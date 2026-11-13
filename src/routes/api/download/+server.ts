import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Payload } from 'youtube-dl-exec';
import { youtubeDl } from 'youtube-dl-exec';
import { MEDIA_DIR } from '$app/env/private';
import { prisma } from '#lib/server/prisma.ts';
import { VIDEO_ID_PATTERN } from '#lib/server/video-id.ts';
import type { RequestHandler } from './$types';

// Concurrent imports of the same clip corrupt its shared media file;
// legacy gated downloads the same way (library-download.md, commit
// 63ca42a).
const importsInFlight = new Set<string>();

const audioFileFor = (youtubeId: string): string => join(MEDIA_DIR, `${youtubeId}.mp3`);

const downloadFlags = () => {
    return {
        output: join(MEDIA_DIR, '%(id)s.%(ext)s'),
        extractAudio: true,
        audioFormat: 'mp3',
        noPlaylist: true,
        quiet: true,
        printJson: true
    };
};

// Audio format matched to the requested video container so the ffmpeg
// merge stays inside the promised <youtubeId>.<ext> (no mkv escape
// across mixed containers); the keyset doubles as the ext whitelist.
const AUDIO_FORMAT_BY_CONTAINER: Record<string, string> = {
    mp4: 'm4a',
    webm: 'webm',
    '3gp': '3gp'
};

interface DownloadRequest {
    videoId?: unknown;
    channel?: unknown;
    thumbnailUrl?: unknown;
    // A { height, ext, ... } option as served by GET /api/formats; label
    // and sizeBytes ride along but only height + ext drive the download.
    resolution?: unknown;
}

interface RequestedResolution {
    height: number;
    ext: string;
}

// null → audio-only (option absent, the default); 'invalid' → malformed
// option answered with 400 rather than a quiet audio-only import
// (sentinel pattern of the stream route's parseRange). 8192 is headroom
// above YouTube's 4320 ceiling; what is actually selectable is the
// formats endpoint's contract.
function parseResolution(value: unknown): RequestedResolution | 'invalid' | null {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        return 'invalid';
    }
    const { height, ext } = value as Record<string, unknown>;
    const heightOk =
        typeof height === 'number' && Number.isInteger(height) && height > 0 && height <= 8192;
    const extOk = typeof ext === 'string' && ext in AUDIO_FORMAT_BY_CONTAINER;
    if (!heightOk || !extOk) {
        return 'invalid';
    }
    return { height, ext };
}

export const POST: RequestHandler = async ({ request }) => {
    const body = (await request.json().catch(() => null)) as DownloadRequest | null;
    const videoId = body?.videoId;

    if (typeof videoId !== 'string' || !VIDEO_ID_PATTERN.test(videoId)) {
        return Response.json(
            { error: 'Send the YouTube videoId of a search result.' },
            { status: 400 }
        );
    }
    const resolution = parseResolution(body?.resolution);
    if (resolution === 'invalid') {
        return Response.json(
            { error: 'resolution must be a height/ext option from /api/formats.' },
            { status: 400 }
        );
    }
    if (importsInFlight.has(videoId)) {
        return Response.json({ error: 'This track is already downloading.' }, { status: 409 });
    }
    // A missing media dir usually means a missing volume mount; silently
    // recreating it would strand the library (library-download.md known
    // bug warning).
    if (!existsSync(MEDIA_DIR)) {
        return Response.json({ error: 'Media dir is missing; import refused.' }, { status: 500 });
    }

    importsInFlight.add(videoId);
    try {
        const audioData = await downloadAudio(videoId);
        const videoPath = resolution ? await downloadVideo(videoId, resolution) : null;
        const metadata = {
            ...audioData,
            channel: stringOrNull(body?.channel),
            thumbnailUrl: stringOrNull(body?.thumbnailUrl)
        };
        // videoPath is sticky: an audio-only re-import keeps an existing
        // track's video association; only a fresh video download rewrites
        // it. Re-importing a known clip refreshes its row instead of
        // duplicating it (unique youtubeId, legacy learning).
        const track = await prisma.track.upsert({
            where: { youtubeId: videoId },
            update: { ...metadata, ...(videoPath ? { videoPath } : {}) },
            create: { youtubeId: videoId, ...metadata, ...(videoPath ? { videoPath } : {}) }
        });
        return Response.json(track);
    } catch (error) {
        console.error(`Import of ${videoId} failed:`, error);
        return Response.json(
            { error: 'Import failed; the download did not complete.' },
            { status: 502 }
        );
    } finally {
        importsInFlight.delete(videoId);
    }
};

async function downloadAudio(youtubeId: string): Promise<ImportedAudio> {
    const result: Payload | string = await youtubeDl(
        `https://www.youtube.com/watch?v=${youtubeId}`,
        downloadFlags()
    );
    const metadata = typeof result === 'object' ? result : null;
    if (!metadata?.title.trim()) {
        throw new Error(`YouTube returned no metadata for ${youtubeId}`);
    }
    if (!existsSync(audioFileFor(youtubeId))) {
        throw new Error(`ffmpeg conversion did not produce ${youtubeId}.mp3`);
    }

    return {
        title: metadata.title.trim(),
        mediaPath: `${youtubeId}.mp3`,
        durationSec: roundedOrNull(metadata.duration)
    };
}

async function downloadVideo(
    youtubeId: string,
    { height, ext }: RequestedResolution
): Promise<string> {
    await youtubeDl(`https://www.youtube.com/watch?v=${youtubeId}`, videoFlags(height, ext));
    const relativePath = `${youtubeId}.${ext}`;
    if (!existsSync(join(MEDIA_DIR, relativePath))) {
        throw new Error(`download did not produce ${relativePath}`);
    }
    return relativePath;
}

// Video + its container's audio in one file; forceOverwrites is what
// lets a resolution switch replace a file yt-dlp would otherwise skip as
// "already recorded" while keeping a stale resolution.
const videoFlags = (height: number, ext: string) => {
    return {
        output: join(MEDIA_DIR, '%(id)s.%(ext)s'),
        format: `bv*[height=${height}][ext=${ext}]+ba[ext=${AUDIO_FORMAT_BY_CONTAINER[ext]}]/b[height=${height}][ext=${ext}]`,
        forceOverwrites: true,
        noPlaylist: true,
        quiet: true
    };
};

interface ImportedAudio {
    title: string;
    mediaPath: string;
    durationSec: number | null;
}

function stringOrNull(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
}

function roundedOrNull(duration: number | undefined): number | null {
    return typeof duration === 'number' && Number.isFinite(duration) ? Math.round(duration) : null;
}

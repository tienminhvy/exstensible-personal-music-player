import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { json } from '@sveltejs/kit';
import type { Payload } from 'youtube-dl-exec';
import { youtubeDl } from 'youtube-dl-exec';
import { MEDIA_DIR } from '$app/env/private';
import { prisma } from '#lib/server/prisma.ts';
import type { RequestHandler } from './$types';

// YouTube ids are exactly 11 chars of [A-Za-z0-9_-]; validating here also
// keeps the id safe to embed in the media filename.
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

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

interface DownloadRequest {
    videoId?: unknown;
}

export const POST: RequestHandler = async ({ request }) => {
    const body = (await request.json().catch(() => null)) as DownloadRequest | null;
    const videoId = body?.videoId;

    if (typeof videoId !== 'string' || !VIDEO_ID_PATTERN.test(videoId)) {
        return json({ error: 'Send the YouTube videoId of a search result.' }, { status: 400 });
    }
    if (importsInFlight.has(videoId)) {
        return json({ error: 'This track is already downloading.' }, { status: 409 });
    }
    // A missing media dir usually means a missing volume mount; silently
    // recreating it would strand the library (library-download.md known
    // bug warning).
    if (!existsSync(MEDIA_DIR)) {
        return json({ error: 'Media dir is missing; import refused.' }, { status: 500 });
    }

    importsInFlight.add(videoId);
    try {
        const trackData = await downloadAudio(videoId);
        const track = await prisma.track.upsert({
            where: { youtubeId: videoId },
            // Re-importing a known clip refreshes its row instead of
            // duplicating it (unique youtubeId, legacy learning).
            update: trackData,
            create: { youtubeId: videoId, ...trackData }
        });
        return json(track);
    } catch (error) {
        console.error(`Import of ${videoId} failed:`, error);
        return json({ error: 'Import failed; the download did not complete.' }, { status: 502 });
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

interface ImportedAudio {
    title: string;
    mediaPath: string;
    durationSec: number | null;
}

function roundedOrNull(duration: number | undefined): number | null {
    return typeof duration === 'number' && Number.isFinite(duration) ? Math.round(duration) : null;
}

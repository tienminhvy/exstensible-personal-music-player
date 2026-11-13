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
        // Unquiet (newline keeps `[download]` lines intact) so the import
        // response can stream live progress; the JSON metadata line is
        // still printed once at the end.
        newline: true,
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

const UNIT_BYTES: Record<string, number> = {
    KiB: 1024,
    MiB: 1_048_576,
    GiB: 1_073_741_824,
    TiB: 1_099_511_627_776
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

interface ImportProgressEvent {
    phase: 'audio' | 'video';
    label: string | null;
    percent: number;
    totalBytes: number | null;
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

// yt-dlp gets its totals from the source HTTP Content-Length; the
// `[download] x% of ~N Unit` lines carry exactly those — so progress
// rides the import response itself and no size endpoint is ever needed
// (library-download.md learning).
function progressFromLine(
    phase: 'audio' | 'video',
    label: string | null,
    line: string
): ImportProgressEvent | null {
    const match = /^\[download\]\s+([\d.]+)%\s+of\s+(?:~\s*)?([\d.]+)(KiB|MiB|GiB|TiB)/.exec(
        line.trim()
    );
    if (!match) {
        return null;
    }
    const percent = Number(match[1]);
    if (!Number.isFinite(percent)) {
        return null;
    }
    const unitBytes = UNIT_BYTES[match[3]];
    const size = Number(match[2]);
    const totalBytes =
        Number.isFinite(size) && unitBytes !== undefined ? Math.round(size * unitBytes) : null;
    return { phase, label, percent, totalBytes };
}

// Throttled per-phase line handler: forward only when the picture
// meaningfully changed, so a fast download does not flood the stream.
function progressHandlerFor(
    phase: 'audio' | 'video',
    label: string | null,
    send: (event: object) => void
): (line: string) => void {
    let sentPercent = -1;
    let sentTotal: number | null = null;
    return (line) => {
        const event = progressFromLine(phase, label, line);
        if (!event) {
            return;
        }
        if (event.percent - sentPercent >= 2 || event.totalBytes !== sentTotal) {
            sentPercent = event.percent;
            sentTotal = event.totalBytes;
            send(event);
        }
    };
}

export const POST: RequestHandler = async ({ request }) => {
    const body = (await request.json().catch(() => null)) as DownloadRequest | null;

    if (
        !body ||
        typeof body.videoId !== 'string' ||
        !VIDEO_ID_PATTERN.test(body.videoId as string)
    ) {
        return Response.json(
            { error: 'Send the YouTube videoId of a search result.' },
            { status: 400 }
        );
    }
    const videoId = body.videoId;
    const resolution = parseResolution(body.resolution);
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

    return new Response(streamImport(request, videoId, body, resolution), {
        headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' }
    });
};

// The import response is a stream of JSON lines, not a finished JSON
// body: download-progress events while the media downloads, then
// `{ track … }` on success — or `{ error … }` on a mid-flight failure
// (pre-download errors above still answer plain Response.json).
function streamImport(
    request: Request,
    videoId: string,
    body: DownloadRequest,
    resolution: RequestedResolution | null
): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();

    return new ReadableStream<Uint8Array>({
        async start(controller) {
            // A request the client aborted leaves the stream unclosed;
            // enqueueing on it throws, which is how the send path and
            // the abort listener learn to stop the subprocess.
            let closed = false;
            // The download functions are module scope, live across both
            // yt-dlp calls, and need to hand the still-running
            // subprocess to the abort listener — a one-slot box instead
            // of threading a kill callback through the download chain.
            const subprocessBox: { active: ReturnType<typeof youtubeDl.exec> | null } = {
                active: null
            };

            const killActive = () => {
                closed = true;
                subprocessBox.active?.kill('SIGKILL');
            };
            const onAbort = () => killActive();
            request.signal.addEventListener('abort', onAbort);

            const send = (event: object) => {
                if (closed) {
                    return;
                }
                try {
                    controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
                } catch {
                    killActive();
                }
            };

            try {
                const audioData = await downloadAudio(
                    videoId,
                    progressHandlerFor('audio', null, send),
                    subprocessBox
                );
                let videoPath: string | null = null;
                if (resolution) {
                    videoPath = await downloadVideo(
                        videoId,
                        resolution,
                        progressHandlerFor('video', `${resolution.height}p`, send),
                        subprocessBox
                    );
                }
                const metadata = {
                    ...audioData,
                    channel: stringOrNull(body.channel),
                    thumbnailUrl: stringOrNull(body.thumbnailUrl)
                };
                // videoPath is sticky: an audio-only re-import keeps an
                // existing track's video association; only a fresh video
                // download rewrites it. Re-importing a known clip
                // refreshes its row instead of duplicating it (unique
                // youtubeId, legacy learning).
                const track = await prisma.track.upsert({
                    where: { youtubeId: videoId },
                    update: { ...metadata, ...(videoPath ? { videoPath } : {}) },
                    create: { youtubeId: videoId, ...metadata, ...(videoPath ? { videoPath } : {}) }
                });
                send({ track });
                controller.close();
            } catch (error) {
                console.error(`Import of ${videoId} failed:`, error);
                send({ error: 'Import failed; the download did not complete.' });
                try {
                    controller.close();
                } catch {
                    // A mid-stream consumer error already closed it.
                }
            } finally {
                request.signal.removeEventListener('abort', onAbort);
                // The gate releases only when this stream settles —
                // success, failure, or a client that walked away —
                // because the handler returned before any download ran.
                importsInFlight.delete(videoId);
            }
        }
    });
}

async function downloadAudio(
    youtubeId: string,
    onLine: (line: string) => void,
    subprocessBox: { active: ReturnType<typeof youtubeDl.exec> | null }
): Promise<ImportedAudio> {
    const stdout = await runWithProgressLines(youtubeId, downloadFlags(), onLine, subprocessBox);
    const metadata = lastJsonObjectLine<Payload>(stdout);
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
    { height, ext }: RequestedResolution,
    onLine: (line: string) => void,
    subprocessBox: { active: ReturnType<typeof youtubeDl.exec> | null }
): Promise<string> {
    await runWithProgressLines(youtubeId, videoFlags(height, ext), onLine, subprocessBox);
    const relativePath = `${youtubeId}.${ext}`;
    if (!existsSync(join(MEDIA_DIR, relativePath))) {
        throw new Error(`download did not produce ${relativePath}`);
    }
    return relativePath;
}

// Streams `[download]` lines while yt-dlp runs, then resolves with the
// full buffered stdout (tinyspawn collects it independently of the
// lines consumed here). The live subprocess is registered in `box` so a
// client disconnect can kill a download that would otherwise keep
// running for nobody.
async function runWithProgressLines(
    youtubeId: string,
    flags: Parameters<typeof youtubeDl.exec>[1],
    onLine: (line: string) => void,
    subprocessBox: { active: ReturnType<typeof youtubeDl.exec> | null }
): Promise<string> {
    const subprocess = youtubeDl.exec(`https://www.youtube.com/watch?v=${youtubeId}`, flags);
    subprocessBox.active = subprocess;
    try {
        const stdout = subprocess.stdout;
        if (stdout) {
            let buffer = '';
            for await (const chunk of stdout) {
                buffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    onLine(line);
                }
            }
        }
        const { stdout: full } = await subprocess;
        return full;
    } finally {
        subprocessBox.active = null;
    }
}

// yt-dlp prints the postprocessed metadata as one JSON line, preceded by
// progress and destination lines; take the last object line that parses.
function lastJsonObjectLine<T>(stdout: string): T | null {
    for (const line of stdout.split('\n').reverse()) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('{')) {
            continue;
        }
        try {
            return JSON.parse(trimmed) as T;
        } catch {
            // keep scanning backwards
        }
    }
    return null;
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
        newline: true
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

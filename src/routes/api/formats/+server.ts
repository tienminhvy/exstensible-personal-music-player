import type { Format, Payload } from 'youtube-dl-exec';
import { youtubeDl } from 'youtube-dl-exec';
import { VIDEO_ID_PATTERN } from '#lib/server/video-id.ts';
import type { RequestHandler } from './$types';

interface FormatOption {
    label: string;
    height: number;
    ext: string;
    sizeBytes: number | null;
}

export const GET: RequestHandler = async ({ url }) => {
    const videoId = url.searchParams.get('videoId');
    if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) {
        return Response.json(
            { error: 'Send the YouTube videoId of a search result.' },
            { status: 400 }
        );
    }

    try {
        const result: Payload | string = await youtubeDl(
            `https://www.youtube.com/watch?v=${videoId}`,
            { dumpSingleJson: true, noPlaylist: true, quiet: true }
        );
        const metadata = typeof result === 'object' ? result : null;
        if (!metadata?.formats?.length) {
            throw new Error(`YouTube returned no formats for ${videoId}`);
        }
        return Response.json({ videoId, formats: formatOptions(metadata) });
    } catch (error) {
        console.error(`Format listing for ${videoId} failed:`, error);
        return Response.json({ error: 'YouTube metadata fetch failed.' }, { status: 502 });
    }
};

// A resolution picker needs ONE option per height; yt-dlp lists multiple
// renderings per height, so keep the best per height (mp4 preferred, then
// the larger file).
function formatOptions(payload: Payload): FormatOption[] {
    const options = new Map<number, FormatOption>();
    for (const format of payload.formats) {
        const height = videoHeightOrNull(format);
        const option = height !== null ? toOption(format, height) : null;
        if (option && betterRender(option, options.get(option.height))) {
            options.set(option.height, option);
        }
    }
    return [...options.values()].sort((a, b) => b.height - a.height);
}

function videoHeightOrNull(format: Format): number | null {
    return format.vcodec && format.vcodec !== 'none' && typeof format.height === 'number'
        ? format.height
        : null;
}

// undefined current = nothing kept yet; mp4 wins ties, then file size.
function betterRender(next: FormatOption, current?: FormatOption): boolean {
    if (!current) {
        return true;
    }
    if ((current.ext === 'mp4') !== (next.ext === 'mp4')) {
        return next.ext === 'mp4';
    }
    return (current.sizeBytes ?? 0) < (next.sizeBytes ?? 0);
}

function toOption(format: Format, height: number): FormatOption {
    return {
        label: `${height}p`,
        height,
        ext: format.ext,
        sizeBytes: format.filesize ?? format.filesize_approx ?? null
    };
}

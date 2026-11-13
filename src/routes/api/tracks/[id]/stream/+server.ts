import { createReadStream, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { MEDIA_DIR } from '$app/env/private';
import { prisma } from '#lib/server/prisma.ts';
import type { RequestHandler } from './$types';

const MIME_BY_EXTENSION: Record<string, string> = {
    '.mp3': 'audio/mpeg'
};

function mimeTypeFor(audioFile: string): string {
    const dot = audioFile.lastIndexOf('.');
    return MIME_BY_EXTENSION[audioFile.slice(dot)] ?? 'application/octet-stream';
}

interface ByteRange {
    start: number;
    end: number;
}

// null → serve full (no Range, or malformed — malformed header is
// ignored per RFC 9110). 'unsatisfiable' → the 416 contract (legacy
// af614ba: out-of-bounds ranges must fail loudly, not clamp into
// wrong audio).
function parseRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | null {
    if (!header) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match || (match[1] === '' && match[2] === '')) return null;

    if (match[1] === '') {
        const suffix = Number(match[2]);
        if (suffix === 0) return 'unsatisfiable';
        return { start: Math.max(0, size - suffix), end: size - 1 };
    }
    const start = Number(match[1]);
    if (start >= size) return 'unsatisfiable';
    if (match[2] === '') return { start, end: size - 1 };
    const requestedEnd = Number(match[2]);
    if (requestedEnd < start) return 'unsatisfiable';
    return { start, end: Math.min(requestedEnd, size - 1) };
}

function audioResponse(
    audioFile: string,
    mimeType: string,
    status: number,
    range: ByteRange | null,
    size: number
): Response {
    const streamArgs = range ? { start: range.start, end: range.end } : undefined;
    const body = Readable.toWeb(
        createReadStream(audioFile, streamArgs)
    ) as ReadableStream<Uint8Array>;
    const headers: Record<string, string> = {
        'Content-Type': mimeType,
        'Content-Length': String(range ? range.end - range.start + 1 : size),
        'Accept-Ranges': 'bytes'
    };
    if (range) {
        headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    }
    return new Response(body, { status, headers });
}

export const GET: RequestHandler = async ({ params, request }) => {
    const track = await prisma.track.findUnique({ where: { id: params.id } });
    if (!track) {
        return Response.json({ error: 'Track not found.' }, { status: 404 });
    }
    const audioFile = join(MEDIA_DIR, track.mediaPath);
    let size: number;
    try {
        size = statSync(audioFile).size;
    } catch {
        // Rows keep RELATIVE media paths on purpose (library-loss
        // incident); a missing file behind a live row is reported, not
        // recreated here.
        return Response.json({ error: 'File not found.' }, { status: 404 });
    }

    const mimeType = mimeTypeFor(audioFile);
    const range = parseRange(request.headers.get('range'), size);
    if (range === 'unsatisfiable') {
        return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${size}` }
        });
    }
    return audioResponse(audioFile, mimeType, range ? 206 : 200, range, size);
};

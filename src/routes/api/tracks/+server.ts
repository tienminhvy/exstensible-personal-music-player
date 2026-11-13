import { prisma } from '#lib/server/prisma.ts';
import type { RequestHandler } from './$types';

// Minimal G2: browse the library, optionally narrowed by title.
export const GET: RequestHandler = async ({ url }) => {
    const query = url.searchParams.get('q')?.trim();
    const tracks = await prisma.track.findMany({
        where: query ? { title: { contains: query, mode: 'insensitive' } } : undefined,
        orderBy: { createdAt: 'desc' }
    });
    return Response.json(tracks);
};

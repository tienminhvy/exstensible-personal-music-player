import { error } from '@sveltejs/kit';
import type { TrackRow } from '#lib/track.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => {
    const response = await fetch('/api/tracks');
    if (!response.ok) {
        throw error(503, 'Library unavailable');
    }
    const tracks = (await response.json()) as TrackRow[];
    return { tracks };
};

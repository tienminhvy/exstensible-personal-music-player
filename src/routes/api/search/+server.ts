import { json } from '@sveltejs/kit';
import { YOUTUBE_API_KEY } from '$app/env/private';
import type { RequestHandler } from './$types';

interface VideoResult {
    videoId: string;
    title: string;
    channel: string;
    thumbnailUrl: string;
}

interface YouTubeSearchItem {
    id?: { videoId?: string };
    snippet?: {
        title?: string;
        channelTitle?: string;
        thumbnails?: Record<string, { url?: string }>;
    };
}

// One YouTube API call per request, capped results; API quota is the
// intake pipeline's shared constraint.
const RESULTS_LIMIT = 10;

export const GET: RequestHandler = async ({ url }) => {
    const query = url.searchParams.get('q')?.trim();
    if (!query) {
        return json({ error: 'Provide a search query.' }, { status: 400 });
    }

    if (!YOUTUBE_API_KEY) {
        return json({ error: 'YOUTUBE_API_KEY is not configured.' }, { status: 500 });
    }

    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', String(RESULTS_LIMIT));
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('key', YOUTUBE_API_KEY);

    const response = await fetch(searchUrl);
    if (!response.ok) {
        return json({ error: 'YouTube search failed.' }, { status: 502 });
    }

    const payload = (await response.json()) as { items?: YouTubeSearchItem[] };
    return json(parseResults(payload));
};

function parseResults(payload: { items?: YouTubeSearchItem[] }): VideoResult[] {
    return (payload.items ?? []).map((item) => ({
        videoId: item.id?.videoId ?? '',
        title: item.snippet?.title ?? '',
        channel: item.snippet?.channelTitle ?? '',
        thumbnailUrl:
            item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url ?? ''
    }));
}

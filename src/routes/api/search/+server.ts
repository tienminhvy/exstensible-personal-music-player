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

// One YouTube API call per request, capped results — both limits
// conserve the API quota granted to the key.
const RESULTS_LIMIT = 10;

export const GET: RequestHandler = async ({ url }) => {
    const query = url.searchParams.get('q')?.trim();
    if (!query) {
        return Response.json({ error: 'Provide a search query.' }, { status: 400 });
    }

    if (!YOUTUBE_API_KEY) {
        return Response.json({ error: 'YOUTUBE_API_KEY is not configured.' }, { status: 500 });
    }

    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('type', 'video');
    searchUrl.searchParams.set('maxResults', String(RESULTS_LIMIT));
    searchUrl.searchParams.set('q', query);
    searchUrl.searchParams.set('key', YOUTUBE_API_KEY);

    const response = await fetch(searchUrl);
    if (!response.ok) {
        return Response.json({ error: 'YouTube search failed.' }, { status: 502 });
    }

    const payload = (await response.json()) as { items?: YouTubeSearchItem[] };
    return Response.json(parseResults(payload));
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

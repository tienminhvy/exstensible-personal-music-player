// JSON shape of a Track row as the API serves it; dates are ISO strings.
// videoPath/channel/thumbnailUrl are nullable: rows imported before the
// video/metadata columns keep working (audio-only, no channel captured).
export interface TrackRow {
    id: string;
    title: string;
    youtubeId: string;
    mediaPath: string;
    videoPath: string | null;
    channel: string | null;
    thumbnailUrl: string | null;
    durationSec: number | null;
    createdAt: string;
    updatedAt: string;
}

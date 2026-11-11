// JSON shape of a Track row as the API serves it; dates are ISO strings.
export interface TrackRow {
    id: string;
    title: string;
    youtubeId: string;
    mediaPath: string;
    durationSec: number | null;
    createdAt: string;
    updatedAt: string;
}

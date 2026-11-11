import type { TrackRow } from '#lib/track.ts';

function streamUrl(trackId: string): string {
    return `/api/tracks/${trackId}/stream`;
}

/*
 * User selection is authoritative (legacy player-core.md epoch guard):
 * every user action bumps the epoch, and every async start captures the
 * epoch it began under and bails if the user has acted again — a stale
 * start may never clobber a later selection or pause. Keep this pattern
 * for any future deferred advance (queue, autoplay).
 */
class PlayerStore {
    current = $state<TrackRow | null>(null);
    playing = $state(false);
    currentTime = $state(0);
    duration = $state(0);
    error = $state('');

    #element: HTMLAudioElement | null = null;
    #epoch = 0;

    attach(element: HTMLAudioElement): void {
        this.#element = element;
    }

    async select(track: TrackRow): Promise<void> {
        const epoch = ++this.#epoch;
        this.current = track;
        this.currentTime = 0;
        this.duration = track.durationSec ?? 0;
        this.error = '';
        const element = this.#element;
        if (!element) return;
        element.src = streamUrl(track.id);
        element.load();
        try {
            await element.play();
        } catch {
            if (epoch === this.#epoch) {
                this.playing = false;
                this.error = 'Playback could not start; try again.';
            }
        }
    }

    toggle(): void {
        const element = this.#element;
        if (!element || !this.current) return;
        if (element.paused) {
            if (element.ended) {
                element.currentTime = 0;
            }
            void this.#start();
        } else {
            ++this.#epoch;
            element.pause();
        }
    }

    seek(time: number): void {
        const element = this.#element;
        if (!element || !this.current) return;
        ++this.#epoch;
        const clamped = Math.min(Math.max(time, 0), this.duration);
        element.currentTime = clamped;
        this.currentTime = clamped;
    }

    playStarted(): void {
        this.playing = true;
        this.error = '';
    }

    playPaused(): void {
        this.playing = false;
    }

    progressTick(seconds: number): void {
        if (Number.isFinite(seconds) && seconds >= 0) {
            this.currentTime = seconds;
        }
    }

    metadataLoaded(totalSeconds: number): void {
        if (Number.isFinite(totalSeconds) && totalSeconds > 0) {
            this.duration = totalSeconds;
        }
    }

    trackEnded(): void {
        this.currentTime = this.duration;
        this.playing = false;
    }

    playbackFailed(): void {
        this.playing = false;
        this.error = 'The audio file could not be loaded.';
    }

    async #start(): Promise<void> {
        const epoch = ++this.#epoch;
        const element = this.#element;
        if (!element) return;
        try {
            await element.play();
        } catch {
            if (epoch === this.#epoch) {
                this.playing = false;
                this.error = 'Playback could not start; try again.';
            }
        }
    }
}

export const player = new PlayerStore();

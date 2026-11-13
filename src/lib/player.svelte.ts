import type { TrackRow } from '#lib/track.ts';

function streamUrl(trackId: string): string {
    return `/api/tracks/${trackId}/stream`;
}

export type RepeatMode = 'none' | 'all' | 'one';

const repeatCycle: RepeatMode[] = ['none', 'all', 'one'];

/*
 * User selection is authoritative (legacy player-core.md epoch guard):
 * every user action bumps the epoch, and every play attempt captures the
 * epoch it began under and bails if the user has acted again — a stale
 * start may never clobber a later selection or pause. Deferred advances
 * (natural end) capture WITHOUT bumping: a user action that already
 * happened keeps winning against a pending advance. Natural end advances
 * from the element's `ended` event — never a timer (2026-09-15 race
 * rule); every deferred advance keeps this pattern.
 */
class PlayerStore {
    queue = $state<TrackRow[]>([]);
    currentIndex = $state(-1);
    repeat = $state<RepeatMode>('none');
    speed = $state(1);
    playing = $state(false);
    currentTime = $state(0);
    duration = $state(0);
    error = $state('');

    #element: HTMLAudioElement | null = null;
    #epoch = 0;

    get current(): TrackRow | null {
        return this.queue[this.currentIndex] ?? null;
    }

    attach(element: HTMLAudioElement): void {
        this.#element = element;
        this.#applySpeed(element);
    }

    /* Play a track now: a track that is already queued jumps to its queue
     * slot (restart when it is the current one); a new track is appended
     * and played — the rest of the queue stays intact (T4.2 adds the
     * queue UI around this model). */
    async select(track: TrackRow): Promise<void> {
        ++this.#epoch;
        const existing = this.queue.findIndex((entry) => entry.id === track.id);
        this.currentIndex = existing === -1 ? this.queue.push(track) - 1 : existing;
        await this.#beginPlayback();
    }

    async next(): Promise<void> {
        if (!this.current) return;
        ++this.#epoch;
        if (this.currentIndex < this.queue.length - 1) {
            this.currentIndex += 1;
            await this.#beginPlayback();
            return;
        }
        if (this.repeat === 'all') {
            this.currentIndex = 0;
            await this.#beginPlayback();
            return;
        }
        /* Queue ends cleanly: pause via the element so the `paused` event
         * (and the element's actual state) stays the source of truth. */
        this.#element?.pause();
    }

    async previous(): Promise<void> {
        if (!this.current) return;
        ++this.#epoch;
        if (this.currentIndex > 0) {
            this.currentIndex -= 1;
        } else if (this.repeat === 'all') {
            this.currentIndex = this.queue.length - 1;
        }
        await this.#beginPlayback();
    }

    cycleRepeat(): void {
        this.repeat = repeatCycle[(repeatCycle.indexOf(this.repeat) + 1) % repeatCycle.length];
    }

    setSpeed(rate: number): void {
        if (!Number.isFinite(rate) || rate <= 0) return;
        this.speed = rate;
        const element = this.#element;
        if (element) {
            this.#applySpeed(element);
        }
    }

    toggle(): void {
        const element = this.#element;
        if (!element || !this.current) return;
        ++this.#epoch;
        if (element.paused) {
            if (element.ended) {
                element.currentTime = 0;
            }
            void this.#resume();
        } else {
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

    /*
     * Natural end: the element `ended` event. This is a deferred advance,
     * not a user action — it captures the epoch without bumping (through
     * the guarded #start it reaches), so a click after the advance
     * started wins the race. Repeat `one` replays the track, repeat
     * `all` wraps to the queue head, and repeat `none` lets the queue
     * end cleanly on the last track.
     */
    async trackEnded(): Promise<void> {
        this.currentTime = this.duration;
        this.playing = false;
        const element = this.#element;
        if (!element || !this.current) return;
        if (this.repeat === 'one') {
            element.currentTime = 0;
            this.currentTime = 0;
            await this.#start(element);
            return;
        }
        if (this.currentIndex === this.queue.length - 1 && this.repeat !== 'all') {
            return;
        }
        this.currentIndex =
            this.repeat === 'all'
                ? (this.currentIndex + 1) % this.queue.length
                : this.currentIndex + 1;
        await this.#beginPlayback();
    }

    playbackFailed(): void {
        this.playing = false;
        this.error = 'The audio file could not be loaded.';
    }

    async #resume(): Promise<void> {
        const element = this.#element;
        if (!element) return;
        await this.#start(element);
    }

    /* Play attempt with its own epoch capture: user paths have already
     * bumped before reaching here; deferred advances must not. Failure
     * writes only happen while the epoch still matches. */
    async #start(element: HTMLAudioElement): Promise<void> {
        const epoch = this.#epoch;
        try {
            await element.play();
        } catch {
            if (epoch === this.#epoch) {
                this.playing = false;
                this.error = 'Playback could not start; try again.';
            }
        }
    }

    /* Load the current queue entry and start it. */
    async #beginPlayback(): Promise<void> {
        const element = this.#element;
        const track = this.current;
        if (!element || !track) return;
        element.src = streamUrl(track.id);
        element.load();
        this.currentTime = 0;
        this.duration = track.durationSec ?? 0;
        this.error = '';
        this.#applySpeed(element);
        await this.#start(element);
    }

    /* Mirror the speed onto both rates: load() resets playbackRate to
     * defaultPlaybackRate, so setting default keeps the speed across
     * track changes. */
    #applySpeed(element: HTMLAudioElement): void {
        element.playbackRate = this.speed;
        element.defaultPlaybackRate = this.speed;
    }
}

export const player = new PlayerStore();

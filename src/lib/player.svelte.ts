import { browser } from '$app/env';
import type { TrackRow } from '#lib/track.ts';

/* The media element doubles as the video display (legacy
 * library-download.md): a row carrying a video file streams its video
 * file (`?variant=video`) through the same element — but only while the
 * user has revealed the video display; otherwise every track (video
 * rows included) plays the plain audio stream, so video never decodes
 * in the background (repair R2: the always-decoding dock video froze
 * the user's machine). */
function streamUrl(trackId: string, variant: 'audio' | 'video'): string {
    const base = `/api/tracks/${trackId}/stream`;
    return variant === 'video' ? `${base}?variant=video` : base;
}

export type RepeatMode = 'none' | 'all' | 'one';

const repeatCycle: RepeatMode[] = ['none', 'all', 'one'];

/* Shape of the persisted player state (T4.3): everything a reload needs
 * to restore the queue paused at its saved position. `playing` is never
 * persisted — a reload always restores paused. */
const storageKey = 'player';

interface SavedPlayerState {
    queue: TrackRow[];
    currentIndex: number;
    position: number;
    repeat: RepeatMode;
    speed: number;
}

function readSavedPlayerState(): SavedPlayerState | null {
    if (!browser) return null;
    try {
        const raw = localStorage.getItem(storageKey);
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return null;
        const candidate = parsed as Partial<SavedPlayerState>;
        if (!Array.isArray(candidate.queue)) return null;
        const queue = candidate.queue.filter(
            (entry): entry is TrackRow =>
                typeof entry === 'object' &&
                entry !== null &&
                typeof (entry as TrackRow).id === 'string' &&
                typeof (entry as TrackRow).title === 'string'
        );
        const rawIndex = candidate.currentIndex;
        const currentIndex =
            typeof rawIndex === 'number' && Number.isFinite(rawIndex) && Number.isInteger(rawIndex)
                ? Math.min(Math.max(rawIndex, -1), queue.length - 1)
                : -1;
        const repeat = repeatCycle.includes(candidate.repeat as RepeatMode)
            ? (candidate.repeat as RepeatMode)
            : 'none';
        const speed =
            typeof candidate.speed === 'number' &&
            Number.isFinite(candidate.speed) &&
            candidate.speed > 0
                ? candidate.speed
                : 1;
        const position =
            typeof candidate.position === 'number' &&
            Number.isFinite(candidate.position) &&
            candidate.position >= 0
                ? candidate.position
                : 0;
        return { queue, currentIndex, position, repeat, speed };
    } catch {
        return null;
    }
}

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
    /* Video reveal (repair R2): video rows stream their audio variant
     * until the user explicitly shows the video display. In-session
     * only — never persisted, so a reload starts hidden again. */
    videoRevealed = $state(false);

    #element: HTMLMediaElement | null = null;
    #epoch = 0;
    #pendingPosition: number | null = null;
    #lastPersist = 0;

    constructor() {
        if (browser) {
            this.#restore();
        }
    }

    get current(): TrackRow | null {
        return this.queue[this.currentIndex] ?? null;
    }

    attach(element: HTMLMediaElement): void {
        this.#element = element;
        this.#applySpeed(element);
    }

    /* Play a track now: a track that is already queued jumps to its queue
     * slot (restart when it is the current one); a new track is appended
     * and played — the rest of the queue stays intact (T4.2 adds the
     * queue UI around this model). The jump refreshes the stored row with
     * the library's current data, so a row that gained a video file after
     * it was queued plays as video instead of showing a stale audio-only
     * entry (T6.1). */
    async select(track: TrackRow): Promise<void> {
        ++this.#epoch;
        const existing = this.queue.findIndex((entry) => entry.id === track.id);
        if (existing === -1) {
            this.currentIndex = this.queue.push(track) - 1;
        } else {
            this.queue[existing] = track;
            this.currentIndex = existing;
        }
        await this.#beginPlayback();
    }

    /* Enqueue without stealing playback: the queue grows by one and no
     * index, element, or epoch changes — even a pending natural-end
     * advance stays valid (enqueue is not a user playback action).
     * Duplicates are allowed; select jumps to an already-queued track. */
    enqueue(track: TrackRow): void {
        this.queue.push(track);
        this.#persist();
    }

    /* Adjacent-swap reorder that never disturbs playback: the element is
     * untouched, so a playing track keeps playing while it moves slots.
     * The current index follows the track across the swap (exact for
     * adjacent swaps, duplicate ids included). Reordering is not a user
     * playback action: the epoch does not bump. */
    moveUp(index: number): void {
        this.#swap(index, index - 1);
    }

    moveDown(index: number): void {
        this.#swap(index, index + 1);
    }

    #swap(index: number, other: number): void {
        if (index < 0 || index >= this.queue.length) return;
        if (other < 0 || other >= this.queue.length) return;
        const entry = this.queue[index];
        this.queue[index] = this.queue[other];
        this.queue[other] = entry;
        if (this.currentIndex === index) {
            this.currentIndex = other;
        } else if (this.currentIndex === other) {
            this.currentIndex = index;
        }
        this.#persist();
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
        this.#persist();
    }

    setSpeed(rate: number): void {
        if (!Number.isFinite(rate) || rate <= 0) return;
        this.speed = rate;
        this.#persist();
        const element = this.#element;
        if (element) {
            this.#applySpeed(element);
        }
    }

    #currentVariant(): 'audio' | 'video' {
        return this.current?.videoPath && this.videoRevealed ? 'video' : 'audio';
    }

    /* Show or hide the video display (repair R2). A videoPath row's
     * element swaps variant at the current position, keeping the
     * element identity (same DOM node, so attach/epoch/persistence
     * contracts hold); playback resumes if it was playing. Audio-only
     * rows and a hidden reveal need no reload. This is a user playback
     * action: the epoch bumps. */
    async setVideoReveal(on: boolean): Promise<void> {
        if (this.videoRevealed === on) return;
        this.videoRevealed = on;
        const track = this.current;
        const element = this.#element;
        if (!track?.videoPath || !element) return;
        ++this.#epoch;
        const wasPlaying = !element.paused;
        const position = element.currentTime;
        element.src = streamUrl(track.id, on ? 'video' : 'audio');
        element.load();
        this.duration = track.durationSec ?? 0;
        /* Planting currentTime before metadata loads keeps the position
         * (same pre-metadata pattern the post-reload first Play uses). */
        element.currentTime = position;
        this.currentTime = position;
        this.#applySpeed(element);
        if (wasPlaying) {
            await this.#start(element);
        } else {
            element.pause();
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
        this.#pendingPosition = null;
        element.currentTime = clamped;
        this.currentTime = clamped;
        this.#persist();
    }

    playStarted(): void {
        this.playing = true;
        this.error = '';
    }

    playPaused(): void {
        this.playing = false;
        this.#persist();
    }

    progressTick(seconds: number): void {
        if (Number.isFinite(seconds) && seconds >= 0) {
            this.currentTime = seconds;
            /* Throttled position save: timeupdate fires ~4×/s while
             * playing; persist at most every 2s so page eviction keeps
             * the position within seconds (#persist refreshes the
             * throttle stamp for every save path). */
            if (Date.now() - this.#lastPersist >= 2000) {
                this.#persist();
            }
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
            this.#persist();
            await this.#start(element);
            return;
        }
        if (this.currentIndex === this.queue.length - 1 && this.repeat !== 'all') {
            this.#persist();
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
        this.error = 'The media file could not be loaded.';
    }

    /* Resume without clobbering a restored-but-not-yet-loaded element:
     * after a page reload nothing has a src yet, so the first Play loads
     * the current track through its revealed variant (video rows stream
     * the video file only while the video display is revealed, else the
     * audio stream) and consumes the saved position (setting currentTime
     * before metadata loads plants the default playback start position).
     * A user seek cleared the saved position first. */
    async #resume(): Promise<void> {
        const element = this.#element;
        const track = this.current;
        if (!element || !track) return;
        const variant = this.#currentVariant();
        if (element.getAttribute('src') !== streamUrl(track.id, variant)) {
            element.src = streamUrl(track.id, variant);
            element.load();
            this.duration = track.durationSec ?? 0;
            this.error = '';
            this.#applySpeed(element);
        }
        const pending = this.#pendingPosition;
        if (pending !== null) {
            element.currentTime = pending;
            this.currentTime = pending;
            this.#pendingPosition = null;
        }
        await this.#start(element);
    }

    /* Play attempt with its own epoch capture: user paths have already
     * bumped before reaching here; deferred advances must not. Failure
     * writes only happen while the epoch still matches. */
    async #start(element: HTMLMediaElement): Promise<void> {
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
        element.src = streamUrl(track.id, this.#currentVariant());
        element.load();
        this.currentTime = 0;
        this.duration = track.durationSec ?? 0;
        this.error = '';
        this.#applySpeed(element);
        this.#persist();
        await this.#start(element);
    }

    /* Reload hydration (T4.3): queue/currentIndex/position/repeat/
     * speed come back from localStorage; playback always restores
     * paused. The saved position waits as #pendingPosition until the
     * first Play (or a superseding seek) consumes it. Speed rides the
     * attach() call of #applySpeed so BOTH rates carry the restored
     * speed from the first element interaction. */
    #restore(): void {
        const saved = readSavedPlayerState();
        if (saved === null) return;
        this.queue = saved.queue;
        this.currentIndex = saved.currentIndex;
        this.repeat = saved.repeat;
        this.speed = saved.speed;
        const current = this.current;
        this.duration = current?.durationSec ?? 0;
        const maxDuration = this.duration;
        const position = maxDuration > 0 ? Math.min(saved.position, maxDuration) : saved.position;
        this.currentTime = position;
        if (current !== null) {
            this.#pendingPosition = position;
        }
    }

    persistNow(): void {
        this.#persist();
    }

    #persist(): void {
        if (!browser) return;
        this.#lastPersist = Date.now();
        const saved: SavedPlayerState = {
            queue: this.queue,
            currentIndex: this.currentIndex,
            position: this.currentTime,
            repeat: this.repeat,
            speed: this.speed
        };
        try {
            localStorage.setItem(storageKey, JSON.stringify(saved));
        } catch {
            /* Persistence is best-effort: storage may be unavailable
             * (private mode, quota) without breaking playback. */
        }
    }

    /* Mirror the speed onto both rates: load() resets playbackRate to
     * defaultPlaybackRate, so setting default keeps the speed across
     * track changes. */
    #applySpeed(element: HTMLMediaElement): void {
        element.playbackRate = this.speed;
        element.defaultPlaybackRate = this.speed;
    }
}

export const player = new PlayerStore();

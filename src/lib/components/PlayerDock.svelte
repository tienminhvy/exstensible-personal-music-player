<script lang="ts">
    import { browser } from '$app/env';
    import Icon from '#lib/components/Icon.svelte';
    import { player } from '#lib/player.svelte.ts';
    import { formatClock } from '#lib/time.ts';

    let mediaElement = $state<HTMLVideoElement>();
    let scrubTime = $state<number | null>(null);
    let queueOpen = $state(false);

    $effect(() => {
        if (mediaElement) {
            player.attach(mediaElement);
        }
    });

    /* Page-eviction survival: flush the player state synchronously when
     * the page goes away, so the restored position is never more than
     * the last save behind. */
    $effect(() => {
        if (!browser) return;
        const flush = () => player.persistNow();
        window.addEventListener('pagehide', flush);
        return () => window.removeEventListener('pagehide', flush);
    });

    const speedOptions = [0.75, 1, 1.25, 1.5, 2];

    function onScrub(event: Event): void {
        scrubTime = Number((event.currentTarget as HTMLInputElement).value);
    }

    function onScrubCommit(): void {
        if (scrubTime !== null) {
            player.seek(scrubTime);
        }
        scrubTime = null;
    }

    function onSpeed(event: Event): void {
        player.setSpeed(Number((event.currentTarget as HTMLSelectElement).value));
    }

    function onQueueToggle(): void {
        queueOpen = !queueOpen;
    }

    /* Fullscreen toggle (legacy library-download.md parity): button plus
     * double-click on the video. Fullscreen can be unavailable or
     * rejected; playback never depends on it. */
    async function toggleFullscreen(): Promise<void> {
        const el = mediaElement;
        if (!el) return;
        try {
            if (document.fullscreenElement === el) {
                await document.exitFullscreen();
            } else {
                await el.requestFullscreen();
            }
        } catch {
            return;
        }
    }
</script>

<div class="DockedZone">
    {#if browser}
        <div
            class={player.current?.videoPath && player.videoRevealed
                ? 'VideoSection'
                : 'HiddenShell'}
        >
            <video
                bind:this={mediaElement}
                class={player.current?.videoPath && player.videoRevealed
                    ? 'DockVideo'
                    : 'NativeMedia'}
                preload="metadata"
                playsinline
                ondblclick={toggleFullscreen}
                onplay={() => player.playStarted()}
                onpause={() => player.playPaused()}
                ontimeupdate={() => player.progressTick(mediaElement?.currentTime ?? 0)}
                onloadedmetadata={() => player.metadataLoaded(mediaElement?.duration ?? 0)}
                onended={() => void player.trackEnded()}
                onerror={() => player.playbackFailed()}
            ></video>
        </div>
    {/if}
    <section class="PlayerDock" aria-label="Player">
        <div class="DockInner">
            {#if browser && player.current}
                <input
                    class="DockSeek"
                    type="range"
                    min="0"
                    max={player.duration || 1}
                    step="1"
                    value={scrubTime ?? player.currentTime}
                    aria-label="Seek within the track"
                    oninput={onScrub}
                    onchange={onScrubCommit}
                />
                <div class="DockMeta">
                    <span class="DockTitle">{player.current.title}</span>
                    <span class="DockTime">
                        {formatClock(scrubTime ?? player.currentTime)} / {formatClock(
                            player.duration
                        )}
                    </span>
                </div>
                <div class="DockControls">
                    <button
                        class="IconButton"
                        type="button"
                        aria-label="Previous track"
                        title="Previous track"
                        onclick={() => void player.previous()}
                    >
                        <Icon name="prev" />
                    </button>
                    <button
                        class="IconButton IconButtonPlay"
                        type="button"
                        aria-label={player.playing ? 'Pause' : 'Play'}
                        title={player.playing ? 'Pause' : 'Play'}
                        onclick={() => player.toggle()}
                    >
                        {#if player.playing}
                            <Icon name="pause" />
                        {:else}
                            <Icon name="play" />
                        {/if}
                    </button>
                    <button
                        class="IconButton"
                        type="button"
                        aria-label="Next track"
                        title="Next track"
                        onclick={() => void player.next()}
                    >
                        <Icon name="next" />
                    </button>
                    <button
                        class="IconButton"
                        class:IconButtonOff={player.repeat === 'none'}
                        type="button"
                        aria-label="Repeat: {player.repeat}"
                        title="Repeat: {player.repeat}"
                        onclick={() => player.cycleRepeat()}
                    >
                        <Icon name="repeat" />
                        {#if player.repeat === 'one'}
                            <span class="ModeBadge">1</span>
                        {/if}
                    </button>
                    <label class="SpeedLabel" for="player-speed" aria-label="Playback speed">
                        <Icon name="speed" />
                    </label>
                    <select
                        id="player-speed"
                        class="SpeedSelect"
                        value={player.speed}
                        onchange={onSpeed}
                    >
                        {#each speedOptions as rate (rate)}
                            <option value={rate}>{rate}×</option>
                        {/each}
                    </select>
                    {#if player.current?.videoPath}
                        <button
                            class="IconButton"
                            type="button"
                            aria-pressed={player.videoRevealed}
                            aria-label={player.videoRevealed
                                ? 'Hide video display'
                                : 'Show video display'}
                            title={player.videoRevealed
                                ? 'Hide video display'
                                : 'Show video display'}
                            onclick={() => void player.setVideoReveal(!player.videoRevealed)}
                        >
                            <Icon name="video" />
                        </button>
                    {/if}
                    {#if player.current?.videoPath && player.videoRevealed}
                        <button
                            class="IconButton"
                            type="button"
                            aria-label="Toggle video fullscreen"
                            title="Toggle video fullscreen"
                            onclick={() => void toggleFullscreen()}
                        >
                            <Icon name="fullscreen" />
                        </button>
                    {/if}
                </div>
                {#if player.error}
                    <p class="Hint" role="status">{player.error}</p>
                {/if}
            {:else}
                <p class="Hint">Select a track in your library to play it.</p>
            {/if}
            {#if browser && player.queue.length > 0}
                <button
                    class="IconButton IconButtonWide"
                    type="button"
                    aria-expanded={queueOpen}
                    aria-controls="PlayerDockQueue"
                    aria-label="Toggle queue visibility"
                    title="Toggle queue visibility"
                    onclick={onQueueToggle}
                >
                    <Icon name="queue" />
                    <span class="QueueCount">{player.queue.length}</span>
                </button>
                {#if queueOpen}
                    <ol class="QueueList" id="PlayerDockQueue">
                        {#each player.queue as entry, index (index)}
                            <li
                                class="QueueEntry"
                                class:QueueEntryCurrent={index === player.currentIndex}
                            >
                                {#if index === player.currentIndex}
                                    <span class="QueueNow">Now</span>
                                {/if}
                                <span class="QueueTitle">{entry.title}</span>
                                <span class="QueueActions">
                                    <button
                                        class="QueueMoveButton"
                                        type="button"
                                        disabled={index === 0}
                                        aria-label="Move {entry.title} up in the queue"
                                        onclick={() => player.moveUp(index)}
                                    >
                                        ↑
                                    </button>
                                    <button
                                        class="QueueMoveButton"
                                        type="button"
                                        disabled={index === player.queue.length - 1}
                                        aria-label="Move {entry.title} down in the queue"
                                        onclick={() => player.moveDown(index)}
                                    >
                                        ↓
                                    </button>
                                </span>
                            </li>
                        {/each}
                    </ol>
                {/if}
            {/if}
        </div>
    </section>
</div>

<style>
    /* The fixed docked zone holds the video panel and the control
     * bar; children of the zone never reflow with the page grid, so
     * narrowing the library cannot unmount or move them. */
    .DockedZone {
        display: flex;
        flex-direction: column;
        gap: 10px;
        position: fixed;
        right: 0;
        bottom: 0;
        left: 0;
        z-index: 10;
    }

    .PlayerDock {
        padding: 10px 16px calc(10px + env(safe-area-inset-bottom, 0px));
        background: var(--Surface);
        border-top: 1px solid var(--Border);
    }

    .DockInner {
        display: grid;
        gap: 8px;
        max-width: 1080px;
        margin: 0 auto;
    }

    /* The media element doubles as the video display: visible (bounded)
     * only while the current row carries a video file AND the user has
     * revealed the video display (repair R2 — hidden by default, video
     * never decodes in the background); otherwise the element stays
     * hidden and carries the audio stream. */
    .DockVideo {
        width: 100%;
        max-height: 40vh;
        border: 1px solid var(--Border);
        border-radius: 8px;
        background: #000;
    }

    /* The revealed video is its own docked panel, separate from the
     * control bar; when hidden the wrapper contributes no box. */
    .HiddenShell {
        display: contents;
    }

    /* Desktop: the panel hugs its content and aligns bottom-right in
     * the docked zone; the video inside hugs the content too (the
     * panel supplies the padding). Mobile keeps it inline. */
    @media (min-width: 760px) {
        .VideoSection {
            align-self: flex-end;
            max-width: 1080px;
            background: var(--Surface);
            border: 1px solid var(--Border);
            border-radius: 8px;
            padding: 8px;
            display: flex;
            justify-content: flex-end;
            align-items: flex-end;
        }

        .DockVideo {
            width: auto;
            max-width: 1080px;
            padding: 0;
        }
    }

    .NativeMedia {
        display: none;
    }

    .DockSeek {
        width: 100%;
        accent-color: var(--Accent);
    }

    .DockMeta {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
    }

    .DockTitle {
        min-width: 0;
        font-weight: 600;
        overflow-wrap: anywhere;
    }

    .DockTime {
        flex-shrink: 0;
        color: var(--Muted);
        font-variant-numeric: tabular-nums;
    }

    .DockControls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
    }

    /* Icon-only control buttons (repair R3): the glyph is the visible
     * affordance; every button's aria-label/title carries the full
     * wording. */
    .IconButton {
        position: relative;
        display: grid;
        place-items: center;
        min-width: 38px;
        padding: 8px;
        border: 1px solid var(--Border);
        border-radius: 999px;
        background: var(--Background);
        cursor: pointer;
    }

    .IconButton :global(svg) {
        display: block;
    }

    .IconButtonPlay {
        min-width: 44px;
        border-color: var(--Accent);
        background: var(--Accent);
        color: var(--OnAccent);
    }

    .IconButtonOff {
        opacity: 0.45;
    }

    .ModeBadge {
        position: absolute;
        top: -3px;
        right: -3px;
        min-width: 14px;
        padding: 0 3px;
        border-radius: 999px;
        background: var(--Accent);
        color: var(--OnAccent);
        font-size: 0.6875rem;
        font-weight: 700;
        line-height: 14px;
        text-align: center;
    }

    .IconButtonWide {
        justify-self: start;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 12px;
    }

    .QueueCount {
        color: var(--Muted);
        font-size: 0.8125rem;
        font-variant-numeric: tabular-nums;
    }

    .DockControls :is(button, select):disabled {
        opacity: 0.55;
        cursor: default;
    }

    .SpeedLabel {
        display: grid;
        place-items: center;
        color: var(--Muted);
    }

    .SpeedSelect {
        padding: 5px 8px;
        border: 1px solid var(--Border);
        border-radius: 8px;
        background: var(--Background);
    }

    .QueueList {
        display: grid;
        gap: 6px;
        max-height: 200px;
        margin: 0;
        padding: 0;
        overflow-y: auto;
        list-style: none;
    }

    .QueueEntry {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 10px;
        border: 1px solid var(--Border);
        border-radius: 8px;
    }

    .QueueEntryCurrent {
        border-color: var(--Accent);
    }

    .QueueNow {
        flex-shrink: 0;
        margin-right: 8px;
        padding: 1px 8px;
        border: 1px solid var(--Accent);
        border-radius: 999px;
        color: var(--Accent);
        font-size: 0.75rem;
    }

    .QueueTitle {
        overflow-wrap: anywhere;
    }

    .QueueActions {
        display: flex;
        flex-shrink: 0;
        gap: 6px;
    }

    .QueueMoveButton {
        min-width: 32px;
        padding: 4px 8px;
        border: 1px solid var(--Border);
        border-radius: 6px;
        background: var(--Background);
        cursor: pointer;
    }

    .QueueMoveButton:disabled {
        cursor: not-allowed;
        opacity: 0.5;
    }
</style>

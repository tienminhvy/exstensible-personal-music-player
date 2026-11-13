<script lang="ts">
    import { browser } from '$app/env';
    import { player, type RepeatMode } from '#lib/player.svelte.ts';
    import { formatClock } from '#lib/time.ts';

    let audioElement = $state<HTMLAudioElement>();
    let scrubTime = $state<number | null>(null);
    let queueOpen = $state(false);

    $effect(() => {
        if (audioElement) {
            player.attach(audioElement);
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

    const repeatLabels: Record<RepeatMode, string> = {
        none: 'Repeat: None',
        all: 'Repeat: All',
        one: 'Repeat: One'
    };
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
</script>

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
                    {formatClock(scrubTime ?? player.currentTime)} / {formatClock(player.duration)}
                </span>
            </div>
            <div class="DockControls">
                <button
                    class="TransportButton"
                    type="button"
                    onclick={() => void player.previous()}
                >
                    Prev
                </button>
                <button class="PlayButton" type="button" onclick={() => player.toggle()}>
                    {player.playing ? 'Pause' : 'Play'}
                </button>
                <button class="TransportButton" type="button" onclick={() => void player.next()}>
                    Next
                </button>
                <button class="RepeatButton" type="button" onclick={() => player.cycleRepeat()}>
                    {repeatLabels[player.repeat]}
                </button>
                <label class="SpeedLabel" for="player-speed">Speed</label>
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
            </div>
            {#if player.error}
                <p class="Hint" role="status">{player.error}</p>
            {/if}
        {:else}
            <p class="Hint">Select a track in your library to play it.</p>
        {/if}
        {#if browser && player.queue.length > 0}
            <button
                class="QueueToggle"
                type="button"
                aria-expanded={queueOpen}
                aria-controls="PlayerDockQueue"
                onclick={onQueueToggle}
            >
                Queue ({player.queue.length})
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
    {#if browser}
        <audio
            bind:this={audioElement}
            class="NativeAudio"
            preload="metadata"
            onplay={() => player.playStarted()}
            onpause={() => player.playPaused()}
            ontimeupdate={() => player.progressTick(audioElement?.currentTime ?? 0)}
            onloadedmetadata={() => player.metadataLoaded(audioElement?.duration ?? 0)}
            onended={() => void player.trackEnded()}
            onerror={() => player.playbackFailed()}
        ></audio>
    {/if}
</section>

<style>
    /* The dock is a fixed bottom bar, so it never reflows with the page
     * grid: narrowing the library cannot unmount or move it. */
    .PlayerDock {
        position: fixed;
        right: 0;
        bottom: 0;
        left: 0;
        z-index: 10;
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

    .TransportButton {
        min-width: 62px;
        padding: 7px 12px;
        border: 1px solid var(--Border);
        border-radius: 999px;
        background: var(--Background);
        cursor: pointer;
    }

    .PlayButton {
        min-width: 84px;
        padding: 7px 14px;
        border: 1px solid var(--Border);
        border-radius: 999px;
        background: var(--Accent);
        color: var(--OnAccent);
        cursor: pointer;
    }

    .RepeatButton {
        padding: 5px 12px;
        border: 1px solid var(--Border);
        border-radius: 999px;
        background: var(--Background);
        cursor: pointer;
    }

    .SpeedLabel {
        color: var(--Muted);
    }

    .SpeedSelect {
        padding: 5px 8px;
        border: 1px solid var(--Border);
        border-radius: 8px;
        background: var(--Background);
    }

    .QueueToggle {
        justify-self: start;
        padding: 5px 12px;
        border: 1px solid var(--Border);
        border-radius: 999px;
        background: var(--Background);
        cursor: pointer;
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

    .NativeAudio {
        display: none;
    }
</style>

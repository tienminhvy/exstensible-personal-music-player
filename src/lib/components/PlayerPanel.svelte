<script lang="ts">
    import { browser } from '$app/env';
    import { player, type RepeatMode } from '#lib/player.svelte.ts';
    import { formatClock } from '#lib/time.ts';

    let audioElement = $state<HTMLAudioElement>();
    let scrubTime = $state<number | null>(null);

    $effect(() => {
        if (audioElement) {
            player.attach(audioElement);
        }
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
</script>

<section class="Panel PlayerPanel">
    <h2>Player</h2>
    {#if browser && player.current}
        <p class="PlayerTitle">{player.current.title}</p>
        <div class="PlayerControls">
            <button class="TransportButton" type="button" onclick={() => void player.previous()}>
                Prev
            </button>
            <button class="PlayButton" type="button" onclick={() => player.toggle()}>
                {player.playing ? 'Pause' : 'Play'}
            </button>
            <button class="TransportButton" type="button" onclick={() => void player.next()}>
                Next
            </button>
            <span class="PlayerTime">
                {formatClock(scrubTime ?? player.currentTime)} / {formatClock(player.duration)}
            </span>
        </div>
        <div class="PlayerOptions">
            <button class="RepeatButton" type="button" onclick={() => player.cycleRepeat()}>
                {repeatLabels[player.repeat]}
            </button>
            <label class="SpeedLabel" for="player-speed">Speed</label>
            <select id="player-speed" class="SpeedSelect" value={player.speed} onchange={onSpeed}>
                {#each speedOptions as rate (rate)}
                    <option value={rate}>{rate}×</option>
                {/each}
            </select>
        </div>
        <input
            class="SeekBar"
            type="range"
            min="0"
            max={player.duration || 1}
            step="1"
            value={scrubTime ?? player.currentTime}
            aria-label="Seek within the track"
            oninput={onScrub}
            onchange={onScrubCommit}
        />
        <p class="Hint" role="status">{player.error}</p>
    {:else}
        <p class="Hint">Select a track in your library to play it.</p>
    {/if}
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
    .PlayerTitle {
        margin: 0 0 12px;
        font-weight: 600;
        overflow-wrap: anywhere;
    }

    .PlayerControls {
        display: flex;
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

    .PlayerTime {
        color: var(--Muted);
        font-variant-numeric: tabular-nums;
    }

    .PlayerOptions {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 10px;
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

    .SeekBar {
        width: 100%;
        margin-top: 12px;
        accent-color: var(--Accent);
    }

    .NativeAudio {
        display: none;
    }

    @media (min-width: 760px) {
        .PlayerPanel {
            grid-column: 1 / -1;
        }
    }
</style>

<script lang="ts">
    import { browser } from '$app/env';
    import { player } from '#lib/player.svelte.ts';
    import { formatClock } from '#lib/time.ts';

    let audioElement = $state<HTMLAudioElement>();
    let scrubTime = $state<number | null>(null);

    $effect(() => {
        if (audioElement) {
            player.attach(audioElement);
        }
    });

    function onScrub(event: Event): void {
        scrubTime = Number((event.currentTarget as HTMLInputElement).value);
    }

    function onScrubCommit(): void {
        if (scrubTime !== null) {
            player.seek(scrubTime);
        }
        scrubTime = null;
    }
</script>

<section class="Panel PlayerPanel">
    <h2>Player</h2>
    {#if browser && player.current}
        <p class="PlayerTitle">{player.current.title}</p>
        <div class="PlayerControls">
            <button class="PlayButton" type="button" onclick={() => player.toggle()}>
                {player.playing ? 'Pause' : 'Play'}
            </button>
            <span class="PlayerTime">
                {formatClock(scrubTime ?? player.currentTime)} / {formatClock(player.duration)}
            </span>
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
            onended={() => player.trackEnded()}
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
        gap: 14px;
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

<script lang="ts">
    import { debounce } from '#lib/debounce.ts';
    import { formatClock } from '#lib/time.ts';
    import type { TrackRow } from '#lib/track.ts';

    interface Props {
        tracks: TrackRow[];
        query: string;
        loading: boolean;
        error: string;
        activeTrackId: string | null;
        onSelect: (track: TrackRow) => void;
        onEnqueue: (track: TrackRow) => void;
        onNarrow: (query: string) => void;
    }

    let { tracks, query, loading, error, activeTrackId, onSelect, onEnqueue, onNarrow }: Props =
        $props();

    const narrow = debounce((value: string) => {
        onNarrow(value);
    }, 400);

    function onNarrowInput(event: Event) {
        narrow((event.currentTarget as HTMLInputElement).value.trim());
    }

    function formatDuration(seconds: number | null): string {
        return seconds === null ? '—' : formatClock(seconds);
    }
</script>

<section class="Panel">
    <h2>Your library</h2>
    <label class="InputLabel" for="library-narrow">Narrow by title</label>
    <input
        id="library-narrow"
        class="TextInput"
        type="search"
        placeholder="Narrow by title"
        autocomplete="off"
        value={query}
        oninput={onNarrowInput}
    />
    <ul class="TrackList">
        {#each tracks as track (track.id)}
            <li>
                <div class="TrackRowCard">
                    <button
                        class="TrackRow"
                        type="button"
                        class:TrackRowActive={track.id === activeTrackId}
                        onclick={() => onSelect(track)}
                    >
                        {#if track.thumbnailUrl}
                            <img
                                class="TrackThumb"
                                src={track.thumbnailUrl}
                                alt=""
                                loading="lazy"
                                width="40"
                                height="40"
                            />
                        {/if}
                        <span class="TrackMain">
                            <span class="TrackTitle">{track.title}</span>
                            {#if track.channel}
                                <span class="TrackChannel">{track.channel}</span>
                            {/if}
                        </span>
                        <span class="TrackDuration">{formatDuration(track.durationSec)}</span>
                    </button>
                    <button class="EnqueueButton" type="button" onclick={() => onEnqueue(track)}>
                        Enqueue
                    </button>
                </div>
            </li>
        {:else}
            <li class="TrackEmpty">
                {query === ''
                    ? 'No tracks yet — search YouTube to import music.'
                    : 'No tracks match.'}
            </li>
        {/each}
    </ul>
    <p class="Hint" role="status">
        {#if error}
            {error}
        {:else if loading}
            Loading…
        {/if}
    </p>
</section>

<style>
    .TrackList {
        display: grid;
        gap: 8px;
        margin: 12px 0 4px;
        padding: 0;
        list-style: none;
    }

    .TrackRowCard {
        display: flex;
        align-items: stretch;
        gap: 8px;
    }

    .TrackRow {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        width: 100%;
        padding: 8px 12px;
        border: 1px solid var(--Border);
        border-radius: 8px;
        background: var(--Background);
        text-align: left;
        cursor: pointer;
    }

    .TrackRowActive {
        border-color: var(--Accent);
    }

    .TrackRowActive .TrackTitle {
        color: var(--Accent);
    }

    .TrackThumb {
        flex-shrink: 0;
        width: 40px;
        height: 40px;
        border-radius: 6px;
        object-fit: cover;
        background: var(--Border);
    }

    .TrackMain {
        display: flex;
        min-width: 0;
        flex-direction: column;
        gap: 2px;
    }

    .TrackTitle {
        overflow-wrap: anywhere;
    }

    .TrackChannel {
        overflow: hidden;
        color: var(--Muted);
        font-size: 0.8125rem;
    }

    .TrackDuration {
        flex-shrink: 0;
        color: var(--Muted);
        font-variant-numeric: tabular-nums;
    }

    .EnqueueButton {
        flex-shrink: 0;
        align-self: center;
        padding: 7px 10px;
        border: 1px solid var(--Border);
        border-radius: 8px;
        background: var(--Background);
        cursor: pointer;
    }

    .TrackEmpty {
        padding: 10px 12px;
        color: var(--Muted);
        border: 1px dashed var(--Border);
        border-radius: 8px;
    }
</style>

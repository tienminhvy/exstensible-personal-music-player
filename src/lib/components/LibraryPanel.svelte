<script lang="ts">
    import { debounce } from '#lib/debounce.ts';
    import type { TrackRow } from '#lib/track.ts';

    interface Props {
        tracks: TrackRow[];
        query: string;
        loading: boolean;
        error: string;
        onNarrow: (query: string) => void;
    }

    let { tracks, query, loading, error, onNarrow }: Props = $props();

    const narrow = debounce((value: string) => {
        onNarrow(value);
    }, 400);

    function onNarrowInput(event: Event) {
        narrow((event.currentTarget as HTMLInputElement).value.trim());
    }

    function formatDuration(seconds: number | null): string {
        if (seconds === null) {
            return '—';
        }
        const minutes = Math.floor(seconds / 60);
        return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
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
            <li class="TrackRow">
                <span class="TrackTitle">{track.title}</span>
                <span class="TrackDuration">{formatDuration(track.durationSec)}</span>
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

    .TrackRow {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        border: 1px solid var(--Border);
        border-radius: 8px;
        background: var(--Background);
    }

    .TrackTitle {
        overflow-wrap: anywhere;
    }

    .TrackDuration {
        flex-shrink: 0;
        color: var(--Muted);
        font-variant-numeric: tabular-nums;
    }

    .TrackEmpty {
        padding: 10px 12px;
        color: var(--Muted);
        border: 1px dashed var(--Border);
        border-radius: 8px;
    }
</style>

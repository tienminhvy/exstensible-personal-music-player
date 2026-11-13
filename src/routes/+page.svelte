<script lang="ts">
    import LibraryPanel from '#lib/components/LibraryPanel.svelte';
    import PlayerDock from '#lib/components/PlayerDock.svelte';
    import SearchPanel from '#lib/components/SearchPanel.svelte';
    import Icon from '#lib/components/Icon.svelte';
    import { player } from '#lib/player.svelte.ts';
    import { theme, type Theme } from '#lib/theme.svelte.ts';
    import type { TrackRow } from '#lib/track.ts';
    import type { PageProps } from './$types';

    let { data }: PageProps = $props();

    let refreshedTracks = $state<TrackRow[] | null>(null);
    const tracks = $derived(refreshedTracks ?? data.tracks);
    let narrowQuery = $state('');
    let fetching = $state(false);
    let libraryError = $state('');
    // Import state for search results: the loaded library plus every
    // import made in this session. Built from data.tracks (the unfiltered
    // initial load) rather than the displayed list, so narrowing cannot
    // blind it.
    let manualImportIds = $state<string[]>([]);
    const importedIds = $derived(
        new Set([...data.tracks.map((track) => track.youtubeId), ...manualImportIds])
    );

    const themeLabels: Record<Theme, string> = {
        light: 'Light',
        night: 'Night',
        dark: 'Dark'
    };

    function noteImported(videoId: string) {
        manualImportIds.push(videoId);
        void refreshLibrary(narrowQuery);
    }

    async function refreshLibrary(query: string) {
        narrowQuery = query;
        fetching = true;
        libraryError = '';
        try {
            const response = await fetch(
                query === '' ? '/api/tracks' : `/api/tracks?q=${encodeURIComponent(query)}`
            );
            if (response.ok) {
                refreshedTracks = (await response.json()) as TrackRow[];
            } else {
                libraryError = 'Could not load your library.';
            }
        } catch {
            libraryError = 'Could not load your library.';
        } finally {
            fetching = false;
        }
    }
</script>

<header class="ShellHeader">
    <h1 class="ShellTitle">Personal Music Player</h1>
    <button
        class="ThemeButton"
        type="button"
        aria-label="Cycle theme (currently {themeLabels[theme.current]})"
        title="Cycle theme (currently {themeLabels[theme.current]})"
        onclick={() => theme.cycle()}
    >
        <Icon name="theme" />
    </button>
</header>

<main class="ShellMain" class:VideoDocked={player.videoRevealed}>
    <SearchPanel {importedIds} onImported={noteImported} />
    <LibraryPanel
        {tracks}
        query={narrowQuery}
        loading={fetching}
        error={libraryError}
        activeTrackId={player.current?.id ?? null}
        onSelect={(track) => void player.select(track)}
        onEnqueue={(track) => player.enqueue(track)}
        onNarrow={refreshLibrary}
    />
</main>

<PlayerDock />

<style>
    .ShellHeader {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 20px;
        background: var(--Surface);
        border-bottom: 1px solid var(--Border);
    }

    .ShellTitle {
        margin: 0;
        font-size: 1.1rem;
    }

    .ThemeButton {
        display: grid;
        place-items: center;
        min-width: 38px;
        padding: 8px;
        border: 1px solid var(--Border);
        border-radius: 999px;
        background: var(--Background);
        cursor: pointer;
    }

    .ThemeButton :global(svg) {
        display: block;
    }

    .ShellMain {
        display: grid;
        gap: 14px;
        max-width: 1080px;
        margin: 0 auto;
        /* Bottom padding clears the fixed player dock so the last library
         * rows stay reachable above it. */
        padding: 14px 16px 190px;
    }

    /* While the video is revealed, a media section docks above the
     * player on desktop: grow the page's bottom padding so the last
     * library rows stay reachable above both fixed sections. */
    @media (min-width: 760px) {
        .VideoDocked {
            padding-bottom: calc(190px + 40vh + 24px);
        }
    }

    /* Mobile-first: the two panels sit side by side on wider screens. */
    @media (min-width: 760px) {
        .ShellMain {
            grid-template-columns: 1fr 1fr;
            align-items: start;
            padding: 20px 24px 190px;
        }
    }
</style>

<script lang="ts">
    import LibraryPanel from '#lib/components/LibraryPanel.svelte';
    import SearchPanel from '#lib/components/SearchPanel.svelte';
    import { theme, type Theme } from '#lib/theme.svelte.ts';
    import type { TrackRow } from '#lib/track.ts';
    import type { PageProps } from './$types';

    let { data }: PageProps = $props();

    let refreshedTracks = $state<TrackRow[] | null>(null);
    const tracks = $derived(refreshedTracks ?? data.tracks);
    let narrowQuery = $state('');
    let fetching = $state(false);
    let libraryError = $state('');

    const themeLabels: Record<Theme, string> = {
        light: 'Light',
        night: 'Night',
        dark: 'Dark'
    };

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
    <button class="ThemeButton" type="button" onclick={() => theme.cycle()}>
        Theme: {themeLabels[theme.current]}
    </button>
</header>

<main class="ShellMain">
    <SearchPanel onImported={() => refreshLibrary(narrowQuery)} />
    <LibraryPanel
        {tracks}
        query={narrowQuery}
        loading={fetching}
        error={libraryError}
        onNarrow={refreshLibrary}
    />
</main>

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
        min-width: 112px;
        padding: 7px 14px;
        border: 1px solid var(--Border);
        border-radius: 999px;
        background: var(--Background);
        cursor: pointer;
    }

    .ShellMain {
        display: grid;
        gap: 14px;
        max-width: 1080px;
        margin: 0 auto;
        padding: 14px 16px 40px;
    }

    /* Mobile-first: the two panels sit side by side on wider screens. */
    @media (min-width: 760px) {
        .ShellMain {
            grid-template-columns: 1fr 1fr;
            align-items: start;
            padding: 20px 24px 60px;
        }
    }
</style>

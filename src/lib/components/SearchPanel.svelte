<script lang="ts">
    import { debounce } from '#lib/debounce.ts';

    interface VideoResult {
        videoId: string;
        title: string;
        channel: string;
        thumbnailUrl: string;
    }

    interface Props {
        onImported: () => void;
    }

    let { onImported }: Props = $props();

    let results = $state<VideoResult[]>([]);
    let searching = $state(false);
    let searchFailed = $state(false);
    let searched = $state(false);
    let importStatus = $state('');
    let importingId = $state('');

    let searchToken = 0;

    const search = debounce((value: string) => {
        void runSearch(value);
    }, 400);

    async function runSearch(value: string) {
        const token = ++searchToken;
        searching = true;
        searchFailed = false;
        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(value)}`);
            if (token === searchToken) {
                if (response.ok) {
                    results = (await response.json()) as VideoResult[];
                    searched = true;
                } else {
                    searchFailed = true;
                }
            }
        } catch {
            if (token === searchToken) {
                searchFailed = true;
            }
        } finally {
            if (token === searchToken) {
                searching = false;
            }
        }
    }

    function onSearchInput(event: Event) {
        const value = (event.currentTarget as HTMLInputElement).value.trim();
        if (value === '') {
            search.cancel();
            ++searchToken;
            searching = false;
            searched = false;
            searchFailed = false;
            results = [];
        } else {
            search(value);
        }
    }

    async function importTrack(result: VideoResult) {
        importingId = result.videoId;
        importStatus = '';
        try {
            const response = await fetch('/api/download', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    videoId: result.videoId,
                    channel: result.channel,
                    thumbnailUrl: result.thumbnailUrl
                })
            });
            if (response.ok) {
                importStatus = `Imported ${result.title}`;
                onImported();
            } else {
                importStatus = importError(response.status);
            }
        } catch {
            importStatus = 'Import failed; the download did not complete.';
        } finally {
            importingId = '';
        }
    }

    function importError(status: number): string {
        if (status === 409) {
            return 'This track is already downloading.';
        }
        return 'Import failed; the download did not complete.';
    }
</script>

<section class="Panel">
    <h2>Search YouTube</h2>
    <label class="InputLabel" for="youtube-search">Find music to import</label>
    <input
        id="youtube-search"
        class="TextInput"
        type="search"
        placeholder="Search YouTube"
        autocomplete="off"
        oninput={onSearchInput}
    />
    <p class="Hint" role="status">
        {#if searching}
            Searching…
        {:else if searchFailed}
            Search failed. Try again.
        {:else if searched && results.length === 0}
            No results.
        {/if}
    </p>
    <ul class="ResultList">
        {#each results as result (result.videoId)}
            <li class="ResultRow">
                <img class="Thumbnail" src={result.thumbnailUrl} alt="" loading="lazy" />
                <span class="ResultText">
                    <span class="ResultTitle">{result.title}</span>
                    <span class="ResultChannel">{result.channel}</span>
                </span>
                <button
                    class="ImportButton"
                    type="button"
                    disabled={importingId !== ''}
                    onclick={() => importTrack(result)}
                >
                    {importingId === result.videoId ? 'Importing…' : 'Import'}
                </button>
            </li>
        {/each}
    </ul>
    <p class="Hint" role="status">{importStatus}</p>
</section>

<style>
    .ResultList {
        display: grid;
        gap: 10px;
        margin: 12px 0 6px;
        padding: 0;
        list-style: none;
    }

    .ResultRow {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px;
        border: 1px solid var(--Border);
        border-radius: 10px;
        background: var(--Background);
    }

    .Thumbnail {
        flex-shrink: 0;
        width: 96px;
        height: 72px;
        border-radius: 6px;
        object-fit: cover;
    }

    .ResultText {
        flex: 1;
        min-width: 0;
        display: grid;
        gap: 2px;
    }

    .ResultTitle {
        overflow-wrap: anywhere;
    }

    .ResultChannel {
        color: var(--Muted);
        font-size: 0.85rem;
    }

    .ImportButton {
        flex-shrink: 0;
        padding: 6px 12px;
        border: 1px solid var(--Border);
        border-radius: 8px;
        background: var(--Accent);
        color: var(--OnAccent);
        cursor: pointer;
    }

    .ImportButton:disabled {
        opacity: 0.55;
        cursor: default;
    }
</style>

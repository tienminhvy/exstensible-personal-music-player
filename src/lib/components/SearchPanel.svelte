<script lang="ts">
    import { SvelteMap } from 'svelte/reactivity';
    import { debounce } from '#lib/debounce.ts';

    interface VideoResult {
        videoId: string;
        title: string;
        channel: string;
        thumbnailUrl: string;
    }

    // Shape served by GET /api/formats; one option per height.
    interface FormatOption {
        label: string;
        height: number;
        ext: string;
        sizeBytes: number | null;
    }

    // One line of the import response stream: progress events carry the
    // current phase's yt-dlp bytes, the final line is the track row or
    // an error.
    interface ImportStreamEvent {
        phase?: 'audio' | 'video';
        label?: string | null;
        percent?: number | null;
        totalBytes?: number | null;
        track?: unknown;
        error?: unknown;
    }

    interface ImportProgress {
        phase: 'audio' | 'video';
        label: string | null;
        percent: number | null;
        totalBytes: number | null;
    }

    interface Props {
        importedIds: Set<string>;
        onImported: (videoId: string) => void;
    }

    let { importedIds, onImported }: Props = $props();

    let results = $state<VideoResult[]>([]);
    let searching = $state(false);
    let searchFailed = $state(false);
    let searched = $state(false);
    let importStatus = $state('');
    let importingId = $state('');
    let importProgress = $state<ImportProgress | null>(null);

    // Resolution picker state per result row, keyed by youtubeId so a
    // refresh of the results list does not drop what the row resolved.
    // Formats load on demand (picker interaction) — not per search —
    // since each listing is a real metadata fetch.
    let formatsByVideoId = new SvelteMap<string, FormatOption[]>();
    let formatsStateByVideoId = new SvelteMap<string, 'loading' | 'ready' | 'failed'>();
    let pickedByVideoId = new SvelteMap<string, FormatOption>();

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

    async function loadFormats(result: VideoResult) {
        const videoId = result.videoId;
        if (formatsStateByVideoId.get(videoId) === 'ready') {
            return;
        }
        formatsStateByVideoId.set(videoId, 'loading');
        try {
            const response = await fetch(`/api/formats?videoId=${encodeURIComponent(videoId)}`);
            if (response.ok) {
                const payload = (await response.json()) as { formats: FormatOption[] };
                formatsByVideoId.set(videoId, payload.formats);
                formatsStateByVideoId.set(videoId, 'ready');
            } else {
                formatsStateByVideoId.set(videoId, 'failed');
            }
        } catch {
            formatsStateByVideoId.set(videoId, 'failed');
        }
    }

    // An option's select value is its index into the row's formats; the
    // empty value is the audio-only default. The picked FORMATS option
    // object is what the import POST sends as `resolution` (the route
    // keeps height + ext of it).
    function pickFormat(result: VideoResult, event: Event) {
        const select = event.currentTarget as HTMLSelectElement;
        const index = Number(select.value);
        const formats = formatsByVideoId.get(result.videoId) ?? [];
        const option =
            Number.isInteger(index) && index >= 0 && index < formats.length ? formats[index] : null;
        if (option) {
            pickedByVideoId.set(result.videoId, option);
        } else {
            pickedByVideoId.delete(result.videoId);
        }
    }

    function importLabel(result: VideoResult): string {
        if (importingId !== result.videoId) {
            return 'Import';
        }
        if (importProgress && importProgress.percent !== null) {
            return `Importing ${Math.round(importProgress.percent)}%`;
        }
        if (importProgress?.label) {
            return `Importing ${importProgress.label}`;
        }
        return 'Importing…';
    }

    async function importTrack(result: VideoResult) {
        importingId = result.videoId;
        importStatus = '';
        importProgress = null;
        try {
            const picked = pickedByVideoId.get(result.videoId);
            const response = await fetch('/api/download', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    videoId: result.videoId,
                    channel: result.channel,
                    thumbnailUrl: result.thumbnailUrl,
                    ...(picked ? { resolution: picked } : {})
                })
            });
            if (!response.ok) {
                importStatus = importError(response.status);
            } else if (response.body) {
                // The import streams: progress lines while the media
                // downloads, then the track row (the import is finished
                // only when a track line arrives).
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let imported = false;
                let streamFailed = false;
                while (!imported && !streamFailed) {
                    const { done, value } = await reader.read();
                    if (done) {
                        break;
                    }
                    buffer += decoder.decode(value, { stream: true });
                    let newlineIndex: number;
                    while (
                        (newlineIndex = buffer.indexOf('\n')) !== -1 &&
                        !imported &&
                        !streamFailed
                    ) {
                        const line = buffer.slice(0, newlineIndex).trim();
                        buffer = buffer.slice(newlineIndex + 1);
                        if (line === '') {
                            continue;
                        }
                        let parsed: ImportStreamEvent;
                        try {
                            parsed = JSON.parse(line) as ImportStreamEvent;
                        } catch {
                            streamFailed = true;
                            break;
                        }
                        if (parsed.track !== undefined) {
                            imported = true;
                        } else if (typeof parsed.error === 'string') {
                            importStatus = parsed.error;
                            streamFailed = true;
                        } else if (parsed.phase) {
                            importProgress = {
                                phase: parsed.phase,
                                label: parsed.label ?? null,
                                percent: parsed.percent ?? null,
                                totalBytes: parsed.totalBytes ?? null
                            };
                        }
                    }
                }
                if (imported) {
                    importStatus = `Imported ${result.title}`;
                    onImported(result.videoId);
                } else if (!streamFailed) {
                    importStatus = importError(-1);
                }
            } else {
                importStatus = importError(-1);
            }
        } catch {
            importStatus = 'Import failed; the download did not complete.';
        } finally {
            importingId = '';
            importProgress = null;
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
                    {#if importingId === result.videoId && importProgress && importProgress.percent !== null}
                        <span class="ImportProgress" aria-hidden="true">
                            <span
                                class="ImportProgressBar"
                                style="width: {Math.round(importProgress.percent)}%"
                            ></span>
                        </span>
                    {/if}
                </span>
                <span class="ImportControls">
                    <select
                        class="ResolutionSelect"
                        aria-label="Video resolution for {result.title}"
                        disabled={importingId !== '' || importedIds.has(result.videoId)}
                        onfocus={() => loadFormats(result)}
                        onchange={(event) => pickFormat(result, event)}
                    >
                        <option
                            value=""
                            selected={pickedByVideoId.get(result.videoId) === undefined}
                        >
                            Audio only
                        </option>
                        {#if formatsStateByVideoId.get(result.videoId) === 'loading'}
                            <option value="" disabled>Loading resolutions…</option>
                        {:else if formatsStateByVideoId.get(result.videoId) === 'failed'}
                            <option value="" disabled>Resolutions unavailable</option>
                        {:else if formatsStateByVideoId.get(result.videoId) === 'ready'}
                            {@const options = formatsByVideoId.get(result.videoId) ?? []}
                            {#each options as option, index (option.height)}
                                <option
                                    value={String(index)}
                                    selected={pickedByVideoId.get(result.videoId) === option}
                                >
                                    {option.label}{option.sizeBytes === null
                                        ? ''
                                        : ` · ${Math.round(option.sizeBytes / 1048576)} MB`}
                                </option>
                            {/each}
                        {/if}
                    </select>
                    <button
                        class="ImportButton"
                        class:ImportButtonImported={importedIds.has(result.videoId)}
                        type="button"
                        disabled={importingId !== '' || importedIds.has(result.videoId)}
                        onclick={() => importTrack(result)}
                    >
                        {importingId === result.videoId
                            ? importLabel(result)
                            : importedIds.has(result.videoId)
                              ? 'Imported'
                              : 'Import'}
                    </button>
                </span>
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

    .ImportProgress {
        display: block;
        height: 4px;
        border-radius: 999px;
        background: var(--Border);
        overflow: hidden;
    }

    .ImportProgressBar {
        display: block;
        height: 100%;
        border-radius: 999px;
        background: var(--Accent);
        transition: width 0.2s ease-out;
    }

    .ImportControls {
        flex-shrink: 0;
        display: grid;
        gap: 6px;
    }

    .ResolutionSelect {
        min-width: 148px;
        padding: 5px 8px;
        border: 1px solid var(--Border);
        border-radius: 8px;
        background: var(--Background);
        font-size: 0.85rem;
        cursor: pointer;
    }

    .ResolutionSelect:disabled {
        opacity: 0.55;
        cursor: default;
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

    .ImportButtonImported {
        background: var(--Background);
        color: var(--Muted);
        border-color: var(--Border);
    }
</style>

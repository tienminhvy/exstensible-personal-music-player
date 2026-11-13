<script lang="ts">
    /* Icon-only control buttons (repair R3): dependency-free inline-SVG
     * glyph set. Every consumer button carries its full wording in an
     * aria-label/title — the icon is the only visible content. */
    type IconName =
        | 'prev'
        | 'play'
        | 'pause'
        | 'next'
        | 'repeat'
        | 'speed'
        | 'fullscreen'
        | 'video'
        | 'queue'
        | 'import'
        | 'imported'
        | 'enqueue'
        | 'theme';

    interface Props {
        name: IconName;
        size?: number;
    }

    let { name, size = 16 }: Props = $props();
</script>

<svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
>
    {#if name === 'prev'}
        <polygon points="19 20 9 12 19 4" fill="currentColor" stroke="none" />
        <line x1="5" y1="4" x2="5" y2="20" />
    {:else if name === 'play'}
        <polygon points="6 4 20 12 6 20" fill="currentColor" stroke="none" />
    {:else if name === 'pause'}
        <rect x="6" y="4" width="4" height="16" fill="currentColor" stroke="none" />
        <rect x="14" y="4" width="4" height="16" fill="currentColor" stroke="none" />
    {:else if name === 'next'}
        <polygon points="5 4 15 12 5 20" fill="currentColor" stroke="none" />
        <line x1="19" y1="4" x2="19" y2="20" />
    {:else if name === 'repeat'}
        <polyline points="17 1 21 5 17 9" />
        <path d="M3 11V9a4 4 0 0 1 4-4h14" />
        <polyline points="7 23 3 19 7 15" />
        <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    {:else if name === 'speed'}
        <circle cx="12" cy="12" r="9" />
        <path d="M12 12l3.5-3.5" />
    {:else if name === 'fullscreen'}
        <polyline points="15 3 21 3 21 9" />
        <polyline points="9 21 3 21 3 15" />
        <line x1="21" y1="3" x2="14" y2="10" />
        <line x1="3" y1="21" x2="10" y2="14" />
    {:else if name === 'video'}
        <polygon points="23 7 16 12 23 17 23 7" />
        <rect x="1" y="5" width="15" height="14" rx="2" />
    {:else if name === 'queue'}
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
    {:else if name === 'import'}
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
    {:else if name === 'imported'}
        <polyline points="20 6 9 17 4 12" />
    {:else if name === 'enqueue'}
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="12" y1="8" x2="12" y2="16" />
        <line x1="8" y1="12" x2="16" y2="12" />
    {:else if name === 'theme'}
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a10 10 0 0 1 0 20Z" fill="currentColor" stroke="none" />
    {/if}
</svg>

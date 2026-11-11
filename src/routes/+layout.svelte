<script lang="ts">
    import '../app.css';
    import favicon from '#lib/assets/favicon.svg';
    import { theme } from '#lib/theme.svelte.ts';
    import { onMount } from 'svelte';
    import type { LayoutProps } from './$types';

    let { children }: LayoutProps = $props();

    onMount(() => {
        theme.initialize();
    });
</script>

<svelte:head>
    <link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

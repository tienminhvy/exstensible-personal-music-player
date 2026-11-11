export type Theme = 'light' | 'night' | 'dark';

const themes: readonly Theme[] = ['light', 'night', 'dark'];

const storageKey = 'theme';

function storedTheme(): Theme {
    const stored = localStorage.getItem(storageKey);
    return stored !== null && themes.includes(stored as Theme) ? (stored as Theme) : 'light';
}

class ThemeStore {
    current = $state<Theme>('light');

    initialize(): void {
        this.current = storedTheme();
        this.apply();
    }

    cycle(): void {
        const next = themes[(themes.indexOf(this.current) + 1) % themes.length];
        this.setTheme(next);
    }

    setTheme(next: Theme): void {
        this.current = next;
        localStorage.setItem(storageKey, next);
        this.apply();
    }

    private apply(): void {
        document.documentElement.dataset.theme = this.current;
    }
}

export const theme = new ThemeStore();

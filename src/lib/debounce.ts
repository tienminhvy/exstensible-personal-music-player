export function debounce<Arguments extends unknown[]>(
    action: (...args: Arguments) => void,
    delayMs: number
): ((...args: Arguments) => void) & { cancel: () => void } {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const run = (...args: Arguments) => {
        clearTimeout(timer);
        timer = setTimeout(() => action(...args), delayMs);
    };
    run.cancel = () => clearTimeout(timer);

    return run;
}

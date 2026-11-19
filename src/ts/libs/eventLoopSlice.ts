const DEFAULT_SLICE_MS = 8;

export function createEventLoopSlicer(sliceMs = DEFAULT_SLICE_MS): () => Promise<void> {
    let sliceStarted = Date.now();
    return async () => {
        if (Date.now() - sliceStarted < sliceMs) return;
        await new Promise<void>(resolve => setImmediate(resolve));
        sliceStarted = Date.now();
    };
}

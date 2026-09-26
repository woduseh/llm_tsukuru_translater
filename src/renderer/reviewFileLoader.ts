/** A view owns its scan generation; KeepAlive deactivation does not discard it. */
export function createReviewScan() {
  let generation = 0
  return {
    begin() {
      const current = ++generation
      return () => generation === current
    },
    invalidate() { generation++ },
  }
}

/** Keep at most one file pair in flight; yield between CPU-heavy summaries for painting/input. */
export async function readReviewEntries<T>(
  names: readonly string[],
  read: (name: string) => Promise<T | undefined>,
  isCurrent: () => boolean,
): Promise<T[] | undefined> {
  const entries: T[] = []
  let lastYield = performance.now()
  for (const name of names) {
    if (!isCurrent()) return
    const entry = await read(name)
    if (!isCurrent()) return
    if (entry !== undefined) entries.push(entry)
    if (performance.now() - lastYield >= 8) {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      lastYield = performance.now()
    }
  }
  return isCurrent() ? entries : undefined
}

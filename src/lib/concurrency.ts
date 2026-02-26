export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const actualLimit = Math.max(1, Math.min(limit, items.length || 1));
  let cursor = 0;

  async function consume(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: actualLimit }, () => consume()));
}

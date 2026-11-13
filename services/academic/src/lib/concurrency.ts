/**
 * Como `Promise.all(items.map(fn))`, pero con a lo más `limit` tareas a la vez: así 100 centros se
 * calculan en paralelo sin agotar las conexiones a la base (el pool tiene 10).
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

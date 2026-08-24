/**
 * Helper utility to fetch all pages of a Supabase query using range-based pagination.
 * Prevents PostgREST default 1000-row silent truncation.
 */
export async function fetchAllPaginated<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await fetchPage(from, from + pageSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return all
}

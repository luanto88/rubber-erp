// Chuẩn hoá chuỗi để tìm/so khớp — hàm THUẦN, dùng được ở client lẫn server.

/** Bỏ dấu (NFD), đ→d, chữ thường, ký tự lạ → khoảng trắng, gộp khoảng trắng.
 *  "Dao băm" = "dao  bằm" = "DAO BAM". */
export function normalizeSearchText(value: string | number | null | undefined): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

/** Mọi từ trong `query` đều phải xuất hiện trong ít nhất 1 trường (đã gộp). Query rỗng ⇒ luôn khớp. */
export function matchesSearchQuery(
  query: string,
  fields: ReadonlyArray<string | number | null | undefined>,
): boolean {
  const q = normalizeSearchText(query)
  if (!q) return true
  const haystack = ` ${fields.map(normalizeSearchText).filter(Boolean).join(" ")} `
  // Ghép thêm bản bỏ khoảng trắng để "MCC1" khớp "MCC-1".
  const compact = haystack.replace(/ /g, "")
  return q.split(" ").every((token) => haystack.includes(token) || compact.includes(token))
}

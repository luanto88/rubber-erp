export const EMPTY_NOTE_FILTER = "__EMPTY_NOTE__"

export function isEmptyNoteFilter(filterValue: string) {
  return filterValue === EMPTY_NOTE_FILTER
}

export function isBlankNoteContent(note: string | null | undefined) {
  const trimmed = (note || "").trim()
  return trimmed.length === 0 || trimmed === "0"
}

export function matchesNoteFilter(note: string | null | undefined, filterValue: string) {
  if (!filterValue) return true

  if (isEmptyNoteFilter(filterValue)) return isBlankNoteContent(note)

  const normalizedNote = (note || "").trim()
  return normalizedNote === filterValue.trim()
}

export function matchesNoteFilterMulti(note: string | null | undefined, selected: string[]) {
  if (!selected || selected.length === 0) return true

  if (selected.includes(EMPTY_NOTE_FILTER) && isBlankNoteContent(note)) return true

  const normalizedNote = (note || "").trim()
  return selected.some((value) => !isEmptyNoteFilter(value) && normalizedNote === value.trim())
}

export function describeNoteFilter(filterValue: string) {
  if (!filterValue) return ""
  if (isEmptyNoteFilter(filterValue)) return "ghi chú trống"
  return `ghi chú ${filterValue.trim()}`
}

export function describeNoteFilterMulti(selected: string[]) {
  const values = (selected || []).filter(Boolean)
  if (values.length === 0) return ""
  const labels = values.map((v) => (isEmptyNoteFilter(v) ? "trống" : v.trim()))
  return `ghi chú ${labels.join(", ")}`
}

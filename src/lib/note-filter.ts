export const EMPTY_NOTE_FILTER = "__EMPTY_NOTE__"

export function isEmptyNoteFilter(filterValue: string) {
  return filterValue === EMPTY_NOTE_FILTER
}

export function matchesNoteFilter(note: string | null | undefined, filterValue: string) {
  if (!filterValue) return true

  const normalizedNote = (note || "").trim()
  if (isEmptyNoteFilter(filterValue)) return normalizedNote.length === 0

  return normalizedNote === filterValue.trim()
}

export function describeNoteFilter(filterValue: string) {
  if (!filterValue) return ""
  if (isEmptyNoteFilter(filterValue)) return "ghi chú trống"
  return `ghi chú ${filterValue.trim()}`
}

// Chữ song ngữ Việt / Khmer của màn điểm danh ca (GĐ C2). Nguồn duy nhất: ./khmer-ui.json
// (chuyên gia duyệt qua scripts/export-attendance-khmer.mjs). Tên công việc / lý do lấy cột ten_khmer của danh mục.

import ui from "./khmer-ui.json"

export type AttLang = "vi" | "km"
export const ATT_LANG_STORAGE_KEY = "attendance_shift_lang"
export const ATT_LANG_OPTIONS: { code: AttLang; label: string }[] = [
  { code: "vi", label: "VI" },
  { code: "km", label: "ខ្មែរ" },
]

type UiItem = { key: string; vi: string; km?: string }
const DICT = new Map<string, UiItem>((ui.items as UiItem[]).map((i) => [i.key, i]))

export function at(lang: AttLang, key: string, vars?: Record<string, string | number>): string {
  const item = DICT.get(key)
  let s = item ? (lang === "km" && item.km ? item.km : item.vi) : key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  return s
}

/** Tên song ngữ từ danh mục: Khmer khi có, kèm tiếng Việt nhỏ (trực ca + văn phòng cùng đọc được). */
export function bilingual(lang: AttLang, vi: string, km: string | null | undefined): string {
  return lang === "km" && km ? km : vi
}

export function loadAttLang(): AttLang {
  try {
    return localStorage.getItem(ATT_LANG_STORAGE_KEY) === "km" ? "km" : "vi"
  } catch {
    return "vi"
  }
}

export function storeAttLang(lang: AttLang) {
  try {
    localStorage.setItem(ATT_LANG_STORAGE_KEY, lang)
  } catch {
    /* WebView chặn storage — bỏ qua */
  }
}

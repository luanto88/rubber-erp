// Nguồn gốc lô thành phẩm theo hậu tố mã lô (bảng `suffixes`) — module THUẦN, dùng được ở cả client và server.
// Quy tắc giữ nguyên như F12 (daily-report-actions.ts): suffixes.nguon NT/CS = Công ty, M/TM = Thu mua, GC* = Gia công,
// TL = Thanh lý; thiếu nguon thì thử chính mã hậu tố, rồi tên hậu tố.

export type LotSuffixRow = { code: string | null; nguon: string | null; name: string | null };

/** Ký hiệu kỹ thuật (ghi chú lô) chuẩn của lô thu mua — khớp danh mục `required_notes` và quy ước Sản lượng/Kho NL. */
export const THU_MUA_NOTE = "TM";

function nguonLabelFromCode(nguon: string): string | null {
  const n = nguon.trim().toUpperCase();
  if (!n) return null;
  if (n === "NT" || n === "CS") return "Công ty";
  if (n === "M" || n === "TM") return "Thu mua";
  if (n.startsWith("GC")) return "Gia công";
  if (n === "TL") return "Thanh lý";
  return null;
}

/** Trả hàm hậu tố → nhãn nguồn ("Công ty" / "Thu mua" / "Gia công" / "Thanh lý" / tên hậu tố). */
export function makeNguonResolver(suffixes: LotSuffixRow[]) {
  const byCode = new Map<string, LotSuffixRow>();
  for (const s of suffixes) if (s.code) byCode.set(s.code.trim().toLowerCase(), s);
  return (suffix: string | null | undefined): string => {
    const code = (suffix || "").trim().toLowerCase();
    if (!code) return "Công ty";
    const s = byCode.get(code);
    return nguonLabelFromCode(s?.nguon || "") || nguonLabelFromCode(code) || s?.name?.trim() || code;
  };
}

/** Hậu tố của mã lô "54m/26" → "m"; "12/26" → "". Không khớp mẫu → "". */
export function suffixOfMaLo(maLo: string | null | undefined): string {
  const m = String(maLo || "").trim().match(/^\d+([^/\d][^/]*)?\/\d+$/);
  return (m?.[1] || "").trim().toLowerCase();
}

export function isThuMuaSuffix(suffix: string | null | undefined, suffixes: LotSuffixRow[]): boolean {
  return makeNguonResolver(suffixes)(suffix) === "Thu mua";
}

/** Ghi chú mặc định cho LÔ MỚI: hậu tố thu mua ⇒ "TM", ngược lại "". */
export function defaultLotNoteForMaLo(maLo: string | null | undefined, suffixes: LotSuffixRow[]): string {
  return isThuMuaSuffix(suffixOfMaLo(maLo), suffixes) ? THU_MUA_NOTE : "";
}

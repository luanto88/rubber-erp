// Quy tắc đọc dòng phiếu điểm danh ca — dùng chung phiếu TKSX (F01/F02) và truy vết nhân sự ca ở chi tiết lô (C2b).
// Module THUẦN (không import server) — sửa quy tắc ở đây thì 2 nơi đổi cùng lúc.

export type SectionSlot = { staff_id: string | null; goc_staff_id: string | null }
export type SectionViTri = { truong?: SectionSlot; pho?: SectionSlot }

export type SectionLineLike = {
  staff_id: string
  cong_viec_id: string | null
  cong_viec_ids: string[] | null
  xep_loai: string | null
  diem_danh: "co" | "vang"
  thay_the_staff_id: string | null
  thay_the_ten: string | null
}

/** Phiếu ca "trống" = đang lập, chưa có dòng nào (chỉ mở xem / ca không làm việc) ⇒ không tính vào phiếu ngày,
 *  không chặn duyệt — cùng quy tắc với attendance_recompute_sheet (migration 20261212). */
export function isEmptyOpenSection(s: { id: string; trang_thai: string }, sectionIdsWithLines: Set<string>) {
  return s.trang_thai === "dang_lam" && !sectionIdsWithLines.has(s.id)
}

/** Việc của dòng: `cong_viec_ids` (nhiều việc, 20261206); dòng cũ chỉ có `cong_viec_id`. */
export function lineJobIds(l: Pick<SectionLineLike, "cong_viec_id" | "cong_viec_ids">): string[] {
  if (l.cong_viec_ids && l.cong_viec_ids.length > 0) return l.cong_viec_ids
  return l.cong_viec_id ? [l.cong_viec_id] : []
}

export type SectionPerson = { ten: string; xepLoai: string; thayCho?: string; tam?: boolean; staffId: string | null }

/**
 * Người THỰC SỰ làm việc của 1 dòng: có mặt ⇒ chính người đó; vắng có người thay (nhân sự) ⇒ người thay (xếp A);
 * vắng có tên thay gõ tay ⇒ "<tên> (tạm)"; vắng không ai thay ⇒ null.
 */
export function linePerson(l: SectionLineLike, name: (id: string | null | undefined) => string): SectionPerson | null {
  if (l.diem_danh === "co") return { ten: name(l.staff_id), xepLoai: l.xep_loai || "A", staffId: l.staff_id }
  if (l.thay_the_staff_id) return { ten: name(l.thay_the_staff_id), xepLoai: "A", thayCho: name(l.staff_id), staffId: l.thay_the_staff_id }
  if (l.thay_the_ten) return { ten: `${l.thay_the_ten} (tạm)`, xepLoai: "", thayCho: name(l.staff_id), tam: true, staffId: null }
  return null
}

/** Người giữ vị trí trưởng / phó: "<tên>" hoặc "<tên> (thay <người gốc>)". */
export function slotHolderText(slot: SectionSlot | undefined, name: (id: string | null | undefined) => string): string {
  if (!slot?.staff_id) return ""
  const n = name(slot.staff_id)
  return slot.goc_staff_id && slot.goc_staff_id !== slot.staff_id ? `${n} (thay ${name(slot.goc_staff_id)})` : n
}

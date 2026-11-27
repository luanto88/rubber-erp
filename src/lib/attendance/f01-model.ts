// Mô hình dữ liệu phiếu triển khai sản xuất F01 (Mủ tạp) / F02 (Mủ nước) — GĐ3 mục 4 (rule 31).
// Module THUẦN (client + server). Server action `sheet-report-actions.ts` dựng mô hình; `f01-sheet.ts` vẽ Canvas → PDF.

export type F01Form = "F01" | "F02"

export type F01Person = {
  ten: string
  /** "A" / "B" — trống với người trực xuất hàng lấy từ đơn xuất. */
  xepLoai: string
  /** Người vắng mà người này thay. */
  thayCho?: string
}

export type F01JobRow = { ten: string; tenKm: string | null; people: F01Person[] }

/** A2 — nhóm con của khối tổ: khung giờ ("Khung ngày (05:00–17:00)") hoặc ca sản xuất ("Ca A (Shok Khoeun)"). "" = không tiêu đề. */
export type F01JobGroup = { label: string; rows: F01JobRow[] }

export type F01Production = { csr: string; banh: number; loaiBanh: number | null; boc: string }

/** 1 mục trên phiếu = 1 Ca/Tổ đã điểm danh (thứ tự theo danh mục Ca/Tổ). */
export type F01Block = {
  code: string
  ten: string
  tenKm: string | null
  /** "ca" ⇒ Ca trưởng / Ca phó + giờ ca + sản xuất; "to" ⇒ Tổ trưởng / Tổ phó. */
  loai: "ca" | "to"
  truong: string
  pho: string
  /** false = mục phụ (vd Trực xuất hàng khi không có tổ cơ điện) — không in dòng trưởng/phó. */
  coViTri: boolean
  gioBatDau: string
  gioKetThuc: string
  sanXuat: F01Production[]
  rows: F01JobRow[]
  /** A2 — có thì in theo nhóm (thay cho `rows`). */
  groups?: F01JobGroup[]
}

export type F01Approval = { ten: string; luc: string }

export type F01Model = {
  form: F01Form
  sheetId: string
  maPhieu: string
  ngay: string
  dayChuyen: string
  factoryName: string
  factoryKhmer: string | null
  chiThi: string
  ngan: string
  blocks: F01Block[]
  /** Mọi phiếu ca đã duyệt (≥ 1 phiếu ca) ⇒ được sinh bản cứng có dấu duyệt. */
  approved: boolean
  approval: F01Approval | null
  /** sha256 của các `section_id:duyet_luc` đã sắp — khoá bản cứng. Rỗng khi chưa duyệt đủ. */
  approvalKey: string
  /** Lý do chưa in dấu duyệt dù mọi phiếu ca đã duyệt (vd có kiện quét sau giờ duyệt). */
  approvalWarning?: string | null
}

export const F01_DOC_CODE: Record<F01Form, string> = {
  F01: "NMCB-QT01-F01 (03-01/8/2026)",
  F02: "NMCB-QT01-F02 (03-01/8/2026)",
}

export const F01_TITLE_PRODUCTS: Record<F01Form, string> = {
  F01: "CSR10, 20",
  F02: "L, 3L, 5, CV50, 60",
}

export function f01FormOf(dayChuyen: string): F01Form {
  return dayChuyen === "Mủ nước" ? "F02" : "F01"
}

/** Gộp người cùng tên trong 1 việc (người làm ở cả 2 phiếu ca chỉ in 1 lần). */
export function pushPerson(row: F01JobRow, p: F01Person) {
  if (!p.ten) return
  if (row.people.some((x) => x.ten === p.ten)) return
  row.people.push(p)
}

export function f01FileName(m: Pick<F01Model, "form" | "maPhieu">): string {
  return `Phieu trien khai san xuat ${m.maPhieu}.pdf`
}

// Nhãn tiếng Việt dùng chung cho hệ thống ký số (`yeu_cau_ky.modun` / `.loai_tai_lieu`).
//
// Trước đây 2 bảng map này nằm cục bộ trong `src/app/dashboard/ky/[id]/page.tsx`; tách ra đây
// để phần thông báo server-side (`src/lib/signing/notify.ts`) dùng lại đúng CÙNG một nguồn —
// tránh tình trạng chuông/Telegram hiển thị mã snake_case nội bộ trong khi SignScreen hiển thị
// tiếng Việt. File thuần const, không import gì server-only nên client vẫn dùng được.

export const MODUN_LABEL: Record<string, string> = {
  quality: "Chất lượng",
  export: "Xuất hàng",
  maintenance: "Bảo trì",
  dispatch: "Điều xe",
  output: "Sản lượng",
  storage: "Kho nguyên liệu",
}

// Nhãn tiếng Việt cho yeu_cau_ky.loai_tai_lieu — trước đây in thẳng mã snake_case nội bộ
// (vd "dispatch_bang_phan_xe") ra màn hình (bug đã báo 2026-09-01). Danh sách đủ 6 giá trị
// đang tồn tại trong hệ thống (grep toàn bộ nơi gọi createSigningRequest với loaiTaiLieu:).
export const LOAI_TAI_LIEU_LABEL: Record<string, string> = {
  dispatch_bang_phan_xe: "Bảng phân xe",
  quality_kqkn: "Phiếu KQKN",
  su_co_nho: "Biên bản sự cố",
  bao_duong: "Biên bản bảo dưỡng",
  bao_duong_xe: "Biên bản bảo dưỡng xe",
  sua_chua_nho_xe: "Biên bản sửa chữa nhỏ xe",
}

export function modunLabel(modun: string): string {
  return MODUN_LABEL[modun] || modun
}

export function loaiTaiLieuLabel(loaiTaiLieu: string): string {
  return LOAI_TAI_LIEU_LABEL[loaiTaiLieu] || loaiTaiLieu
}

/** Nhãn 1 dòng mô tả hồ sơ, vd: "Biên bản bảo dưỡng MT-030925/001 · Bảo trì" */
export function signingDocLabel(modun: string, loaiTaiLieu: string, maHoSo?: string | null): string {
  return `${loaiTaiLieuLabel(loaiTaiLieu)}${maHoSo ? ` ${maHoSo}` : ""} · ${modunLabel(modun)}`
}

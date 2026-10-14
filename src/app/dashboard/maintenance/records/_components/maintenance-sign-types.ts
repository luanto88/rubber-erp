// Kiểu dữ liệu trạng thái ký số của biên bản bảo trì — payload của GET /api/maintenance/signing-status.
// (Tách khỏi maintenance-sign-status.tsx cũ khi U1b chuyển trang chi tiết sang SignStatusBadge dùng chung.)

export type MaintenanceSignerStatus = { userId: string; thuTu: number; vaiTro: string; trangThai: string; hoTen: string }

export type MaintenanceSigningStatus = {
  recordId: string
  yeuCauId: string
  trangThai: "dang_luan_chuyen" | "hoan_tat"
  nguoiTao: string
  fileHienTai: string | null
  traVeLyDo: string | null
  signers: MaintenanceSignerStatus[]
  dataChanged: boolean
}

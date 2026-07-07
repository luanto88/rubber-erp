// Cấu hình "lô tròn" theo loai_csr/loai_banh, dùng riêng cho tính năng Dự đoán số lô
// (module Thành phẩm — src/app/dashboard/product/page.tsx) — mirror đúng công thức gốc,
// không import trực tiếp từ page.tsx vì các hàm đó không export (module-private).
// Nếu chỉnh sửa công thức ở product/page.tsx, phải cập nhật đồng bộ ở đây.

export type LoaiBanhConfig = {
  loai_banh: number
  max_per_kien: number
  lo_tron: number
}

export function getLoaiBanhConfig(loai_csr: string, selected_banh?: number): LoaiBanhConfig {
  if (["CSRCV50", "CSRCV60", "SVRCV50", "SVRCV60"].includes(loai_csr)) {
    const b = selected_banh || 35
    return b === 20
      ? { loai_banh: 20, max_per_kien: 60, lo_tron: 240 }
      : { loai_banh: 35, max_per_kien: 36, lo_tron: 144 }
  }
  if (["CSRL", "CSR3L", "SVRL", "SVR3L"].includes(loai_csr)) {
    const b = selected_banh || 33.33
    return { loai_banh: b, max_per_kien: 36, lo_tron: 144 }
  }
  return { loai_banh: 35, max_per_kien: 36, lo_tron: 144 }
}

export function getLoaiBanhOptions(loai_csr: string): number[] {
  if (["CSRCV50", "CSRCV60", "SVRCV50", "SVRCV60"].includes(loai_csr)) return [35, 20]
  if (["CSRL", "CSR3L", "SVRL", "SVR3L"].includes(loai_csr)) return [35, 33.33]
  return [35]
}

export function getLoaiCSRByDayChuyen(dc: string, prefix: "CSR" | "SVR"): string[] {
  if (dc === "Mủ nước") return [`${prefix}L`, `${prefix}3L`, `${prefix}CV50`, `${prefix}CV60`, "Ngoại lệ"]
  return [`${prefix}10`, `${prefix}20`, "Ngoại lệ"]
}

export function getBocsForLoaiCSR(dc: string, loai_csr: string): string[] {
  const base = [`Bọc trơn 0,04`, `Bọc nhãn 0,04 VRG ${loai_csr}`]
  if (dc === "Mủ nước") return [...base, `Bọc trơn 0,13`, `Bọc nhãn 0,13 VRG ${loai_csr}`]
  return base
}

export function buildMaLo(num: number, suffix: string, year: string): string {
  return suffix === "" ? `${num}/${year}` : `${num}${suffix}/${year}`
}

// Nhãn in bỏ phần năm — vì nhãn đã có dòng "Ngày:" ghi tay, không cần lặp lại năm
export function buildShortLotLabel(num: number, suffix: string): string {
  return `${num}${suffix}`
}

export function kienWeightKg(cfg: LoaiBanhConfig): number {
  return Math.round(cfg.max_per_kien * cfg.loai_banh * 100) / 100
}

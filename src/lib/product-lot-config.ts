// Nguồn DUY NHẤT cho chủng loại / loại bành / bành-kiện / lô tròn của Thành phẩm (client + server).
// Từ GĐ2 (2026-11-08) đọc cấu hình nhà máy `product_grade_types` qua tham số `cfg` (product-grade.ts);
// không truyền `cfg` ⇒ đúng quy tắc hard-code cũ. Hàm SQL product_grade_lo_tron() phải khớp logic này.

import { DEFAULT_PACKAGING, resolveBocOptions, type PackagingConfig } from "@/lib/product-packaging"
import {
  gradeLoaiBanhConfig,
  gradeLoaiBanhOptions,
  gradeLoaiCSRByDayChuyen,
  gradeDayChuyenOf,
  type CsrPrefix,
  type GradeConfig,
  type LoaiBanhConfig,
} from "@/lib/product-grade"

export type { LoaiBanhConfig } from "@/lib/product-grade"

export function getLoaiBanhConfig(loai_csr: string, selected_banh?: number, cfg?: GradeConfig | null): LoaiBanhConfig {
  return gradeLoaiBanhConfig(cfg, loai_csr, selected_banh)
}

/** `current` = loại bành đang lưu trên lô/phiếu — luôn giữ trong danh sách (dữ liệu cũ không mất). */
export function getLoaiBanhOptions(loai_csr: string, cfg?: GradeConfig | null, current?: number | null): number[] {
  return gradeLoaiBanhOptions(cfg, loai_csr, current)
}

export function getLoaiCSRByDayChuyen(dc: string, prefix: CsrPrefix, cfg?: GradeConfig | null): string[] {
  return gradeLoaiCSRByDayChuyen(cfg, dc, prefix)
}

/**
 * Danh sách bọc của (dây chuyền, chủng loại). Nguồn = bảng product_packaging_types (truyền `cfg` đã tải);
 * không truyền ⇒ danh sách mặc định (đúng hành vi hard-code cũ).
 */
export function getBocsForLoaiCSR(dc: string, loai_csr: string, cfg?: PackagingConfig | null): string[] {
  return resolveBocOptions(cfg ?? DEFAULT_PACKAGING, dc, loai_csr)
}

const MU_NUOC_CSR_SUFFIX = ["L", "3L", "CV50", "CV60"]

/** Dây chuyền suy từ loại CSR (CSRL/SVR3L/CSRCV50… ⇒ Mủ nước, còn lại Mủ tạp); có cấu hình thì theo cấu hình. */
export function dayChuyenForCsr(loaiCsr: string, cfg?: GradeConfig | null): string {
  const fromCfg = gradeDayChuyenOf(cfg, loaiCsr)
  if (fromCfg) return fromCfg
  const suffix = String(loaiCsr || "").replace(/\s+/g, "").toUpperCase().replace(/^(CSR|SVR)/, "")
  return MU_NUOC_CSR_SUFFIX.includes(suffix) ? "Mủ nước" : "Mủ tạp"
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

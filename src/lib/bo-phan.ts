// Danh sách Bộ phận dùng chung (Bảo trì, Đề nghị mua vật tư). File THUẦN — không import gì,
// dùng được cả ở client lẫn API route.
export const BO_PHAN_LIST = [
  "Mủ tạp",
  "Mủ nước",
  "Nước thải",
  "Biomass",
  "Đội xe",
  "Văn phòng",
  "Khác",
] as const

export type BoPhan = (typeof BO_PHAN_LIST)[number]

export function isBoPhan(value: unknown): value is BoPhan {
  return typeof value === "string" && (BO_PHAN_LIST as readonly string[]).includes(value)
}

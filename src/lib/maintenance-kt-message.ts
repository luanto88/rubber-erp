import type { KtItemStatus } from "@/lib/maintenance-kt"

// Thuần (dùng được ở client lẫn server): câu giải thích vì sao biên bản chưa gửi ký được —
// thiếu vật tư mua ngoài trong kho và/hoặc dịch vụ gia công chưa "Xác nhận hoàn thành".
export function describeKtShortage(items: Pick<KtItemStatus, "kind" | "name" | "unit" | "shortage" | "warehouseCode">[]): string | null {
  const vatTu = items.filter((it) => it.kind !== "dich_vu" && it.shortage > 0)
  const dichVu = items.filter((it) => it.kind === "dich_vu" && it.shortage > 0)
  const parts: string[] = []
  if (vatTu.length) {
    parts.push(
      `Kho chưa đủ vật tư mua ngoài: ${vatTu
        .map((it) => `${it.name} (thiếu ${it.shortage}${it.unit ? ` ${it.unit}` : ""}${it.warehouseCode ? ` ở kho ${it.warehouseCode}` : ""})`)
        .join(", ")} — lập đề nghị mua và ghi nhận nhập kho`,
    )
  }
  if (dichVu.length) {
    parts.push(
      `Dịch vụ gia công chưa xác nhận hoàn thành: ${dichVu
        .map((it) => `${it.name} (còn ${it.shortage}${it.unit ? ` ${it.unit}` : ""})`)
        .join(", ")} — xác nhận hoàn thành trên phiếu đề nghị mua`,
    )
  }
  return parts.length ? `${parts.join(". ")} trước khi gửi ký.` : null
}

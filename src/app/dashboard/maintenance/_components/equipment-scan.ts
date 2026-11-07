"use client"

import { authFetch } from "@/lib/auth-fetch"

/** Kết quả quét tem QR (/tb/<token>): máy móc (`assetId`) hoặc xe Đội xe (`vehicleId`, GĐ4a). */
export type ScannedEquipment =
  | { kind: "asset"; assetId: string; ma_tb: string; ten_tb: string; bo_phan: string }
  | { kind: "vehicle"; vehicleId: string; ma_tb: string; ten_tb: string; bo_phan: string }

/** Tra tem QR thiết bị (/tb/<token>) → thiết bị / xe. Lỗi ⇒ trả { error } để trang hiện thông báo. */
export async function resolveScannedEquipment(
  token: string,
): Promise<{ ok: true; equipment: ScannedEquipment } | { ok: false; error: string }> {
  try {
    const res = await authFetch(`/api/equipment/resolve?token=${encodeURIComponent(token)}`)
    const json = (await res.json().catch(() => ({}))) as {
      kind?: string
      assetId?: string
      vehicleId?: string
      ma_tb?: string
      ten_tb?: string
      bo_phan?: string
      error?: string
    }
    if (!res.ok) return { ok: false, error: json.error || "Không tra được tem QR" }
    const base = { ma_tb: json.ma_tb || "", ten_tb: json.ten_tb || "", bo_phan: json.bo_phan || "" }
    if (json.kind === "vehicle" && json.vehicleId) {
      return { ok: true, equipment: { kind: "vehicle", vehicleId: json.vehicleId, ...base } }
    }
    if (json.assetId) return { ok: true, equipment: { kind: "asset", assetId: json.assetId, ...base } }
    return { ok: false, error: json.error || "Không tra được tem QR" }
  } catch {
    return { ok: false, error: "Mất kết nối. Vui lòng thử lại." }
  }
}

/** In tem QR (A4, 20 tem) cho các máy móc HOẶC các xe theo đúng thứ tự truyền vào. Trả lỗi/ghi chú để trang hiện. */
export async function printEquipmentLabels(
  ids: string[],
  kind: "asset" | "vehicle" = "asset",
): Promise<{ error?: string; note?: string }> {
  if (ids.length === 0) return { error: kind === "vehicle" ? "Chưa chọn xe nào" : "Chưa chọn thiết bị nào" }
  try {
    const res = await authFetch("/api/equipment/qr-token/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(kind === "vehicle" ? { vehicleIds: ids } : { assetIds: ids }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      labels?: { ma_tb: string; ten_tb: string; token: string }[]
      error?: string
    }
    if (!res.ok || !json.labels) return { error: json.error || "Không lấy được QR thiết bị" }
    if (json.labels.length === 0) return { error: "Không có thiết bị hợp lệ để in" }
    const { downloadEquipmentQrLabelsPdf } = await import("@/lib/equipment-qr-pdf")
    await downloadEquipmentQrLabelsPdf(json.labels)
    if (json.labels.length < ids.length) {
      return { note: `Đã in ${json.labels.length}/${ids.length} tem — một số thiết bị không còn tồn tại.` }
    }
    return {}
  } catch {
    return { error: "Không in được tem QR. Vui lòng thử lại." }
  }
}

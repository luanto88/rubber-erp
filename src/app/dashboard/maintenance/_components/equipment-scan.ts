"use client"

import { authFetch } from "@/lib/auth-fetch"

export type ScannedEquipment = { assetId: string; ma_tb: string; ten_tb: string; bo_phan: string }

/** Tra tem QR thiết bị (/tb/<token>) → thiết bị. Lỗi ⇒ trả { error } để trang hiện thông báo. */
export async function resolveScannedEquipment(
  token: string,
): Promise<{ ok: true; equipment: ScannedEquipment } | { ok: false; error: string }> {
  try {
    const res = await authFetch(`/api/equipment/resolve?token=${encodeURIComponent(token)}`)
    const json = (await res.json().catch(() => ({}))) as Partial<ScannedEquipment> & { error?: string }
    if (!res.ok || !json.assetId) return { ok: false, error: json.error || "Không tra được tem QR" }
    return {
      ok: true,
      equipment: {
        assetId: json.assetId,
        ma_tb: json.ma_tb || "",
        ten_tb: json.ten_tb || "",
        bo_phan: json.bo_phan || "",
      },
    }
  } catch {
    return { ok: false, error: "Mất kết nối. Vui lòng thử lại." }
  }
}

/** In tem QR (A4, 20 tem) cho các máy móc theo đúng thứ tự truyền vào. Trả lỗi/ghi chú để trang hiện. */
export async function printEquipmentLabels(assetIds: string[]): Promise<{ error?: string; note?: string }> {
  if (assetIds.length === 0) return { error: "Chưa chọn thiết bị nào" }
  try {
    const res = await authFetch("/api/equipment/qr-token/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assetIds }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      labels?: { ma_tb: string; ten_tb: string; token: string }[]
      error?: string
    }
    if (!res.ok || !json.labels) return { error: json.error || "Không lấy được QR thiết bị" }
    if (json.labels.length === 0) return { error: "Không có thiết bị hợp lệ để in" }
    const { downloadEquipmentQrLabelsPdf } = await import("@/lib/equipment-qr-pdf")
    await downloadEquipmentQrLabelsPdf(json.labels)
    if (json.labels.length < assetIds.length) {
      return { note: `Đã in ${json.labels.length}/${assetIds.length} tem — một số thiết bị không còn tồn tại.` }
    }
    return {}
  } catch {
    return { error: "Không in được tem QR. Vui lòng thử lại." }
  }
}

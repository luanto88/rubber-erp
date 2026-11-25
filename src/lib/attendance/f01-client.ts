// Luồng client phiếu F01/F02 (GĐ3 mục 4–5): đã có bản cứng của bộ duyệt hiện tại ⇒ mở đúng bản đó (không dựng lại);
// chưa có mà đã duyệt đủ các ca ⇒ dựng + lưu bản cứng (lỗi lưu KHÔNG chặn xem, trả cảnh báo); chưa duyệt đủ ⇒ bản xem trước.

import { supabase } from "@/lib/supabase"
import { getFreshAuthSession } from "@/lib/auth"
import { getErrorMessage } from "@/lib/error-message"
import {
  finalizeSheetSnapshot,
  getSheetSnapshotUrl,
  loadF01Model,
  loadSheetSnapshotState,
  prepareSheetSnapshotUpload,
  type SheetSnapshotInfo,
} from "@/app/dashboard/attendance/sheet-report-actions"
import { f01FileName } from "./f01-model"
import { buildF01PdfBytes } from "./f01-sheet"

export type F01Result = {
  bytes: Uint8Array
  fileName: string
  /** "hard" = bản cứng đã lưu; "preview" = chưa duyệt đủ; "live" = đã duyệt đủ nhưng chưa lưu được bản cứng. */
  kind: "hard" | "preview" | "live"
  snapshot: SheetSnapshotInfo | null
  warning: string | null
}

async function token() {
  const s = await getFreshAuthSession()
  return s?.access_token ?? null
}

export async function resolveF01Pdf(factoryId: string, sheetId: string): Promise<F01Result> {
  const t = await token()
  let state: Awaited<ReturnType<typeof loadSheetSnapshotState>> | null = null
  try {
    state = await loadSheetSnapshotState(t, factoryId, sheetId)
  } catch (err) {
    console.warn("Không đọc được trạng thái bản cứng F01/F02:", err)
  }

  if (state?.current) {
    const url = await getSheetSnapshotUrl(t, factoryId, state.current.id)
    const res = await fetch(url)
    if (!res.ok) throw new Error("Không tải được bản cứng đã lưu.")
    return { bytes: new Uint8Array(await res.arrayBuffer()), fileName: state.current.fileName, kind: "hard", snapshot: state.current, warning: null }
  }

  const model = await loadF01Model(t, factoryId, sheetId)
  const bytes = await buildF01PdfBytes(model)
  const fileName = f01FileName(model)
  if (!model.approved) return { bytes, fileName, kind: "preview", snapshot: null, warning: model.approvalWarning || null }
  if (state?.unavailable) {
    return { bytes, fileName, kind: "live", snapshot: null, warning: "Chưa cấu hình lưu bản cứng (migration 20261207) — đang xem bản dựng trực tiếp." }
  }

  try {
    const { path, token: uploadToken } = await prepareSheetSnapshotUpload(t, factoryId, sheetId)
    const { error } = await supabase.storage
      .from("attendance-sheet-reports")
      .uploadToSignedUrl(path, uploadToken, new Blob([bytes as BlobPart], { type: "application/pdf" }), { contentType: "application/pdf" })
    if (error) throw error
    const snap = await finalizeSheetSnapshot(t, factoryId, sheetId, path, fileName)
    return { bytes, fileName, kind: "hard", snapshot: snap, warning: null }
  } catch (err) {
    return { bytes, fileName, kind: "live", snapshot: null, warning: `Chưa lưu được bản cứng: ${getErrorMessage(err, "lỗi không xác định")}. Mở lại trang để thử lại.` }
  }
}

/**
 * Tải PDF phiếu TKSX. Bản cứng đã lưu ⇒ tải qua Signed URL có Content-Disposition (ổn định trên mobile / WebView).
 * Bản dựng trực tiếp ⇒ blob URL; KHÔNG thu hồi URL ngay sau click (Chrome Android tải bất đồng bộ ⇒ báo
 * "1 tệp tải xuống không thành công" — lỗi thật 2026-11-25), giữ 60 giây rồi mới thu hồi.
 */
export async function downloadF01(result: F01Result, factoryId: string): Promise<void> {
  if (result.kind === "hard" && result.snapshot) {
    try {
      const url = await getSheetSnapshotUrl(await token(), factoryId, result.snapshot.id, true)
      triggerDownload(url, result.fileName)
      return
    } catch (err) {
      console.warn("Không lấy được link tải bản cứng, tải bản trong máy:", err)
    }
  }
  downloadPdfBytes(result.bytes, result.fileName)
}

function triggerDownload(url: string, fileName: string) {
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  a.rel = "noopener"
  document.body.appendChild(a)
  a.click()
  window.setTimeout(() => a.remove(), 1000)
}

export function downloadPdfBytes(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }))
  triggerDownload(url, fileName)
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

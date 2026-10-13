/**
 * Doc-UI GĐ5 — cấu hình worker pdfjs dùng chung cho khung xem PDF và 4 màn ký.
 *
 * Worker luôn lấy từ gói `pdfjs-dist` đã cài (webpack đóng gói qua `new URL(..., import.meta.url)`),
 * KHÔNG nạp từ CDN: CDN chậm/không ổn định trên mạng nhà máy và lệch phiên bản với bản đã cài.
 * Nếu trang đã nạp worker sẵn (`globalThis.pdfjsWorker`) thì dùng luôn, không tạo worker thứ hai.
 */
type PdfjsLike = { GlobalWorkerOptions: { workerSrc: string } }

export function ensurePdfjsWorker(pdfjsLib: PdfjsLike) {
  if ((globalThis as Record<string, unknown>).pdfjsWorker) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = ""
    return
  }
  if (pdfjsLib.GlobalWorkerOptions.workerSrc) return
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.mjs", import.meta.url,
  ).toString()
}

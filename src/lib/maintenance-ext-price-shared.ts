// Phần THUẦN của giá vật tư mua ngoài / gia công trên biên bản bảo trì (GĐ4) — dùng được ở client.
// Phần tính toán + đồng bộ DB ở `maintenance-ext-price.ts` (server-only).
import { formatSoPhieuFull } from "@/lib/purchase/types"

/**
 * Giá đã xác định cho 1 vật tư (theo đúng biên bản nếu có):
 *  - `de_nghi`: phiếu đề nghị mua GẦN NHẤT có dòng gắn biên bản này (mọi trạng thái trừ Huỷ; phiếu điều
 *    chỉnh chỉ tính khi đã duyệt) — đề nghị là nguồn giá, biên bản chỉ đọc;
 *  - `lan_mua_truoc` / `danh_muc`: giá tham chiếu (pickReferencePrice);
 *  - null: chưa có giá nào ⇒ biên bản nhập tay, phiếu lập từ biên bản chép giá đó.
 */
export type ResolvedExtPrice = {
  value: number
  loaiTien: string
  /** `thuc_te` (A4): bình quân theo số lượng các lần nhập kho đã ghi sổ / xác nhận gia công của dòng gắn biên bản. */
  source: "thuc_te" | "de_nghi" | "lan_mua_truoc" | "danh_muc"
  so?: number
  nam?: number
  ngay?: string
  /** Số lần nhập / xác nhận gia công đã gộp (chỉ `thuc_te`). */
  soLan?: number
}

export function extPriceLabel(p: ResolvedExtPrice): string {
  if (p.source === "thuc_te") {
    const lan = (p.soLan || 0) > 1 ? `bình quân ${p.soLan} lần` : "1 lần"
    return `Giá nhập thực tế (${lan}) theo đề nghị ${formatSoPhieuFull(p.so, p.nam)}`
  }
  if (p.source === "de_nghi") return `Theo đề nghị ${formatSoPhieuFull(p.so, p.nam)}`
  if (p.source === "lan_mua_truoc") return `Lần mua gần nhất ${formatSoPhieuFull(p.so, p.nam)}`
  return "Giá danh mục kho"
}

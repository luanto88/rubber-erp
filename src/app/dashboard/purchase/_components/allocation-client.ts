// Phân bổ dòng đề nghị mua đã duyệt (lập riêng) cho biên bản bảo trì — helper trình duyệt NHẸ
// (không kéo jsPDF), dùng ở cả trang phiếu đề nghị lẫn trang biên bản.
import { authFetch } from "@/lib/auth-fetch"

async function readJson<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error || `Lỗi ${res.status}`)
  return json
}

export type PurchaseLineAllocation = {
  id: string
  lineId: string
  recordId: string
  maBb: string | null
  recordTrangThai: string | null
  qty: number
}

export type AllocationCandidate = {
  lineId: string
  requestId: string
  so: number
  nam: number
  ngay: string | null
  trangThai: string
  boPhan: string | null
  itemName: string | null
  unit: string | null
  soLuong: number
  received: number
  allocated: number
  free: number
  mine: number
  donGia: number
  loaiTien: string
  pendingAdjust: boolean
}

/** Gắn / đổi / gỡ (soLuong = 0) phân bổ 1 dòng đề nghị cho 1 biên bản bảo trì. */
export async function allocatePurchaseLine(lineId: string, recordId: string, soLuong: number) {
  return readJson<{ ok: boolean }>(await authFetch(`/api/purchase/lines/${lineId}/allocations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recordId, soLuong }),
  }))
}

/** Dòng đề nghị đã duyệt, lập riêng, cùng vật tư, còn SL chưa phân bổ — để gắn vào biên bản. */
export async function fetchAllocationCandidates(recordId: string, itemId: string) {
  const qs = new URLSearchParams({ recordId, itemId })
  return readJson<{ candidates: AllocationCandidate[] }>(await authFetch(`/api/purchase/allocation-candidates?${qs}`))
}


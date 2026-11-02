import type { KtItemStatus } from "@/lib/maintenance-kt"

// Thuần (dùng được ở client lẫn server): câu giải thích vì sao biên bản chưa gửi ký được —
// thiếu vật tư mua ngoài trong kho và/hoặc dịch vụ gia công chưa "Xác nhận hoàn thành".
// Nói rõ phần thiếu đã có đề nghị nào đang chờ (chờ nhập kho / chờ xác nhận) và còn phải lập thêm bao nhiêu.

type ShortageItem = Pick<KtItemStatus, "kind" | "name" | "unit" | "shortage" | "warehouseCode"> &
  Partial<Pick<KtItemStatus, "pendingRequested" | "pendingRequests">>

const fmtSo = (so: number, nam: number) => `${String(so).padStart(2, "0")}/ĐNMVT${nam ? ` (${nam})` : ""}`

function pendingNote(it: ShortageItem, waitVerb: string): { text: string; covered: boolean } {
  const reqs = it.pendingRequests || []
  const pending = it.pendingRequested ?? reqs.reduce((s, r) => s + r.qty, 0)
  const u = it.unit ? ` ${it.unit}` : ""
  if (pending <= 0) return { text: "", covered: false }
  const list = reqs.length ? ` theo đề nghị ${reqs.map((r) => fmtSo(r.so, r.nam)).join(", ")}` : " theo đề nghị mua"
  if (pending >= it.shortage) return { text: ` — ${waitVerb}${list}`, covered: true }
  return { text: ` — ${waitVerb}${list} ${pending}${u}, cần lập thêm đề nghị cho ${it.shortage - pending}${u}`, covered: false }
}

export function describeKtShortage(items: ShortageItem[]): string | null {
  const vatTu = items.filter((it) => it.kind !== "dich_vu" && it.shortage > 0)
  const dichVu = items.filter((it) => it.kind === "dich_vu" && it.shortage > 0)
  const parts: string[] = []
  if (vatTu.length) {
    const notes = vatTu.map((it) => pendingNote(it, "chờ nhập kho"))
    const allCovered = notes.every((n) => n.covered)
    parts.push(
      `Kho chưa đủ vật tư mua ngoài: ${vatTu
        .map((it, i) => `${it.name} (thiếu ${it.shortage}${it.unit ? ` ${it.unit}` : ""}${it.warehouseCode ? ` ở kho ${it.warehouseCode}` : ""}${notes[i].text})`)
        .join(", ")} — ${allCovered ? "ghi nhận nhập kho trên phiếu đề nghị" : "lập đề nghị mua và ghi nhận nhập kho"}`,
    )
  }
  if (dichVu.length) {
    const notes = dichVu.map((it) => pendingNote(it, "chờ xác nhận hoàn thành"))
    const allCovered = notes.every((n) => n.covered)
    parts.push(
      `Dịch vụ gia công chưa xác nhận hoàn thành: ${dichVu
        .map((it, i) => `${it.name} (còn ${it.shortage}${it.unit ? ` ${it.unit}` : ""}${notes[i].text})`)
        .join(", ")} — ${allCovered ? "xác nhận hoàn thành trên phiếu đề nghị" : "lập đề nghị mua rồi xác nhận hoàn thành"}`,
    )
  }
  return parts.length ? `${parts.join(". ")} trước khi gửi ký.` : null
}

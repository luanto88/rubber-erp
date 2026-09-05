"use client"

import { supabase } from "@/lib/supabase"
import { getTodayISODate } from "@/lib/date-utils"
import { prepareImageForUploadOrThrow } from "@/lib/image-upload"

export const OPERATION_NOTE_MAX_IMAGES = 10

// Supabase JS (PostgREST/Storage) ném lỗi dạng plain object { message, code, details, hint... },
// KHÔNG phải instance của `Error` — nên `err instanceof Error ? err.message : fallback` luôn
// rơi vào nhánh fallback và nuốt mất lý do thật (vd bảng chưa tồn tại vì chưa chạy migration,
// vi phạm RLS...). Dùng hàm này ở mọi catch block liên quan tới operation-notes để luôn thấy
// đúng lỗi thật khi debug.
export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === "string" && msg) return msg
  }
  return fallback
}

export type OperationNote = {
  id: string
  factory_id: string
  noi_dung: string
  ngay_xay_ra: string
  image_urls: string[]
  created_by: string | null
  nguoi_tao: string | null
  created_at: string
  updated_at: string
}

export type OperationNoteFilters = {
  search?: string
  from?: string
  to?: string
  limit?: number
  // Phân trang thật (.range()) — dùng cùng với limit để "Tải thêm" chỉ lấy đúng trang kế tiếp
  // thay vì truy vấn lại từ đầu với limit lớn hơn (bug lag cũ). Không truyền = lấy limit đầu tiên.
  offset?: number
}

// So sánh khớp đúng thứ tự sort của query (ngay_xay_ra desc, created_at desc) — dùng để chèn
// 1 ghi chú mới/vừa sửa vào đúng vị trí trong mảng đã tải cục bộ, không phải tải lại toàn bộ.
export function compareOperationNotes(a: OperationNote, b: OperationNote): number {
  if (a.ngay_xay_ra !== b.ngay_xay_ra) return a.ngay_xay_ra < b.ngay_xay_ra ? 1 : -1
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1
  return 0
}

const SELECT_COLS =
  "id, factory_id, noi_dung, ngay_xay_ra, image_urls, created_by, nguoi_tao, created_at, updated_at"

export async function fetchOperationNotes(
  factoryId: string,
  filters: OperationNoteFilters = {},
): Promise<OperationNote[]> {
  let q = supabase
    .from("operation_notes")
    .select(SELECT_COLS)
    .eq("factory_id", factoryId)
    .order("ngay_xay_ra", { ascending: false })
    .order("created_at", { ascending: false })

  if (filters.from) q = q.gte("ngay_xay_ra", filters.from)
  if (filters.to) q = q.lte("ngay_xay_ra", filters.to)
  if (filters.search?.trim()) q = q.ilike("noi_dung", `%${filters.search.trim()}%`)
  if (filters.limit && filters.offset !== undefined) {
    q = q.range(filters.offset, filters.offset + filters.limit - 1)
  } else if (filters.limit) {
    q = q.limit(filters.limit)
  }

  const { data, error } = await q
  if (error) throw error
  return (data || []) as OperationNote[]
}

export async function uploadOperationNoteImage(factoryId: string, rawFile: File): Promise<string> {
  // Chuẩn hóa theo nội dung thật (chuyển HEIC sang JPEG) — xem src/lib/image-format.ts.
  const file = await prepareImageForUploadOrThrow(rawFile)
  const ext = file.name.split(".").pop() || "jpg"
  const path = `${factoryId}/notes/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from("order-files").upload(path, file, { upsert: false, contentType: file.type })
  if (error) throw error
  const { data } = supabase.storage.from("order-files").getPublicUrl(path)
  return data.publicUrl
}

// Trả về row vừa tạo (không chỉ throw-on-error) — để caller cập nhật danh sách cục bộ
// (prepend) thay vì phải tải lại toàn bộ trang sau mỗi lần lưu.
export async function createOperationNote(input: {
  factoryId: string
  noiDung: string
  ngayXayRa: string
  imageUrls: string[]
  createdBy: string | null
  nguoiTao: string | null
}): Promise<OperationNote> {
  const { data, error } = await supabase
    .from("operation_notes")
    .insert({
      factory_id: input.factoryId,
      noi_dung: input.noiDung.trim(),
      ngay_xay_ra: input.ngayXayRa || getTodayISODate(),
      image_urls: input.imageUrls,
      created_by: input.createdBy,
      nguoi_tao: input.nguoiTao,
    })
    .select(SELECT_COLS)
    .single()
  if (error) throw error
  return data as OperationNote
}

// Trả về row đã cập nhật — dùng để patch đúng vị trí trong mảng cục bộ thay vì tải lại toàn bộ.
export async function updateOperationNote(
  id: string,
  patch: { noiDung?: string; ngayXayRa?: string; imageUrls?: string[] },
): Promise<OperationNote> {
  const payload: Record<string, unknown> = {}
  if (patch.noiDung !== undefined) payload.noi_dung = patch.noiDung.trim()
  if (patch.ngayXayRa !== undefined) payload.ngay_xay_ra = patch.ngayXayRa
  if (patch.imageUrls !== undefined) payload.image_urls = patch.imageUrls
  const { data, error } = await supabase
    .from("operation_notes")
    .update(payload)
    .eq("id", id)
    .select(SELECT_COLS)
    .single()
  if (error) throw error
  return data as OperationNote
}

export async function deleteOperationNote(id: string) {
  const { error } = await supabase.from("operation_notes").delete().eq("id", id)
  if (error) throw error
}

export function canManageOperationNote(
  note: Pick<OperationNote, "created_by">,
  user: { id: string; role: string } | null,
) {
  if (!user) return false
  if (user.role === "admin") return true
  return !!note.created_by && note.created_by === user.id
}

// ── Chia sẻ ghi chú ──────────────────────────────────────────────────────────
// Mặc định ghi chú là riêng tư theo người tạo; admin thấy tất cả (thực thi ở RLS,
// xem migration 20260707_operation_notes.sql). Chia sẻ cho người khác qua bảng
// operation_note_shares — người được chia sẻ sẽ tự thấy ghi chú đó (RLS cho phép đọc).

export type ShareCandidate = { id: string; name: string }

export type OperationNoteShare = {
  id: string
  note_id: string
  shared_with_user_id: string
  shared_by: string | null
  created_at: string
}

// Danh sách user active trong nhà máy để chọn chia sẻ — phải qua API route server-side
// vì RLS của bảng `profiles` không cho user thường đọc toàn bộ profiles trong factory.
export async function fetchShareCandidates(factoryId: string): Promise<ShareCandidate[]> {
  const res = await fetch(`/api/notes/share-candidates?factoryId=${encodeURIComponent(factoryId)}`)
  const json = (await res.json().catch(() => null)) as { users?: ShareCandidate[]; error?: string } | null
  if (!res.ok) throw new Error(json?.error || "Không tải được danh sách người dùng.")
  return json?.users || []
}

export async function fetchOperationNoteShares(noteId: string): Promise<OperationNoteShare[]> {
  const { data, error } = await supabase
    .from("operation_note_shares")
    .select("id, note_id, shared_with_user_id, shared_by, created_at")
    .eq("note_id", noteId)
  if (error) throw error
  return (data || []) as OperationNoteShare[]
}

// Đặt lại đúng danh sách người được chia sẻ cho 1 ghi chú (thêm người mới, gỡ người bị bỏ chọn).
// Đi qua client Supabase bình thường (không dùng service role) — RLS của operation_note_shares
// tự xác thực actor thật sự là chủ ghi chú hoặc admin qua auth.uid(), không tin dữ liệu client gửi lên.
export async function setOperationNoteShares(input: {
  noteId: string
  factoryId: string
  actorId: string
  recipientUserIds: string[]
}) {
  const current = await fetchOperationNoteShares(input.noteId)
  const currentIds = new Set(current.map((s) => s.shared_with_user_id))
  const nextIds = new Set(input.recipientUserIds)

  const toAdd = input.recipientUserIds.filter((id) => !currentIds.has(id))
  const toRemove = current.filter((s) => !nextIds.has(s.shared_with_user_id))

  if (toAdd.length) {
    const { error } = await supabase.from("operation_note_shares").insert(
      toAdd.map((uid) => ({
        note_id: input.noteId,
        factory_id: input.factoryId,
        shared_with_user_id: uid,
        shared_by: input.actorId,
      })),
    )
    if (error) throw error
  }

  if (toRemove.length) {
    const { error } = await supabase
      .from("operation_note_shares")
      .delete()
      .in("id", toRemove.map((s) => s.id))
    if (error) throw error
  }
}

// Đếm số người được chia sẻ cho mỗi ghi chú trong danh sách — chỉ dùng cho ghi chú mà
// người xem hiện tại là chủ (RLS chỉ trả về đủ số dòng thật khi actor là shared_by/admin).
export async function fetchShareCountsForNoteIds(noteIds: string[]): Promise<Record<string, number>> {
  if (!noteIds.length) return {}
  const { data, error } = await supabase
    .from("operation_note_shares")
    .select("note_id")
    .in("note_id", noteIds)
  if (error) throw error
  const counts: Record<string, number> = {}
  for (const row of data || []) {
    const noteId = row.note_id as string
    counts[noteId] = (counts[noteId] || 0) + 1
  }
  return counts
}

// Bảng màu pastel xoay vòng theo index — cảm giác "ghi chú giấy nhớ" nhẹ nhàng,
// không dùng viền cứng, chỉ đổ bóng nhẹ (áp dụng ở nơi render card).
export const NOTE_PASTEL_BG = [
  "bg-amber-50",
  "bg-sky-50",
  "bg-emerald-50",
  "bg-rose-50",
  "bg-violet-50",
  "bg-lime-50",
]

export function notePastelBg(index: number) {
  return NOTE_PASTEL_BG[index % NOTE_PASTEL_BG.length]
}

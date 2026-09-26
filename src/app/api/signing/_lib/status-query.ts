import { NextRequest, NextResponse } from "next/server"
import { isSessionExpiredError, supabaseAdmin } from "@/app/api/account/_lib/security"

// Truy vấn dùng chung cho các route `.../signing-status` (Bảo trì, Điều xe).
//
// Bug báo 2026-09-26: cột "Ký duyệt" lúc hiện lúc không. Nguyên nhân gồm (1) danh sách id dài
// nhồi vào URL — lại còn GẤP ĐÔI vì `.or(ban_ghi_id.in.(ids),ma_ho_so.in.(ids))` — vượt giới
// hạn URL của gateway khi bộ lọc ngày rộng; (2) lỗi phiên trả 400 khiến client không phân biệt
// được để làm mới token. File này: nhận id qua POST body, chia lô, và trả 401 cho lỗi phiên.

export const STATUS_CHUNK_SIZE = 100

export function chunk<T>(arr: T[], size = STATUS_CHUNK_SIZE): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Đọc `factoryId` + danh sách id từ query (GET, tương thích cũ) hoặc JSON body (POST). */
export async function readStatusParams(
  req: NextRequest,
  idsKey: string,
): Promise<{ factoryId: string | null; ids: string[] | null }> {
  if (req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const raw = body[idsKey]
    return {
      factoryId: typeof body.factoryId === "string" ? body.factoryId : null,
      ids: Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string" && !!v) : null,
    }
  }
  const param = req.nextUrl.searchParams.get(idsKey)
  return {
    factoryId: req.nextUrl.searchParams.get("factoryId"),
    ids: param ? param.split(",").filter(Boolean) : null,
  }
}

export type YeuCauStatusRow = {
  id: string
  ma_ho_so: string | null
  ban_ghi_id: string | null
  trang_thai: string
  nguoi_tao: string
  file_hien_tai: string | null
  tao_luc: string
  tra_ve_ly_do: string | null
}

const YEU_CAU_COLS = "id, ma_ho_so, ban_ghi_id, trang_thai, nguoi_tao, file_hien_tai, tao_luc, tra_ve_ly_do"

/**
 * Yêu cầu ký còn hiệu lực (`dang_luan_chuyen`/`hoan_tat`) khớp các id bản ghi — theo
 * `ban_ghi_id` (chuẩn hiện tại) HOẶC `ma_ho_so` (bản ghi lịch sử lưu id vào mã hồ sơ). Trả về
 * sắp `tao_luc` mới nhất trước, đã khử trùng theo `id`.
 * `ids = null` → không lọc theo bản ghi (phân trang để không bị cắt 1000 dòng).
 */
export async function fetchActiveYeuCau(params: {
  factoryId: string
  modun: string
  loaiTaiLieu: string[]
  ids: string[] | null
}): Promise<YeuCauStatusRow[]> {
  const base = () =>
    supabaseAdmin
      .from("yeu_cau_ky")
      .select(YEU_CAU_COLS)
      .eq("factory_id", params.factoryId)
      .eq("modun", params.modun)
      .in("loai_tai_lieu", params.loaiTaiLieu)
      .in("trang_thai", ["dang_luan_chuyen", "hoan_tat"])

  const byId = new Map<string, YeuCauStatusRow>()
  const collect = (rows: unknown[] | null) => {
    for (const r of (rows || []) as YeuCauStatusRow[]) byId.set(r.id, r)
  }

  if (params.ids === null) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await base().order("tao_luc", { ascending: false }).range(from, from + 999)
      if (error) throw new Error(error.message)
      collect(data)
      if (!data || data.length < 1000) break
    }
  } else {
    const ids = [...new Set(params.ids)]
    for (const part of chunk(ids)) {
      const [a, b] = await Promise.all([base().in("ban_ghi_id", part), base().in("ma_ho_so", part)])
      if (a.error) throw new Error(a.error.message)
      if (b.error) throw new Error(b.error.message)
      collect(a.data)
      collect(b.data)
    }
  }

  return [...byId.values()].sort((x, y) => (y.tao_luc || "").localeCompare(x.tao_luc || ""))
}

export type NguoiKyStatusRow = {
  yeu_cau_id: string
  user_id: string
  vai_tro: string
  thu_tu: number
  trang_thai: string
}

/** Người ký của các yêu cầu — chia lô để câu `.in` không quá dài/không vượt 1000 dòng. */
export async function fetchNguoiKyForYeuCau(yeuCauIds: string[]): Promise<NguoiKyStatusRow[]> {
  const out: NguoiKyStatusRow[] = []
  for (const part of chunk(yeuCauIds)) {
    const { data, error } = await supabaseAdmin
      .from("nguoi_ky")
      .select("yeu_cau_id, user_id, vai_tro, thu_tu, trang_thai")
      .in("yeu_cau_id", part)
      .order("thu_tu", { ascending: true })
    if (error) throw new Error(error.message)
    out.push(...((data || []) as NguoiKyStatusRow[]))
  }
  return out
}

/** Map `id → updated_at` (ms) của bảng nguồn, chia lô. */
export async function fetchUpdatedAtMap(table: string, ids: string[]): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  for (const part of chunk(ids)) {
    const { data } = await supabaseAdmin.from(table).select("id, updated_at").in("id", part)
    for (const r of (data || []) as { id: string; updated_at: string | null }[]) {
      map.set(r.id, new Date(r.updated_at || 0).getTime())
    }
  }
  return map
}

/** Lỗi phiên → 401 để client biết làm mới token rồi thử lại; lỗi khác → 400. */
export function statusErrorResponse(err: unknown): NextResponse {
  if (isSessionExpiredError(err)) {
    return NextResponse.json({ error: err.message }, { status: 401 })
  }
  return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
}

import { NextRequest, NextResponse } from "next/server"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"

export const dynamic = "force-dynamic"

// "Hồ sơ ký đang chờ chính tôi" — phục vụ mục chuông "Hồ sơ chờ bạn ký" (module-tasks.ts).
//
// Vì sao BẮT BUỘC phải là route service-role: RLS `nguoi_ky_select`
// (20260902_signing_core_tables.sql) chỉ cho client đọc dòng `user_id = auth.uid()` (hoặc khi là
// owner/admin). Để biết "đã TỚI LƯỢT tôi chưa" phải nhìn được trạng thái của những người ký
// TRƯỚC mình — client không đọc được các dòng đó, nên không thể tự tính.
//
// Tái dùng cho mọi module: bỏ `modun` thì trả toàn bộ hồ sơ đang chờ tôi ở mọi module.

const CHUNK = 200 // chunk .in() theo .claude/rules/04-code-patterns.md

type MyRow = { yeu_cau_id: string; thu_tu: number }
type YeuCauRow = { id: string; ma_ho_so: string | null; modun: string; loai_tai_lieu: string; tao_luc: string }
type SignerRow = { yeu_cau_id: string; thu_tu: number; trang_thai: string }

function chunked<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

export async function GET(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)
    const modun = req.nextUrl.searchParams.get("modun")

    // KHÔNG tin factoryId từ client — luôn đọc từ profile của chính người gọi (mirror
    // create-request/route.ts). Nếu client vẫn truyền và lệch → 403, chặn dò cross-factory.
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("factory_id")
      .eq("id", authUser.id)
      .single()
    const factoryId = profile?.factory_id as string | undefined
    if (!factoryId) {
      return NextResponse.json({ error: "Tài khoản chưa gán nhà máy" }, { status: 403 })
    }
    const requestedFactoryId = req.nextUrl.searchParams.get("factoryId")
    if (requestedFactoryId && requestedFactoryId !== factoryId) {
      return NextResponse.json({ error: "Không có quyền với nhà máy này" }, { status: 403 })
    }

    // 1. Các dòng nguoi_ky của CHÍNH tôi còn chờ ký.
    const { data: myRows } = await supabaseAdmin
      .from("nguoi_ky")
      .select("yeu_cau_id, thu_tu")
      .eq("user_id", authUser.id)
      .eq("factory_id", factoryId)
      .in("trang_thai", ["cho", "dang_mo"])

    const myByYeuCau = new Map<string, number>()
    for (const r of (myRows || []) as MyRow[]) myByYeuCau.set(r.yeu_cau_id, r.thu_tu)
    if (!myByYeuCau.size) {
      return NextResponse.json({ count: 0, countChoLuot: 0, items: [] })
    }

    // 2. Lọc còn lại các hồ sơ thật sự đang luân chuyển (bỏ hoan_tat/huy/tu_choi).
    const yeuCauRows: YeuCauRow[] = []
    for (const ids of chunked([...myByYeuCau.keys()])) {
      let q = supabaseAdmin
        .from("yeu_cau_ky")
        .select("id, ma_ho_so, modun, loai_tai_lieu, tao_luc")
        .in("id", ids)
        .eq("factory_id", factoryId)
        .eq("trang_thai", "dang_luan_chuyen")
      if (modun) q = q.eq("modun", modun)
      const { data } = await q
      yeuCauRows.push(...((data || []) as YeuCauRow[]))
    }
    if (!yeuCauRows.length) {
      return NextResponse.json({ count: 0, countChoLuot: 0, items: [] })
    }

    // 3. Trạng thái TẤT CẢ người ký của các hồ sơ đó → tính "đã tới lượt tôi chưa".
    const activeIds = yeuCauRows.map((y) => y.id)
    const signersByYeuCau = new Map<string, SignerRow[]>()
    for (const ids of chunked(activeIds)) {
      const { data } = await supabaseAdmin
        .from("nguoi_ky")
        .select("yeu_cau_id, thu_tu, trang_thai")
        .in("yeu_cau_id", ids)
      for (const r of (data || []) as SignerRow[]) {
        const list = signersByYeuCau.get(r.yeu_cau_id)
        if (list) list.push(r)
        else signersByYeuCau.set(r.yeu_cau_id, [r])
      }
    }

    const items = yeuCauRows
      .map((y) => {
        const myThuTu = myByYeuCau.get(y.id) as number
        const rows = signersByYeuCau.get(y.id) || []
        // Mirror ĐÚNG guard server trong signField(): tới lượt khi mọi người có thu_tu nhỏ hơn
        // đều đã 'da_ky'.
        const toiLuot = !rows.some((r) => r.thu_tu < myThuTu && r.trang_thai !== "da_ky")
        return {
          yeuCauId: y.id,
          maHoSo: y.ma_ho_so,
          modun: y.modun,
          loaiTaiLieu: y.loai_tai_lieu,
          thuTu: myThuTu,
          toiLuot,
          taoLuc: y.tao_luc,
        }
      })
      .sort((a, b) => (a.taoLuc < b.taoLuc ? -1 : a.taoLuc > b.taoLuc ? 1 : 0))

    return NextResponse.json({
      count: items.filter((i) => i.toiLuot).length,
      countChoLuot: items.filter((i) => !i.toiLuot).length,
      items,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: 400 })
  }
}

import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"

export const dynamic = "force-dynamic"

// GET — nhân sự thật của nhà máy (maintenance_staff active) để chọn "Thành phần nhà máy" in đầu Mẫu 8A (rule 30).
// Trả đủ 3 loại chức vụ; UI mặc định chức vụ chính quyền → kiêm nhiệm → chức vụ. Service role vì RLS bảng nhân sự
// không cho mọi người đọc; chỉ trả các cột hiển thị.

type StaffRow = {
  id: string
  ten: string | null
  gioi_tinh: string | null
  chuc_vu: string | null
  chuc_vu_chinh_quyen: string | null
  chuc_vu_kim_nhiem: string | null
}

export async function GET(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    const load = (cols: string) =>
      supabaseAdmin.from("maintenance_staff").select(cols).eq("factory_id", actor.factoryId).eq("active", true).order("ten")
    let res = await load("id, ten, gioi_tinh, chuc_vu, chuc_vu_chinh_quyen, chuc_vu_kim_nhiem")
    if (res.error) res = await load("id, ten, chuc_vu, chuc_vu_chinh_quyen")
    if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 })
    const clean = (v: string | null | undefined) => {
      const t = String(v || "").trim()
      // Có nhân sự bị điền nhầm email vào chức vụ (rule 14) — bỏ.
      return t && !t.includes("@") ? t : ""
    }
    const staff = ((res.data || []) as unknown as Partial<StaffRow>[])
      .filter((s) => s.id && clean(s.ten))
      .map((s) => ({
        id: s.id as string,
        ten: clean(s.ten),
        gioiTinh: clean(s.gioi_tinh),
        chucVuChinhQuyen: clean(s.chuc_vu_chinh_quyen),
        chucVuKiemNhiem: clean(s.chuc_vu_kim_nhiem),
        chucVu: clean(s.chuc_vu),
      }))
      .sort((a, b) => a.ten.localeCompare(b.ten, "vi"))
    return NextResponse.json({ staff })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}

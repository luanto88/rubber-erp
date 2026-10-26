import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"
import { isBoPhan } from "@/lib/bo-phan"
import { fetchAllPaginated } from "@/lib/supabase-helpers"

export const dynamic = "force-dynamic"

// GET — Thống kê dịch vụ gia công ngoài đã "Xác nhận hoàn thành" (bảng purchase_service_completions).
// ?from=&to=&bo_phan=a,b — lọc theo ngày hoàn thành và bộ phận của phiếu đề nghị.
// Phạm vi: purchase.view_all / admin → toàn nhà máy; còn lại → phiếu mình đề nghị / ký / tạo.
type CompletionRow = {
  id: string
  request_id: string
  item_id: string | null
  item_name: string | null
  unit: string | null
  so_luong: number
  don_gia: number
  loai_tien: string | null
  ngay: string
  nha_cung_cap: string | null
  ghi_chu: string | null
  image_urls: string[] | null
  created_by: string | null
  created_at: string
}

type RequestRow = {
  id: string
  so: number
  nam: number
  bo_phan: string | null
  nguoi_de_nghi_id: string
  giam_doc_user_id: string | null
  ke_toan_user_id: string | null
  created_by: string | null
  maintenance_record_id: string | null
}

export async function GET(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    const sp = req.nextUrl.searchParams
    const from = sp.get("from")
    const to = sp.get("to")
    const boPhan = (sp.get("bo_phan") || "").split(",").map((v) => v.trim()).filter(isBoPhan)
    const canAll = actor.isAdmin || (await isoActorHasPermission(actor, ["purchase.view_all"]))

    const completions = await fetchAllPaginated<CompletionRow>((a, b) => {
      let q = supabaseAdmin
        .from("purchase_service_completions")
        .select("id, request_id, item_id, item_name, unit, so_luong, don_gia, loai_tien, ngay, nha_cung_cap, ghi_chu, image_urls, created_by, created_at")
        .eq("factory_id", actor.factoryId)
        .order("ngay", { ascending: false })
        .order("id", { ascending: true })
        .range(a, b)
      if (from) q = q.gte("ngay", from)
      if (to) q = q.lte("ngay", to)
      return q
    })

    const reqIds = [...new Set(completions.map((c) => c.request_id))]
    const requests = new Map<string, RequestRow>()
    for (let i = 0; i < reqIds.length; i += 200) {
      const { data, error } = await supabaseAdmin
        .from("purchase_requests")
        .select("id, so, nam, bo_phan, nguoi_de_nghi_id, giam_doc_user_id, ke_toan_user_id, created_by, maintenance_record_id")
        .eq("factory_id", actor.factoryId)
        .in("id", reqIds.slice(i, i + 200))
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      for (const r of (data || []) as RequestRow[]) requests.set(r.id, r)
    }

    const u = actor.userId
    const visible = completions.filter((c) => {
      const r = requests.get(c.request_id)
      if (!r) return false
      if (boPhan.length && !(r.bo_phan && boPhan.includes(r.bo_phan as (typeof boPhan)[number]))) return false
      if (canAll) return true
      return [r.nguoi_de_nghi_id, r.giam_doc_user_id, r.ke_toan_user_id, r.created_by].includes(u) || c.created_by === u
    })

    // Biên bản liên kết + tên người xác nhận.
    const recIds = [...new Set(visible.map((c) => requests.get(c.request_id)?.maintenance_record_id).filter((v): v is string => !!v))]
    const maBb = new Map<string, string | null>()
    for (let i = 0; i < recIds.length; i += 200) {
      const { data } = await supabaseAdmin.from("maintenance_records").select("id, ma_bb").in("id", recIds.slice(i, i + 200))
      for (const r of (data || []) as { id: string; ma_bb: string | null }[]) maBb.set(r.id, r.ma_bb)
    }
    const userIds = [...new Set(visible.map((c) => c.created_by).filter((v): v is string => !!v))]
    const names = new Map<string, string>()
    for (let i = 0; i < userIds.length; i += 200) {
      const { data } = await supabaseAdmin.from("profiles").select("id, full_name, username").in("id", userIds.slice(i, i + 200))
      for (const p of (data || []) as { id: string; full_name: string | null; username: string | null }[]) {
        names.set(p.id, p.full_name || p.username || "")
      }
    }

    const rows = visible.map((c) => {
      const r = requests.get(c.request_id)!
      return {
        ...c,
        so_luong: Number(c.so_luong) || 0,
        don_gia: Number(c.don_gia) || 0,
        so: r.so,
        nam: r.nam,
        bo_phan: r.bo_phan,
        maintenance_record_id: r.maintenance_record_id,
        ma_bb: r.maintenance_record_id ? maBb.get(r.maintenance_record_id) || null : null,
        nguoi_xac_nhan: c.created_by ? names.get(c.created_by) || "" : "",
      }
    })
    return NextResponse.json({ rows, canAll })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi server" }, { status: isoAuthErrorStatus(err) })
  }
}

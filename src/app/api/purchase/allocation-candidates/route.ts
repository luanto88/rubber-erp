import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/app/api/account/_lib/security"
import { resolveIsoActor, isoActorHasPermission, isoAuthErrorStatus } from "@/app/api/iso/_lib/iso-actor"

export const dynamic = "force-dynamic"

// GET ?recordId=&itemId= — các dòng đề nghị ĐÃ DUYỆT, lập riêng (không thuộc biên bản nào), cùng vật tư hiệu
// lực, còn SL chưa phân bổ (hoặc đang phân bổ cho chính biên bản này) — để gắn vào biên bản bảo trì.

const OK_STATES = ["da_duyet", "dang_mua", "hoan_tat", "dong"]

type LineRow = {
  id: string
  request_id: string
  item_id: string | null
  item_name: string | null
  unit: string | null
  purchase_requests: { so: number; nam: number; ngay: string | null; trang_thai: string; loai: string; loai_tien: string | null; bo_phan: string | null } | { so: number; nam: number; ngay: string | null; trang_thai: string; loai: string; loai_tien: string | null; bo_phan: string | null }[] | null
}

export async function GET(req: NextRequest) {
  try {
    const actor = await resolveIsoActor(req)
    if (!actor.isAdmin && !(await isoActorHasPermission(actor, ["maintenance.view", "purchase.view", "purchase.create"]))) {
      return NextResponse.json({ error: "Không có quyền" }, { status: 403 })
    }
    const recordId = req.nextUrl.searchParams.get("recordId") || ""
    const itemId = req.nextUrl.searchParams.get("itemId") || ""
    if (!itemId) return NextResponse.json({ error: "Thiếu vật tư" }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from("purchase_request_lines")
      .select("id, request_id, item_id, item_name, unit, purchase_requests!inner(so, nam, ngay, trang_thai, loai, loai_tien, bo_phan)")
      .eq("factory_id", actor.factoryId)
      .eq("item_id", itemId)
      .is("maintenance_record_id", null)
      .eq("purchase_requests.loai", "goc")
      .in("purchase_requests.trang_thai", OK_STATES)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    const lines = (data || []) as unknown as LineRow[]
    if (!lines.length) return NextResponse.json({ candidates: [] })

    const lineIds = lines.map((l) => l.id)
    const { data: allocs, error: aErr } = await supabaseAdmin
      .from("purchase_line_record_allocations")
      .select("line_id, maintenance_record_id, so_luong")
      .in("line_id", lineIds)
    if (aErr) return NextResponse.json({ error: "Chưa chạy migration 20261129_purchase_line_record_allocations.sql" }, { status: 500 })
    const allocList = (allocs || []) as { line_id: string; maintenance_record_id: string; so_luong: number }[]
    // Biên bản đã huỷ không chiếm SL của dòng.
    const huyRecs = new Set<string>()
    const recIds = Array.from(new Set(allocList.map((a) => a.maintenance_record_id)))
    if (recIds.length) {
      const { data: recs } = await supabaseAdmin.from("maintenance_records").select("id, trang_thai").in("id", recIds)
      for (const r of (recs || []) as { id: string; trang_thai: string | null }[]) if (r.trang_thai === "huy") huyRecs.add(r.id)
    }
    const allocated = new Map<string, number>()
    const mine = new Map<string, number>()
    for (const a of allocList.filter((x) => !huyRecs.has(x.maintenance_record_id))) {
      allocated.set(a.line_id, (allocated.get(a.line_id) || 0) + (Number(a.so_luong) || 0))
      if (a.maintenance_record_id === recordId) mine.set(a.line_id, Number(a.so_luong) || 0)
    }

    const reqIds = Array.from(new Set(lines.map((l) => l.request_id)))
    const eff = new Map<string, { item_id: string | null; so_luong: number; received: number; don_gia: number; pending_adjust: boolean }>()
    const results = await Promise.all(reqIds.map((id) => supabaseAdmin.rpc("purchase_effective_lines", { p_request_id: id })))
    for (const { data: rows, error: e } of results) {
      if (e) return NextResponse.json({ error: e.message }, { status: 400 })
      for (const r of (rows || []) as { root_line_id: string; item_id: string | null; so_luong: number; received: number; don_gia: number; pending_adjust: boolean }[]) {
        eff.set(r.root_line_id, { item_id: r.item_id, so_luong: Number(r.so_luong) || 0, received: Number(r.received) || 0, don_gia: Number(r.don_gia) || 0, pending_adjust: !!r.pending_adjust })
      }
    }

    const candidates = lines
      .map((l) => {
        const r = Array.isArray(l.purchase_requests) ? l.purchase_requests[0] : l.purchase_requests
        const e = eff.get(l.id)
        if (!r || !e || e.item_id !== itemId) return null
        const cap = r.trang_thai === "dong" ? e.received : e.so_luong
        const used = allocated.get(l.id) || 0
        const myQty = mine.get(l.id) || 0
        const free = Math.max(0, cap - used)
        if (free <= 0 && myQty <= 0) return null
        return {
          lineId: l.id,
          requestId: l.request_id,
          so: r.so,
          nam: r.nam,
          ngay: r.ngay,
          trangThai: r.trang_thai,
          boPhan: r.bo_phan,
          itemName: l.item_name,
          unit: l.unit,
          soLuong: e.so_luong,
          received: e.received,
          allocated: used,
          free,
          mine: myQty,
          donGia: e.don_gia,
          loaiTien: r.loai_tien || "USD",
          pendingAdjust: e.pending_adjust,
        }
      })
      .filter((c): c is NonNullable<typeof c> => !!c)
      .sort((a, b) => a.nam - b.nam || a.so - b.so)
    return NextResponse.json({ candidates })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi không xác định" }, { status: isoAuthErrorStatus(err) })
  }
}

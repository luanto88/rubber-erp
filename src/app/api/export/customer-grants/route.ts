import { NextRequest, NextResponse } from "next/server"
import { accountErrorResponse, requireAuthUser } from "@/app/api/account/_lib/security"
import { getSupabaseAdmin } from "@/lib/supabase-admin"

export const dynamic = "force-dynamic"

type ProfileRow = {
  id: string
  full_name: string | null
  username: string | null
  role: string | null
  factory_id: string | null
  status: string | null
}

async function verifyExportGrantCaller(req: NextRequest, factoryId: string) {
  const authUser = await requireAuthUser(req)
  const supabaseAdmin = getSupabaseAdmin()

  const { data: callerProfile, error: callerError } = await supabaseAdmin
    .from("profiles")
    .select("id, role, factory_id, status")
    .eq("id", authUser.id)
    .single()

  if (callerError || !callerProfile) {
    throw new Error("Không tìm thấy hồ sơ người dùng")
  }

  const caller = callerProfile as ProfileRow
  if (caller.role !== "admin" || caller.status !== "active" || caller.factory_id !== factoryId) {
    throw new Error("Chỉ tài khoản admin mới có quyền cấp hoặc quản lý quyền khách hàng")
  }

  return { authUser, caller, supabaseAdmin }
}

// GET /api/export/customer-grants?factoryId=xxx&orderId=yyy
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const factoryId = searchParams.get("factoryId")
  const orderId = searchParams.get("orderId")

  if (!factoryId) {
    return NextResponse.json({ error: "Thiếu factoryId" }, { status: 400 })
  }

  try {
    const { supabaseAdmin } = await verifyExportGrantCaller(req, factoryId)

    let q = supabaseAdmin
      .from("export_order_customer_grants")
      .select("id, export_order_id, factory_id, granted_to_user_id, granted_by, created_at")
      .eq("factory_id", factoryId)

    if (orderId) {
      q = q.eq("export_order_id", orderId)
    }

    const { data: grantsData, error: grantsErr } = await q
    if (grantsErr) throw grantsErr

    const userIds = [...new Set((grantsData || []).map((g) => g.granted_to_user_id))]
    let userMap = new Map<string, string>()

    if (userIds.length > 0) {
      const { data: profilesData } = await supabaseAdmin
        .from("profiles")
        .select("id, full_name, username")
        .in("id", userIds);

      const profileList = (profilesData || []) as Array<{
        id: string;
        full_name: string | null;
        username: string | null;
      }>;

      profileList.forEach((p) => {
        userMap.set(p.id, p.full_name || p.username || "Khách hàng");
      });
    }

    const grants = (grantsData || []).map((g) => ({
      id: g.id,
      orderId: g.export_order_id,
      userId: g.granted_to_user_id,
      userName: userMap.get(g.granted_to_user_id) || "Khách hàng",
      grantedBy: g.granted_by,
      createdAt: g.created_at,
    }))

    return NextResponse.json({ grants })
  } catch (err) {
    return accountErrorResponse(err, "Lỗi nạp danh sách cấp quyền", 400)
  }
}

// POST /api/export/customer-grants
// Body: { orderId: string, factoryId: string, recipientUserIds: string[] }
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      orderId: string
      factoryId: string
      recipientUserIds: string[]
    }
    const { orderId, factoryId, recipientUserIds = [] } = body

    if (!orderId || !factoryId) {
      return NextResponse.json({ error: "Thiếu tham số bắt buộc" }, { status: 400 })
    }

    const { authUser, supabaseAdmin } = await verifyExportGrantCaller(req, factoryId)

    // Lấy danh sách hiện tại của đơn hàng
    const { data: currentGrants, error: curErr } = await supabaseAdmin
      .from("export_order_customer_grants")
      .select("id, granted_to_user_id")
      .eq("export_order_id", orderId)

    if (curErr) throw curErr

    const currentMap = new Map((currentGrants || []).map((g) => [g.granted_to_user_id, g.id]))
    const nextSet = new Set(recipientUserIds)

    const toAdd = recipientUserIds.filter((uid) => !currentMap.has(uid))
    const toRemoveIds = (currentGrants || [])
      .filter((g) => !nextSet.has(g.granted_to_user_id))
      .map((g) => g.id)

    if (toAdd.length > 0) {
      const { error: insErr } = await supabaseAdmin
        .from("export_order_customer_grants")
        .insert(
          toAdd.map((uid) => ({
            export_order_id: orderId,
            factory_id: factoryId,
            granted_to_user_id: uid,
            granted_by: authUser.id,
          })),
        )
      if (insErr) throw insErr
    }

    if (toRemoveIds.length > 0) {
      const { error: delErr } = await supabaseAdmin
        .from("export_order_customer_grants")
        .delete()
        .in("id", toRemoveIds)
      if (delErr) throw delErr
    }

    return NextResponse.json({ success: true, added: toAdd.length, removed: toRemoveIds.length })
  } catch (err) {
    return accountErrorResponse(err, "Lỗi cập nhật cấp quyền", 400)
  }
}

// DELETE /api/export/customer-grants?id=xxx&factoryId=yyy
export async function DELETE(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const id = searchParams.get("id")
  const factoryId = searchParams.get("factoryId")

  if (!id) {
    return NextResponse.json({ error: "Thiếu ID quyền cần xóa" }, { status: 400 })
  }

  try {
    const authUser = await requireAuthUser(req)
    const supabaseAdmin = getSupabaseAdmin()

    // Lấy grant để biết factory_id nếu client không truyền
    const { data: grant, error: gErr } = await supabaseAdmin
      .from("export_order_customer_grants")
      .select("id, factory_id")
      .eq("id", id)
      .single()

    if (gErr || !grant) {
      return NextResponse.json({ error: "Không tìm thấy bản ghi cấp quyền" }, { status: 404 })
    }

    const fid = factoryId || grant.factory_id
    await verifyExportGrantCaller(req, fid)

    const { error: delErr } = await supabaseAdmin
      .from("export_order_customer_grants")
      .delete()
      .eq("id", id)

    if (delErr) throw delErr

    return NextResponse.json({ success: true })
  } catch (err) {
    return accountErrorResponse(err, "Lỗi thu hồi quyền", 400)
  }
}

import { NextRequest, NextResponse, after } from "next/server"
import { requireAuthUser } from "@/app/api/account/_lib/security"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { traceExportOrderGeoChain, type TraceOrderAssignment } from "@/lib/eudr-trace"
import { writeEudrCleanLogIfChanged } from "@/lib/eudr-clean-log-write"

export const dynamic = "force-dynamic"

type ProfileRow = {
  id: string
  role: string | null
  status: string | null
}

type ExportOrderRow = {
  id: string
  factory_id: string
  ma_don: string
  ngay: string
  chung_loai: string
  tong_banh: number
  loai_banh: number
  loai_pallet: string
  loai_boc: string
  so_thong_bao: string
  so_hoa_don: string
  so_hop_dong: string
  public_token: string | null
  assignments: TraceOrderAssignment[]
  vehicles: unknown
  files: { name: string; url: string; path?: string; size?: number }[] | null
  customers: { ma_kh: string; ten_kh_en: string; quoc_gia: string; dia_chi: string; email: string; nguoi_lien_he: string } | null
}

type FactoryRow = {
  id: string
  full_name_en: string
  address_en: string
  contact_person: string
  contact_email: string
  website: string
  country_en: string
}

// GET /api/customer-portal/orders/[id]
// Trả về toàn bộ chuỗi truy xuất EUDR của 1 đơn xuất hàng CỤ THỂ, chỉ khi tài khoản
// customer đang gọi đã được admin cấp quyền xem đúng đơn này (bảng
// export_order_customer_grants). Dùng service role để tự chạy lại chuỗi trace (vốn
// RESTRICTIVE RLS đã chặn role customer đọc thẳng các bảng liên quan) — không tin bất kỳ
// dữ liệu nào client gửi lên ngoài id đơn trong URL.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: orderId } = await params
    if (!orderId) {
      return NextResponse.json({ error: "Thiếu mã đơn xuất hàng" }, { status: 400 })
    }

    const authUser = await requireAuthUser(req)
    const supabaseAdmin = getSupabaseAdmin()

    const { data: profile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("id, role, status")
      .eq("id", authUser.id)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: "Không tìm thấy hồ sơ người dùng" }, { status: 403 })
    }

    const caller = profile as ProfileRow
    if (caller.role !== "customer" || caller.status !== "active") {
      return NextResponse.json({ error: "Tài khoản không có quyền truy cập" }, { status: 403 })
    }

    const { data: grant, error: grantError } = await supabaseAdmin
      .from("export_order_customer_grants")
      .select("id")
      .eq("export_order_id", orderId)
      .eq("granted_to_user_id", authUser.id)
      .maybeSingle()

    if (grantError) {
      return NextResponse.json({ error: grantError.message }, { status: 500 })
    }
    if (!grant) {
      return NextResponse.json({ error: "Bạn không có quyền xem đơn này" }, { status: 403 })
    }

    const { data: orderData, error: orderError } = await supabaseAdmin
      .from("export_orders")
      .select(
        "id, factory_id, ma_don, ngay, chung_loai, tong_banh, loai_banh, loai_pallet, loai_boc, so_thong_bao, so_hoa_don, so_hop_dong, public_token, assignments, vehicles, files, customers(ma_kh, ten_kh_en, quoc_gia, dia_chi, email, nguoi_lien_he)",
      )
      .eq("id", orderId)
      .single()

    if (orderError || !orderData) {
      return NextResponse.json({ error: "Không tìm thấy đơn xuất hàng" }, { status: 404 })
    }

    const order = orderData as unknown as ExportOrderRow

    const { data: factoryData } = await supabaseAdmin
      .from("factories")
      .select("id, full_name_en, address_en, contact_person, contact_email, website, country_en")
      .eq("id", order.factory_id)
      .single()

    const trace = await traceExportOrderGeoChain(supabaseAdmin, {
      id: order.id,
      factory_id: order.factory_id,
      assignments: order.assignments || [],
      ngay: order.ngay,
    })

    // GĐ 4: ghi eudr_clean_log/eudr_geometry_hash mỗi khi trace được tính lại (view time),
    // không phải lúc tải file — best-effort, idempotent, không được làm chậm response.
    const writeCleanLog = () => writeEudrCleanLogIfChanged(supabaseAdmin, order.id, trace.geoData, trace.cleanLog)
    try {
      after(writeCleanLog)
    } catch {
      void writeCleanLog()
    }

    return NextResponse.json({
      order: {
        ...order,
        assignments: trace.resolvedAssignments,
      },
      factory: (factoryData as FactoryRow) || null,
      lotDetails: trace.lotDetails,
      extractionDates: trace.extractionDates,
      lotCertMap: trace.lotCertMap,
      diemGn: trace.diemGn,
      geoData: trace.geoData,
      // GĐ 3(c): nhật ký làm sạch/nở mảnh — client dùng lại khi tự tải file (serializeEudrGeoJson),
      // không phải để hiển thị trực tiếp trên trang.
      eudrCleanLog: trace.cleanLog,
      traceInfo: trace.traceInfo,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 401 },
    )
  }
}

import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"
import { traceExportOrderGeoChain, type TraceOrderAssignment } from "@/lib/eudr-trace"

export const dynamic = "force-dynamic"

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

// GET /api/eudr/public-order?token=<public_token>
//
// Route CÔNG KHAI — KHÔNG gọi requireAuthUser(), không quan tâm người gọi có đăng nhập hay
// không, không dựa vào export_order_customer_grants. Đây chính là điểm mấu chốt khắc phục
// lỗ hổng "quét 1 QR bất kỳ là xem được toàn bộ đơn hàng của tài khoản": mỗi đơn hàng có 1
// public_token ngẫu nhiên riêng (UUID, không đoán được), quét đúng token nào chỉ trả về
// đúng dữ liệu của đơn hàng đó — độc lập hoàn toàn với tài khoản/quyền đăng nhập.
//
// Dùng service role vì role="customer" bị RESTRICTIVE RLS chặn đọc thẳng các bảng liên
// quan, và khách truy cập qua route này hoàn toàn không có phiên đăng nhập nào cả.
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token")?.trim()
    if (!token) {
      return NextResponse.json({ error: "Thiếu mã tra cứu" }, { status: 400 })
    }

    const supabaseAdmin = getSupabaseAdmin()

    const { data: orderData, error: orderError } = await supabaseAdmin
      .from("export_orders")
      .select(
        "id, factory_id, ma_don, ngay, chung_loai, tong_banh, loai_banh, loai_pallet, loai_boc, so_thong_bao, so_hoa_don, so_hop_dong, public_token, assignments, vehicles, files, customers(ma_kh, ten_kh_en, quoc_gia, dia_chi, email, nguoi_lien_he)",
      )
      .eq("public_token", token)
      .maybeSingle()

    if (orderError) {
      return NextResponse.json({ error: orderError.message }, { status: 500 })
    }
    if (!orderData) {
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
    })

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
      traceInfo: trace.traceInfo,
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Lỗi server" },
      { status: 500 },
    )
  }
}

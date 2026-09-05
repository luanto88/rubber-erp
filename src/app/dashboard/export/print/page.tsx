"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { hasPermission, hydrateActiveSession } from "@/lib/auth";
import { downloadExportOrderPdf, type ExportOrderPdfInput } from "@/lib/export-order-pdf";
import { Download, ChevronLeft, AlertTriangle, CheckCircle2 } from "lucide-react";

// Re-use types from export
type Vehicle = {
  id: string;
  loai_xe: string;
  bien_truoc: string;
  bien_sau: string;
  ghi_chu: string;
  image_urls?: string[];
  image_url_1?: string;
  image_url_2?: string;
  image_url_3?: string;
};
type Assignment = {
  lot_id: string;
  ma_lo: string;
  vehicleIdx: number;
  kien_a: number;
  kien_b: number;
  kien_c: number;
  kien_d: number;
};
type ChiTieuReq = { ten: string; min: string; max: string };
type ExportOrder = {
  id: string;
  factory_id: string;
  ma_don: string;
  ngay: string;
  so_thong_bao: string;
  so_hoa_don: string;
  so_hop_dong: string;
  customer_id: string | null;
  chung_loai: string;
  loai_pallet: string;
  loai_banh: number;
  loai_boc: string;
  vehicles: Vehicle[];
  assignments: Assignment[];
  tong_banh: number;
  yeu_cau_chi_tieu: ChiTieuReq[];
  customers?: {
    ma_kh: string;
    ten_kh_en: string;
    quoc_gia: string;
    dia_chi: string;
    email: string;
    nguoi_lien_he: string;
  };
};

function PrintContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get("id");

  const [order, setOrder] = useState<ExportOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [factory, setFactory] = useState<{ name: string } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [pdfState, setPdfState] = useState<"idle" | "generating" | "done" | "error">("idle");

  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      return;
    }
    const load = async () => {
      setLoading(true);
      try {
        // Trang này trước đây không có bất kỳ kiểm tra đăng nhập/quyền nào — bất kỳ
        // ai biết orderId (kể cả chưa đăng nhập) đều xem được toàn bộ đơn xuất hàng của
        // bất kỳ nhà máy nào. Gate + lọc factory_id giống mọi trang dashboard khác.
        const { user } = await hydrateActiveSession().catch(() => ({ user: null }));
        if (!hasPermission(user, "export.view")) {
          window.location.replace("/dashboard");
          return;
        }
        const fid = user?.factory_id;
        if (!fid) {
          window.location.replace("/dashboard");
          return;
        }

        const { data } = await supabase
          .from("export_orders")
          .select(
            "*, customers(ma_kh,ten_kh_en,quoc_gia,dia_chi,email,nguoi_lien_he)",
          )
          .eq("id", orderId)
          .eq("factory_id", fid)
          .single();

        if (data) {
          setOrder(data as ExportOrder);
          const { data: fData } = await supabase
            .from("factories")
            .select("name")
            .eq("id", data.factory_id)
            .single();
          if (fData) setFactory(fData);
        } else {
          setNotFound(true);
        }
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [orderId]);

  const generatePdf = useCallback(async () => {
    if (!order) return;
    setPdfState("generating");
    try {
      const input: ExportOrderPdfInput = {
        ma_don: order.ma_don,
        ngay: order.ngay,
        so_thong_bao: order.so_thong_bao,
        so_hoa_don: order.so_hoa_don,
        so_hop_dong: order.so_hop_dong,
        chung_loai: order.chung_loai,
        loai_pallet: order.loai_pallet,
        loai_banh: order.loai_banh,
        loai_boc: order.loai_boc,
        vehicles: order.vehicles || [],
        assignments: order.assignments || [],
        tong_banh: order.tong_banh,
        customerName: order.customers?.ten_kh_en || null,
      };
      await downloadExportOrderPdf(input, factory?.name);
      setPdfState("done");
    } catch {
      setPdfState("error");
    }
  }, [order, factory]);

  // Tự động tạo PDF ngay khi dữ liệu đơn đã sẵn sàng — khớp UX "tải trực tiếp" đã chốt.
  useEffect(() => {
    if (order && pdfState === "idle") void generatePdf();
  }, [order, pdfState, generatePdf]);

  if (loading)
    return (
      <div className="p-10 text-center font-bold text-slate-500">
        Đang tải dữ liệu...
      </div>
    );
  if (notFound || !order)
    return (
      <div className="p-10 text-center font-bold text-red-500">
        Không tìm thấy đơn xuất hàng!
      </div>
    );

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
        <button
          onClick={() => window.close()}
          className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-bold text-sm mb-6"
        >
          <ChevronLeft size={16} /> Đóng trang
        </button>

        <div className="font-extrabold text-lg text-slate-800 mb-1">
          Biên bản kiểm tra & giao nhận hàng hóa
        </div>
        <div className="text-sm text-slate-500 mb-6">Đơn {order.ma_don}</div>

        {pdfState === "generating" && (
          <div className="text-sm font-bold text-slate-500">Đang tạo PDF...</div>
        )}

        {pdfState === "done" && (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-emerald-600 font-bold text-sm">
              <CheckCircle2 size={18} /> Đã tải file PDF về máy
            </div>
            <button
              onClick={() => void generatePdf()}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold shadow-md"
            >
              <Download size={16} /> Tải lại
            </button>
          </div>
        )}

        {pdfState === "error" && (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 text-red-600 font-bold text-sm">
              <AlertTriangle size={18} /> Không tạo được PDF, thử lại?
            </div>
            <button
              onClick={() => void generatePdf()}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold shadow-md"
            >
              <Download size={16} /> Thử lại
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ExportPrintPage() {
  return (
    <Suspense
      fallback={
        <div className="p-10 text-center font-bold text-slate-500">
          Đang tải...
        </div>
      }
    >
      <PrintContent />
    </Suspense>
  );
}

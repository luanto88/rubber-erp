"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { QRCodeSVG as QRCode } from "qrcode.react";
import { Printer, ChevronLeft } from "lucide-react";
import Image from "next/image";

// Re-use types from export
type Vehicle = {
  id: string;
  loai_xe: string;
  bien_truoc: string;
  bien_sau: string;
  ghi_chu: string;
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

  useEffect(() => {
    if (!orderId) return;
    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("export_orders")
        .select(
          "*, customers(ma_kh,ten_kh_en,quoc_gia,dia_chi,email,nguoi_lien_he)",
        )
        .eq("id", orderId)
        .single();

      if (data) {
        setOrder(data as ExportOrder);
        const { data: fData } = await supabase
          .from("factories")
          .select("name")
          .eq("id", data.factory_id)
          .single();
        if (fData) setFactory(fData);
      }
      setLoading(false);
    };
    load();
  }, [orderId]);

  if (loading)
    return (
      <div className="p-10 text-center font-bold text-slate-500">
        Đang tải dữ liệu in...
      </div>
    );
  if (!order)
    return (
      <div className="p-10 text-center font-bold text-red-500">
        Không tìm thấy đơn xuất hàng!
      </div>
    );

  return (
    <div className="print-overlay min-h-screen bg-slate-200 print:bg-white py-8 print:py-0 text-slate-900 font-sans">
      {/* CSS dành riêng cho trang in */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
        /* 1. ÉP ẨN MENU/SIDEBAR TRÊN MÀN HÌNH BẰNG GLOBAL CSS */
        aside, header, nav, [class*="sidebar"], [class*="Sidebar"] {
          display: none !important;
        }
        
        body, main, #__next {
          padding: 0 !important;
          margin: 0 !important;
          max-width: 100% !important;
          overflow: visible !important;
        }

        /* 2. CẤU HÌNH TRANG IN RA GIẤY */
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; background: white !important; }
          .print-hidden { display: none !important; }
          .page-break-avoid { page-break-inside: avoid; break-inside: avoid; }
        }
      `,
        }}
      />

      {/* Thanh công cụ (Ẩn khi in) */}
      <div className="max-w-[210mm] mx-auto mb-6 flex justify-between items-center print-hidden bg-white p-4 rounded-xl shadow-sm border border-slate-200">
        <button
          onClick={() => window.close()}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-900 font-bold px-3 py-2 rounded-lg hover:bg-slate-100"
        >
          <ChevronLeft size={18} /> Đóng trang
        </button>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-md"
        >
          <Printer size={18} /> In Biên Bản
        </button>
      </div>

      {/* Khung giấy A4 */}
      <div className="w-[210mm] min-h-[297mm] mx-auto bg-white p-[15mm] shadow-xl print:shadow-none print:w-full print:p-0">
        {/* Header Công ty & QR */}
        <div className="flex justify-between items-start border-b-2 border-slate-800 pb-4 mb-6">
          <div className="flex gap-4 items-center">
            <Image
              src="/logo-phk-moi.png"
              alt="Logo"
              width={70}
              height={70}
              className="object-contain"
              priority
            />
            <div>
              <div className="font-extrabold text-lg uppercase tracking-tight">
                {factory?.name || "CÔNG TY TNHH PTCS PHƯỚC HÒA KAMPONG THOM"}
              </div>
              <div className="text-sm font-semibold text-slate-600">
                Nhà máy chế biến mủ cao su
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end">
            <QRCode
              value={`https://qlsxkpt.vercel.app/dashboard/eudr?order=${order.ma_don}`}
              size={64}
              level="M"
            />
            <span className="text-[10px] mt-1 font-mono">{order.ma_don}</span>
          </div>
        </div>

        {/* Tiêu đề */}
        <div className="text-center mb-8">
          <h1 className="text-2xl font-extrabold uppercase">
            Biên Bản Kiểm Tra & Giao Nhận Hàng Hóa
          </h1>
          <p className="text-sm font-semibold mt-1 italic">
            Ngày xuất: {new Date(order.ngay).toLocaleDateString("vi-VN")}
          </p>
        </div>

        {/* Thông tin chung */}
        <div className="grid grid-cols-2 gap-y-3 gap-x-8 text-sm mb-6 bg-slate-50 p-4 border border-slate-200 rounded-lg">
          <div>
            <span className="font-semibold text-slate-600">Khách hàng:</span>{" "}
            <span className="font-bold">
              {order.customers?.ten_kh_en || "—"}
            </span>
          </div>
          <div>
            <span className="font-semibold text-slate-600">Mã đơn:</span>{" "}
            <span className="font-bold">{order.ma_don}</span>
          </div>
          <div>
            <span className="font-semibold text-slate-600">
              Số hóa đơn / Hợp đồng:
            </span>{" "}
            <span className="font-bold">
              {order.so_hoa_don || "—"} / {order.so_hop_dong || "—"}
            </span>
          </div>
          <div>
            <span className="font-semibold text-slate-600">Số thông báo:</span>{" "}
            <span className="font-bold">{order.so_thong_bao}</span>
          </div>
          <div>
            <span className="font-semibold text-slate-600">Chủng loại SP:</span>{" "}
            <span className="font-bold text-emerald-700">
              {order.chung_loai} · {order.loai_banh}kg/bành
            </span>
          </div>
          <div>
            <span className="font-semibold text-slate-600">Tổng lượng:</span>{" "}
            <span className="font-bold text-red-600">
              {order.tong_banh.toLocaleString()} bành
            </span>{" "}
            <span>
              ({((order.tong_banh * order.loai_banh) / 1000).toLocaleString()}{" "}
              Tấn)
            </span>
          </div>
          <div>
            <span className="font-semibold text-slate-600">Loại bọc:</span>{" "}
            <span>{order.loai_boc}</span>
          </div>
          <div>
            <span className="font-semibold text-slate-600">Pallet:</span>{" "}
            <span>{order.loai_pallet}</span>
          </div>
        </div>

        {/* Danh sách xe và hình ảnh */}
        <div className="mb-6">
          <h3 className="font-bold text-base mb-4 uppercase border-b pb-1 border-slate-300">
            Chi tiết phương tiện & Lô hàng
          </h3>
          <div className="space-y-6">
            {(order.vehicles || []).map((v, i) => {
              const assignedLots = order.assignments.filter(
                (a) => a.vehicleIdx === i,
              );
              const vBanh = assignedLots.reduce(
                (s, a) =>
                  s +
                  (a.kien_a || 0) +
                  (a.kien_b || 0) +
                  (a.kien_c || 0) +
                  (a.kien_d || 0),
                0,
              );

              return (
                <div
                  key={v.id}
                  className="border border-slate-300 rounded-lg p-4 page-break-avoid"
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="font-extrabold text-lg text-blue-800">
                        Xe {i + 1}: {v.bien_truoc}{" "}
                        {v.bien_sau ? `/ ${v.bien_sau}` : ""}
                      </div>
                      <div className="text-sm font-semibold text-slate-600">
                        {v.loai_xe} {v.ghi_chu ? `— ${v.ghi_chu}` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-emerald-700">
                        {vBanh} bành
                      </div>
                      <div className="text-xs text-slate-500">
                        {assignedLots.length} lô
                      </div>
                    </div>
                  </div>

                  {assignedLots.length > 0 && (
                    <div className="text-xs text-slate-700 mb-4 bg-slate-50 p-2 rounded border border-slate-200">
                      <span className="font-semibold">Các lô bốc lên xe: </span>
                      {assignedLots.map((a) => a.ma_lo).join(", ")}
                    </div>
                  )}

                  {/* Hiển thị 3 hình ảnh của xe */}
                  {(v.image_url_1 || v.image_url_2 || v.image_url_3) && (
                    <div className="grid grid-cols-3 gap-4">
                      {v.image_url_1 && (
                        <div className="border border-slate-200 rounded p-1">
                          <div className="text-[10px] text-center font-semibold text-slate-500 mb-1">
                            Ảnh xe / Biển số
                          </div>
                          <img
                            src={v.image_url_1}
                            alt="Biển số"
                            className="w-full h-32 object-cover rounded-sm"
                          />
                        </div>
                      )}
                      {v.image_url_2 && (
                        <div className="border border-slate-200 rounded p-1">
                          <div className="text-[10px] text-center font-semibold text-slate-500 mb-1">
                            Ảnh hàng hóa / Niêm phong
                          </div>
                          <img
                            src={v.image_url_2}
                            alt="Niêm phong"
                            className="w-full h-32 object-cover rounded-sm"
                          />
                        </div>
                      )}
                      {v.image_url_3 && (
                        <div className="border border-slate-200 rounded p-1">
                          <div className="text-[10px] text-center font-semibold text-slate-500 mb-1">
                            Ảnh chứng từ / Phiếu cân
                          </div>
                          <img
                            src={v.image_url_3}
                            alt="Chứng từ"
                            className="w-full h-32 object-cover rounded-sm"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Chữ ký */}
        <div className="grid grid-cols-3 gap-8 text-center mt-12 pt-8 border-t border-slate-200 page-break-avoid">
          <div>
            <div className="font-bold text-sm mb-16">Đại diện Giao hàng</div>
            <div className="text-xs text-slate-500">(Ký và ghi rõ họ tên)</div>
          </div>
          <div>
            <div className="font-bold text-sm mb-16">Đại diện Vận chuyển</div>
            <div className="text-xs text-slate-500">(Ký và ghi rõ họ tên)</div>
          </div>
          <div>
            <div className="font-bold text-sm mb-16">Đại diện Nhận hàng</div>
            <div className="text-xs text-slate-500">(Ký và ghi rõ họ tên)</div>
          </div>
        </div>
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

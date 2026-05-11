"use client"

import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Printer } from "lucide-react"
import Link from "next/link"
import { QRCodeSVG } from "qrcode.react"
import { supabase } from "@/lib/supabase"
import { currencySymbol } from "../_components/maintenance-data"

// ─── Types ────────────────────────────────────────────────────────────────────

type PrintType = "su_co" | "de_nghi" | "ly_lich"

type MaterialRow = {
  nguon: "trong_kho" | "ben_ngoai"
  ten_vat_tu: string
  dvt: string | null
  so_luong: number
  don_gia: number | null
  loai_tien: string | null
  thanh_tien: number | null
}

type LineData = {
  id: string
  ten_tb: string
  ma_tb: string
  ten_tai_xe: string | null
  noi_dung: string | null
  nguyen_nhan: string | null
  cac_khac_phuc: string | null
  loai_sua_chua: "lon" | "nho" | null
  chi_phi_dk: number
  loai_tien: string
  cong_tho: number
  nhien_lieu_su_dung: string | null
  dvt_do: string | null
  so_luong_do: number | null
  materials: MaterialRow[]
}

type RecordData = {
  id: string
  ma_bb: string | null
  hang_muc: string
  ngay: string
  tu_gio: string | null
  den_gio: string | null
  bo_phan: string
  nguoi_tao: string | null
  nguoi_thuc_hien: string[]
  nv_phu_trach: string | null
  phu_trach_bao_tri: string | null
  bgd_phu_trach: string | null
  giam_doc: string | null
  trang_thai: string
  nguoi_duyet: string | null
  ngay_duyet: string | null
  ghi_chu: string | null
  lines: LineData[]
}

type HistoryRow = {
  ngay: string
  ma_bb: string | null
  hang_muc: string
  ten_tb: string
  ma_tb: string
  noi_dung: string | null
  cac_khac_phuc: string | null
  chi_phi_dk: number
  loai_tien: string
  cong_tho: number
  nguoi_thuc_hien: string[]
  nv_phu_trach: string | null
  phu_trach_bao_tri: string | null
}

type AssetInfo = {
  ma_tb: string
  ten_tb: string
  bo_phan: string
  loai: "may_moc" | "xe"
  nam_sd: string | null
  bien_so: string | null
  mo_ta: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d: string | null) {
  if (!d) return "..."
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`
}

function fmtTime(t: string | null) {
  if (!t) return "..."
  return t.slice(0, 5)
}

function fmtValue(chi_phi: number, loai_tien: string) {
  const sym = currencySymbol(loai_tien)
  return `${sym}${chi_phi.toLocaleString()}`
}

// ─── Print Templates ──────────────────────────────────────────────────────────

function CompanyHeader() {
  return (
    <div className="text-center mb-4 print-section">
      <div className="text-xs font-bold text-slate-600 uppercase tracking-wide">Công ty TNHH PTCS Phuoc Hoa Kampong Thom</div>
      <div className="text-[10px] text-slate-500">Khu Công Nghiệp Phuoc Hoa, Tỉnh Kampong Thom, Campuchia</div>
    </div>
  )
}

type SigCol = { role: string; name?: string | null }

function SignatureRow({ cols }: { cols: SigCol[] }) {
  return (
    <div className="grid gap-4 mt-10 text-center text-xs" style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
      {cols.map((col, i) => (
        <div key={i}>
          <div className="font-bold text-slate-700 mb-1">{col.role}</div>
          <div className="text-slate-500 italic text-[10px]">(Ký và ghi rõ họ tên)</div>
          <div className="mt-14 border-t border-dashed border-slate-400 pt-1 font-semibold text-slate-600 min-h-[1.25rem]">
            {col.name || ""}
          </div>
        </div>
      ))}
    </div>
  )
}

// Template 1: Biên bản kiểm tra sự cố
function PrintSuCo({ record, qrUrl }: { record: RecordData; qrUrl: string }) {
  const isBoDoi = record.bo_phan === "Đội xe"
  return (
    <div className="print-page font-serif">
      <CompanyHeader />
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <h2 className="text-center text-base font-extrabold uppercase tracking-wide mb-1">
            Biên bản kiểm tra {record.hang_muc === "Sửa chữa" ? "sự cố" : "bảo dưỡng"}
          </h2>
          <div className="text-center text-xs text-slate-500">Số: {record.ma_bb || "..."}</div>
        </div>
        {qrUrl && (
          <div className="shrink-0 text-center ml-4">
            <QRCodeSVG value={qrUrl} size={64} level="M" />
            <div className="text-[9px] text-slate-400 mt-0.5 font-mono">{record.ma_bb}</div>
          </div>
        )}
      </div>

      {/* Header info */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs mb-4">
        <div><span className="font-bold">Ngày:</span> {fmtDate(record.ngay)}</div>
        <div><span className="font-bold">Hạng mục:</span> {record.hang_muc}</div>
        <div><span className="font-bold">Giờ bắt đầu:</span> {fmtTime(record.tu_gio)}</div>
        <div><span className="font-bold">Giờ kết thúc:</span> {fmtTime(record.den_gio)}</div>
        <div><span className="font-bold">Bộ phận:</span> {record.bo_phan}</div>
        <div><span className="font-bold">Người tạo:</span> {record.nguoi_tao || "..."}</div>
      </div>

      {/* Equipment lines */}
      {record.lines.map((line, idx) => (
        <div key={line.id} className="mb-5">
          <div className="bg-slate-100 px-3 py-1.5 font-bold text-xs uppercase mb-2 rounded">
            {record.lines.length > 1 ? `${idx + 1}. ` : ""}{line.ten_tb} ({line.ma_tb})
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs pl-3 mb-2">
            {isBoDoi && line.ten_tai_xe && (
              <div><span className="font-bold">Tài xế:</span> {line.ten_tai_xe}</div>
            )}
            {line.noi_dung && (
              <div className="col-span-2"><span className="font-bold">Nội dung:</span> {line.noi_dung}</div>
            )}
            {line.nguyen_nhan && (
              <div className="col-span-2"><span className="font-bold">Nguyên nhân:</span> {line.nguyen_nhan}</div>
            )}
            {line.cac_khac_phuc && (
              <div className="col-span-2"><span className="font-bold">Cách khắc phục:</span> {line.cac_khac_phuc}</div>
            )}
            {line.loai_sua_chua && (
              <div><span className="font-bold">Phân loại:</span> {line.loai_sua_chua === "lon" ? "Sửa chữa lớn" : "Sửa chữa nhỏ"}</div>
            )}
            <div><span className="font-bold">Chi phí ước tính:</span> {fmtValue(line.chi_phi_dk, line.loai_tien)}</div>
            {line.cong_tho > 0 && (
              <div><span className="font-bold">Công thợ:</span> {fmtValue(line.cong_tho, line.loai_tien)}</div>
            )}
            {isBoDoi && line.nhien_lieu_su_dung && (
              <div>
                <span className="font-bold">Nhiên liệu:</span> {line.nhien_lieu_su_dung} {line.dvt_do} {line.so_luong_do ? `× ${line.so_luong_do}` : ""}
              </div>
            )}
          </div>

          {/* Materials */}
          {line.materials.length > 0 && (
            <div className="pl-3">
              <div className="text-xs font-bold text-slate-600 mb-1">Vật tư sử dụng:</div>
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="border border-slate-300 px-2 py-1 text-left">STT</th>
                    <th className="border border-slate-300 px-2 py-1 text-left">Tên vật tư</th>
                    <th className="border border-slate-300 px-2 py-1 text-center">ĐVT</th>
                    <th className="border border-slate-300 px-2 py-1 text-right">Số lượng</th>
                    <th className="border border-slate-300 px-2 py-1 text-right">Đơn giá</th>
                    <th className="border border-slate-300 px-2 py-1 text-right">Thành tiền</th>
                    <th className="border border-slate-300 px-2 py-1 text-center">Nguồn</th>
                  </tr>
                </thead>
                <tbody>
                  {line.materials.map((m, mi) => (
                    <tr key={mi}>
                      <td className="border border-slate-300 px-2 py-1 text-center">{mi + 1}</td>
                      <td className="border border-slate-300 px-2 py-1">{m.ten_vat_tu}</td>
                      <td className="border border-slate-300 px-2 py-1 text-center">{m.dvt || "—"}</td>
                      <td className="border border-slate-300 px-2 py-1 text-right">{m.so_luong}</td>
                      <td className="border border-slate-300 px-2 py-1 text-right">
                        {m.don_gia ? `${currencySymbol(m.loai_tien || "USD")}${m.don_gia.toLocaleString()}` : "—"}
                      </td>
                      <td className="border border-slate-300 px-2 py-1 text-right">
                        {m.thanh_tien ? `${currencySymbol(m.loai_tien || "USD")}${m.thanh_tien.toLocaleString()}` : "—"}
                      </td>
                      <td className="border border-slate-300 px-2 py-1 text-center">
                        {m.nguon === "trong_kho" ? "Kho" : "Mua ngoài"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}

      {/* Personnel */}
      <div className="text-xs mt-4 mb-2">
        <span className="font-bold">Người thực hiện: </span>
        {record.nguoi_thuc_hien.join(", ") || "..."}
      </div>
      {record.ghi_chu && (
        <div className="text-xs mb-2"><span className="font-bold">Ghi chú: </span>{record.ghi_chu}</div>
      )}

      <SignatureRow cols={[
        { role: "Người thực hiện" },
        { role: "NV phụ trách", name: record.nv_phu_trach },
        { role: "Phụ trách bảo trì", name: record.phu_trach_bao_tri },
        { role: "BGĐ phụ trách", name: record.bgd_phu_trach },
      ]} />
    </div>
  )
}

// Template 2: Giấy đề nghị sửa chữa + Biên bản nghiệm thu
function PrintDeNghi({ record, qrUrl }: { record: RecordData; qrUrl: string }) {
  return (
    <div className="font-serif">
      {/* Part 1: Giấy đề nghị */}
      <div className="print-page">
        <CompanyHeader />
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h2 className="text-center text-base font-extrabold uppercase tracking-wide mb-1">
              Giấy đề nghị sửa chữa / bảo dưỡng
            </h2>
            <div className="text-center text-xs text-slate-500">Số: {record.ma_bb || "..."}</div>
          </div>
          {qrUrl && (
            <div className="shrink-0 text-center ml-4">
              <QRCodeSVG value={qrUrl} size={64} level="M" />
              <div className="text-[9px] text-slate-400 mt-0.5 font-mono">{record.ma_bb}</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs mb-4">
          <div><span className="font-bold">Ngày đề nghị:</span> {fmtDate(record.ngay)}</div>
          <div><span className="font-bold">Hạng mục:</span> {record.hang_muc}</div>
          <div><span className="font-bold">Bộ phận:</span> {record.bo_phan}</div>
          <div><span className="font-bold">Người đề nghị:</span> {record.nguoi_tao || "..."}</div>
        </div>

        {record.lines.map((line, idx) => (
          <div key={line.id} className="mb-4">
            {record.lines.length > 1 && (
              <div className="font-bold text-xs mb-1">{idx + 1}. {line.ten_tb} ({line.ma_tb})</div>
            )}
            {record.lines.length === 1 && (
              <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs mb-2">
                <div><span className="font-bold">Thiết bị:</span> {line.ten_tb}</div>
                <div><span className="font-bold">Mã thiết bị:</span> {line.ma_tb}</div>
              </div>
            )}
            <div className="text-xs mb-1"><span className="font-bold">Nội dung đề nghị:</span> {line.noi_dung || "..."}</div>
            {line.nguyen_nhan && (
              <div className="text-xs mb-1"><span className="font-bold">Nguyên nhân:</span> {line.nguyen_nhan}</div>
            )}
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
              <div><span className="font-bold">Chi phí ước tính:</span> {fmtValue(line.chi_phi_dk, line.loai_tien)}</div>
              {line.loai_sua_chua && (
                <div><span className="font-bold">Phân loại:</span> {line.loai_sua_chua === "lon" ? "Sửa chữa lớn (>200$)" : "Sửa chữa nhỏ (≤200$)"}</div>
              )}
            </div>
          </div>
        ))}

        <SignatureRow cols={[
          { role: "Người đề nghị", name: record.nguoi_tao },
          { role: "NV phụ trách", name: record.nv_phu_trach },
          { role: "BGĐ phụ trách", name: record.bgd_phu_trach },
          { role: "Giám đốc", name: record.giam_doc },
        ]} />
      </div>

      {/* Page break */}
      <div className="print:page-break-before-always mt-8 border-t-2 border-dashed border-slate-300 pt-8" />

      {/* Part 2: Biên bản nghiệm thu */}
      <div className="print-page">
        <CompanyHeader />
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h2 className="text-center text-base font-extrabold uppercase tracking-wide mb-1">
              Biên bản nghiệm thu sửa chữa / bảo dưỡng
            </h2>
            <div className="text-center text-xs text-slate-500">Số: {record.ma_bb || "..."}</div>
          </div>
          {qrUrl && (
            <div className="shrink-0 text-center ml-4">
              <QRCodeSVG value={qrUrl} size={64} level="M" />
              <div className="text-[9px] text-slate-400 mt-0.5 font-mono">{record.ma_bb}</div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs mb-4">
          <div><span className="font-bold">Ngày nghiệm thu:</span> {record.ngay_duyet ? fmtDate(record.ngay_duyet) : fmtDate(record.ngay)}</div>
          <div><span className="font-bold">Người nghiệm thu:</span> {record.nguoi_duyet || "..."}</div>
          <div><span className="font-bold">Bộ phận:</span> {record.bo_phan}</div>
          <div><span className="font-bold">Hạng mục:</span> {record.hang_muc}</div>
        </div>

        {record.lines.map((line, idx) => (
          <div key={line.id} className="mb-4">
            {record.lines.length > 1 && (
              <div className="font-bold text-xs mb-1">{idx + 1}. {line.ten_tb} ({line.ma_tb})</div>
            )}
            {record.lines.length === 1 && (
              <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs mb-2">
                <div><span className="font-bold">Thiết bị:</span> {line.ten_tb}</div>
                <div><span className="font-bold">Mã thiết bị:</span> {line.ma_tb}</div>
              </div>
            )}
            <div className="text-xs mb-1"><span className="font-bold">Công việc đã thực hiện:</span> {line.cac_khac_phuc || line.noi_dung || "..."}</div>

            {line.materials.length > 0 && (
              <div className="mt-2">
                <div className="text-xs font-bold text-slate-600 mb-1">Vật tư đã sử dụng:</div>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50">
                      <th className="border border-slate-300 px-2 py-1 text-left">STT</th>
                      <th className="border border-slate-300 px-2 py-1 text-left">Tên vật tư</th>
                      <th className="border border-slate-300 px-2 py-1 text-center">ĐVT</th>
                      <th className="border border-slate-300 px-2 py-1 text-right">Số lượng</th>
                      <th className="border border-slate-300 px-2 py-1 text-right">Thành tiền</th>
                    </tr>
                  </thead>
                  <tbody>
                    {line.materials.map((m, mi) => (
                      <tr key={mi}>
                        <td className="border border-slate-300 px-2 py-1 text-center">{mi + 1}</td>
                        <td className="border border-slate-300 px-2 py-1">{m.ten_vat_tu}</td>
                        <td className="border border-slate-300 px-2 py-1 text-center">{m.dvt || "—"}</td>
                        <td className="border border-slate-300 px-2 py-1 text-right">{m.so_luong}</td>
                        <td className="border border-slate-300 px-2 py-1 text-right">
                          {m.thanh_tien ? `${currencySymbol(m.loai_tien || "USD")}${m.thanh_tien.toLocaleString()}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs mt-2">
              <div><span className="font-bold">Tổng chi phí:</span> {fmtValue(line.chi_phi_dk + line.cong_tho, line.loai_tien)}</div>
            </div>
          </div>
        ))}

        <div className="text-xs mt-3 border border-slate-300 rounded p-2">
          <span className="font-bold">Kết quả nghiệm thu: </span>
          <span className="inline-block w-4 h-4 border border-slate-600 mr-1 align-middle" /> Đạt yêu cầu
          <span className="inline-block w-4 h-4 border border-slate-600 ml-4 mr-1 align-middle" /> Không đạt
        </div>

        <SignatureRow cols={[
          { role: "Người thực hiện" },
          { role: "NV phụ trách", name: record.nv_phu_trach },
          { role: "Phụ trách bảo trì", name: record.phu_trach_bao_tri },
          { role: "Người nghiệm thu", name: record.nguoi_duyet },
        ]} />
      </div>
    </div>
  )
}

// Template 3: Lý lịch thiết bị / xe
function PrintLyLich({ rows, asset, filterFrom, filterTo }: {
  rows: HistoryRow[]
  asset: AssetInfo | null
  filterFrom: string
  filterTo: string
}) {
  return (
    <div className="print-page font-serif">
      <CompanyHeader />
      <h2 className="text-center text-base font-extrabold uppercase tracking-wide mb-1">
        Lý lịch {asset?.loai === "xe" ? "xe" : "thiết bị / máy móc"}
      </h2>

      {asset && (
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs mb-4 mt-2">
          <div><span className="font-bold">Tên thiết bị:</span> {asset.ten_tb}</div>
          <div><span className="font-bold">Mã thiết bị:</span> {asset.ma_tb}</div>
          <div><span className="font-bold">Bộ phận:</span> {asset.bo_phan}</div>
          {asset.bien_so && <div><span className="font-bold">Biển số:</span> {asset.bien_so}</div>}
          {asset.nam_sd && <div><span className="font-bold">Năm sản xuất:</span> {asset.nam_sd}</div>}
          {asset.mo_ta && <div className="col-span-2"><span className="font-bold">Mô tả:</span> {asset.mo_ta}</div>}
          {(filterFrom || filterTo) && (
            <div className="col-span-2">
              <span className="font-bold">Kỳ báo cáo:</span>{" "}
              {filterFrom ? fmtDate(filterFrom) : "Tất cả"} – {filterTo ? fmtDate(filterTo) : "nay"}
            </div>
          )}
        </div>
      )}

      <table className="w-full text-xs border-collapse mt-2">
        <thead>
          <tr className="bg-slate-100">
            <th className="border border-slate-400 px-2 py-1.5 text-center">STT</th>
            <th className="border border-slate-400 px-2 py-1.5 text-center">Ngày</th>
            <th className="border border-slate-400 px-2 py-1.5 text-left">Nội dung sửa chữa / thay thế phụ tùng</th>
            <th className="border border-slate-400 px-2 py-1.5 text-right">Giá trị</th>
            <th className="border border-slate-400 px-2 py-1.5 text-center">Người thực hiện</th>
            <th className="border border-slate-400 px-2 py-1.5 text-center">Người theo dõi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const value = row.chi_phi_dk > 0
              ? fmtValue(row.chi_phi_dk, row.loai_tien)
              : row.cong_tho > 0 ? fmtValue(row.cong_tho, row.loai_tien) : "—"
            const nguoiTheoDoi = [row.nv_phu_trach, row.phu_trach_bao_tri].filter(Boolean).join(", ") || "—"
            return (
              <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                <td className="border border-slate-300 px-2 py-1 text-center">{idx + 1}</td>
                <td className="border border-slate-300 px-2 py-1 text-center whitespace-nowrap">{fmtDate(row.ngay)}</td>
                <td className="border border-slate-300 px-2 py-1">
                  <div>{row.noi_dung || row.hang_muc || "—"}</div>
                  {row.cac_khac_phuc && <div className="text-slate-500 italic text-[10px]">{row.cac_khac_phuc}</div>}
                  {row.ma_bb && <div className="text-slate-400 text-[10px]">BB: {row.ma_bb}</div>}
                </td>
                <td className="border border-slate-300 px-2 py-1 text-right whitespace-nowrap">{value}</td>
                <td className="border border-slate-300 px-2 py-1 text-center">
                  {row.nguoi_thuc_hien.join(", ") || "—"}
                </td>
                <td className="border border-slate-300 px-2 py-1 text-center">{nguoiTheoDoi}</td>
              </tr>
            )
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="border border-slate-300 px-4 py-4 text-center text-slate-400 italic">
                Chưa có dữ liệu
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="text-xs mt-4 text-slate-500 italic">
        Tổng cộng: {rows.length} lần bảo trì ·
        Sửa chữa: {rows.filter((r) => r.hang_muc === "Sửa chữa").length} ·
        Bảo dưỡng: {rows.filter((r) => r.hang_muc === "Bảo dưỡng").length}
      </div>

      <SignatureRow cols={[
        { role: "Người lập" },
        { role: "Phụ trách bảo trì" },
        { role: "Trưởng bộ phận" },
        { role: "BGĐ phụ trách" },
      ]} />
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MaintenancePrintPage() {
  const params = useSearchParams()
  const printType = (params.get("type") || "su_co") as PrintType
  const recordId = params.get("record_id") || ""
  const assetId = params.get("asset_id") || ""
  const filterFrom = params.get("from") || ""
  const filterTo = params.get("to") || ""

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [record, setRecord] = useState<RecordData | null>(null)
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([])
  const [assetInfo, setAssetInfo] = useState<AssetInfo | null>(null)

  const qrUrl = useMemo(() => {
    if (!recordId || typeof window === "undefined") return ""
    return `${window.location.origin}/dashboard/maintenance/records/${recordId}`
  }, [recordId])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        if (printType === "ly_lich") {
          if (assetId) {
            const { data: asset } = await supabase
              .from("maintenance_assets")
              .select("ma_tb, ten_tb, bo_phan, loai, nam_sd, bien_so, mo_ta")
              .eq("id", assetId)
              .single()
            setAssetInfo(asset as AssetInfo | null)
          }

          // Step 1: get approved records
          let recQ = supabase
            .from("maintenance_records")
            .select("id, ma_bb, hang_muc, ngay, nguoi_thuc_hien, nv_phu_trach, phu_trach_bao_tri")
            .eq("trang_thai", "da_duyet")
            .order("ngay", { ascending: true })
          if (filterFrom) recQ = recQ.gte("ngay", filterFrom)
          if (filterTo) recQ = recQ.lte("ngay", filterTo)
          const { data: recs } = await recQ
          const recList = (recs || []) as {
            id: string; ma_bb: string | null; hang_muc: string; ngay: string
            nguoi_thuc_hien: string[]; nv_phu_trach: string | null; phu_trach_bao_tri: string | null
          }[]

          if (recList.length > 0) {
            const recIds = recList.map((r) => r.id)
            let lineQ = supabase
              .from("maintenance_record_lines")
              .select("id, record_id, asset_id, ten_tb, ma_tb, noi_dung, cac_khac_phuc, chi_phi_dk, loai_tien, cong_tho")
              .in("record_id", recIds)
            if (assetId) lineQ = lineQ.eq("asset_id", assetId)
            const { data: linesData } = await lineQ
            const recMap = new Map(recList.map((r) => [r.id, r]))
            const mapped: HistoryRow[] = ((linesData || []) as {
              id: string; record_id: string; asset_id: string | null
              ten_tb: string; ma_tb: string; noi_dung: string | null; cac_khac_phuc: string | null
              chi_phi_dk: number; loai_tien: string; cong_tho: number
            }[]).map((d) => {
              const rec = recMap.get(d.record_id)!
              return {
                ngay: rec.ngay,
                ma_bb: rec.ma_bb,
                hang_muc: rec.hang_muc,
                ten_tb: d.ten_tb,
                ma_tb: d.ma_tb,
                noi_dung: d.noi_dung,
                cac_khac_phuc: d.cac_khac_phuc,
                chi_phi_dk: d.chi_phi_dk || 0,
                loai_tien: d.loai_tien || "USD",
                cong_tho: d.cong_tho || 0,
                nguoi_thuc_hien: rec.nguoi_thuc_hien || [],
                nv_phu_trach: rec.nv_phu_trach,
                phu_trach_bao_tri: rec.phu_trach_bao_tri,
              }
            })
            mapped.sort((a, b) => a.ngay.localeCompare(b.ngay))
            setHistoryRows(mapped)
          }
        } else {
          // su_co or de_nghi — need a record_id
          if (!recordId) { setError("Thiếu record_id"); return }

          const { data: rec } = await supabase
            .from("maintenance_records")
            .select("*")
            .eq("id", recordId)
            .single()

          if (!rec) { setError("Không tìm thấy biên bản"); return }

          const { data: rawLines } = await supabase
            .from("maintenance_record_lines")
            .select("*")
            .eq("record_id", recordId)
            .order("sort_order")

          const lines: LineData[] = []
          for (const ln of rawLines || []) {
            const { data: mats } = await supabase
              .from("maintenance_materials")
              .select("*")
              .eq("line_id", ln.id)
              .order("sort_order")
            lines.push({
              ...(ln as Omit<LineData, "materials">),
              materials: (mats || []) as MaterialRow[],
            })
          }

          setRecord({ ...(rec as Omit<RecordData, "lines">), lines })
        }
      } catch {
        setError("Lỗi tải dữ liệu")
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [printType, recordId, assetId, filterFrom, filterTo])

  // Auto-print on load
  useEffect(() => {
    if (!loading && !error) {
      const t = setTimeout(() => window.print(), 500)
      return () => clearTimeout(t)
    }
  }, [loading, error])

  const backHref = recordId
    ? `/dashboard/maintenance/records/${recordId}`
    : "/dashboard/maintenance/history"

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 15mm; size: A4 portrait; }
          body { font-size: 11pt; }
          .print\\:page-break-before-always { page-break-before: always; }
        }
        .print-page { max-width: 800px; margin: 0 auto; padding: 16px; }
        @media screen {
          body { background: #f1f5f9; }
          .print-page { background: white; box-shadow: 0 2px 12px rgba(0,0,0,.12); border-radius: 8px; padding: 40px 48px; }
        }
      `}</style>

      {/* Toolbar (screen only) */}
      <div className="no-print fixed top-0 left-0 right-0 z-50 bg-white border-b border-slate-200 shadow-sm px-6 py-2 flex items-center gap-4">
        <Link href={backHref} className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft size={14} /> Quay lại
        </Link>
        <div className="flex-1 text-center text-sm font-bold text-slate-700">
          {printType === "su_co" && "Biên bản kiểm tra sự cố"}
          {printType === "de_nghi" && "Giấy đề nghị + Biên bản nghiệm thu"}
          {printType === "ly_lich" && "Lý lịch thiết bị"}
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-1.5 bg-slate-700 text-white text-sm font-bold rounded-lg hover:bg-slate-800"
        >
          <Printer size={14} /> In
        </button>
      </div>

      <div className="pt-12">
        {loading && (
          <div className="print-page text-center py-16 text-slate-400">Đang tải...</div>
        )}
        {error && (
          <div className="print-page text-center py-16 text-red-500">{error}</div>
        )}
        {!loading && !error && printType !== "ly_lich" && record && (
          <>
            {printType === "su_co" && <PrintSuCo record={record} qrUrl={qrUrl} />}
            {printType === "de_nghi" && <PrintDeNghi record={record} qrUrl={qrUrl} />}
          </>
        )}
        {!loading && !error && printType === "ly_lich" && (
          <PrintLyLich rows={historyRows} asset={assetInfo} filterFrom={filterFrom} filterTo={filterTo} />
        )}
      </div>
    </>
  )
}

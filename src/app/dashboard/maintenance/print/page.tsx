"use client"

import { useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Printer } from "lucide-react"
import Link from "next/link"
import { QRCodeSVG } from "qrcode.react"
import { supabase } from "@/lib/supabase"
import { currencySymbol } from "../_components/maintenance-data"

// ─── Types ────────────────────────────────────────────────────────────────────

type PrintType = "su_co" | "de_nghi" | "ly_lich" | "su_co_nho" | "bao_duong" | "bao_duong_xe"

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
  image_urls: string[]
  materials: MaterialRow[]
}

type RecordData = {
  id: string
  factory_id: string
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
  noi_dung_chung: string | null
  nguyen_nhan_chung: string | null
  cac_khac_phuc_chung: string | null
  image_urls_chung: string[] | null
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
  if (!d) return "......"
  const dt = new Date(d)
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`
}

function fmtDateParts(d: string | null) {
  if (!d) return { dd: "......", mm: "......", yyyy: "........." }
  const dt = new Date(d)
  return {
    dd: String(dt.getDate()).padStart(2, "0"),
    mm: String(dt.getMonth() + 1).padStart(2, "0"),
    yyyy: String(dt.getFullYear()),
  }
}

function fmtTime(t: string | null) {
  if (!t) return "......"
  return t.slice(0, 5)
}

function fmtValue(chi_phi: number, loai_tien: string) {
  const sym = currencySymbol(loai_tien)
  return `${sym}${chi_phi.toLocaleString()}`
}

// ─── Shared UI Components ──────────────────────────────────────────────────────

function CompanyHeader({ boPhan }: { boPhan?: string }) {
  return (
    <div className="flex items-start justify-between mb-0.5">
      <div>
        <div className="font-bold uppercase" style={{ fontSize: "12px", color: "#000000" }}>
          Nhà máy chế biến Phước Hòa Kampong Thom
        </div>
        {boPhan && (
          <div style={{ fontSize: "12px", color: "#000000" }}>Bộ phận: {boPhan}</div>
        )}
      </div>
    </div>
  )
}

type SigCol = { role: string; name?: string | null }

function SignatureRow({ cols }: { cols: SigCol[] }) {
  return (
    <div className="grid gap-4 mt-8 text-center text-xs" style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)` }}>
      {cols.map((col, i) => (
        <div key={i}>
          <div className="font-bold text-slate-700 mb-1">{col.role}</div>
          <div className="h-16" />
          <div className="pt-1">
            <div className="font-semibold text-slate-700 min-h-[1.25rem]">{col.name || " "}</div>
            <div className="text-slate-400 italic text-[10px] mt-0.5">(Ký và ghi rõ họ tên)</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function DocumentFooter({ code }: { code: string }) {
  return (
    <div className="mt-6 pt-2 border-t border-slate-300 text-[9px] text-slate-400">
      <span>{code} (01-15/05/2026)</span>
    </div>
  )
}

function BlankLine({ count = 1 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border-b border-slate-300 mb-3 pb-1" />
      ))}
    </>
  )
}

function MaterialsTable({ materials, showDonGia = true }: { materials: MaterialRow[]; showDonGia?: boolean }) {
  if (materials.length === 0) return null
  return (
    <table className="w-full text-xs border-collapse mt-1">
      <thead>
        <tr className="bg-slate-50">
          <th className="border border-slate-400 px-2 py-1 text-center">STT</th>
          <th className="border border-slate-400 px-2 py-1 text-left">Tên vật tư / phụ tùng</th>
          <th className="border border-slate-400 px-2 py-1 text-center">ĐVT</th>
          <th className="border border-slate-400 px-2 py-1 text-right">Số lượng</th>
          {showDonGia && <th className="border border-slate-400 px-2 py-1 text-right">Đơn giá</th>}
          <th className="border border-slate-400 px-2 py-1 text-right">Thành tiền</th>
          {showDonGia && <th className="border border-slate-400 px-2 py-1 text-center">Nguồn</th>}
        </tr>
      </thead>
      <tbody>
        {materials.map((m, mi) => (
          <tr key={mi}>
            <td className="border border-slate-300 px-2 py-1 text-center">{mi + 1}</td>
            <td className="border border-slate-300 px-2 py-1">{m.ten_vat_tu}</td>
            <td className="border border-slate-300 px-2 py-1 text-center">{m.dvt || "—"}</td>
            <td className="border border-slate-300 px-2 py-1 text-right">{m.so_luong}</td>
            {showDonGia && (
              <td className="border border-slate-300 px-2 py-1 text-right">
                {m.don_gia ? `${currencySymbol(m.loai_tien || "USD")}${m.don_gia.toLocaleString()}` : "—"}
              </td>
            )}
            <td className="border border-slate-300 px-2 py-1 text-right">
              {m.thanh_tien ? `${currencySymbol(m.loai_tien || "USD")}${m.thanh_tien.toLocaleString()}` : "—"}
            </td>
            {showDonGia && (
              <td className="border border-slate-300 px-2 py-1 text-center">
                {m.nguon === "trong_kho" ? "Kho" : "Mua ngoài"}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ─── Template F13: Biên bản kiểm tra sự cố ────────────────────────────────────

function PrintSuCo({ record, qrUrl, staffMap }: { record: RecordData; qrUrl: string; staffMap: Map<string, string> }) {
  const { dd, mm, yyyy } = fmtDateParts(record.ngay)
  const isBoDoi = record.bo_phan === "Đội xe"

  // Tổ trưởng cơ điện được chọn trong nguoi_thuc_hien (nếu có)
  const toTruongCoDien = record.nguoi_thuc_hien.filter(name => {
    const role = staffMap.get(name)?.toLowerCase() || ""
    return role.includes("tổ trưởng") && role.includes("cơ điện")
  })
  // Thứ tự: Giám đốc → BGĐ → NV phụ trách → Phụ trách bảo trì → Tổ trưởng cơ điện (từ nguoi_thuc_hien)
  const participants: { name: string; role: string }[] = []
  if (record.giam_doc) participants.push({ name: record.giam_doc, role: staffMap.get(record.giam_doc) || "Giám đốc nhà máy" })
  if (record.bgd_phu_trach) participants.push({ name: record.bgd_phu_trach, role: staffMap.get(record.bgd_phu_trach) || "BGĐ phụ trách" })
  if (record.nv_phu_trach) participants.push({ name: record.nv_phu_trach, role: staffMap.get(record.nv_phu_trach) || "Nhân viên phụ trách" })
  if (record.phu_trach_bao_tri) participants.push({ name: record.phu_trach_bao_tri, role: staffMap.get(record.phu_trach_bao_tri) || "Phụ trách bảo trì" })
  for (const name of toTruongCoDien) {
    participants.push({ name, role: staffMap.get(name) || "Tổ trưởng cơ điện" })
  }
  if (!record.nv_phu_trach && !record.phu_trach_bao_tri && toTruongCoDien.length === 0) participants.push({ name: "", role: "Tổ trưởng cơ điện" })

  return (
    <div className="print-page font-serif">
      <CompanyHeader boPhan={record.bo_phan} />

      {/* Title + QR */}
      <div className="flex items-start justify-between mt-2 mb-3">
        <div className="flex-1 text-center">
          <h2 className="font-extrabold uppercase tracking-wide" style={{ fontSize: "13pt" }}>Biên bản kiểm tra sự cố</h2>
          <div className="text-[10px] italic text-slate-500 mt-0.5">
            (Áp dụng cho {isBoDoi ? "phương tiện vận tải" : "thiết bị sơ chế cao su"})
          </div>
          <div className="text-xs text-slate-600 mt-1 font-semibold">Số: {record.ma_bb || "..."}</div>
        </div>
        {qrUrl && (
          <div className="shrink-0 text-center ml-4">
            <QRCodeSVG value={qrUrl} size={64} level="M" />
            <div className="text-[9px] text-slate-400 mt-0.5 font-mono">{record.ma_bb}</div>
          </div>
        )}
      </div>

      {/* Body text */}
      <div className="text-xs leading-5 space-y-0.5">
        <p>
          Hôm nay vào lúc <span className="px-2">{fmtTime(record.tu_gio)}</span> giờ,
          {" "}ngày <span className="px-2">{dd}</span> tháng{" "}
          <span className="px-2">{mm}</span> năm{" "}
          <span className="px-2">{yyyy}</span>
        </p>
        <p>
          Tại: <span>{record.bo_phan}</span>
        </p>

        <p className="font-semibold mt-2">Chúng tôi gồm:</p>
        {participants.length > 0 ? (
          participants.map((p, i) => (
            <p key={i}>
              {i + 1}- <strong>{p.name || "................................."}</strong>
              {p.role ? ` – ${p.role}` : ""}
            </p>
          ))
        ) : (
          <>
            <p>1- ................................................................................</p>
            <p>2- ................................................................................</p>
            <p>3- ................................................................................</p>
          </>
        )}
      </div>

      {/* Equipment lines */}
      {record.lines.map((line, idx) => (
        <div key={line.id} className="mt-2 text-xs leading-5 space-y-0.5">
          {record.lines.length > 1 && (
            <div className="bg-slate-100 px-3 py-1 font-bold rounded text-[11px] uppercase mb-1">
              {idx + 1}. {line.ten_tb} ({line.ma_tb})
            </div>
          )}

          <p>
            Tiến hành kiểm tra {record.hang_muc === "Sửa chữa" ? "sự cố" : "bảo dưỡng"} máy{" "}
            <span>{line.ten_tb}</span>, Số hiệu nhận dạng{" "}
            <span className="font-mono">{line.ma_tb}</span>
            {isBoDoi && line.ten_tai_xe && (
              <>, Lái xe: <span>{line.ten_tai_xe}</span></>
            )}
          </p>

          <div className="mt-1">
            <span className="font-semibold">Tình trạng {record.hang_muc === "Sửa chữa" ? "sự cố" : "thiết bị"}: </span>
            {line.noi_dung ? <span>{line.noi_dung}</span> : <BlankLine count={2} />}
          </div>

          {record.hang_muc === "Sửa chữa" && (
            <div className="mt-1">
              <span className="font-semibold">Nguyên nhân sự cố: </span>
              {line.nguyen_nhan ? <span>{line.nguyen_nhan}</span> : <BlankLine count={2} />}
            </div>
          )}

          <div className="mt-1">
            <span className="font-semibold">Cách khắc phục xử lý: </span>
            {line.cac_khac_phuc ? <span>{line.cac_khac_phuc}</span> : <BlankLine count={2} />}
          </div>

          <div className="mt-2">
            <span className="font-semibold">Vật tư sử dụng: </span>
            {line.materials.length === 0 && (
              <span className="italic">Không có</span>
            )}
            {line.materials.length > 0 && <MaterialsTable materials={line.materials} showDonGia />}
          </div>
        </div>
      ))}

      <div className="mt-2 text-xs leading-5">
        <span className="font-semibold">Kết luận và những kiến nghị lên Giám đốc nhà máy </span>
        <span className="italic">(đối với những trường hợp không khắc phục ngay được): </span>
        {record.ghi_chu ? (
          <span>{record.ghi_chu}</span>
        ) : (
          <BlankLine count={3} />
        )}
      </div>

      <SignatureRow cols={[
        { role: "BGĐ phụ trách", name: record.bgd_phu_trach },
        { role: "Nhân viên kỹ thuật", name: record.nv_phu_trach },
        { role: "Tổ cơ điện", name: record.phu_trach_bao_tri },
        { role: "Giám đốc nhà máy", name: record.giam_doc },
      ]} />

      <DocumentFooter code="KHXD-QT02-F13" />
    </div>
  )
}

// ─── Template F10: Giấy đề nghị sửa chữa ─────────────────────────────────────

function PrintF10({ record, qrUrl }: { record: RecordData; qrUrl: string }) {
  const { dd, mm, yyyy } = fmtDateParts(record.ngay)
  const allMaterials = record.lines.flatMap((l) => l.materials)
  const machineNames = record.lines.map((l) => `${l.ten_tb} (${l.ma_tb})`).join(", ")

  return (
    <div className="print-page font-serif">
      <CompanyHeader boPhan={record.bo_phan} />

      <div className="flex items-start justify-between mt-2">
        <div className="flex-1" />
        {qrUrl && (
          <div className="shrink-0 text-center ml-4">
            <QRCodeSVG value={qrUrl} size={64} level="M" />
            <div className="text-[9px] text-slate-400 mt-0.5 font-mono">{record.ma_bb}</div>
          </div>
        )}
      </div>

      {/* Date right-aligned */}
      <div className="text-right text-xs mt-1 mb-3">
        Kampong Thom, ngày <span className="px-1">{dd}</span> tháng{" "}
        <span className="px-1">{mm}</span> năm{" "}
        <span className="px-1">{yyyy}</span>
      </div>

      <div className="text-center mb-4">
        <h2 className="font-extrabold uppercase tracking-wide" style={{ fontSize: "13pt" }}>Giấy đề nghị sửa chữa</h2>
        <div className="text-[10px] italic text-slate-500 mt-0.5">(Áp dụng cho sửa chữa thiết bị sơ chế cao su)</div>
        <div className="text-xs text-slate-600 mt-1 font-semibold">Số: {record.ma_bb || "..."}</div>
      </div>

      <div className="text-xs leading-5 space-y-1">
        <p>
          <strong>Kính gửi:</strong> Giám đốc Nhà máy chế biến Phước Hòa Kampong Thom
        </p>
        <p>
          Đề nghị Ban Giám đốc Nhà máy chế biến cho sửa chữa:{" "}
          <span>{machineNames}</span>
        </p>
        <p>
          Đính kèm biên bản số: <span className="font-bold">{record.ma_bb || "..."}</span>
        </p>
        <p>
          Thời gian tiến hành, từ ngày <span>{fmtDate(record.ngay)}</span>
          {" "}đến ngày <span>{fmtDate(record.ngay)}</span>
        </p>
        <p>
          Thực hiện sửa chữa:{" "}
          <span>
            {record.nguoi_thuc_hien.join(", ") || "..."}
          </span>
        </p>

        <div className="mt-2">
          <p className="font-semibold">Nội dung cụ thể cần thay thế sửa chữa:</p>

          {/* Per-line details */}
          {record.lines.map((line, idx) => (
            <div key={line.id} className="mt-2">
              {record.lines.length > 1 && (
                <p className="font-bold">{idx + 1}. {line.ten_tb} ({line.ma_tb})</p>
              )}
              {line.noi_dung && <p className="pl-3">• Nội dung: {line.noi_dung}</p>}
              {line.nguyen_nhan && <p className="pl-3">• Nguyên nhân: {line.nguyen_nhan}</p>}
            </div>
          ))}

          {/* Combined materials table */}
          <div className="mt-2">
            <span className="font-semibold">Vật tư thay thế: </span>
            {allMaterials.length === 0 && (
              <span className="italic text-slate-500">Không có</span>
            )}
          </div>
          {allMaterials.length > 0 && (
            <MaterialsTable materials={allMaterials} showDonGia />
          )}
        </div>

        {/* Cost summary */}
        <div className="flex gap-8 mt-2 text-xs">
          {record.lines.map((line, idx) => (
            <div key={idx}>
              {record.lines.length > 1 && <span className="font-bold">{line.ten_tb}: </span>}
              <span>Chi phí ước tính: <strong>{fmtValue(line.chi_phi_dk, line.loai_tien)}</strong></span>
              {line.loai_sua_chua && (
                <span className="ml-4">
                  ({line.loai_sua_chua === "lon" ? "Sửa chữa lớn >200$" : "Sửa chữa nhỏ ≤200$"})
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <SignatureRow cols={[
        { role: "Giám đốc nhà máy", name: record.giam_doc },
        { role: "Nhân viên kỹ thuật", name: record.nv_phu_trach },
        { role: "BGĐ phụ trách", name: record.bgd_phu_trach },
      ]} />

      <DocumentFooter code="KHXD-QT02-F10" />
    </div>
  )
}

// ─── Template F15: Biên bản nghiệm thu ───────────────────────────────────────

function PrintF15({ record, qrUrl, staffMap }: { record: RecordData; qrUrl: string; staffMap: Map<string, string> }) {
  const { dd, mm, yyyy } = fmtDateParts(record.ngay_duyet || record.ngay)

  return (
    <div className="print-page font-serif">
      <CompanyHeader boPhan={record.bo_phan} />

      <div className="flex items-start justify-between mt-2 mb-3">
        <div className="flex-1 text-center">
          <h2 className="font-extrabold uppercase tracking-wide" style={{ fontSize: "13pt" }}>Biên bản nghiệm thu</h2>
          <div className="text-[10px] italic text-slate-500 mt-0.5">(Áp dụng cho sửa chữa nhỏ, thường xuyên)</div>
          <div className="text-xs text-slate-600 mt-1 font-semibold">Căn cứ biên bản số: {record.ma_bb || "..."}</div>
        </div>
        {qrUrl && (
          <div className="shrink-0 text-center ml-4">
            <QRCodeSVG value={qrUrl} size={64} level="M" />
            <div className="text-[9px] text-slate-400 mt-0.5 font-mono">{record.ma_bb}</div>
          </div>
        )}
      </div>

      {record.lines.map((line, idx) => (
        <div key={line.id} className="mb-2 text-xs leading-5">
          {record.lines.length > 1 && (
            <div className="bg-slate-100 px-3 py-1 font-bold rounded text-[11px] uppercase mb-2">
              {idx + 1}. {line.ten_tb} ({line.ma_tb})
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <p>Xe/máy/thiết bị: <span>{line.ten_tb}</span></p>
            <p>Biển số/số hiệu: <span className="font-mono">{line.ma_tb}</span></p>
            <p className="col-span-2">
              Lái xe / người phụ trách:{" "}
              <span>{line.ten_tai_xe || record.nv_phu_trach || "..."}</span>
            </p>
          </div>
        </div>
      ))}

      <div className="text-xs leading-5 space-y-0.5">
        <p>
          Đơn vị quản lý, sử dụng:{" "}
          <span>Nhà máy chế biến Phước Hòa Kampong Thom</span>
        </p>
        <p>
          Căn cứ: Giấy đề nghị sửa chữa số{" "}
          <span className="font-bold">{record.ma_bb || "..."}</span>
        </p>
        <p>
          Căn cứ: Biên bản kiểm tra sự cố số{" "}
          <span className="font-bold">{record.ma_bb || "..."}</span>
        </p>
        <p>
          Hôm nay, ngày <span className="px-1">{dd}</span> tháng{" "}
          <span className="px-1">{mm}</span> năm{" "}
          <span className="px-1">{yyyy}</span>
        </p>
        <p>Tại: <span>{record.bo_phan}</span></p>

        <p className="font-semibold mt-2">Chúng tôi gồm:</p>
        {record.giam_doc && <p>Ông: <strong>{record.giam_doc}</strong> – {staffMap.get(record.giam_doc) || "Giám đốc Nhà máy"}</p>}
        {record.bgd_phu_trach && <p>Ông: <strong>{record.bgd_phu_trach}</strong> – {staffMap.get(record.bgd_phu_trach) || "BGĐ phụ trách"}</p>}
        {record.nv_phu_trach && <p>Ông: <strong>{record.nv_phu_trach}</strong> – {staffMap.get(record.nv_phu_trach) || "Nhân viên phụ trách"}</p>}
        {record.phu_trach_bao_tri && <p>Ông: <strong>{record.phu_trach_bao_tri}</strong> – {staffMap.get(record.phu_trach_bao_tri) || "Phụ trách bảo trì"}</p>}
        {!record.nv_phu_trach && !record.phu_trach_bao_tri && (
          <p>Ông: <strong>.................................</strong> – Tổ trưởng cơ điện</p>
        )}

        <p className="mt-2">
          Cùng tiến hành kiểm tra chất lượng sửa chữa. Kết quả như sau:
        </p>

        <div className="mt-2">
          {record.lines.map((line, idx) => {
            const allMats = line.materials
            const content = line.cac_khac_phuc || line.noi_dung || ""
            return (
              <div key={idx} className="mt-1">
                {record.lines.length > 1 ? (
                  <>
                    <p className="font-bold">{idx + 1}. {line.ten_tb}:</p>
                    <p className="pl-3">
                      <span className="font-semibold">Khối lượng đã sửa chữa, thay thế phụ tùng: </span>
                      {content}
                    </p>
                  </>
                ) : (
                  <p>
                    <span className="font-semibold">Khối lượng đã sửa chữa, thay thế phụ tùng: </span>
                    {content || ".............................."}
                  </p>
                )}
                {allMats.length > 0 && <MaterialsTable materials={allMats} showDonGia={false} />}
              </div>
            )
          })}
          {!record.lines.some((l) => l.cac_khac_phuc || l.noi_dung || l.materials.length > 0) && (
            <BlankLine count={2} />
          )}
        </div>

        <div className="mt-2 flex items-center gap-6">
          <span className="font-semibold">Chất lượng:</span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-4 h-4 border border-slate-600 align-middle" /> Đạt yêu cầu
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-4 h-4 border border-slate-600 align-middle" /> Không đạt
          </span>
        </div>

        <div className="mt-1">
          <span className="font-semibold">Giá trị sửa chữa: </span>
          {record.lines.map((line, idx) => (
            <span key={idx}>
              {record.lines.length > 1 ? `${line.ten_tb}: ` : ""}
              <strong>{fmtValue(line.chi_phi_dk, line.loai_tien)}</strong>
              {idx < record.lines.length - 1 ? ", " : ""}
            </span>
          ))}
        </div>

        <div className="mt-1">
          <p className="font-semibold">Kết luận:</p>
          {[0, 1].map(i => (
            <div key={i} style={{ height: "2rem", borderBottom: "1px solid #cbd5e1", marginTop: "0.5rem" }} />
          ))}
        </div>
      </div>

      <SignatureRow cols={[
        { role: "BGĐ phụ trách", name: record.bgd_phu_trach },
        { role: "Nhân viên phụ trách", name: record.nv_phu_trach },
        { role: "Giám đốc nhà máy", name: record.giam_doc },
      ]} />

      <DocumentFooter code="KHXD-QT02-F15" />
    </div>
  )
}

// ─── Wrapper: F10 + F15 gộp ──────────────────────────────────────────────────

function PrintDeNghi({ record, qrUrl, staffMap }: { record: RecordData; qrUrl: string; staffMap: Map<string, string> }) {
  return (
    <div className="font-serif">
      <PrintF10 record={record} qrUrl={qrUrl} />
      <div className="print:page-break-before-always mt-6 pt-6" />
      <PrintF15 record={record} qrUrl={qrUrl} staffMap={staffMap} />
    </div>
  )
}

// ─── Template F01: Lý lịch máy móc / thiết bị ─────────────────────────────────

function PrintLyLich({ rows, asset, filterFrom, filterTo }: {
  rows: HistoryRow[]
  asset: AssetInfo | null
  filterFrom: string
  filterTo: string
}) {
  return (
    <div className="print-page font-serif">
      <CompanyHeader boPhan={asset?.bo_phan} />

      <div className="text-center mt-2 mb-4">
        <h2 className="font-extrabold uppercase tracking-wide" style={{ fontSize: "13pt" }}>
          Lý lịch {asset?.loai === "xe" ? "xe" : "máy móc / thiết bị"}
        </h2>
        <div className="text-[10px] italic text-slate-500 mt-0.5">(KHXD-QT02-F01)</div>
      </div>

      {/* Section I: Thông tin thiết bị */}
      {asset && (
        <div className="mb-4">
          <div className="text-xs font-bold text-slate-700 mb-2 uppercase tracking-wide">I. Thông tin thiết bị</div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs border border-slate-300 rounded p-3 bg-slate-50">
            <div>
              <span className="font-bold">Tên thiết bị:</span>{" "}
              <span>{asset.ten_tb}</span>
            </div>
            <div>
              <span className="font-bold">Mã thiết bị:</span>{" "}
              <span className="font-mono">{asset.ma_tb}</span>
            </div>
            <div>
              <span className="font-bold">Bộ phận:</span>{" "}
              <span>{asset.bo_phan}</span>
            </div>
            {asset.loai === "xe" && asset.bien_so && (
              <div>
                <span className="font-bold">Biển số:</span>{" "}
                <span>{asset.bien_so}</span>
              </div>
            )}
            {asset.nam_sd && (
              <div>
                <span className="font-bold">Năm sử dụng:</span>{" "}
                <span>{asset.nam_sd}</span>
              </div>
            )}
            {asset.mo_ta && (
              <div className="col-span-2">
                <span className="font-bold">Mô tả:</span>{" "}
                <span>{asset.mo_ta}</span>
              </div>
            )}
            {(filterFrom || filterTo) && (
              <div className="col-span-2">
                <span className="font-bold">Kỳ báo cáo:</span>{" "}
                {filterFrom ? fmtDate(filterFrom) : "Từ đầu"} – {filterTo ? fmtDate(filterTo) : "nay"}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section II: Lịch sử bảo trì */}
      <div>
        <div className="text-xs font-bold text-slate-700 mb-2 uppercase tracking-wide">
          II. Bảo trì, sửa chữa, thay thế phụ tùng
        </div>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-100">
              <th className="border border-slate-400 px-2 py-1.5 text-center w-8">STT</th>
              <th className="border border-slate-400 px-2 py-1.5 text-center w-24">Thời gian</th>
              <th className="border border-slate-400 px-2 py-1.5 text-left">Nội dung sửa chữa, thay thế phụ tùng</th>
              <th className="border border-slate-400 px-2 py-1.5 text-right w-24">Giá trị</th>
              <th className="border border-slate-400 px-2 py-1.5 text-center w-28">Người thực hiện</th>
              <th className="border border-slate-400 px-2 py-1.5 text-center w-28">Người theo dõi</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const value = row.chi_phi_dk > 0
                ? fmtValue(row.chi_phi_dk, row.loai_tien)
                : row.cong_tho > 0 ? fmtValue(row.cong_tho, row.loai_tien) : "—"
              const nguoiTheoDoi = [row.nv_phu_trach, row.phu_trach_bao_tri].filter(Boolean).join(", ") || "—"
              return (
                <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"}>
                  <td className="border border-slate-300 px-2 py-1.5 text-center">{idx + 1}</td>
                  <td className="border border-slate-300 px-2 py-1.5 text-center whitespace-nowrap">{fmtDate(row.ngay)}</td>
                  <td className="border border-slate-300 px-2 py-1.5">
                    <div>{row.noi_dung || row.hang_muc || "—"}</div>
                    {row.cac_khac_phuc && <div className="text-slate-500 italic text-[10px]">{row.cac_khac_phuc}</div>}
                    {row.ma_bb && <div className="text-slate-400 text-[10px]">BB: {row.ma_bb}</div>}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-right whitespace-nowrap">{value}</td>
                  <td className="border border-slate-300 px-2 py-1.5 text-center">
                    {row.nguoi_thuc_hien.join(", ") || "—"}
                  </td>
                  <td className="border border-slate-300 px-2 py-1.5 text-center">{nguoiTheoDoi}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="border border-slate-300 px-4 py-8 text-center text-slate-400 italic">
                  Chưa có dữ liệu bảo trì
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="text-xs mt-2 text-slate-500 italic">
          Tổng: {rows.length} lần bảo trì ·
          Sửa chữa: {rows.filter((r) => r.hang_muc === "Sửa chữa").length} ·
          Bảo dưỡng: {rows.filter((r) => r.hang_muc === "Bảo dưỡng").length}
        </div>
      </div>

      <SignatureRow cols={[
        { role: "Người lập" },
        { role: "Tổ cơ điện" },
        { role: "BGĐ phụ trách" },
        { role: "Giám đốc nhà máy" },
      ]} />

      <DocumentFooter code="KHXD-QT02-F01" />
    </div>
  )
}

// ─── Template 4: Trang ảnh (dùng trong su_co_nho) ─────────────────────────────

function PrintImages({ lines, record }: { lines: LineData[]; record: RecordData }) {
  const linesWithImages = lines.filter((l) => (l.image_urls || []).some(Boolean))
  if (linesWithImages.length === 0) return null
  const multiDevice = linesWithImages.length > 1

  return (
    <div className="print-page font-serif">
      <CompanyHeader boPhan={record.bo_phan} />
      <div className="text-center mt-2 mb-4">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">Hình ảnh biên bản</h2>
        <div className="text-xs text-slate-600 mt-1">Số: {record.ma_bb || "..."}</div>
      </div>

      {linesWithImages.map((line) => {
        const imgs = (line.image_urls || []).filter(Boolean)
        const colClass = imgs.length <= 2 ? "grid-cols-2" : "grid-cols-3"
        return (
          <div key={line.id} className="mb-6">
            {multiDevice && (
              <div className="bg-slate-100 px-3 py-1.5 font-bold text-xs uppercase mb-2 rounded">
                {line.ten_tb} ({line.ma_tb})
              </div>
            )}
            <div className={`grid ${colClass} gap-2`}>
              {imgs.map((url, i) => (
                <div key={i} className="overflow-hidden rounded border border-slate-200" style={{ aspectRatio: "4/3" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Ảnh ${i + 1}`} className="w-full h-full object-cover" crossOrigin="anonymous" />
                </div>
              ))}
            </div>
            <div className="text-[10px] text-slate-400 text-right mt-1">{imgs.length} hình ảnh</div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Template gộp: F13 + F10 + F15 + Ảnh ────────────────────────────────────

function PrintSuCoNho({ record, qrUrl, staffMap }: { record: RecordData; qrUrl: string; staffMap: Map<string, string> }) {
  const hasImages = record.lines.some((l) => (l.image_urls || []).some(Boolean))
  return (
    <div className="font-serif">
      <PrintSuCo record={record} qrUrl={qrUrl} staffMap={staffMap} />
      <div className="print:page-break-before-always mt-6 pt-6" />
      <PrintDeNghi record={record} qrUrl={qrUrl} staffMap={staffMap} />
      {hasImages && (
        <>
          <div className="print:page-break-before-always mt-6 pt-6" />
          <PrintImages lines={record.lines} record={record} />
        </>
      )}
    </div>
  )
}

// ─── Template F03: Giấy đề nghị bảo trì - sửa chữa ──────────────────────────

// Kết hợp nội dung chung + nội dung riêng của từng thiết bị để in biên bản
function mergeNoidung(common: string | null | undefined, own: string | null | undefined): string {
  return [common, own].filter(Boolean).join("\n")
}

function PrintF03({ record, qrUrl }: { record: RecordData; qrUrl: string }) {
  const { dd, mm, yyyy } = fmtDateParts(record.ngay)
  return (
    <div className="print-page font-serif">
      <CompanyHeader boPhan={record.bo_phan} />

      <div className="flex items-start justify-between mt-2">
        <div className="flex-1" />
        {qrUrl && (
          <div className="shrink-0 text-center ml-4">
            <QRCodeSVG value={qrUrl} size={64} level="M" />
            <div className="text-[9px] text-slate-400 mt-0.5 font-mono">{record.ma_bb}</div>
          </div>
        )}
      </div>

      <div className="text-right text-xs mt-1 mb-2">
        Kampong Thom, ngày <span className="px-1">{dd}</span> tháng{" "}
        <span className="px-1">{mm}</span> năm{" "}
        <span className="px-1">{yyyy}</span>
      </div>

      <div className="text-center mb-4">
        <h2 className="font-extrabold uppercase tracking-wide" style={{ fontSize: "13pt" }}>Giấy đề nghị bảo trì - sửa chữa</h2>
        <div className="text-xs text-slate-600 mt-1 font-semibold">Số: {record.ma_bb || "..."}</div>
      </div>

      <div className="text-xs leading-5 space-y-1">
        {record.lines.map((line) => (
          <p key={line.id}>
            Mã thiết bị: <span className="font-mono font-bold">{line.ma_tb}</span>
            <span className="mx-4" />
            Tên thiết bị: <span>{line.ten_tb}</span>
          </p>
        ))}

        <p className="mt-2">
          <strong>Kính gửi:</strong> Giám đốc nhà máy chế biến.
        </p>
        <p>
          Kính đề nghị giám đốc nhà máy cho bảo dưỡng xe, máy móc, thiết bị như sau:
        </p>

        {record.lines.map((line, idx) => (
          <div key={line.id} className="mt-2 pl-3">
            {record.lines.length > 1 && (
              <p className="font-bold">{idx + 1}. {line.ten_tb} ({line.ma_tb})</p>
            )}
            <div className="mt-1">
              <span className="font-semibold">1/ Nội dung bảo dưỡng: </span>
              {(() => { const nd = mergeNoidung(record.noi_dung_chung, line.noi_dung); return nd ? <span style={{ whiteSpace: "pre-wrap" }}>{nd}</span> : <BlankLine count={3} /> })()}
            </div>
            <div className="mt-1">
              <span className="font-semibold">2/ Lý do bảo dưỡng: </span>
              {(() => { const nd = mergeNoidung(record.nguyen_nhan_chung, line.nguyen_nhan); return nd ? <span style={{ whiteSpace: "pre-wrap" }}>{nd}</span> : <BlankLine count={3} /> })()}
            </div>
          </div>
        ))}
      </div>

      <SignatureRow cols={[
        { role: "BGĐ phụ trách", name: record.bgd_phu_trach },
        { role: "Nhân viên phụ trách", name: record.nv_phu_trach },
        { role: "Giám đốc nhà máy", name: record.giam_doc },
        { role: "Tổ cơ điện", name: record.phu_trach_bao_tri },
      ]} />

      <DocumentFooter code="KHXD-QT02-F03" />
    </div>
  )
}

// ─── Template F15 variant cho Bảo dưỡng ──────────────────────────────────────

function PrintF15BaoDuong({ record, qrUrl, staffMap }: { record: RecordData; qrUrl: string; staffMap: Map<string, string> }) {
  const { dd, mm, yyyy } = fmtDateParts(record.ngay_duyet || record.ngay)
  const isBoDoi = record.bo_phan === "Đội xe"
  const firstTaiXe = isBoDoi ? (record.lines[0]?.ten_tai_xe || null) : null

  const participants: { name: string; role: string }[] = []
  if (record.giam_doc) participants.push({ name: record.giam_doc, role: staffMap.get(record.giam_doc) || "Giám đốc Nhà máy" })
  if (record.bgd_phu_trach) participants.push({ name: record.bgd_phu_trach, role: staffMap.get(record.bgd_phu_trach) || "BGĐ phụ trách" })
  if (record.nv_phu_trach) participants.push({ name: record.nv_phu_trach, role: staffMap.get(record.nv_phu_trach) || "Nhân viên phụ trách" })
  if (isBoDoi && firstTaiXe) participants.push({ name: firstTaiXe, role: "Lái xe" })
  if (!isBoDoi && !record.nv_phu_trach && !record.phu_trach_bao_tri) {
    participants.push({ name: "", role: "Tổ trưởng cơ điện" })
  }

  return (
    <div className="print-page font-serif">
      <CompanyHeader boPhan={record.bo_phan} />

      <div className="flex items-start justify-between mt-2 mb-3">
        <div className="flex-1 text-center">
          <h2 className="font-extrabold uppercase tracking-wide" style={{ fontSize: "13pt" }}>Biên bản nghiệm thu</h2>
          <div className="text-[10px] italic text-slate-500 mt-0.5">(Áp dụng cho bảo dưỡng định kỳ)</div>
          <div className="text-xs text-slate-600 mt-1 font-semibold">Căn cứ biên bản số: {record.ma_bb || "..."}</div>
        </div>
        {qrUrl && (
          <div className="shrink-0 text-center ml-4">
            <QRCodeSVG value={qrUrl} size={64} level="M" />
            <div className="text-[9px] text-slate-400 mt-0.5 font-mono">{record.ma_bb}</div>
          </div>
        )}
      </div>

      {record.lines.map((line, idx) => (
        <div key={line.id} className="mb-2 text-xs leading-5">
          {record.lines.length > 1 && (
            <div className="bg-slate-100 px-3 py-1 font-bold rounded text-[11px] uppercase mb-2">
              {idx + 1}. {line.ten_tb} ({line.ma_tb})
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            <p>Xe/máy/thiết bị: <span>{line.ten_tb}</span></p>
            <p>Biển số/số hiệu: <span className="font-mono">{line.ma_tb}</span></p>
            {isBoDoi && (
              <p className="col-span-2">Lái xe: <span>{line.ten_tai_xe || "..."}</span></p>
            )}
          </div>
        </div>
      ))}

      <div className="text-xs leading-5 space-y-0.5">
        <p>Đơn vị quản lý, sử dụng: <span>Nhà máy chế biến Phước Hòa Kampong Thom</span></p>
        <p>Căn cứ: Giấy đề nghị bảo trì số <span className="font-bold">{record.ma_bb || "..."}</span></p>
        <p>
          Hôm nay, ngày <span className="px-1">{dd}</span> tháng{" "}
          <span className="px-1">{mm}</span> năm{" "}
          <span className="px-1">{yyyy}</span>
        </p>
        <p>Tại: <span>{record.bo_phan}</span></p>

        <p className="font-semibold mt-2">Chúng tôi gồm:</p>
        {participants.map((p, i) => (
          <p key={i}>
            Ông: <strong>{p.name || "................................."}</strong> – {p.role}
          </p>
        ))}

        <p className="mt-2">Cùng tiến hành kiểm tra chất lượng bảo dưỡng. Kết quả như sau:</p>

        <div className="mt-2">
          {record.lines.map((line, idx) => {
            const content =
              mergeNoidung(record.cac_khac_phuc_chung, line.cac_khac_phuc) ||
              mergeNoidung(record.noi_dung_chung, line.noi_dung)
            return (
              <div key={idx} className="mt-1">
                {record.lines.length > 1 ? (
                  <>
                    <p className="font-bold">{idx + 1}. {line.ten_tb}:</p>
                    <p className="pl-3">
                      <span className="font-semibold">Khối lượng đã bảo dưỡng, thay thế phụ tùng: </span>
                      {content ? <span style={{ whiteSpace: "pre-wrap" }}>{content}</span> : ".............................."}
                    </p>
                  </>
                ) : (
                  <p>
                    <span className="font-semibold">Khối lượng đã bảo dưỡng, thay thế phụ tùng: </span>
                    {content ? <span style={{ whiteSpace: "pre-wrap" }}>{content}</span> : ".............................."}
                  </p>
                )}
                {line.materials.length > 0 && <MaterialsTable materials={line.materials} showDonGia={false} />}
              </div>
            )
          })}
        </div>

        <div className="mt-2 flex items-center gap-6">
          <span className="font-semibold">Chất lượng:</span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-4 h-4 border border-slate-600 align-middle" /> Đạt yêu cầu
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block w-4 h-4 border border-slate-600 align-middle" /> Không đạt
          </span>
        </div>

        <div className="mt-1">
          <p className="font-semibold">Kết luận:</p>
          {[0, 1].map(i => (
            <div key={i} style={{ height: "2rem", borderBottom: "1px solid #cbd5e1", marginTop: "0.5rem" }} />
          ))}
        </div>
      </div>

      {isBoDoi ? (
        <SignatureRow cols={[
          { role: "BGĐ phụ trách", name: record.bgd_phu_trach },
          { role: "Nhân viên phụ trách", name: record.nv_phu_trach },
          { role: "Tài xế", name: firstTaiXe },
          { role: "Giám đốc nhà máy", name: record.giam_doc },
        ]} />
      ) : (
        <SignatureRow cols={[
          { role: "BGĐ phụ trách", name: record.bgd_phu_trach },
          { role: "Nhân viên phụ trách", name: record.nv_phu_trach },
          { role: "Giám đốc nhà máy", name: record.giam_doc },
        ]} />
      )}

      <DocumentFooter code="KHXD-QT02-F15" />
    </div>
  )
}

// ─── Template F06: Phiếu hoàn thành công việc bảo trì (xe) ───────────────────

function PrintF06({ record, qrUrl }: { record: RecordData; qrUrl: string }) {
  const { dd, mm, yyyy } = fmtDateParts(record.ngay)
  return (
    <div className="print-page font-serif">
      <CompanyHeader boPhan={record.bo_phan} />

      <div className="flex items-start justify-between mt-2">
        <div className="flex-1" />
        {qrUrl && (
          <div className="shrink-0 text-center ml-4">
            <QRCodeSVG value={qrUrl} size={64} level="M" />
            <div className="text-[9px] text-slate-400 mt-0.5 font-mono">{record.ma_bb}</div>
          </div>
        )}
      </div>

      <div className="text-right text-xs mt-1 mb-2">
        Kampong Thom, ngày <span className="px-1">{dd}</span> tháng{" "}
        <span className="px-1">{mm}</span> năm{" "}
        <span className="px-1">{yyyy}</span>
      </div>

      <div className="text-center mb-3">
        <h2 className="font-extrabold uppercase tracking-wide" style={{ fontSize: "13pt" }}>Phiếu hoàn thành công việc bảo trì</h2>
        <div className="text-[10px] italic text-slate-500 mt-0.5">(Áp dụng cho xe ôtô vận chuyển mủ)</div>
        <div className="text-xs text-slate-600 mt-1 font-semibold">Số: {record.ma_bb || "..."}</div>
      </div>

      {record.lines.map((line, idx) => {
        type F06Row = { stt: number; hang_muc: string; dvt: string; so_luong: string | number; thanh_tien: string; ghi_chu: string }
        const rows: F06Row[] = []
        let rowIdx = 1

        rows.push({
          stt: rowIdx++,
          hang_muc: line.nhien_lieu_su_dung ? `Nhiên liệu bảo dưỡng: ${line.nhien_lieu_su_dung}` : "Nhiên liệu bảo dưỡng",
          dvt: line.dvt_do || "",
          so_luong: line.so_luong_do ?? "",
          thanh_tien: "",
          ghi_chu: "",
        })

        for (const mat of line.materials) {
          rows.push({
            stt: rowIdx++,
            hang_muc: mat.ten_vat_tu,
            dvt: mat.dvt || "",
            so_luong: mat.so_luong,
            thanh_tien: mat.thanh_tien ? `${currencySymbol(mat.loai_tien || "USD")}${mat.thanh_tien.toLocaleString()}` : "",
            ghi_chu: mat.nguon === "ben_ngoai" ? "Mua ngoài" : "Kho",
          })
        }

        rows.push({
          stt: rowIdx++,
          hang_muc: "Công thợ",
          dvt: "",
          so_luong: "",
          thanh_tien: line.cong_tho > 0 ? fmtValue(line.cong_tho, line.loai_tien) : "",
          ghi_chu: "",
        })

        const matTotal = line.materials.reduce((s, m) => s + (m.thanh_tien || 0), 0)
        const grandTotal = matTotal + (line.cong_tho || 0)

        return (
          <div key={line.id} className="mb-6 text-xs leading-5">
            {record.lines.length > 1 && (
              <div className="bg-slate-100 px-3 py-1.5 font-bold text-xs uppercase mb-2 rounded">
                {idx + 1}. {line.ten_tb} ({line.ma_tb})
              </div>
            )}

            <div className="grid grid-cols-2 gap-x-8 gap-y-0.5 mb-2">
              <p>Biển số: <span className="font-mono">{line.ma_tb}</span></p>
              <p>Tên lái xe: <span>{line.ten_tai_xe || "..."}</span></p>
            </div>

            <p className="mb-2">
              Căn cứ giấy đề nghị bảo trì số:{" "}
              <span className="font-bold">{record.ma_bb || "..."}</span>,{" "}
              ngày <span className="px-1">{dd}</span> tháng{" "}
              <span className="px-1">{mm}</span> năm{" "}
              <span className="px-1">{yyyy}</span>
            </p>

            <p className="font-semibold mb-1">Kết quả bảo dưỡng bao gồm:</p>

            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  <th className="border border-slate-400 px-2 py-1 text-center w-8">STT</th>
                  <th className="border border-slate-400 px-2 py-1 text-left">Hạng mục công việc đã thực hiện</th>
                  <th className="border border-slate-400 px-2 py-1 text-center w-14">ĐVT</th>
                  <th className="border border-slate-400 px-2 py-1 text-right w-16">Số lượng</th>
                  <th className="border border-slate-400 px-2 py-1 text-right w-24">Thành tiền</th>
                  <th className="border border-slate-400 px-2 py-1 text-center w-16">Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? "bg-white" : "bg-slate-50/40"}>
                    <td className="border border-slate-300 px-2 py-1 text-center">{row.stt}</td>
                    <td className="border border-slate-300 px-2 py-1">{row.hang_muc}</td>
                    <td className="border border-slate-300 px-2 py-1 text-center">{row.dvt}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right">{row.so_luong}</td>
                    <td className="border border-slate-300 px-2 py-1 text-right">{row.thanh_tien}</td>
                    <td className="border border-slate-300 px-2 py-1 text-center">{row.ghi_chu}</td>
                  </tr>
                ))}
                <tr className="font-bold bg-slate-100">
                  <td colSpan={4} className="border border-slate-400 px-2 py-1 text-right">Cộng:</td>
                  <td className="border border-slate-400 px-2 py-1 text-right">
                    {grandTotal > 0 ? fmtValue(grandTotal, line.loai_tien) : ""}
                  </td>
                  <td className="border border-slate-400 px-2 py-1" />
                </tr>
              </tbody>
            </table>
          </div>
        )
      })}

      <SignatureRow cols={[
        { role: "BGĐ phụ trách", name: record.bgd_phu_trach },
        { role: "Nhân viên phụ trách", name: record.nv_phu_trach },
        { role: "Tài xế", name: record.lines[0]?.ten_tai_xe || null },
        { role: "Giám đốc nhà máy", name: record.giam_doc },
      ]} />

      <DocumentFooter code="KHXD-QT02-F06" />
    </div>
  )
}

// ─── Trang ảnh cho Bảo dưỡng ─────────────────────────────────────────────────

function PrintImagesPage({ record }: { record: RecordData }) {
  const commonImgs = (record.image_urls_chung || []).filter(Boolean)
  const linesWithImages = record.lines.filter((l) => (l.image_urls || []).some(Boolean))
  if (linesWithImages.length === 0 && commonImgs.length === 0) return null
  const multiDevice = linesWithImages.length > 1

  return (
    <div className="print-page font-serif">
      <CompanyHeader boPhan={record.bo_phan} />
      <div className="text-center mt-2 mb-4">
        <h2 className="text-sm font-extrabold uppercase tracking-wide">Hình ảnh bảo dưỡng</h2>
        <div className="text-xs text-slate-600 mt-1">Số: {record.ma_bb || "..."}</div>
      </div>

      {/* Ảnh chung — hiển thị đầu tiên */}
      {commonImgs.length > 0 && (
        <div className="mb-6">
          <div className="bg-amber-50 border border-amber-200 px-3 py-1.5 font-bold text-xs uppercase mb-2 rounded">
            Ảnh chung
          </div>
          <div className={`grid ${commonImgs.length <= 2 ? "grid-cols-2" : "grid-cols-3"} gap-2`}>
            {commonImgs.map((url, i) => (
              <div key={i} className="overflow-hidden rounded border border-slate-200" style={{ aspectRatio: "4/3" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Ảnh chung ${i + 1}`} className="w-full h-full object-cover" crossOrigin="anonymous" />
              </div>
            ))}
          </div>
          <div className="text-[10px] text-slate-400 text-right mt-1">{commonImgs.length} hình ảnh</div>
        </div>
      )}

      {linesWithImages.map((line) => {
        const imgs = (line.image_urls || []).filter(Boolean)
        const colClass = imgs.length <= 2 ? "grid-cols-2" : "grid-cols-3"
        return (
          <div key={line.id} className="mb-6">
            {(multiDevice || commonImgs.length > 0) && (
              <div className="bg-slate-100 px-3 py-1.5 font-bold text-xs uppercase mb-2 rounded">
                {line.ten_tb} ({line.ma_tb})
              </div>
            )}
            <div className={`grid ${colClass} gap-2`}>
              {imgs.map((url, i) => (
                <div key={i} className="overflow-hidden rounded border border-slate-200" style={{ aspectRatio: "4/3" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`Ảnh ${i + 1}`} className="w-full h-full object-cover" crossOrigin="anonymous" />
                </div>
              ))}
            </div>
            <div className="text-[10px] text-slate-400 text-right mt-1">{imgs.length} hình ảnh</div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Wrapper: F03 + F15 + Ảnh (Bảo dưỡng thiết bị chế biến) ─────────────────

function PrintBaoDuong({ record, qrUrl, staffMap }: { record: RecordData; qrUrl: string; staffMap: Map<string, string> }) {
  const hasImages = record.lines.some((l) => (l.image_urls || []).some(Boolean)) || (record.image_urls_chung || []).some(Boolean)
  return (
    <div className="font-serif">
      <PrintF03 record={record} qrUrl={qrUrl} />
      <div className="print:page-break-before-always mt-6 pt-6" />
      <PrintF15BaoDuong record={record} qrUrl={qrUrl} staffMap={staffMap} />
      {hasImages && (
        <>
          <div className="print:page-break-before-always mt-6 pt-6" />
          <PrintImagesPage record={record} />
        </>
      )}
    </div>
  )
}

// ─── Wrapper: F03 + F15 + F06 + Ảnh (Bảo dưỡng Đội xe) ─────────────────────

function PrintBaoDuongXe({ record, qrUrl, staffMap }: { record: RecordData; qrUrl: string; staffMap: Map<string, string> }) {
  const hasImages = record.lines.some((l) => (l.image_urls || []).some(Boolean)) || (record.image_urls_chung || []).some(Boolean)
  return (
    <div className="font-serif">
      <PrintF03 record={record} qrUrl={qrUrl} />
      <div className="print:page-break-before-always mt-6 pt-6" />
      <PrintF15BaoDuong record={record} qrUrl={qrUrl} staffMap={staffMap} />
      <div className="print:page-break-before-always mt-6 pt-6" />
      <PrintF06 record={record} qrUrl={qrUrl} />
      {hasImages && (
        <>
          <div className="print:page-break-before-always mt-6 pt-6" />
          <PrintImagesPage record={record} />
        </>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MaintenancePrintPage() {
  const params = useSearchParams()
  const printType = (params.get("type") || "su_co") as PrintType
  const recordId = params.get("record_id") || ""
  const assetId = params.get("asset_id") || ""
  const assetIdsParam = params.get("asset_ids") || ""   // comma-separated for multi-device ly_lich
  const filterFrom = params.get("from") || ""
  const filterTo = params.get("to") || ""

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [record, setRecord] = useState<RecordData | null>(null)
  const [staffMap, setStaffMap] = useState<Map<string, string>>(new Map())
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([])
  const [assetInfo, setAssetInfo] = useState<AssetInfo | null>(null)
  const [multiAssets, setMultiAssets] = useState<{ info: AssetInfo; rows: HistoryRow[] }[]>([])

  const qrUrl = useMemo(() => {
    if (!recordId || typeof window === "undefined") return ""
    return `${window.location.origin}/dashboard/maintenance/records/${recordId}`
  }, [recordId])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        if (printType === "ly_lich") {
          // Two-step query helper for one asset
          const fetchRowsForAsset = async (aid: string, factoryId?: string): Promise<HistoryRow[]> => {
            let recQ = supabase
              .from("maintenance_records")
              .select("id, ma_bb, hang_muc, ngay, nguoi_thuc_hien, nv_phu_trach, phu_trach_bao_tri")
              .eq("trang_thai", "da_duyet")
              .order("ngay", { ascending: true })
            if (factoryId) recQ = recQ.eq("factory_id", factoryId)
            if (filterFrom) recQ = recQ.gte("ngay", filterFrom)
            if (filterTo) recQ = recQ.lte("ngay", filterTo)
            const { data: recs } = await recQ
            const recList = (recs || []) as {
              id: string; ma_bb: string | null; hang_muc: string; ngay: string
              nguoi_thuc_hien: string[]; nv_phu_trach: string | null; phu_trach_bao_tri: string | null
            }[]
            if (recList.length === 0) return []
            const recIds = recList.map((r) => r.id)
            const { data: linesData } = await supabase
              .from("maintenance_record_lines")
              .select("id, record_id, asset_id, ten_tb, ma_tb, noi_dung, cac_khac_phuc, chi_phi_dk, loai_tien, cong_tho")
              .in("record_id", recIds)
              .eq("asset_id", aid)
            const recMap = new Map(recList.map((r) => [r.id, r]))
            const mapped: HistoryRow[] = ((linesData || []) as {
              id: string; record_id: string; asset_id: string | null
              ten_tb: string; ma_tb: string; noi_dung: string | null; cac_khac_phuc: string | null
              chi_phi_dk: number; loai_tien: string; cong_tho: number
            }[]).map((d) => {
              const rec = recMap.get(d.record_id)!
              return {
                ngay: rec.ngay, ma_bb: rec.ma_bb, hang_muc: rec.hang_muc,
                ten_tb: d.ten_tb, ma_tb: d.ma_tb, noi_dung: d.noi_dung, cac_khac_phuc: d.cac_khac_phuc,
                chi_phi_dk: d.chi_phi_dk || 0, loai_tien: d.loai_tien || "USD", cong_tho: d.cong_tho || 0,
                nguoi_thuc_hien: rec.nguoi_thuc_hien || [], nv_phu_trach: rec.nv_phu_trach, phu_trach_bao_tri: rec.phu_trach_bao_tri,
              }
            })
            mapped.sort((a, b) => a.ngay.localeCompare(b.ngay))
            return mapped
          }

          // Multi-device: comma-separated asset_ids
          const assetIdList = assetIdsParam ? assetIdsParam.split(",").filter(Boolean) : []

          if (assetIdList.length > 0) {
            const { data: assetsData } = await supabase
              .from("maintenance_assets")
              .select("id, ma_tb, ten_tb, bo_phan, loai, nam_sd, bien_so, mo_ta")
              .in("id", assetIdList)
            const assetMap = new Map(((assetsData || []) as (AssetInfo & { id: string })[]).map((a) => [a.id, a]))
            const result: { info: AssetInfo; rows: HistoryRow[] }[] = []
            for (const aid of assetIdList) {
              const info = assetMap.get(aid)
              if (!info) continue
              const rows = await fetchRowsForAsset(aid)
              result.push({ info, rows })
            }
            setMultiAssets(result)
          } else if (assetId) {
            const { data: asset } = await supabase
              .from("maintenance_assets")
              .select("ma_tb, ten_tb, bo_phan, loai, nam_sd, bien_so, mo_ta")
              .eq("id", assetId)
              .single()
            setAssetInfo(asset as AssetInfo | null)
            const rows = await fetchRowsForAsset(assetId)
            setHistoryRows(rows)
          }
        } else {
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
            lines.push({ ...(ln as Omit<LineData, "materials">), materials: (mats || []) as MaterialRow[] })
          }
          const recordData = { ...(rec as Omit<RecordData, "lines">), lines }
          setRecord(recordData)

          // Build name → chuc_vu map for accurate role display in print templates
          const { data: staffData } = await supabase
            .from("maintenance_staff")
            .select("ten, chuc_vu")
            .eq("factory_id", (rec as { factory_id: string }).factory_id)
            .eq("active", true)
          const map = new Map<string, string>()
          for (const s of (staffData || []) as { ten: string; chuc_vu: string | null }[]) {
            if (s.ten && s.chuc_vu) map.set(s.ten, s.chuc_vu)
          }
          setStaffMap(map)
        }
      } catch {
        setError("Lỗi tải dữ liệu")
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [printType, recordId, assetId, assetIdsParam, filterFrom, filterTo])

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
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Tinos:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet" />
      <style>{`
        @media print {
          .no-print { display: none !important; }
          @page { margin: 15mm; size: A4 portrait; }
          body { font-size: 12pt; }
          .print\\:page-break-before-always { page-break-before: always; }
        }
        .print-page {
          max-width: 800px; margin: 0 auto; padding: 16px;
          font-family: 'Tinos', 'Times New Roman', Times, serif !important;
        }
        @media screen {
          body { background: #f1f5f9; }
          .print-page { background: white; box-shadow: 0 2px 12px rgba(0,0,0,.12); border-radius: 8px; padding: 40px 48px; margin-bottom: 24px; }
        }
      `}</style>

      <div className="no-print fixed top-0 left-0 right-0 z-50 bg-white border-b border-slate-200 shadow-sm px-6 py-2 flex items-center gap-4">
        <Link href={backHref} className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900">
          <ArrowLeft size={14} /> Quay lại
        </Link>
        <div className="flex-1 text-center text-sm font-bold text-slate-700">
          {printType === "su_co" && "Biên bản kiểm tra sự cố (F13)"}
          {printType === "de_nghi" && "Giấy đề nghị (F10) + Biên bản nghiệm thu (F15)"}
          {printType === "su_co_nho" && "In biên bản sửa chữa (F13 + F10 + F15 + Ảnh)"}
          {printType === "ly_lich" && "Lý lịch thiết bị (F01)"}
          {printType === "bao_duong" && "Bảo dưỡng thiết bị (F03 + F15 + Ảnh)"}
          {printType === "bao_duong_xe" && "Bảo dưỡng xe (F03 + F15 + F06 + Ảnh)"}
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-1.5 bg-slate-700 text-white text-sm font-bold rounded-lg hover:bg-slate-800"
        >
          <Printer size={14} /> In
        </button>
      </div>

      <div className="pt-12">
        {loading && <div className="print-page text-center py-16 text-slate-400">Đang tải...</div>}
        {error && <div className="print-page text-center py-16 text-red-500">{error}</div>}

        {!loading && !error && printType !== "ly_lich" && record && (
          <>
            {printType === "su_co" && <PrintSuCo record={record} qrUrl={qrUrl} staffMap={staffMap} />}
            {printType === "de_nghi" && <PrintDeNghi record={record} qrUrl={qrUrl} staffMap={staffMap} />}
            {printType === "su_co_nho" && <PrintSuCoNho record={record} qrUrl={qrUrl} staffMap={staffMap} />}
            {printType === "bao_duong" && <PrintBaoDuong record={record} qrUrl={qrUrl} staffMap={staffMap} />}
            {printType === "bao_duong_xe" && <PrintBaoDuongXe record={record} qrUrl={qrUrl} staffMap={staffMap} />}
          </>
        )}

        {!loading && !error && printType === "ly_lich" && (
          <>
            {multiAssets.length > 0 ? (
              multiAssets.map((item, idx) => (
                <div key={item.info.ma_tb}>
                  {idx > 0 && (
                    <div className="print:page-break-before-always mt-4 pt-4" />
                  )}
                  <PrintLyLich rows={item.rows} asset={item.info} filterFrom={filterFrom} filterTo={filterTo} />
                </div>
              ))
            ) : (
              <PrintLyLich rows={historyRows} asset={assetInfo} filterFrom={filterFrom} filterTo={filterTo} />
            )}
          </>
        )}
      </div>
    </>
  )
}

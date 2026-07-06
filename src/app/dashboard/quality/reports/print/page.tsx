"use client"

import { Fragment, Suspense, useEffect, useState, type CSSProperties } from "react"
import { useSearchParams } from "next/navigation"
import {
  Bar, CartesianGrid, ComposedChart, LabelList, Line, LineChart, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import {
  buildCriterionSpcReport,
  buildMonthlyQualityReport,
  chiTieuDisplayLabel,
  NHOM_LABEL,
  type ChiTieuKey,
  type CriterionSpcReportData,
  type MonthlyQualityReportData,
} from "@/lib/quality-stats"

function CompanyHeader() {
  return (
    <div className="text-left mb-1">
      <div className="font-bold uppercase" style={{ fontSize: "12px", color: "#000000" }}>
        Công ty TNHH PTCS Phước Hòa Kampongthom
      </div>
      <div className="font-bold uppercase" style={{ fontSize: "12px", color: "#000000" }}>
        Nhà máy chế biến Phước Hòa Kampongthom
      </div>
    </div>
  )
}

/** Ngăn trình duyệt cắt ngang khối này khi ngắt trang in — dùng cho chữ ký để tên không rơi sang trang khác với chức vụ. */
const avoidBreakStyle: CSSProperties = { breakInside: "avoid", pageBreakInside: "avoid" }

function SignatureRow({ cols }: { cols: { role: string; name?: string }[] }) {
  return (
    <div
      className="grid gap-4 mt-8 text-center text-xs"
      style={{ gridTemplateColumns: `repeat(${cols.length}, 1fr)`, ...avoidBreakStyle }}
    >
      {cols.map((col, i) => (
        <div key={i}>
          <div className="font-bold text-slate-700 mb-1">{col.role}</div>
          <div className="h-16" />
          <div className="pt-1">
            <div className="font-semibold text-slate-700 min-h-[1.25rem]">{col.name || " "}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Chữ ký đơn, canh góc phải trang — dùng cho các trang biểu đồ thống kê chỉ có 1 người ký (người lập). */
function SignatureRight({ role, name }: { role: string; name?: string }) {
  return (
    <div className="flex justify-end mt-8" style={avoidBreakStyle}>
      <div className="text-center text-xs" style={{ width: 180 }}>
        <div className="font-bold text-slate-700 mb-1">{role}</div>
        <div className="h-16" />
        <div className="pt-1">
          <div className="font-semibold text-slate-700 min-h-[1.25rem]">{name || " "}</div>
        </div>
      </div>
    </div>
  )
}

/** pageBreak=false cho trang đầu tiên của tài liệu (không cần ngắt trang trước nó). */
function pageBreakStyle(pageBreak: boolean): CSSProperties | undefined {
  return pageBreak ? { pageBreakBefore: "always" } : undefined
}

function fmtKl(v: number) {
  return v.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 3 })
}

function fmtPct(v: number | null) {
  return v == null ? "—" : `${v.toFixed(2)}%`
}

function MonthlyReportSection({ data, giamDoc, nguoiThucHien, pageBreak }: { data: MonthlyQualityReportData; giamDoc: string; nguoiThucHien: string; pageBreak: boolean }) {
  const groupsPresent = (["mu_tap", "mu_nuoc_cv", "mu_nuoc_khac"] as const).filter((g) =>
    data.rows.some((r) => r.nhom === g),
  )
  const monthLabel = `THÁNG ${data.thang} NĂM ${data.nam}`

  return (
    <div className="report-page" style={pageBreakStyle(pageBreak)}>
      <CompanyHeader />
      <div className="text-center mb-4">
        <div className="font-bold" style={{ fontSize: "14px" }}>BẢNG THỐNG KÊ CHẤT LƯỢNG</div>
        <div className="italic font-semibold" style={{ fontSize: "12px" }}>{monthLabel}</div>
      </div>

      {groupsPresent.map((nhom) => {
        const rowsInGroup = data.rows.filter((r) => r.nhom === nhom)
        const sanPhamInGroup = data.sanPhamList.filter((sp) => rowsInGroup.some((r) => r.bySanPham[sp]))
        if (sanPhamInGroup.length === 0) return null
        return (
          <div key={nhom} className="mb-4 overflow-x-auto">
            <table className="w-full border-collapse text-[10px]" style={{ border: "1px solid #000", tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <td colSpan={1 + sanPhamInGroup.length * 4} className="text-center font-bold py-1" style={{ border: "1px solid #000" }}>
                    {NHOM_LABEL[nhom]}
                  </td>
                </tr>
                <tr>
                  <td rowSpan={3} className="font-bold text-center px-2" style={{ border: "1px solid #000" }}>CHỈ TIÊU</td>
                  <td colSpan={sanPhamInGroup.length * 2} className="text-center font-bold" style={{ border: "1px solid #000" }}>Tháng</td>
                  <td colSpan={sanPhamInGroup.length * 2} className="text-center font-bold" style={{ border: "1px solid #000" }}>Lũy kế năm</td>
                </tr>
                <tr>
                  {[...sanPhamInGroup, ...sanPhamInGroup].map((sp, i) => (
                    <td key={i} colSpan={2} className="text-center font-bold" style={{ border: "1px solid #000" }}>CSR{sp}</td>
                  ))}
                </tr>
                <tr>
                  {[...sanPhamInGroup, ...sanPhamInGroup].map((sp, i) => (
                    <Fragment key={i}>
                      <td className="text-center font-bold px-1" style={{ border: "1px solid #000" }}>KL (tấn)</td>
                      <td className="text-center font-bold px-1" style={{ border: "1px solid #000" }}>Tỷ lệ (%)</td>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowsInGroup.map((row) => (
                  <tr key={`${row.chiTieu}-${row.nhom}`}>
                    <td className="px-2 py-1" style={{ border: "1px solid #000" }}>
                      - {row.label}{row.coMucTieu ? ` (MT ${row.tyLeMucTieu}%)` : ""}
                    </td>
                    {sanPhamInGroup.map((sp) => {
                      const cell = row.bySanPham[sp]?.thang
                      return (
                        <Fragment key={`${sp}-t`}>
                          <td className="text-right px-1" style={{ border: "1px solid #000" }}>{cell ? fmtKl(cell.kl) : ""}</td>
                          <td className="text-right px-1 font-bold" style={{ border: "1px solid #000" }}>{cell ? fmtPct(cell.tyLe) : ""}</td>
                        </Fragment>
                      )
                    })}
                    {sanPhamInGroup.map((sp) => {
                      const cell = row.bySanPham[sp]?.luyKe
                      return (
                        <Fragment key={`${sp}-l`}>
                          <td className="text-right px-1" style={{ border: "1px solid #000" }}>{cell ? fmtKl(cell.kl) : ""}</td>
                          <td className="text-right px-1 font-bold" style={{ border: "1px solid #000" }}>{cell ? fmtPct(cell.tyLe) : ""}</td>
                        </Fragment>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      })}

      <table className="w-full border-collapse text-[11px] mb-6" style={{ border: "1px solid #000" }}>
        <tbody>
          <tr>
            <td className="font-bold px-2 py-1" style={{ border: "1px solid #000" }}>TỔNG SẢN PHẨM SX D/C MỦ TẠP</td>
            <td className="text-right px-2" style={{ border: "1px solid #000" }}>{fmtKl(data.tongTheoNhom.mu_tap.thang)}</td>
            <td className="text-right px-2" style={{ border: "1px solid #000" }}>{fmtKl(data.tongTheoNhom.mu_tap.luyKe)}</td>
          </tr>
          <tr>
            <td className="font-bold px-2 py-1" style={{ border: "1px solid #000" }}>TỔNG SẢN PHẨM SX D/C MỦ NƯỚC</td>
            <td className="text-right px-2" style={{ border: "1px solid #000" }}>{fmtKl(data.tongTheoNhom.mu_nuoc_cv.thang + data.tongTheoNhom.mu_nuoc_khac.thang)}</td>
            <td className="text-right px-2" style={{ border: "1px solid #000" }}>{fmtKl(data.tongTheoNhom.mu_nuoc_cv.luyKe + data.tongTheoNhom.mu_nuoc_khac.luyKe)}</td>
          </tr>
          <tr>
            <td className="font-bold px-2 py-1" style={{ border: "1px solid #000" }}>TỔNG SẢN PHẨM TOÀN NHÀ MÁY</td>
            <td className="text-right px-2 font-bold" style={{ border: "1px solid #000" }}>{fmtKl(data.tongToanNhaMay.thang)}</td>
            <td className="text-right px-2 font-bold" style={{ border: "1px solid #000" }}>{fmtKl(data.tongToanNhaMay.luyKe)}</td>
          </tr>
          <tr>
            <td className="font-bold px-2 py-1" style={{ border: "1px solid #000" }}>TỈ LỆ ĐẠT TIÊU CHUẨN TOÀN NHÀ MÁY</td>
            <td className="text-right px-2 font-bold" style={{ border: "1px solid #000" }}>{fmtPct(data.tyLeDatToanNhaMay.thang)}</td>
            <td className="text-right px-2 font-bold" style={{ border: "1px solid #000" }}>{fmtPct(data.tyLeDatToanNhaMay.luyKe)}</td>
          </tr>
        </tbody>
      </table>

      <SignatureRow cols={[{ role: "GIÁM ĐỐC NHÀ MÁY", name: giamDoc }, { role: "LẬP BẢNG", name: nguoiThucHien }]} />
    </div>
  )
}

function fmt3(v: number | null | undefined) {
  return v == null ? "—" : v.toFixed(3)
}

function CriterionHeader({ data }: { data: CriterionSpcReportData }) {
  const label = chiTieuDisplayLabel(data.chiTieu, data.sanPham)
  return (
    <div className="text-center mb-3">
      <div className="font-bold" style={{ fontSize: "13px" }}>CHỈ TIÊU {label.toUpperCase()} CSR{data.sanPham} NÔNG TRƯỜNG</div>
      <div className="italic font-semibold" style={{ fontSize: "12px" }}>THÁNG {data.thang} NĂM {data.nam}</div>
    </div>
  )
}

/** Trang 1 / chỉ tiêu: bảng dữ liệu mẫu theo ngày + bảng thống kê (không có biểu đồ/ký tên). */
function CriterionDataTablePage({ data, pageBreak }: { data: CriterionSpcReportData; pageBreak: boolean }) {
  const cols = data.maxSamplesInDay || 6
  const cellStyle = { border: "1px solid #000" } as const

  return (
    <div className="report-page" style={pageBreakStyle(pageBreak)}>
      <CompanyHeader />
      <CriterionHeader data={data} />

      <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[8px] mb-2" style={{ ...cellStyle, tableLayout: "fixed" }}>
        <thead>
          <tr>
            <td rowSpan={2} style={cellStyle} className="px-1 font-bold text-center">Ngày</td>
            <td colSpan={cols} style={cellStyle} className="text-center font-bold">MẪU</td>
            <td rowSpan={2} style={cellStyle} className="px-1 font-bold text-center">X</td>
            <td rowSpan={2} style={cellStyle} className="px-1 font-bold text-center">R</td>
            <td rowSpan={2} style={cellStyle} className="px-1 font-bold text-center">Số lô trong ngày</td>
          </tr>
          <tr>
            {Array.from({ length: cols }).map((_, i) => <td key={i} style={cellStyle} className="text-center">{i + 1}</td>)}
          </tr>
        </thead>
        <tbody>
          {data.dailyRows.map((row) => (
            <tr key={row.ngayIso}>
              <td style={cellStyle} className="px-1">{row.ngayLabel}</td>
              {Array.from({ length: cols }).map((_, i) => (
                <td key={i} style={cellStyle} className="text-right px-1">{row.values[i] != null ? (row.values[i] as number).toFixed(3) : ""}</td>
              ))}
              <td style={cellStyle} className="text-right px-1 font-bold">{fmt3(row.xBar)}</td>
              <td style={cellStyle} className="text-right px-1">{fmt3(row.range)}</td>
              <td style={cellStyle} className="text-center px-1">{row.soLo || ""}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td style={cellStyle} className="px-1">Trung bình</td>
            <td colSpan={cols} style={cellStyle}></td>
            <td style={cellStyle} className="text-right px-1">{fmt3(data.xBarOverall)}</td>
            <td style={cellStyle} className="text-right px-1">{fmt3(data.rOverall)}</td>
            <td style={cellStyle}></td>
          </tr>
        </tbody>
      </table>
      </div>

      <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[8px] mb-4" style={{ ...cellStyle, tableLayout: "fixed" }}>
        <thead>
          <tr>
            {["STD", "Mean", ...(data.overall.usl != null ? ["USL"] : []), ...(data.overall.lsl != null ? ["LSL"] : []), "UCL", "LCL", "Min", "Max", "Cp", "Cpk", "Range"].map((h) => (
              <td key={h} style={cellStyle} className="text-center font-bold px-1">{h}</td>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={cellStyle} className="text-center px-1">{fmt3(data.overall.sd)}</td>
            <td style={cellStyle} className="text-center px-1">{fmt3(data.overall.mean)}</td>
            {data.overall.usl != null && <td style={cellStyle} className="text-center px-1">{fmt3(data.overall.usl)}</td>}
            {data.overall.lsl != null && <td style={cellStyle} className="text-center px-1">{fmt3(data.overall.lsl)}</td>}
            <td style={cellStyle} className="text-center px-1">{fmt3(data.overall.ucl)}</td>
            <td style={cellStyle} className="text-center px-1">{fmt3(data.overall.lcl)}</td>
            <td style={cellStyle} className="text-center px-1">{fmt3(data.overall.min)}</td>
            <td style={cellStyle} className="text-center px-1">{fmt3(data.overall.max)}</td>
            <td style={cellStyle} className="text-center px-1">{data.overall.cp != null ? data.overall.cp.toFixed(3) : "—"}</td>
            <td style={cellStyle} className="text-center px-1 font-bold">{data.overall.cpk != null ? data.overall.cpk.toFixed(3) : "—"}</td>
            <td style={cellStyle} className="text-center px-1">{fmt3(data.overall.range)}</td>
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  )
}

/** Mật độ Gauss tại x, scale theo count (n × độ rộng bin) để overlay cùng đơn vị với chiều cao cột histogram. */
function normalDensityScaled(x: number, mean: number, sd: number, n: number, binWidth: number): number {
  if (sd <= 0 || n <= 0) return 0
  const density = (1 / (sd * Math.sqrt(2 * Math.PI))) * Math.exp(-((x - mean) ** 2) / (2 * sd * sd))
  return density * n * binWidth
}

/** Trang 2 / chỉ tiêu: biểu đồ phân bố (histogram + đường cong chuẩn), biểu đồ kiểm soát X/R, nhận xét, ký tên. */
function CriterionChartsPage({ data, nguoiThucHien, pageBreak }: { data: CriterionSpcReportData; nguoiThucHien: string; pageBreak: boolean }) {
  const xChartData = data.dailyRows.map((r, i) => ({ idx: i + 1, x: r.xBar }))
  const rChartData = data.dailyRows.map((r, i) => ({ idx: i + 1, r: r.range }))

  // 1 mảng data dùng chung cho cả Bar (histogram) và Line (đường cong chuẩn) — mỗi bin
  // vừa có "count" thật vừa có "curve" (mật độ chuẩn tại đúng điểm giữa bin đó), tránh
  // dùng prop `data` riêng từng series (kiểu recharts hiện tại không hỗ trợ prop này).
  const binWidth = data.histogram.length ? data.histogram[0].to - data.histogram[0].from : 1
  const distChartData = data.histogram.map((b) => {
    const x = (b.from + b.to) / 2
    return { x, count: b.count, curve: normalDensityScaled(x, data.overall.mean, data.overall.sd, data.allValues.length, binWidth) }
  })
  const domainMin = data.histogram.length ? data.histogram[0].from : data.overall.min
  const domainMax = data.histogram.length ? data.histogram[data.histogram.length - 1].to : data.overall.max
  const yMax = Math.max(1, ...distChartData.map((p) => p.count), ...distChartData.map((p) => p.curve))
  const barSize = Math.max(10, 700 / (distChartData.length || 1))

  return (
    <div className="report-page" style={pageBreakStyle(pageBreak)}>
      <CompanyHeader />
      <CriterionHeader data={data} />

      <div className="font-bold mb-1" style={{ fontSize: "11px" }}>1. BIỂU ĐỒ PHÂN BỐ</div>
      <div style={{ height: 230 }} className="mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={distChartData} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" dataKey="x" domain={[domainMin, domainMax]} tick={{ fontSize: 8 }} />
            <YAxis type="number" domain={[0, Math.ceil(yMax * 1.3)]} tick={{ fontSize: 8 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#38bdf8" stroke="#0284c7" strokeWidth={1} barSize={barSize} isAnimationActive={false} radius={[2, 2, 0, 0]}>
              <LabelList dataKey="count" position="top" formatter={(v: string | number | boolean | null | undefined) => (v ? String(v) : "")} style={{ fontSize: 9, fontWeight: 700, fill: "#0f172a" }} />
            </Bar>
            <Line dataKey="curve" stroke="#f97316" strokeWidth={2} dot={false} type="monotone" isAnimationActive={false} />
            {data.overall.usl != null && (
              <ReferenceLine x={data.overall.usl} stroke="#ef4444" strokeDasharray="4 2" ifOverflow="extendDomain" label={{ value: `USL ${fmt3(data.overall.usl)}`, fontSize: 9, fill: "#b91c1c" }} />
            )}
            {data.overall.lsl != null && (
              <ReferenceLine x={data.overall.lsl} stroke="#ef4444" strokeDasharray="4 2" ifOverflow="extendDomain" label={{ value: `LSL ${fmt3(data.overall.lsl)}`, fontSize: 9, fill: "#b91c1c" }} />
            )}
            <ReferenceLine x={data.overall.ucl} stroke="#f59e0b" strokeDasharray="4 2" ifOverflow="extendDomain" label={{ value: `UCL ${fmt3(data.overall.ucl)}`, fontSize: 9, fill: "#b45309" }} />
            <ReferenceLine x={data.overall.lcl} stroke="#f59e0b" strokeDasharray="4 2" ifOverflow="extendDomain" label={{ value: `LCL ${fmt3(data.overall.lcl)}`, fontSize: 9, fill: "#b45309" }} />
            {data.targetValue != null && (
              <ReferenceLine x={data.targetValue} stroke="#3b82f6" strokeDasharray="4 2" ifOverflow="extendDomain" label={{ value: `Target ${fmt3(data.targetValue)}`, fontSize: 9, fill: "#1d4ed8" }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="font-bold mb-1" style={{ fontSize: "11px" }}>2. BIỂU ĐỒ KIỂM SOÁT</div>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-center font-bold" style={{ fontSize: "10px" }}>BIỂU ĐỒ X</div>
          <div style={{ height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={xChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="idx" tick={{ fontSize: 8 }} />
                <YAxis tick={{ fontSize: 8 }} domain={["auto", "auto"]} />
                <Tooltip />
                <ReferenceLine y={data.overall.mean} stroke="#0f766e" strokeDasharray="4 2" ifOverflow="extendDomain" label={{ value: `CL ${fmt3(data.overall.mean)}`, fontSize: 9 }} />
                <ReferenceLine y={data.overall.ucl} stroke="#f59e0b" strokeDasharray="4 2" ifOverflow="extendDomain" label={{ value: `UCL ${fmt3(data.overall.ucl)}`, fontSize: 9, fill: "#b45309" }} />
                <ReferenceLine y={data.overall.lcl} stroke="#f59e0b" strokeDasharray="4 2" ifOverflow="extendDomain" label={{ value: `LCL ${fmt3(data.overall.lcl)}`, fontSize: 9, fill: "#b45309" }} />
                {data.overall.usl != null && <ReferenceLine y={data.overall.usl} stroke="#dc2626" ifOverflow="extendDomain" label={{ value: `USL ${fmt3(data.overall.usl)}`, fontSize: 9 }} />}
                {data.overall.lsl != null && <ReferenceLine y={data.overall.lsl} stroke="#dc2626" ifOverflow="extendDomain" label={{ value: `LSL ${fmt3(data.overall.lsl)}`, fontSize: 9 }} />}
                <Line type="monotone" dataKey="x" stroke="#2563eb" dot={{ r: 2 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div>
          <div className="text-center font-bold" style={{ fontSize: "10px" }}>BIỂU ĐỒ R</div>
          <div style={{ height: 170 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="idx" tick={{ fontSize: 8 }} />
                <YAxis tick={{ fontSize: 8 }} domain={[0, "auto"]} />
                <Tooltip />
                <ReferenceLine y={data.rControl.center} stroke="#0f766e" strokeDasharray="4 2" ifOverflow="extendDomain" label={{ value: `R̄ ${fmt3(data.rControl.center)}`, fontSize: 9 }} />
                <ReferenceLine y={data.rControl.ucl} stroke="#dc2626" ifOverflow="extendDomain" label={{ value: `UCL ${fmt3(data.rControl.ucl)}`, fontSize: 9 }} />
                <ReferenceLine y={data.rControl.lcl} stroke="#dc2626" ifOverflow="extendDomain" label={{ value: `LCL ${fmt3(data.rControl.lcl)}`, fontSize: 9 }} />
                <Line type="monotone" dataKey="r" stroke="#ea580c" dot={{ r: 2 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {data.nhanXet && (
        <div className="mb-6 text-sm">
          <span className="font-bold">Nhận xét: </span>
          <span className="italic">{data.nhanXet}</span>
        </div>
      )}

      <SignatureRight role="Nhân viên kỹ thuật" name={nguoiThucHien} />
    </div>
  )
}

function QualityReportsPrintInner() {
  const params = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [monthly, setMonthly] = useState<MonthlyQualityReportData | null>(null)
  const [spcList, setSpcList] = useState<CriterionSpcReportData[]>([])

  const factoryId = params.get("factoryId") || ""
  const nam = Number(params.get("nam")) || new Date().getFullYear()
  const thang = Number(params.get("thang")) || new Date().getMonth() + 1
  const sanPhamList = (params.get("sanPham") || "").split(",").filter(Boolean)
  const tieuChuan = params.get("tieuChuan") || "TCCS 112:2022"
  const chiTieuList = (params.get("chiTieu") || "").split(",").filter(Boolean) as ChiTieuKey[]
  const includeSummary = params.get("summary") === "1"
  const spcCombos = (params.get("spc") || "").split(",").filter(Boolean)
  const giamDoc = params.get("giamDoc") || ""
  const nguoiThucHien = params.get("nguoiThucHien") || ""

  useEffect(() => {
    if (!factoryId) { setError("Thiếu thông tin nhà máy"); setLoading(false); return }
    const load = async () => {
      try {
        if (includeSummary) {
          const data = await buildMonthlyQualityReport({ factoryId, nam, thang, sanPhamList, tieuChuan, chiTieuList })
          setMonthly(data)
        }
        if (spcCombos.length > 0) {
          const results = await Promise.all(
            spcCombos.map((combo) => {
              const [sanPham, chiTieu] = combo.split("|")
              return buildCriterionSpcReport({ factoryId, nam, thang, sanPham, chiTieu: chiTieu as ChiTieuKey, tieuChuan })
            }),
          )
          setSpcList(results)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Không tải được dữ liệu báo cáo")
      } finally {
        setLoading(false)
      }
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryId, nam, thang])

  useEffect(() => {
    if (!loading && !error) {
      const t = setTimeout(() => window.print(), 700)
      return () => clearTimeout(t)
    }
  }, [loading, error])

  if (loading) return <div className="p-12 text-center text-slate-400">Đang tải báo cáo...</div>
  if (error) return <div className="p-12 text-center text-red-500">{error}</div>

  return (
    <div className="bg-slate-100 min-h-screen py-4 sm:py-6 print:bg-white print:py-0">
      <div className="no-print fixed top-2 right-2 sm:top-4 sm:right-4 z-50">
        <button onClick={() => window.print()} className="px-3 py-1.5 sm:px-4 sm:py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm sm:text-base font-bold rounded-xl shadow-lg">In</button>
      </div>

      <div className="print-page bg-white mx-auto w-full p-3 sm:p-8 print:p-2 shadow-lg print:shadow-none" style={{ maxWidth: "780px" }}>
        {monthly && <MonthlyReportSection data={monthly} giamDoc={giamDoc} nguoiThucHien={nguoiThucHien} pageBreak={false} />}
        {spcList.map((d, i) => (
          <Fragment key={`${d.sanPham}-${d.chiTieu}`}>
            <CriterionDataTablePage data={d} pageBreak={!(!monthly && i === 0)} />
            <CriterionChartsPage data={d} nguoiThucHien={nguoiThucHien} pageBreak />
          </Fragment>
        ))}
        {!monthly && spcList.length === 0 && <div className="text-center text-slate-400 py-12">Không có phần báo cáo nào được chọn.</div>}
      </div>

      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          @page { size: A4 portrait; margin: 10mm 8mm; }
          body { font-size: 10pt; }
        }
      `}</style>
    </div>
  )
}

export default function QualityReportsPrintPage() {
  return (
    <Suspense fallback={<div className="p-12 text-center text-slate-400">Đang tải...</div>}>
      <QualityReportsPrintInner />
    </Suspense>
  )
}

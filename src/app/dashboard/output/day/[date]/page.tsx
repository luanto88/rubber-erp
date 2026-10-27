"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useParams, useRouter } from "next/navigation"
import { CalendarDays, Download, Droplet, FileText, Pencil, Plus, Table2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { formatDateDisplay } from "@/lib/date-utils"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { buildOutputDayPdfBytes, downloadOutputDayPdf } from "@/lib/output-pdf"
import { moduleThemeClass } from "@/app/dashboard/_components/doc-ui/module-theme"
import { PageBackgroundMotif } from "@/app/dashboard/_components/page-background-motif"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { DetailSplitLayout } from "@/app/dashboard/_components/doc-ui/detail-split-layout"
import { DetailPageHeader, HeaderButton } from "@/app/dashboard/_components/doc-ui/detail-page-header"
import { HeaderQr } from "@/app/dashboard/_components/doc-ui/header-qr"
import { DocViewer } from "@/app/dashboard/_components/doc-ui/doc-viewer"
import { useIsDesktop } from "@/app/dashboard/_components/doc-ui/use-is-desktop"
import { InspectorCard, MetaList, MetaRow, StatusSummaryBar } from "@/app/dashboard/_components/doc-ui/inspector-card"
import { SignActionBox, type SignAction } from "@/app/dashboard/_components/doc-ui/sign-action-box"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { OUTPUT_MATERIALS, compareSoXe, totalKho, totalTuoi, type ProductionRecord } from "../../_components/output-types"
import { OutputSourceCell, OutputWarnBadge } from "../../_components/output-badges"

/**
 * Trang chi tiết sản lượng theo NGÀY (rule 29 mục C, U9b) — chỉ XEM.
 * Cột trái nhúng PDF ngày dựng trong trình duyệt; Thêm / Sửa / Xóa dòng vẫn làm ở danh sách
 * (`/dashboard/output?add=<ngày>` / `?day=<ngày>`) với đúng quyền hiện có.
 */

const LIST_HREF = "/dashboard/output"
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function fmtKg(n: number) {
  return n.toLocaleString("vi-VN", { maximumFractionDigits: 0 })
}

function materialSummary(record: ProductionRecord) {
  return OUTPUT_MATERIALS.map((def) => {
    const tuoi = Number(record[def.tuoiKey] ?? 0)
    const kho = Number(record[def.khoKey] ?? 0)
    if (tuoi <= 0 && kho <= 0) return null
    return `${def.shortLabel} ${fmtKg(tuoi)} / ${fmtKg(kho)}`
  }).filter((v): v is string => Boolean(v))
}

function groupKey(record: ProductionRecord) {
  if (record.ma_nguon === "m" || record.doi === 0) return "m"
  if (record.ma_nguon && record.ma_nguon !== "cs") return record.ma_nguon
  return `doi-${record.doi ?? 0}`
}

export default function OutputDayDetailPage() {
  const params = useParams<{ date: string }>()
  const ngay = typeof params?.date === "string" ? params.date : ""
  const validDate = ISO_DATE_RE.test(ngay)
  const router = useRouter()
  const isDesktop = useIsDesktop()

  const [user, setUser] = useState<SessionUser | null>(null)
  const [records, setRecords] = useState<ProductionRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mobileTab, setMobileTab] = useState<"doc" | "info">("info")
  const [docTab, setDocTab] = useState<"file" | "content">("file")
  const [toast, setToast] = useState<string | null>(null)
  const [origin, setOrigin] = useState("")

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const { user: sessionUser } = await hydrateActiveSession()
      if (!sessionUser) {
        window.location.replace(`/login?next=${encodeURIComponent(`${LIST_HREF}/day/${ngay}`)}`)
        return
      }
      if (!hasPermission(sessionUser, "output.view")) {
        window.location.replace("/dashboard")
        return
      }
      setUser(sessionUser)
      if (!validDate) return
      const fid = await getActiveFactoryId()
      if (!fid) {
        setLoadError("Không xác định được nhà máy đang đăng nhập.")
        return
      }
      const rows = await fetchAllPaginated<ProductionRecord>((from, to) =>
        supabase
          .from("production_records")
          .select("*")
          .eq("factory_id", fid)
          .eq("ngay", ngay)
          .order("so_xe")
          .order("chuyen")
          .order("id")
          .range(from, to),
      )
      rows.sort((a, b) => {
        if (a.doi !== b.doi) return (a.doi ?? 0) - (b.doi ?? 0)
        const xe = compareSoXe(a.so_xe, b.so_xe)
        if (xe !== 0) return xe
        return a.chuyen - b.chuyen
      })
      setRecords(rows)
    } catch (err) {
      setLoadError((err as { message?: string } | null)?.message || "Không tải được sản lượng ngày.")
    } finally {
      setLoading(false)
    }
  }, [ngay, validDate])

  useEffect(() => {
    void load()
  }, [load])

  const detailUrl = origin && validDate ? `${origin}${LIST_HREF}/day/${ngay}` : ""

  const summary = useMemo(() => {
    const byMaterial = OUTPUT_MATERIALS.map((def) => ({
      label: def.label,
      tuoi: records.reduce((s, r) => s + Number(r[def.tuoiKey] ?? 0), 0),
      kho: records.reduce((s, r) => s + Number(r[def.khoKey] ?? 0), 0),
    }))
    const groups = new Map<string, ProductionRecord[]>()
    for (const r of records) {
      const k = groupKey(r)
      const bucket = groups.get(k)
      if (bucket) bucket.push(r)
      else groups.set(k, [r])
    }
    return {
      tuoi: records.reduce((s, r) => s + totalTuoi(r), 0),
      kho: records.reduce((s, r) => s + totalKho(r), 0),
      vehicles: new Set(records.map((r) => r.so_xe)).size,
      warns: records.reduce((s, r) => s + (r.warn_codes?.length || 0), 0),
      byMaterial,
      groups: Array.from(groups.values()),
      dois: [...new Set(records.map((r) => r.doi).filter((d): d is number => typeof d === "number" && d > 0))].sort((a, b) => a - b),
      uploaders: [...new Set(records.map((r) => r.nguoi_upload?.trim()).filter((v): v is string => Boolean(v)))],
      notes: [...new Set(records.map((r) => r.ghi_chu?.trim()).filter((v): v is string => Boolean(v)))],
      lastUpdate: records.reduce((m, r) => ((r.updated_at || r.created_at || "") > m ? (r.updated_at || r.created_at || "") : m), ""),
    }
  }, [records])

  const wrap = (node: ReactNode) => (
    <div className={`space-y-4 p-4 sm:p-6 ${moduleThemeClass("forest")}`}>
      <PageBackgroundMotif theme="forest" />
      {node}
    </div>
  )

  if (loading) return wrap(<ListState kind="loading" />)
  if (loadError) return wrap(<ListState kind="error" message={loadError} onRetry={() => void load()} />)
  if (!validDate) return wrap(<ListState kind="empty" message="Ngày không hợp lệ." />)
  if (records.length === 0) {
    return wrap(
      <div className="rounded-2xl border border-slate-200 bg-white">
        <ListState kind="empty" message={`Không có sản lượng ngày ${formatDateDisplay(ngay)}.`} />
        <div className="pb-6 text-center">
          <button onClick={() => router.push(LIST_HREF)} className="text-sm font-semibold text-mod-700 hover:underline">
            ← Về danh sách sản lượng
          </button>
        </div>
      </div>,
    )
  }

  const isAdmin = user?.role === "admin"
  const canCreate = isAdmin || hasPermission(user, "output.create")
  const canEditOrDelete = isAdmin || hasPermission(user, "output.edit") || hasPermission(user, "output.delete")
  const pdfParams = { ngay, records, makerName: user?.full_name, qrUrl: detailUrl || null }

  const downloadPdf = async () => {
    try {
      await downloadOutputDayPdf(pdfParams)
    } catch {
      setToast("Không tạo được PDF ngày.")
      window.setTimeout(() => setToast(null), 4000)
    }
  }

  const secondary: SignAction[] = [
    { key: "pdf", label: "Tải PDF ngày", icon: <Download size={14} />, onClick: () => void downloadPdf() },
    ...(canCreate
      ? [{ key: "add", label: "Thêm dòng", icon: <Plus size={14} />, onClick: () => router.push(`${LIST_HREF}?add=${ngay}`) }]
      : []),
    ...(canEditOrDelete
      ? [{ key: "edit", label: "Sửa / Xóa dòng", icon: <Pencil size={14} />, onClick: () => router.push(`${LIST_HREF}?day=${ngay}`) }]
      : []),
  ]

  const chip = "rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11.5px] font-medium text-slate-600"

  const contentTable = (
    <ResponsiveTableWrapper>
      <table className="enterprise-table dense min-w-[900px]">
        <thead>
          <tr>
            <th>Xe</th>
            <th className="text-right">Chuyến</th>
            <th>Tài xế</th>
            <th>Nguyên liệu (tươi / khô)</th>
            <th className="text-right">KL tươi</th>
            <th className="text-right">KL khô</th>
            <th>Cảnh báo</th>
            <th>Ký hiệu KT</th>
            <th>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {summary.groups.map((group) => {
            const first = group[0]
            const gTuoi = group.reduce((s, r) => s + totalTuoi(r), 0)
            const gKho = group.reduce((s, r) => s + totalKho(r), 0)
            return [
              <tr key={`g-${groupKey(first)}`} className="bg-mod-50">
                <td colSpan={4} className="font-bold text-mod-800">
                  <span className="inline-flex items-center gap-2">
                    <OutputSourceCell record={first} />
                    <span className="text-xs font-medium text-slate-500">{group.length} dòng</span>
                  </span>
                </td>
                <td className="text-right font-semibold text-slate-700">{fmtKg(gTuoi)}</td>
                <td className="text-right font-bold text-mod-800">{fmtKg(gKho)}</td>
                <td colSpan={3} />
              </tr>,
              ...group.map((r) => (
                <tr key={r.id}>
                  <td className="font-bold text-slate-800">{r.so_xe || "—"}</td>
                  <td className="text-right">{r.chuyen}</td>
                  <td className="whitespace-nowrap">{r.tai_xe || "—"}</td>
                  <td className="text-xs text-slate-600">{materialSummary(r).join(" · ") || "—"}</td>
                  <td className="text-right">{fmtKg(totalTuoi(r))}</td>
                  <td className="text-right font-semibold text-mod-800">{fmtKg(totalKho(r))}</td>
                  <td>
                    {r.warn_codes?.length ? (
                      <div className="flex flex-wrap gap-1">
                        {r.warn_codes.map((code) => <OutputWarnBadge key={code} code={code} />)}
                      </div>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="font-code text-xs">{r.ghi_chu || "—"}</td>
                  <td className="max-w-[200px] truncate" title={r.ghi_chu_tu_do || ""}>{r.ghi_chu_tu_do || "—"}</td>
                </tr>
              )),
            ]
          })}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td colSpan={4}>Tổng ngày</td>
            <td className="text-right">{fmtKg(summary.tuoi)}</td>
            <td className="text-right text-mod-800">{fmtKg(summary.kho)}</td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </ResponsiveTableWrapper>
  )

  return wrap(
    <>
      {toast && (
        <div className="fixed top-4 left-1/2 z-[70] -translate-x-1/2 rounded-2xl bg-red-600 px-5 py-3 text-sm font-bold text-white shadow-2xl">
          {toast}
        </div>
      )}
      <DetailSplitLayout
        mobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
        header={
          <DetailPageHeader
            backHref={LIST_HREF}
            backLabel="Quay lại danh sách sản lượng"
            eyebrow="Sản lượng theo ngày"
            title={`Ngày ${formatDateDisplay(ngay)}`}
            tags={
              <>
                <span className={chip}>{summary.vehicles} xe</span>
                <span className={chip}>{records.length} dòng</span>
                <span className={chip}>Tươi {fmtKg(summary.tuoi)} kg</span>
                <span className={chip}>Khô {fmtKg(summary.kho)} kg</span>
              </>
            }
            actions={
              <>
                <HeaderButton icon={<Download size={15} />} label="Tải PDF" onClick={() => void downloadPdf()} />
                {detailUrl ? <HeaderQr value={detailUrl} code={formatDateDisplay(ngay)} title="QR sản lượng ngày" /> : null}
              </>
            }
          />
        }
        document={
          <>
            <SegmentedTabs
              ariaLabel="Chọn nội dung cột tài liệu"
              value={docTab}
              onChange={setDocTab}
              items={[
                { key: "file", label: "Bản PDF", icon: FileText },
                { key: "content", label: "Bản ghi", icon: Table2, count: records.length },
              ]}
            />
            {docTab === "file" ? (
              <DocViewer
                key={`output-day-${ngay}`}
                active={isDesktop || mobileTab === "doc"}
                loadBytes={() => buildOutputDayPdfBytes(pdfParams)}
                sourceKey={`output-day-${ngay}-${records.length}-${summary.lastUpdate}-${detailUrl}`}
                kind="pdf"
                fileExt="pdf"
                label={`Sản lượng ngày ${formatDateDisplay(ngay)} · Bản xem trước PDF`}
              />
            ) : contentTable}
          </>
        }
        inspector={
          <>
            <StatusSummaryBar
              domain="inventory"
              status={null}
              headline={`${summary.vehicles} xe · ${records.length} dòng`}
              badge={
                summary.warns > 0
                  ? <StatusBadge tone="warn" label={`${summary.warns} cảnh báo`} size="md" />
                  : <StatusBadge tone="valid" label="Không cảnh báo" size="md" />
              }
            />
            <SignActionBox title="Hành động" primary={null} secondary={secondary} danger={[]} />
            <InspectorCard title="Tổng hợp theo loại mủ (kg)" icon={Droplet}>
              <MetaList>
                {summary.byMaterial.filter((m) => m.tuoi > 0 || m.kho > 0).map((m) => (
                  <MetaRow key={m.label} label={m.label} value={`Tươi ${fmtKg(m.tuoi)} · Khô ${fmtKg(m.kho)}`} />
                ))}
                <MetaRow label="Tổng" value={`Tươi ${fmtKg(summary.tuoi)} · Khô ${fmtKg(summary.kho)}`} />
              </MetaList>
            </InspectorCard>
            <InspectorCard title="Thông tin ngày" icon={CalendarDays}>
              <MetaList>
                <MetaRow label="Ngày" value={formatDateDisplay(ngay)} />
                <MetaRow label="Đội" value={summary.dois.map((d) => `Đội ${d}`).join(", ") || "—"} />
                <MetaRow label="Ký hiệu KT" value={summary.notes.join(", ") || "—"} />
                <MetaRow label="Người upload" value={summary.uploaders.join(", ") || "—"} />
              </MetaList>
            </InspectorCard>
          </>
        }
      />
    </>,
  )
}

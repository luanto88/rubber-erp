"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { Boxes, ClipboardList, Download, FileText, FlaskConical, Package, QrCode, Truck, Warehouse } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { hasPermission, hydrateActiveSession } from "@/lib/auth"
import { formatStorageDate } from "@/lib/storage-detail"
import { getLoaiBanhConfig } from "@/lib/product-lot-config"
import { buildProductLabelLookupPath, type KienLetter } from "@/lib/product-label"
import {
  buildProductLotPdfBytes,
  downloadProductLotPdf,
  type ProductLotPdfInput,
} from "@/lib/product-lot-pdf"
import { normalizeLotStatus } from "@/app/dashboard/product/shared"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { moduleThemeClass } from "@/app/dashboard/_components/doc-ui/module-theme"
import { DetailSplitLayout } from "@/app/dashboard/_components/doc-ui/detail-split-layout"
import { DetailPageHeader, HeaderButton } from "@/app/dashboard/_components/doc-ui/detail-page-header"
import { HeaderQr } from "@/app/dashboard/_components/doc-ui/header-qr"
import { DocViewer } from "@/app/dashboard/_components/doc-ui/doc-viewer"
import { useIsDesktop } from "@/app/dashboard/_components/doc-ui/use-is-desktop"
import { InspectorCard, MetaList, MetaRow, StatusSummaryBar } from "@/app/dashboard/_components/doc-ui/inspector-card"
import { SignActionBox, type SignAction } from "@/app/dashboard/_components/doc-ui/sign-action-box"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"

/**
 * Trang chi tiết lô thành phẩm (rule 29 mục C, 2026-10-18). Chỉ XEM — thêm/sửa/xoá giao dịch,
 * khoá ca, Sang kiện/Thay bọc vẫn ở `/dashboard/product` (giữ nguyên mọi điều kiện quyền/khoá ca).
 * Cột trái nhúng PDF "Phiếu chi tiết lô" dựng ngay trong trình duyệt (DocViewer loadBytes).
 */

type LotTx = {
  id: string
  ngan_id: string | null
  ca: string | null
  ngay_nhap: string | null
  kien_a: number | null
  kien_b: number | null
  kien_c: number | null
  kien_d: number | null
  so_banh: number | null
  so_kg: number | null
  boc: string | null
  pallet: string[] | null
  chi_thi: string | null
  created_at: string | null
}

type LotRow = {
  id: string
  factory_id: string
  ma_lo: string
  ngay_sx: string | null
  ngay_ht: string | null
  ca: string | null
  ngan_id: string | null
  day_chuyen: string | null
  loai_csr: string | null
  loai_banh: number | null
  boc: string | null
  tham: string | null
  pallet: string[] | null
  chi_thi: string | null
  kien_a: number | null
  kien_b: number | null
  kien_c: number | null
  kien_d: number | null
  tong_banh: number | null
  tong_kg: number | null
  trang_thai: string | null
  ghi_chu: string | null
  lot_transactions: LotTx[] | null
}

type QcRow = { ngay_kn: string | null; pkn: number | null; dat_hang: string | null; trang_thai: string | null; lan: number | null }
type ExportRow = { id: string; ma_don: string | null; ngay: string | null; so_banh: number }
type NganInfo = { id: string; ten_ngan: string | null; ma_ngan: string | null }

const KIEN: { key: "kien_a" | "kien_b" | "kien_c" | "kien_d"; label: KienLetter }[] = [
  { key: "kien_a", label: "A" },
  { key: "kien_b", label: "B" },
  { key: "kien_c", label: "C" },
  { key: "kien_d", label: "D" },
]

const num = (v: number | null | undefined) => Number(v || 0)
const fmtKg = (v: number) => `${Math.round(v || 0).toLocaleString("vi-VN")} kg`
const palletText = (p: string[] | null | undefined) => (Array.isArray(p) ? p.filter(Boolean).join(", ") : "")

export default function ProductLotDetailPage() {
  const params = useParams<{ id: string }>()
  const lotId = typeof params?.id === "string" ? params.id : ""
  const isDesktop = useIsDesktop()

  const [lot, setLot] = useState<LotRow | null>(null)
  const [ngans, setNgans] = useState<Record<string, NganInfo>>({})
  const [qc, setQc] = useState<QcRow | null>(null)
  const [exportsList, setExportsList] = useState<ExportRow[]>([])
  const [factoryName, setFactoryName] = useState("")
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mobileTab, setMobileTab] = useState<"doc" | "info">("info")
  const [docTab, setDocTab] = useState<"file" | "tx" | "export">("file")
  const [origin, setOrigin] = useState("")
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok })
    window.setTimeout(() => setToast(null), 3500)
  }, [])

  const loadLot = useCallback(async () => {
    if (!lotId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const { user } = await hydrateActiveSession()
      if (!user) {
        window.location.replace(`/login?next=${encodeURIComponent(`/dashboard/product/lot/${lotId}`)}`)
        return
      }
      if (!hasPermission(user, "product.view")) {
        window.location.replace("/dashboard")
        return
      }
      const fid = user.factory_id
      if (!fid) {
        setLoadError("Tài khoản chưa được gán nhà máy.")
        return
      }
      const { data, error } = await supabase
        .from("lots")
        .select(
          "id, factory_id, ma_lo, ngay_sx, ngay_ht, ca, ngan_id, day_chuyen, loai_csr, loai_banh, boc, tham, pallet, chi_thi, kien_a, kien_b, kien_c, kien_d, tong_banh, tong_kg, trang_thai, ghi_chu, lot_transactions(id, ngan_id, ca, ngay_nhap, kien_a, kien_b, kien_c, kien_d, so_banh, so_kg, boc, pallet, chi_thi, created_at)",
        )
        .eq("factory_id", fid)
        .eq("id", lotId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      const row = (data as LotRow | null) ?? null
      setLot(row)
      if (!row) return

      const nganIds = [
        ...new Set([row.ngan_id, ...(row.lot_transactions || []).map((t) => t.ngan_id)].filter((v): v is string => Boolean(v))),
      ]
      const [nganRes, qcRes, orderRes, factoryRes] = await Promise.all([
        nganIds.length
          ? supabase.from("ngans").select("id, ten_ngan, ma_ngan").eq("factory_id", fid).in("id", nganIds)
          : Promise.resolve({ data: [] as NganInfo[], error: null }),
        supabase
          .from("qc_results")
          .select("ngay_kn, pkn, dat_hang, trang_thai, lan")
          .eq("factory_id", fid)
          .eq("lot_id", row.id)
          .order("lan", { ascending: false })
          .order("ngay_kn", { ascending: false })
          .limit(1),
        supabase
          .from("export_orders")
          .select("id, ma_don, ngay, assignments")
          .eq("factory_id", fid)
          .contains("assignments", JSON.stringify([{ lot_id: row.id }])),
        supabase.from("factories").select("name").eq("id", fid).maybeSingle(),
      ])
      const map: Record<string, NganInfo> = {}
      for (const n of (nganRes.data || []) as NganInfo[]) map[n.id] = n
      setNgans(map)
      setQc(((qcRes.data || []) as QcRow[])[0] ?? null)
      const orders = (orderRes.data || []) as Array<{
        id: string
        ma_don: string | null
        ngay: string | null
        assignments: Array<{ lot_id?: string; kien_a?: number; kien_b?: number; kien_c?: number; kien_d?: number }> | null
      }>
      setExportsList(
        orders
          .map((o) => ({
            id: o.id,
            ma_don: o.ma_don,
            ngay: o.ngay,
            so_banh: (o.assignments || [])
              .filter((a) => a.lot_id === row.id)
              .reduce((s, a) => s + num(a.kien_a) + num(a.kien_b) + num(a.kien_c) + num(a.kien_d), 0),
          }))
          .sort((a, b) => (a.ngay || "").localeCompare(b.ngay || "")),
      )
      setFactoryName(((factoryRes.data as { name?: string } | null)?.name || "").trim())
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Không tải được chi tiết lô.")
    } finally {
      setLoading(false)
    }
  }, [lotId])

  useEffect(() => {
    void loadLot()
  }, [loadLot])

  const nganLabel = useCallback(
    (id: string | null | undefined) => {
      if (!id) return "—"
      const n = ngans[id]
      return n ? n.ma_ngan || n.ten_ngan || "—" : "—"
    },
    [ngans],
  )

  const txs = useMemo(
    () =>
      [...(lot?.lot_transactions || [])].sort(
        (a, b) => (a.ngay_nhap || "").localeCompare(b.ngay_nhap || "") || (a.created_at || "").localeCompare(b.created_at || ""),
      ),
    [lot],
  )

  const detailUrl = origin && lot ? `${origin}/dashboard/product/lot/${lot.id}` : ""
  const cfg = getLoaiBanhConfig(lot?.loai_csr || "", lot?.loai_banh || undefined)
  const qcText = qc
    ? `${qc.dat_hang || (qc.trang_thai === "dat" ? "Đạt" : qc.trang_thai || "—")} · PKN ${qc.pkn ?? "—"} · ${formatStorageDate(qc.ngay_kn)}${num(qc.lan) > 1 ? ` (lần ${qc.lan})` : ""}`
    : "Chưa kiểm nghiệm"

  const pdfInput = useMemo<ProductLotPdfInput | null>(() => {
    if (!lot) return null
    return {
      ma_lo: lot.ma_lo,
      factoryName,
      trang_thai: normalizeLotStatus(lot.trang_thai),
      day_chuyen: lot.day_chuyen || "",
      loai_csr: lot.loai_csr || "",
      loai_banh: num(lot.loai_banh),
      boc: lot.boc || "",
      tham: lot.tham || "",
      pallet: palletText(lot.pallet),
      chi_thi: lot.chi_thi || "",
      ngay_sx: lot.ngay_sx,
      ngay_ht: lot.ngay_ht,
      ca: lot.ca || "",
      ngan: nganLabel(lot.ngan_id),
      tong_banh: num(lot.tong_banh),
      tong_kg: num(lot.tong_kg),
      ghi_chu: lot.ghi_chu || "",
      kien: KIEN.map((k) => ({ label: k.label, banh: num(lot[k.key]), max: cfg.max_per_kien })),
      transactions: txs.map((t) => ({
        ngay: t.ngay_nhap || "",
        ca: t.ca || "",
        ngan: nganLabel(t.ngan_id),
        kien: KIEN.filter((k) => num(t[k.key]) > 0).map((k) => `${k.label}:${num(t[k.key])}`).join(" "),
        so_banh: num(t.so_banh),
        so_kg: num(t.so_kg),
        boc: t.boc || "",
        pallet: palletText(t.pallet),
      })),
      exports: exportsList.map((e) => ({ ma_don: e.ma_don || "", ngay: e.ngay || "", so_banh: e.so_banh })),
      qcText,
      qrUrl: detailUrl || null,
    }
  }, [lot, factoryName, txs, exportsList, qcText, detailUrl, nganLabel, cfg.max_per_kien])

  const toastNode = toast && (
    <div className={`fixed top-4 left-1/2 z-[70] -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-2xl ${toast.ok ? "bg-emerald-600" : "bg-red-600"}`}>
      {toast.msg}
    </div>
  )

  if (loading) {
    return <div className={moduleThemeClass("forest")}><ListState kind="loading" /></div>
  }
  if (loadError) {
    return <div className={moduleThemeClass("forest")}><ListState kind="error" message={loadError} onRetry={() => void loadLot()} /></div>
  }
  if (!lot || !pdfInput) {
    return (
      <div className={moduleThemeClass("forest")}>
        <ListState kind="empty" message="Không tìm thấy lô thành phẩm, hoặc lô không thuộc nhà máy của bạn." />
      </div>
    )
  }

  const status = normalizeLotStatus(lot.trang_thai)
  const exportedBanh = exportsList.reduce((s, e) => s + e.so_banh, 0)
  const remaining = Math.max(0, num(lot.tong_banh) - exportedBanh)

  const downloadPdf = async () => {
    try {
      await downloadProductLotPdf(pdfInput)
    } catch {
      showToast("Không tạo được PDF chi tiết lô.", false)
    }
  }

  const secondary: SignAction[] = [
    { key: "pdf", label: "Tải PDF", icon: <Download size={14} />, onClick: () => void downloadPdf() },
    { key: "list", label: "Danh sách thành phẩm", icon: <ClipboardList size={14} />, onClick: () => window.location.assign("/dashboard/product") },
    ...(lot.ngan_id
      ? [{ key: "ngan", label: "Ngăn nguồn", icon: <Warehouse size={14} />, onClick: () => window.location.assign(`/dashboard/storage/${lot.ngan_id}`) }]
      : []),
  ]

  const chip = "rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11.5px] font-medium text-slate-600"

  const txTable = (
    <ResponsiveTableWrapper>
      <table className="enterprise-table dense min-w-[760px]">
        <thead>
          <tr>
            <th>Ngày nhập</th>
            <th>Ca</th>
            <th>Ngăn</th>
            <th>Kiện (A/B/C/D)</th>
            <th className="text-right">Bành</th>
            <th className="text-right">KL (kg)</th>
            <th>Bọc</th>
            <th>Pallet</th>
          </tr>
        </thead>
        <tbody>
          {txs.length === 0 ? (
            <ListState kind="empty" message="Lô chưa có giao dịch nhập thành phẩm" asRow colSpan={8} />
          ) : txs.map((t) => (
            <tr key={t.id}>
              <td className="whitespace-nowrap">{formatStorageDate(t.ngay_nhap)}</td>
              <td className="whitespace-nowrap">{t.ca ? `Ca ${t.ca}` : "—"}</td>
              <td className="whitespace-nowrap">{nganLabel(t.ngan_id)}</td>
              <td className="whitespace-nowrap tabular-nums text-slate-600">
                {num(t.kien_a)} / {num(t.kien_b)} / {num(t.kien_c)} / {num(t.kien_d)}
              </td>
              <td className="text-right font-semibold tabular-nums">{num(t.so_banh).toLocaleString("vi-VN")}</td>
              <td className="text-right tabular-nums">{Math.round(num(t.so_kg)).toLocaleString("vi-VN")}</td>
              <td className="max-w-[160px] truncate text-xs" title={t.boc || ""}>{t.boc || "—"}</td>
              <td className="max-w-[160px] truncate text-xs" title={palletText(t.pallet)}>{palletText(t.pallet) || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ResponsiveTableWrapper>
  )

  const exportTable = (
    <ResponsiveTableWrapper>
      <table className="enterprise-table dense min-w-[640px]">
        <thead>
          <tr>
            <th>Mã đơn</th>
            <th>Ngày</th>
            <th className="text-right">Số bành gán</th>
          </tr>
        </thead>
        <tbody>
          {exportsList.length === 0 ? (
            <ListState kind="empty" message="Lô chưa được gán vào đơn xuất hàng nào" asRow colSpan={3} />
          ) : exportsList.map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap font-semibold">
                <a href={`/dashboard/export/${e.id}`} className="text-brand-700 hover:underline">{e.ma_don || "—"}</a>
              </td>
              <td className="whitespace-nowrap">{formatStorageDate(e.ngay)}</td>
              <td className="text-right tabular-nums">{e.so_banh.toLocaleString("vi-VN")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ResponsiveTableWrapper>
  )

  return (
    <div className={moduleThemeClass("forest")}>
      {toastNode}
      <DetailSplitLayout
        mobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
        header={
          <DetailPageHeader
            backHref="/dashboard/product"
            backLabel="Quay lại danh sách thành phẩm"
            eyebrow="Lô thành phẩm"
            title={`${lot.loai_csr || "—"} · Bành ${num(lot.loai_banh)} kg`}
            code={lot.ma_lo}
            tags={
              <>
                <span className={chip}>Mở lô {formatStorageDate(lot.ngay_sx)}</span>
                {lot.ngay_ht && <span className={chip}>Tròn lô {formatStorageDate(lot.ngay_ht)}</span>}
                <span className={chip}>{num(lot.tong_banh).toLocaleString("vi-VN")} bành · {fmtKg(num(lot.tong_kg))}</span>
              </>
            }
            actions={
              <>
                <HeaderButton icon={<Download size={15} />} label="Tải PDF" onClick={() => void downloadPdf()} />
                {detailUrl ? <HeaderQr value={detailUrl} code={lot.ma_lo} title="QR lô thành phẩm" /> : null}
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
                { key: "tx", label: "Giao dịch nhập", icon: Boxes, count: txs.length },
                { key: "export", label: "Xuất hàng", icon: Truck, count: exportsList.length },
              ]}
            />
            {docTab === "file" ? (
              <DocViewer
                key={`lot-${lot.id}`}
                active={isDesktop || mobileTab === "doc"}
                loadBytes={() => buildProductLotPdfBytes(pdfInput)}
                sourceKey={`lot-${lot.id}-${status}-${num(lot.tong_banh)}-${txs.length}-${exportsList.length}-${qc?.pkn ?? ""}-${Object.keys(ngans).length}-${detailUrl}`}
                kind="pdf"
                fileExt="pdf"
                label={`Lô ${lot.ma_lo} · Bản xem trước PDF`}
              />
            ) : docTab === "tx" ? txTable : exportTable}
          </>
        }
        inspector={
          <>
            <StatusSummaryBar
              domain="lot"
              status={status}
              headline={`${num(lot.tong_banh).toLocaleString("vi-VN")}/${cfg.lo_tron} bành · còn ${remaining.toLocaleString("vi-VN")} chưa xuất`}
            />
            <SignActionBox title="Hành động" secondary={secondary} />
            <InspectorCard title="Số bành theo kiện" icon={Package}>
              <div className="grid grid-cols-2 gap-2">
                {KIEN.map((k) => {
                  const banh = num(lot[k.key])
                  const full = banh >= cfg.max_per_kien
                  return (
                    <a
                      key={k.label}
                      href={buildProductLabelLookupPath(lot.factory_id, lot.ma_lo, k.label)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Tra cứu nhãn kiện ${k.label}`}
                      className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 hover:border-mod-200 hover:bg-mod-50"
                    >
                      <span className="text-[12px] font-bold text-slate-600">Kiện {k.label}</span>
                      <span className={`flex items-center gap-1 text-[13px] font-extrabold tabular-nums ${full ? "text-emerald-700" : banh > 0 ? "text-amber-700" : "text-slate-400"}`}>
                        {banh}/{cfg.max_per_kien}
                        <QrCode size={12} className="text-slate-400" />
                      </span>
                    </a>
                  )
                })}
              </div>
            </InspectorCard>
            <InspectorCard title="Thông tin lô" icon={Boxes}>
              <MetaList>
                <MetaRow label="Mã lô" value={lot.ma_lo} mono />
                <MetaRow label="Dây chuyền" value={lot.day_chuyen || "—"} />
                <MetaRow label="Loại CSR" value={lot.loai_csr || "—"} />
                <MetaRow label="Loại bành" value={`${num(lot.loai_banh)} kg`} />
                <MetaRow label="Bọc" value={lot.boc || "—"} />
                <MetaRow label="Thảm" value={lot.tham || "—"} />
                <MetaRow label="Pallet" value={palletText(lot.pallet) || "—"} />
                <MetaRow label="Ca" value={lot.ca ? `Ca ${lot.ca}` : "—"} />
                <MetaRow label="Ngăn nguồn" value={nganLabel(lot.ngan_id)} />
                {lot.chi_thi && <MetaRow label="Chỉ thị" value={lot.chi_thi} />}
                {lot.ghi_chu && <MetaRow label="Ký hiệu KT" value={lot.ghi_chu} />}
              </MetaList>
            </InspectorCard>
            <InspectorCard title="Kiểm nghiệm" icon={FlaskConical}>
              <MetaList>
                <MetaRow label="Kết quả mới nhất" value={qcText} />
                <MetaRow label="Đã gán xuất" value={`${exportedBanh.toLocaleString("vi-VN")} bành / ${exportsList.length} đơn`} />
              </MetaList>
            </InspectorCard>
          </>
        }
      />
    </div>
  )
}

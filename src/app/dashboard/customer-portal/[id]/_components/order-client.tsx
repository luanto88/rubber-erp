"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { authBlockReason, hasPermission, hydrateActiveSession, signOutEverywhere } from "@/lib/auth"
import type { FeatureCollection } from "geojson"
import { saveAs } from "file-saver"
import { ArrowLeft, Download, FileDown, FileText, Loader2, MapPin, Package } from "lucide-react"
import { buildEudrOrderZipBlob, generateDDS1, generateDDS2, sanitizeOrderCodeForFile, type FactoryProfile, type LotDetail } from "@/app/dashboard/eudr/dds-generator"
import { EudrPlotMap } from "@/app/dashboard/eudr/_components/eudr-plot-map"
import {
  getStoredCustomerPortalLang,
  onCustomerPortalLangChange,
  tCustomerPortal,
  type CustomerPortalLang,
} from "@/lib/customer-portal-i18n"

type PortalOrderDetail = {
  id: string
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
  public_token?: string | null
  assignments: { lot_id: string; ma_lo: string; kien_a: number; kien_b: number; kien_c: number; kien_d: number }[]
  files?: { name: string; url: string; path?: string; size?: number }[] | null
  customers?: { ma_kh: string; ten_kh_en: string; quoc_gia: string; dia_chi: string; email: string; nguoi_lien_he: string } | null
}

type PortalData = {
  order: PortalOrderDetail
  factory: FactoryProfile | null
  lotDetails: LotDetail[]
  extractionDates: Record<string, string>
  lotCertMap: Record<string, string>
  diemGn: string[]
  geoData: FeatureCollection
  traceInfo: { lots: number; ngans: number; tripUids: number; matchedRows: number; diemGn: number; features: number; fallback?: boolean }
}

type DownloadKind = "dds1" | "dds2" | "geojson" | "all"

function formatDate(value: string) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`
}

export default function CustomerPortalOrderClient() {
  const params = useParams<{ id: string }>()
  const orderId = params?.id
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [data, setData] = useState<PortalData | null>(null)
  const [downloading, setDownloading] = useState<DownloadKind | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [lang, setLang] = useState<CustomerPortalLang>("en")
  const t = (key: Parameters<typeof tCustomerPortal>[1]) => tCustomerPortal(lang, key)

  useEffect(() => {
    setLang(getStoredCustomerPortalLang())
    return onCustomerPortalLangChange(setLang)
  }, [])

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  useEffect(() => {
    const bootstrap = async () => {
      const { session, user } = await hydrateActiveSession().catch(() => ({ session: null, user: null }))
      const blocked = authBlockReason(user)
      if (!session?.user || blocked) {
        setLoading(false)
        await signOutEverywhere()
        window.location.replace(`/login${blocked ? `?reason=${blocked}` : ""}`)
        return
      }
      if (!hasPermission(user, "export.view_own")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      if (!orderId) {
        setLoading(false)
        setLoadFailed(true)
        return
      }
      try {
        const res = await fetch(`/api/customer-portal/orders/${orderId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        const json = (await res.json().catch(() => null)) as (PortalData & { error?: string }) | null
        if (!res.ok || !json) throw new Error("load_failed")
        setData(json)
      } catch {
        setLoadFailed(true)
      } finally {
        setLoading(false)
      }
    }
    void bootstrap()
  }, [orderId])

  const handleDownloadDDS1 = async () => {
    if (!data?.factory) {
      showToast(t("errorMissingFactory"), false)
      return
    }
    setDownloading("dds1")
    try {
      const blob = await generateDDS1(
        { ...data.order, customers: data.order.customers ?? undefined },
        data.geoData,
        data.factory,
        data.lotCertMap,
      )
      saveAs(blob, `${sanitizeOrderCodeForFile(data.order.ma_don)}_Plantation.pdf`)
    } catch {
      showToast(t("errorGenerateDds"), false)
    } finally {
      setDownloading(null)
    }
  }

  const handleDownloadDDS2 = async () => {
    if (!data?.factory) {
      showToast(t("errorMissingFactory"), false)
      return
    }
    setDownloading("dds2")
    try {
      const blob = await generateDDS2(
        { ...data.order, customers: data.order.customers ?? undefined },
        data.lotDetails,
        data.extractionDates,
        data.factory,
      )
      saveAs(blob, `${sanitizeOrderCodeForFile(data.order.ma_don)}_Shipment.pdf`)
    } catch {
      showToast(t("errorGenerateDds"), false)
    } finally {
      setDownloading(null)
    }
  }

  const handleDownloadGeoJson = () => {
    if (!data) return
    setDownloading("geojson")
    try {
      const blob = new Blob([JSON.stringify(data.geoData, null, 2)], { type: "application/geo+json" })
      saveAs(blob, `${sanitizeOrderCodeForFile(data.order.ma_don)}_supply_chain.geojson`)
    } finally {
      setDownloading(null)
    }
  }

  const handleDownloadAll = async () => {
    if (!data?.factory) {
      showToast(t("errorMissingFactory"), false)
      return
    }
    setDownloading("all")
    try {
      const orderForDds = { ...data.order, customers: data.order.customers ?? undefined }
      // buildEudrOrderZipBlob() gói 3 file chính (2 DDS + GeoJSON) và tệp đính kèm vào 1 ZIP
      // phẳng (không có thư mục con bên trong) — bucket "eudr-files" đã public nên fetch
      // thẳng URL là đủ, không cần service role. 1 tệp đính kèm lỗi không làm hỏng cả lượt
      // tải, hàm dùng chung tự bỏ qua và tiếp tục với các tệp còn lại.
      const zipBlob = await buildEudrOrderZipBlob(
        orderForDds,
        data.geoData,
        data.factory,
        data.lotDetails,
        data.extractionDates,
        data.lotCertMap,
        data.order.files || [],
      )
      saveAs(zipBlob, `${sanitizeOrderCodeForFile(data.order.ma_don)}_EUDR.zip`)
    } catch {
      showToast(t("errorGenerateDds"), false)
    } finally {
      setDownloading(null)
    }
  }

  if (loading) {
    return <div className="p-12 text-center text-slate-400">{t("loading")}</div>
  }

  if (loadFailed || !data) {
    return (
      <div className="p-12 text-center text-red-500 bg-white rounded-xl border border-slate-200 shadow-sm">
        {t("orderNotFound")}
      </div>
    )
  }

  const { order } = data

  return (
    <div>
      {toast && (
        <div
          className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-2xl shadow-2xl text-sm font-bold text-white ${toast.ok ? "bg-emerald-600" : "bg-red-600"}`}
        >
          {toast.msg}
        </div>
      )}

      <div className="mb-4">
        <Link
          href="/dashboard/customer-portal"
          className="inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={14} /> {t("backToList")}
        </Link>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-extrabold text-slate-800">{order.ma_don}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {t("dateLabel")}: {formatDate(order.ngay)} · {t("productTypeLabel")}: {order.chung_loai || "-"} ·{" "}
              {t("totalBalesLabel")}: {order.tong_banh?.toLocaleString("vi-VN") ?? "-"}
            </p>
            {order.customers && (
              <p className="text-xs text-slate-400 mt-1">
                {t("customerLabel")}: {order.customers.ten_kh_en} — {order.customers.quoc_gia}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleDownloadAll}
              disabled={downloading === "all"}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg disabled:opacity-50"
            >
              {downloading === "all" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {t("downloadAll")}
            </button>
            <button
              onClick={handleDownloadDDS1}
              disabled={downloading === "dds1"}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg disabled:opacity-50"
            >
              {downloading === "dds1" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {t("ddsPlantation")}
            </button>
            <button
              onClick={handleDownloadDDS2}
              disabled={downloading === "dds2"}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg disabled:opacity-50"
            >
              {downloading === "dds2" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {t("ddsShipment")}
            </button>
            <button
              onClick={handleDownloadGeoJson}
              disabled={downloading === "geojson"}
              className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg disabled:opacity-50"
            >
              {downloading === "geojson" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {t("geoJson")}
            </button>
          </div>
        </div>

        {order.files && order.files.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="text-xs font-bold text-slate-500 mb-2">{t("attachmentsTitle")}</div>
            <div className="space-y-1.5">
              {order.files.map((f) => (
                <div
                  key={f.url}
                  className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg border border-slate-200"
                >
                  <FileText size={13} className="text-slate-400 shrink-0" />
                  <span className="flex-1 text-xs text-slate-700 truncate" title={f.name}>
                    {f.name}
                  </span>
                  <a
                    href={f.url}
                    download
                    className="p-1 hover:bg-slate-200 rounded text-slate-500"
                    title={t("downloadOne")}
                  >
                    <FileDown size={13} />
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          {[
            { label: t("kpiLots"), value: data.traceInfo.lots },
            { label: t("kpiStorage"), value: data.traceInfo.ngans },
            { label: t("kpiDeliveryPoints"), value: data.traceInfo.diemGn },
            { label: t("kpiPolygons"), value: data.traceInfo.features },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-slate-50 rounded-xl p-3 text-center">
              <div className="text-lg font-black text-slate-800">{kpi.value}</div>
              <div className="text-[11px] text-slate-500">{kpi.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-4">
        <div className="flex items-center gap-2 mb-3 text-slate-700 font-bold text-sm">
          <MapPin size={16} /> {t("plantationMap")}
        </div>
        <EudrPlotMap geoData={data.geoData} lang={lang} />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 p-4 text-slate-700 font-bold text-sm border-b border-slate-100">
          <Package size={16} /> {t("lotListTitle")}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs">
              <tr>
                <th className="text-left px-4 py-2">{t("colLotCode")}</th>
                <th className="text-left px-4 py-2">{t("colProductionDate")}</th>
                <th className="text-left px-4 py-2">{t("colExtractionDate")}</th>
                <th className="text-left px-4 py-2">{t("colCertification")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {order.assignments.map((assignment) => {
                const lot = data.lotDetails.find((item) => item.id === assignment.lot_id)
                return (
                  <tr key={assignment.lot_id}>
                    <td className="px-4 py-2 font-bold text-slate-700">{assignment.ma_lo}</td>
                    <td className="px-4 py-2 text-slate-600">{lot?.ngay_sx ? formatDate(lot.ngay_sx) : "-"}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {data.extractionDates[assignment.lot_id] ? formatDate(data.extractionDates[assignment.lot_id]) : "-"}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{data.lotCertMap[assignment.lot_id] || "-"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

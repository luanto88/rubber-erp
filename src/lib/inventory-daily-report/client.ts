// Kho vật tư — thao tác báo cáo sử dụng theo ngày từ trình duyệt (supabase anon theo RLS + API service role).
// Mirror src/lib/norms/report-client.ts. Rule 13.

import { supabase } from "@/lib/supabase"
import { authFetch } from "@/lib/auth-fetch"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { jsPdfBoxToPt } from "@/lib/signing/coords"
import type { SigningFieldInput } from "@/lib/signing/requests"
import { buildDailySnapshot } from "./loader"
import { buildDailyReportPdf, type DailyReportPdf } from "./pdf"
import { buildDailyReportXlsx } from "./excel"
import {
  DAILY_REPORT_PATH,
  DAILY_REPORT_SIGN_ORDER,
  hashDailySnapshot,
  type DailyReport,
  type DailyReportConfig,
  type DailyReportKieu,
  type DailyReportSignRole,
  type DailyReportSnapshot,
  type DailyReportTemplate,
} from "./types"

export type ReportPerson = { id: string; full_name: string; chuc_vu: string }
export type ReportApprovers = { nguoiLap: ReportPerson[]; bgd: ReportPerson[]; bgdFallback: boolean; defaultBgdId: string | null; defaultNguoiLapId: string }

async function readJson<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error || `Lỗi máy chủ (${res.status})`)
  return json
}

// ── Mẫu ──────────────────────────────────────────────────────────────────────

export async function loadDailyTemplates(factoryId: string): Promise<DailyReportTemplate[]> {
  return fetchAllPaginated<DailyReportTemplate>((a, b) =>
    supabase.from("inventory_daily_report_templates").select("*").eq("factory_id", factoryId).order("sort_order").order("id").range(a, b),
  )
}

export async function saveDailyTemplate(id: string, patch: Partial<Pick<DailyReportTemplate, "name" | "config" | "is_active" | "sort_order">>) {
  const { error } = await supabase.from("inventory_daily_report_templates").update(patch).eq("id", id)
  if (error) throw error
}

export async function createDailyTemplate(factoryId: string, kieu: DailyReportKieu, code: string, name: string, config: DailyReportConfig) {
  const { error } = await supabase.from("inventory_daily_report_templates").insert({ factory_id: factoryId, kieu, code, name, config, sort_order: kieu === "vt_hc" ? 10 : 20 })
  if (error) throw error
}

export async function deleteDailyTemplate(id: string) {
  const { error } = await supabase.from("inventory_daily_report_templates").delete().eq("id", id)
  if (error) throw error
}

/** Danh mục vật tư (chọn cột). */
export type PickItem = { id: string; code: string; name: string; unit: string; category: string }
export async function loadPickItems(factoryId: string): Promise<PickItem[]> {
  const [items, cats] = await Promise.all([
    fetchAllPaginated<{ id: string; code: string | null; name: string | null; unit: string | null; category_id: string | null }>((a, b) =>
      supabase.from("inventory_items").select("id,code,name,unit,category_id").eq("factory_id", factoryId).order("code").order("id").range(a, b),
    ),
    fetchAllPaginated<{ id: string; name: string | null }>((a, b) => supabase.from("inventory_item_categories").select("id,name").eq("factory_id", factoryId).order("id").range(a, b)),
  ])
  const catName = new Map(cats.map((c) => [c.id, c.name || ""]))
  return items.map((i) => ({ id: i.id, code: i.code || "", name: i.name || "", unit: i.unit || "", category: (i.category_id && catName.get(i.category_id)) || "Chưa phân loại" }))
}

// ── Báo cáo ──────────────────────────────────────────────────────────────────

const LIST_COLS =
  "id,factory_id,template_id,template_code,template_name,template_kieu,template_phien_ban,config,tu_ngay,den_ngay,du_lieu_hash,phong_ban,loai_van_ban,nam,so,ma_bao_cao,trang_thai,nguoi_lap_id,bgd_id,yeu_cau_ky_id,gui_ky_luc,da_ky_luc,ly_do_huy,created_by,created_at,updated_at"
export type DailyReportLite = Omit<DailyReport, "snapshot">

export async function loadDailyReportList(factoryId: string): Promise<DailyReportLite[]> {
  return fetchAllPaginated<DailyReportLite>((a, b) =>
    supabase.from("inventory_daily_reports").select(LIST_COLS).eq("factory_id", factoryId).order("tu_ngay", { ascending: false }).order("id").range(a, b),
  )
}

export async function loadDailyReport(factoryId: string, id: string): Promise<DailyReport> {
  const { data, error } = await supabase.from("inventory_daily_reports").select("*").eq("factory_id", factoryId).eq("id", id).maybeSingle()
  if (error) throw error
  if (!data) throw new Error("Không tìm thấy báo cáo (hoặc bạn không có quyền xem).")
  return data as DailyReport
}

export async function computeDailySnapshot(factoryId: string, t: Pick<DailyReportTemplate, "kieu" | "config">, from: string, to: string): Promise<DailyReportSnapshot> {
  return buildDailySnapshot(supabase, factoryId, { from, to, kieu: t.kieu, config: t.config || {} })
}

/** Lưu báo cáo Nháp (bản chụp mẫu + số liệu). */
export async function createDailyReport(factoryId: string, t: DailyReportTemplate, snapshot: DailyReportSnapshot): Promise<string> {
  const { data, error } = await supabase
    .from("inventory_daily_reports")
    .insert({
      factory_id: factoryId,
      template_id: t.id,
      template_code: t.code,
      template_name: t.name,
      template_kieu: t.kieu,
      template_phien_ban: t.phien_ban,
      config: t.config || {},
      tu_ngay: snapshot.from,
      den_ngay: snapshot.to,
      snapshot,
      du_lieu_hash: await hashDailySnapshot(snapshot),
      trang_thai: "nhap",
    })
    .select("id")
    .single()
  if (error || !data) throw error || new Error("Không lưu được báo cáo")
  return data.id as string
}

/** Tính lại số liệu cho báo cáo Nháp / Bị trả về (dữ liệu kho đã sửa). */
export async function refreshDailyReport(report: DailyReport): Promise<void> {
  const snapshot = await buildDailySnapshot(supabase, report.factory_id, { from: report.tu_ngay, to: report.den_ngay, kieu: report.template_kieu, config: report.config || {} })
  const { error } = await supabase
    .from("inventory_daily_reports")
    .update({ snapshot, du_lieu_hash: await hashDailySnapshot(snapshot) })
    .eq("id", report.id)
  if (error) throw error
}

/** Đã ký: tính lại từ dữ liệu hiện tại có khác bản đã ký? */
export async function dailyReportDataChanged(report: DailyReport): Promise<boolean> {
  const snapshot = await buildDailySnapshot(supabase, report.factory_id, { from: report.tu_ngay, to: report.den_ngay, kieu: report.template_kieu, config: report.config || {} })
  return (await hashDailySnapshot(snapshot)) !== report.du_lieu_hash
}

export async function deleteDailyReportDraft(id: string) {
  const { error } = await supabase.from("inventory_daily_reports").delete().eq("id", id).eq("trang_thai", "nhap")
  if (error) throw error
}

export async function fetchDailyApprovers(): Promise<ReportApprovers> {
  return readJson<ReportApprovers>(await authFetch("/api/inventory/daily-reports/approvers"))
}

export async function syncDailyReportStatuses(ids: string[]): Promise<void> {
  if (!ids.length) return
  await authFetch("/api/inventory/daily-reports/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => null)
}

export async function dailyReportAction(id: string, action: "recall" | "cancel", lyDo?: string) {
  await readJson(await authFetch(`/api/inventory/daily-reports/${id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, lyDo }) }))
}

export function dailyReportQrUrl(id: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://qlsxkpt.vercel.app"
  return `${origin}${DAILY_REPORT_PATH(id)}`
}

type PdfSource = Pick<DailyReport, "id" | "template_name" | "config" | "snapshot" | "ma_bao_cao" | "phong_ban" | "loai_van_ban">

export async function buildDailyPdf(r: PdfSource, opts: { maBaoCao?: string | null; nguoiLapChucVu?: string | null; bgdChucVu?: string | null } = {}): Promise<DailyReportPdf> {
  return buildDailyReportPdf({
    templateName: r.template_name,
    config: r.config || {},
    snapshot: r.snapshot,
    maBaoCao: opts.maBaoCao === undefined ? r.ma_bao_cao : opts.maBaoCao,
    phongBan: r.phong_ban,
    loaiKyHieu: r.loai_van_ban,
    nguoiLapChucVu: opts.nguoiLapChucVu ?? null,
    bgdChucVu: opts.bgdChucVu ?? null,
    qrUrl: dailyReportQrUrl(r.id),
  })
}

function saveBlob(bytes: Uint8Array, type: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export const dailyReportFileName = (r: Pick<DailyReport, "template_name" | "ma_bao_cao" | "tu_ngay">) =>
  `${r.template_name} ${r.ma_bao_cao ? r.ma_bao_cao.replace(/\//g, "-") : r.tu_ngay.slice(0, 7)}`.trim()

export async function downloadDailyPdf(r: PdfSource & Pick<DailyReport, "tu_ngay">) {
  saveBlob((await buildDailyPdf(r)).bytes, "application/pdf", `${dailyReportFileName(r)} (chưa ký).pdf`)
}

export async function downloadDailyXlsx(r: PdfSource & Pick<DailyReport, "tu_ngay">) {
  const bytes = await buildDailyReportXlsx({ templateName: r.template_name, config: r.config || {}, snapshot: r.snapshot, maBaoCao: r.ma_bao_cao, phongBan: r.phong_ban, loaiKyHieu: r.loai_van_ban })
  saveBlob(bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", `${dailyReportFileName(r)}.xlsx`)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export type DailySendSigners = { nguoiLap: ReportPerson; bgd: ReportPerson; so: number | null }

/** Cấp số → dựng PDF có số → gửi ký 2 người. Trả yeuCauId. */
export async function submitDailyReportForSigning(report: DailyReport, s: DailySendSigners): Promise<string> {
  const res0 = await authFetch(`/api/inventory/daily-reports/${report.id}/reserve-number`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ so: s.so }) })
  const ma = (await readJson<{ maBaoCao: string }>(res0)).maBaoCao
  const pdf = await buildDailyPdf(report, { maBaoCao: ma, nguoiLapChucVu: s.nguoiLap.chuc_vu || null, bgdChucVu: s.bgd.chuc_vu })
  const fieldsByRole = {} as Record<DailyReportSignRole, SigningFieldInput[]>
  for (const role of Object.keys(DAILY_REPORT_SIGN_ORDER) as DailyReportSignRole[]) {
    const b = pdf.boxesByRole[role]
    const nhan = DAILY_REPORT_SIGN_ORDER[role].label
    fieldsByRole[role] = [
      { page: b.page, ...jsPdfBoxToPt(pdf.pageHeightMm, b.chuKyBox), loai: "chu_ky", nhan },
      { page: b.page, ...jsPdfBoxToPt(pdf.pageHeightMm, b.tenBox), loai: "ten", nhan },
    ]
  }
  const res = await authFetch(`/api/inventory/daily-reports/${report.id}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileBase64: bytesToBase64(pdf.bytes), fieldsByRole, nguoiLapId: s.nguoiLap.id, bgdId: s.bgd.id }),
  })
  return (await readJson<{ yeuCauId: string }>(res)).yeuCauId
}

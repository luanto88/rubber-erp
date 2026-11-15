// Định mức KTKT GĐ4 — thao tác báo cáo kỳ từ trình duyệt (supabase anon theo RLS + API service role). Rule 30.

import { supabase } from "@/lib/supabase"
import { authFetch } from "@/lib/auth-fetch"
import { fetchAllPaginated } from "@/lib/supabase-helpers"
import { jsPdfBoxToPt } from "@/lib/signing/coords"
import type { SigningFieldInput } from "@/lib/signing/requests"
import { buildNormReportPdf, type NormReportPdf } from "./report-pdf"
import {
  NORM_REPORT_PATH,
  NORM_REPORT_SIGN_ORDER,
  hashNormSnapshot,
  type NormReport,
  type NormReportBatch,
  type NormReportSignRole,
  type NormReportSnapshot,
  type NormReportTemplate,
} from "./report-types"

export type NormPerson = { id: string; full_name: string; chuc_vu: string }
export type NormApprovers = { nguoiLap: NormPerson[]; bgd: NormPerson[]; bgdFallback: boolean; defaultBgdId: string | null; defaultNguoiLapId: string }

async function readJson<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error || `Lỗi máy chủ (${res.status})`)
  return json
}

export async function loadReportTemplates(factoryId: string): Promise<NormReportTemplate[]> {
  return fetchAllPaginated<NormReportTemplate>((a, b) =>
    supabase.from("tech_norm_report_templates").select("*").eq("factory_id", factoryId).order("sort_order").order("id").range(a, b),
  )
}

export async function saveReportTemplate(id: string, patch: Partial<Pick<NormReportTemplate, "name" | "config" | "is_active" | "sort_order" | "khoa_ngay">>) {
  const { error } = await supabase.from("tech_norm_report_templates").update(patch).eq("id", id)
  if (error) throw error
}

const REPORT_COLS =
  "id,factory_id,batch_id,template_id,template_code,template_name,template_kieu,template_phien_ban,config,khoa_ngay,phong_ban,loai_van_ban,nam,so,ma_bao_cao,trang_thai,giai_trinh,kien_nghi,nguoi_lap_id,bgd_id,yeu_cau_ky_id,van_ban_document_id,du_lieu_hash,khoa_tu,khoa_den,gui_ky_luc,da_ky_luc,ly_do_huy,created_by,created_at,updated_at"

export type BatchLite = Omit<NormReportBatch, "snapshot">

export async function loadReportList(factoryId: string): Promise<{ batches: BatchLite[]; reports: NormReport[] }> {
  const [batches, reports] = await Promise.all([
    fetchAllPaginated<BatchLite>((a, b) =>
      supabase
        .from("tech_norm_report_batches")
        .select("id,factory_id,tu_ngay,den_ngay,materials,notes,meter_from,meter_to,du_lieu_hash,created_by,created_at")
        .eq("factory_id", factoryId)
        .order("tu_ngay", { ascending: false })
        .order("id")
        .range(a, b),
    ),
    fetchAllPaginated<NormReport>((a, b) => supabase.from("tech_norm_reports").select(REPORT_COLS).eq("factory_id", factoryId).order("created_at").order("id").range(a, b)),
  ])
  return { batches, reports }
}

export async function loadReportDetail(factoryId: string, id: string): Promise<{ report: NormReport; batch: NormReportBatch; siblings: NormReport[] }> {
  const { data: report, error } = await supabase.from("tech_norm_reports").select(REPORT_COLS).eq("factory_id", factoryId).eq("id", id).maybeSingle()
  if (error) throw error
  if (!report) throw new Error("Không tìm thấy báo cáo (hoặc bạn không có quyền xem).")
  const { data: batch, error: bErr } = await supabase.from("tech_norm_report_batches").select("*").eq("id", report.batch_id).maybeSingle()
  if (bErr) throw bErr
  if (!batch) throw new Error("Không tìm thấy bộ báo cáo.")
  const { data: sib } = await supabase.from("tech_norm_reports").select(REPORT_COLS).eq("batch_id", report.batch_id).order("created_at")
  return { report: report as NormReport, batch: batch as NormReportBatch, siblings: (sib || []) as NormReport[] }
}

/** Lưu bộ báo cáo mới: 1 batch (snapshot dùng chung) + 1 báo cáo Nháp / mẫu tick. */
export async function createReportBatch(
  factoryId: string,
  snapshot: NormReportSnapshot,
  templates: NormReportTemplate[],
  extra: { giaiTrinh: Record<string, string>; kienNghi: string },
): Promise<{ batchId: string; reportIds: string[] }> {
  const hash = await hashNormSnapshot(snapshot)
  const { data: batch, error } = await supabase
    .from("tech_norm_report_batches")
    .insert({
      factory_id: factoryId,
      tu_ngay: snapshot.from,
      den_ngay: snapshot.to,
      materials: snapshot.materials,
      notes: snapshot.notes,
      meter_from: snapshot.meterFrom,
      meter_to: snapshot.meterTo,
      snapshot,
      du_lieu_hash: hash,
    })
    .select("id")
    .single()
  if (error || !batch) throw error || new Error("Không lưu được bộ báo cáo")
  const rows = templates.map((t) => ({
    factory_id: factoryId,
    batch_id: batch.id,
    template_id: t.id,
    template_code: t.code,
    template_name: t.name,
    template_kieu: t.kieu,
    template_phien_ban: t.phien_ban,
    config: t.config || {},
    khoa_ngay: t.khoa_ngay,
    phong_ban: t.phong_ban,
    loai_van_ban: t.loai_van_ban,
    trang_thai: "nhap",
    giai_trinh: t.kieu === "thang_8a" ? extra.giaiTrinh : {},
    kien_nghi: t.kieu === "thang_8a" ? extra.kienNghi || null : null,
  }))
  const { data: ins, error: rErr } = await supabase.from("tech_norm_reports").insert(rows).select("id")
  if (rErr) {
    await supabase.from("tech_norm_report_batches").delete().eq("id", batch.id)
    throw rErr
  }
  return { batchId: batch.id as string, reportIds: ((ins || []) as { id: string }[]).map((r) => r.id) }
}

export async function updateReportTexts(id: string, patch: { giai_trinh?: Record<string, string>; kien_nghi?: string | null }) {
  const { error } = await supabase.from("tech_norm_reports").update(patch).eq("id", id)
  if (error) throw error
}

export async function deleteReportDraft(report: NormReport) {
  const { error } = await supabase.from("tech_norm_reports").delete().eq("id", report.id).eq("trang_thai", "nhap")
  if (error) throw error
  const { count } = await supabase.from("tech_norm_reports").select("id", { count: "exact", head: true }).eq("batch_id", report.batch_id)
  if (!count) await supabase.from("tech_norm_report_batches").delete().eq("id", report.batch_id)
}

export async function fetchNormApprovers(): Promise<NormApprovers> {
  return readJson<NormApprovers>(await authFetch("/api/norms/approvers"))
}

export async function syncReportStatuses(ids: string[]): Promise<void> {
  if (!ids.length) return
  await authFetch("/api/norms/reports/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).catch(() => null)
}

export async function reportAction(id: string, action: "recall" | "cancel", lyDo?: string) {
  await readJson(await authFetch(`/api/norms/reports/${id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, lyDo }) }))
}

let factoryNameCache: { id: string; name: string } | null = null
async function factoryName(factoryId: string): Promise<string> {
  if (factoryNameCache?.id === factoryId) return factoryNameCache.name
  const { data } = await supabase.from("factories").select("name").eq("id", factoryId).maybeSingle()
  factoryNameCache = { id: factoryId, name: (data?.name as string) || "" }
  return factoryNameCache.name
}

export function reportQrUrl(id: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://qlsxkpt.vercel.app"
  return `${origin}${NORM_REPORT_PATH(id)}`
}

/** Dựng PDF của 1 báo cáo (bản chưa ký / bản gửi ký). */
export async function buildReportPdf(
  report: NormReport,
  snapshot: NormReportSnapshot,
  opts: { maBaoCao?: string | null; nguoiLapChucVu?: string | null; bgdChucVu?: string | null; giaiTrinh?: Record<string, string>; kienNghi?: string | null } = {},
): Promise<NormReportPdf> {
  return buildNormReportPdf({
    kieu: report.template_kieu,
    templateCode: report.template_code,
    templateName: report.template_name,
    config: report.config || {},
    snapshot,
    factoryName: await factoryName(report.factory_id),
    maBaoCao: opts.maBaoCao === undefined ? report.ma_bao_cao : opts.maBaoCao,
    phongBan: report.phong_ban,
    loaiKyHieu: report.loai_van_ban,
    giaiTrinh: opts.giaiTrinh ?? report.giai_trinh ?? {},
    kienNghi: opts.kienNghi === undefined ? report.kien_nghi : opts.kienNghi,
    nguoiLapChucVu: opts.nguoiLapChucVu ?? null,
    bgdChucVu: opts.bgdChucVu ?? null,
    qrUrl: reportQrUrl(report.id),
  })
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

async function reserveNumber(id: string, so: number | null): Promise<string> {
  const res = await authFetch(`/api/norms/reports/${id}/reserve-number`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ so }) })
  return (await readJson<{ maBaoCao: string }>(res)).maBaoCao
}

export type SendSigners = { nguoiLap: NormPerson; bgd: NormPerson; so: number | null }

/** Cấp số → dựng PDF có số → gửi ký 2 người. Trả yeuCauId. */
export async function submitReportForSigning(report: NormReport, snapshot: NormReportSnapshot, s: SendSigners): Promise<string> {
  const ma = await reserveNumber(report.id, s.so)
  const pdf = await buildReportPdf(report, snapshot, { maBaoCao: ma, nguoiLapChucVu: s.nguoiLap.chuc_vu, bgdChucVu: s.bgd.chuc_vu })
  const fieldsByRole = {} as Record<NormReportSignRole, SigningFieldInput[]>
  for (const role of Object.keys(NORM_REPORT_SIGN_ORDER) as NormReportSignRole[]) {
    const b = pdf.boxesByRole[role]
    const nhan = NORM_REPORT_SIGN_ORDER[role].label
    fieldsByRole[role] = [
      { page: b.page, ...jsPdfBoxToPt(pdf.pageHeightMm, b.chuKyBox), loai: "chu_ky", nhan },
      { page: b.page, ...jsPdfBoxToPt(pdf.pageHeightMm, b.tenBox), loai: "ten", nhan },
    ]
  }
  const res = await authFetch(`/api/norms/reports/${report.id}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileBase64: bytesToBase64(pdf.bytes), fieldsByRole, nguoiLapId: s.nguoiLap.id, bgdId: s.bgd.id }),
  })
  return (await readJson<{ yeuCauId: string }>(res)).yeuCauId
}

/** Cấp số → dựng PDF → tạo văn bản nội bộ nháp. Trả id văn bản. */
export async function sendReportToVanBan(report: NormReport, snapshot: NormReportSnapshot, s: SendSigners): Promise<string> {
  const ma = await reserveNumber(report.id, s.so)
  const pdf = await buildReportPdf(report, snapshot, { maBaoCao: ma, nguoiLapChucVu: s.nguoiLap.chuc_vu, bgdChucVu: s.bgd.chuc_vu })
  const res = await authFetch(`/api/norms/reports/${report.id}/to-van-ban`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileBase64: bytesToBase64(pdf.bytes), nguoiLapId: s.nguoiLap.id, bgdId: s.bgd.id }),
  })
  return (await readJson<{ docId: string }>(res)).docId
}

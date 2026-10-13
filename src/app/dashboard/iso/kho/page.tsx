"use client"

import Link from "next/link"
import { useState, useEffect, useCallback } from "react"
import { Archive, Eye, Download, AlertTriangle, BadgeCheck, ArrowUpRight } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, getFreshAuthSession, type SessionUser } from "@/lib/auth"
import { canOpenIsoFile, EXPIRED_FILE_HINT } from "@/app/dashboard/iso/_components/iso-file-access"
import { isFormInstanceRelated } from "@/app/dashboard/iso/_components/iso-access"
import { LOAI_TAI_LIEU_LABEL } from "@/app/dashboard/iso/_components/iso-types"
// Vá bảo mật 2026-09-20: bucket iso-documents sẽ chuyển private — không còn dùng URL public
// (`item.file_url`, chỉ để tính "có file hay không" ở dưới) để mở/tải trực tiếp. Mint Signed URL
// qua route xác thực đúng module (documents/forms) — xem secure-file-open.ts.
import { openSecureFile } from "@/app/dashboard/_components/secure-file-open"
import { IsoShell } from "@/app/dashboard/iso/_components/iso-shell"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { PageBackgroundMotif } from "@/app/dashboard/_components/page-background-motif"
import { authFetch } from "@/lib/auth-fetch"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { IconAction } from "@/app/dashboard/_components/doc-ui/icon-action"
import { DocCodePill } from "@/app/dashboard/_components/doc-ui/doc-code-pill"

type KhoItem = {
  recipientId: string
  docId: string
  itemType: "document" | "form"
  ma_tai_lieu: string | null
  ten_tai_lieu: string
  loai_tai_lieu: string | null
  trang_thai: string
  ngay_hieu_luc: string | null
  lan_ban_hanh: string | null
  ngay_nhan: string // created_at của recipient row hoặc ngày tạo
  first_viewed_at: string | null
  first_downloaded_at: string | null
  file_url: string | null // ưu tiên: signed_pdf > signed_office > goc
  created_by?: string | null
  soan_thao_user_id?: string | null
  xem_xet_user_id?: string | null
  phe_duyet_user_id?: string | null
  nguoi_tao?: string | null
  is_owner?: boolean // user là tác giả / người soạn / người soát xét / người lập
  new_doc_id?: string | null // ID bản mới có hiệu lực thay thế (nếu có)
  new_doc_ma?: string | null // Lần ban hành bản mới
}

/** Hiện nguyên văn loại tài liệu ("Quy trình") thay vì mã (QT); giá trị lọc vẫn là mã. */
function loaiLabel(code: string): string {
  return LOAI_TAI_LIEU_LABEL[code] || code
}

function getFileUrl(doc: {
  file_signed_pdf_url: string | null
  file_signed_office_url: string | null
  file_goc_url: string | null
}): string | null {
  return doc.file_signed_pdf_url || doc.file_signed_office_url || doc.file_goc_url || null
}

function fileUrlEndpoint(item: Pick<KhoItem, "docId" | "itemType">, download?: boolean): string {
  const base = item.itemType === "form"
    ? `/api/iso/forms/${item.docId}/file-url`
    : `/api/iso/documents/${item.docId}/file-url?variant=main`
  if (!download) return base
  return `${base}${base.includes("?") ? "&" : "?"}download=1`
}

type TrackResult =
  | { ok: true; first_viewed_at: string | null; first_downloaded_at: string | null }
  | { ok: false; error: string }

/**
 * Ghi mốc "đã xem / đã tải" của lượt PHÂN PHỐI. Chỉ áp dụng cho dòng có bản ghi người nhận thật
 * (recipientId không bắt đầu bằng "owner-"). Trả về mốc mới nhất để cập nhật giao diện ngay.
 */
async function trackAction(item: Pick<KhoItem, "docId" | "itemType">, action: "view" | "download"): Promise<TrackResult> {
  try {
    const res = await authFetch("/api/iso/distribute/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docId: item.docId, action, itemType: item.itemType }),
    })
    const json = (await res.json().catch(() => ({}))) as {
      error?: string
      first_viewed_at?: string | null
      first_downloaded_at?: string | null
    }
    if (!res.ok) return { ok: false, error: json.error || "Không ghi nhận được lượt xem/tải" }
    return { ok: true, first_viewed_at: json.first_viewed_at ?? null, first_downloaded_at: json.first_downloaded_at ?? null }
  } catch {
    return { ok: false, error: "Lỗi kết nối khi ghi nhận lượt xem/tải" }
  }
}

function isDistributedItem(item: Pick<KhoItem, "recipientId">): boolean {
  return !item.recipientId.startsWith("owner-")
}

export default function KhoPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  // Cache session (gồm mảng permissions) — cần cho canOpenIsoFile. Quyền vừa được admin cấp
  // chỉ có hiệu lực sau khi tải lại trang, vì chỉ bootstrap của dashboard/layout.tsx mới gọi
  // hydrateActiveSession() làm mới cache này.
  const [user, setUser] = useState<SessionUser | null>(null)
  const [items, setItems] = useState<KhoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [trackError, setTrackError] = useState<string | null>(null)

  // Ghi mốc xem/tải rồi cập nhật NGAY dòng đó (không tải lại trang). Mục "của bạn" (owner-…)
  // không có bản ghi người nhận nên không theo dõi.
  const handleTrack = useCallback(async (item: KhoItem, action: "view" | "download") => {
    if (!isDistributedItem(item)) return
    const already = action === "view" ? item.first_viewed_at : item.first_downloaded_at
    if (already) return
    const result = await trackAction(item, action)
    if (!result.ok) {
      setTrackError(result.error)
      return
    }
    setItems((prev) =>
      prev.map((row) =>
        row.recipientId === item.recipientId
          ? {
              ...row,
              first_viewed_at: result.first_viewed_at ?? row.first_viewed_at,
              first_downloaded_at: result.first_downloaded_at ?? row.first_downloaded_at,
            }
          : row,
      ),
    )
  }, [])

  // Filters — Mặc định lọc "co_hieu_luc" để người dùng tập trung vào tài liệu đang vận hành
  const [filterLoai, setFilterLoai] = useState<string[]>([])
  const [filterTrangThai, setFilterTrangThai] = useState<string>("co_hieu_luc")

  const loadItems = useCallback(
    async (fid: string, uid: string) => {
      setLoading(true)
      try {
        // 1. Lấy danh sách tài liệu / hồ sơ được phân phối đến user
        const { data: recData } = await supabase
          .from("iso_distribution_recipients")
          .select("id, iso_document_id, iso_form_instance_id, item_type, first_viewed_at, first_downloaded_at, created_at")
          .eq("factory_id", fid)
          .eq("recipient_user_id", uid)
          .order("created_at", { ascending: false })

        const rawRows = (recData || []) as Array<{
          id: string
          iso_document_id: string | null
          iso_form_instance_id: string | null
          item_type: string | null
          first_viewed_at: string | null
          first_downloaded_at: string | null
          created_at: string
        }>

        const docIds = rawRows.map((r) => r.iso_document_id).filter(Boolean) as string[]
        const formIds = rawRows.map((r) => r.iso_form_instance_id).filter(Boolean) as string[]

        // 2. Lấy thêm tài liệu do chính user tạo / soạn thảo / xem xét / phê duyệt (co_hieu_luc hoặc het_hieu_luc)
        // 3. Lấy thêm hồ sơ đã phê duyệt user lập hoặc ký bất kỳ bước (GĐ3 sau test: trước đây bỏ
        //    sót người phê duyệt và người ký các bước trong thu_tu_ky_json)
        // 4. Lấy danh sách tài liệu đang có hiệu lực để đối chiếu bản thay thế cho bản hết hiệu lực
        const formCols = "id, tieu_de, trang_thai, template_doc_id, ky_phe_duyet_at, final_pdf_url, final_office_url, soan_thao_signed_url, draft_file_url, nguoi_tao, xem_xet_user_id, phe_duyet_user_id, thu_tu_ky_json, created_at"
        const [docsRes, formsRes, userDocsRes, userFormsByColsRes, userFormsByStepsRes, activeDocsRes] = await Promise.all([
          docIds.length > 0
            ? supabase
                .from("iso_documents")
                .select("id, ma_tai_lieu, ten_tai_lieu, loai_tai_lieu, trang_thai, ngay_hieu_luc, lan_ban_hanh, file_signed_pdf_url, file_signed_office_url, file_goc_url, created_by, soan_thao_user_id, xem_xet_user_id, phe_duyet_user_id")
                .in("id", docIds)
            : Promise.resolve({ data: [] }),
          formIds.length > 0
            ? supabase
                .from("iso_form_instances")
                .select("id, tieu_de, trang_thai, template_doc_id, ky_phe_duyet_at, final_pdf_url, final_office_url, soan_thao_signed_url, draft_file_url, nguoi_tao, xem_xet_user_id, phe_duyet_user_id")
                .in("id", formIds)
            : Promise.resolve({ data: [] }),
          supabase
            .from("iso_documents")
            .select("id, ma_tai_lieu, ten_tai_lieu, loai_tai_lieu, trang_thai, ngay_hieu_luc, lan_ban_hanh, file_signed_pdf_url, file_signed_office_url, file_goc_url, created_by, soan_thao_user_id, xem_xet_user_id, phe_duyet_user_id, created_at")
            .eq("factory_id", fid)
            .or(`created_by.eq.${uid},soan_thao_user_id.eq.${uid},xem_xet_user_id.eq.${uid},phe_duyet_user_id.eq.${uid}`)
            .in("trang_thai", ["co_hieu_luc", "het_hieu_luc"])
            .order("created_at", { ascending: false }),
          supabase
            .from("iso_form_instances")
            .select(formCols)
            .eq("factory_id", fid)
            .or(`nguoi_tao.eq.${uid},xem_xet_user_id.eq.${uid},phe_duyet_user_id.eq.${uid}`)
            .eq("trang_thai", "da_phe_duyet")
            .order("created_at", { ascending: false }),
          supabase
            .from("iso_form_instances")
            .select(formCols)
            .eq("factory_id", fid)
            // ⚠️ Chuỗi JSON, không phải mảng object (mảng → lỗi 22P02, data = null âm thầm).
            .contains("thu_tu_ky_json", JSON.stringify([{ user_id: uid }]))
            .eq("trang_thai", "da_phe_duyet")
            .order("created_at", { ascending: false }),
          supabase
            .from("iso_documents")
            .select("id, ma_tai_lieu, lan_ban_hanh")
            .eq("factory_id", fid)
            .eq("trang_thai", "co_hieu_luc"),
        ])

        // Bản đồ tài liệu đang có hiệu lực theo mã (chuẩn hóa chữ thường)
        const activeDocByCode = new Map<string, { id: string; lan_ban_hanh: string | null }>()
        for (const ad of ((activeDocsRes.data || []) as any[])) {
          if (ad.ma_tai_lieu) {
            activeDocByCode.set(ad.ma_tai_lieu.trim().toLowerCase(), { id: ad.id, lan_ban_hanh: ad.lan_ban_hanh })
          }
        }

        // Gộp 2 truy vấn hồ sơ của mình theo id, lọc lại bằng isFormInstanceRelated.
        type KhoFormRow = Parameters<typeof isFormInstanceRelated>[0] & { id: string }
        if (userFormsByColsRes.error) console.error("[iso/kho] hồ sơ theo cột lỗi:", userFormsByColsRes.error.message)
        if (userFormsByStepsRes.error) console.error("[iso/kho] hồ sơ theo bước ký lỗi:", userFormsByStepsRes.error.message)
        const userFormsMap = new Map<string, KhoFormRow>()
        for (const f of [...((userFormsByColsRes.data || []) as KhoFormRow[]), ...((userFormsByStepsRes.data || []) as KhoFormRow[])]) {
          if (isFormInstanceRelated(f, uid)) userFormsMap.set(f.id, f)
        }
        const userFormsRes = { data: [...userFormsMap.values()] }

        const docsMap = new Map(((docsRes.data || []) as any[]).map((d) => [d.id, d]))
        const rawForms = (formsRes.data || []) as any[]

        // Lấy mã template cho form instances
        const allFormTmplIds = [
          ...rawForms.map((f) => f.template_doc_id),
          ...((userFormsRes.data || []) as any[]).map((f) => f.template_doc_id),
        ].filter(Boolean) as string[]

        const tmplRes = allFormTmplIds.length > 0
          ? await supabase.from("iso_documents").select("id, ma_tai_lieu, ten_tai_lieu").in("id", allFormTmplIds)
          : { data: [] }
        const tmplMap = new Map(((tmplRes.data || []) as any[]).map((t) => [t.id, t]))

        const formsMap = new Map(rawForms.map((f) => [f.id, f]))

        // Deduplicate: mỗi item giữ row mới nhất
        const seen = new Map<string, KhoItem>()

        // 1. Xử lý các dòng được phân phối
        for (const row of rawRows) {
          const isForm = row.item_type === "form" || (!!row.iso_form_instance_id && !row.iso_document_id)
          const itemId = isForm ? row.iso_form_instance_id! : row.iso_document_id!
          if (!itemId || seen.has(itemId)) continue

          if (isForm) {
            const form = formsMap.get(itemId)
            if (!form) continue
            const tmpl = form.template_doc_id ? tmplMap.get(form.template_doc_id) : null
            const isOwner = isFormInstanceRelated(form, uid)
            seen.set(itemId, {
              recipientId: row.id,
              docId: itemId,
              itemType: "form",
              ma_tai_lieu: tmpl?.ma_tai_lieu || "Biểu mẫu",
              ten_tai_lieu: form.tieu_de || tmpl?.ten_tai_lieu || "Hồ sơ thực hiện",
              loai_tai_lieu: "Hồ sơ thực hiện",
              trang_thai: form.trang_thai === "da_phe_duyet" ? "co_hieu_luc" : form.trang_thai,
              ngay_hieu_luc: form.ky_phe_duyet_at || null,
              lan_ban_hanh: "—",
              ngay_nhan: row.created_at,
              first_viewed_at: row.first_viewed_at,
              first_downloaded_at: row.first_downloaded_at,
              file_url: form.final_pdf_url || form.soan_thao_signed_url || form.draft_file_url || null,
              nguoi_tao: form.nguoi_tao,
              xem_xet_user_id: form.xem_xet_user_id,
              phe_duyet_user_id: form.phe_duyet_user_id,
              is_owner: isOwner,
            })
          } else {
            const doc = docsMap.get(itemId)
            if (!doc) continue
            const isOwner = doc.created_by === uid || doc.soan_thao_user_id === uid || doc.xem_xet_user_id === uid || doc.phe_duyet_user_id === uid
            const normCode = doc.ma_tai_lieu ? doc.ma_tai_lieu.trim().toLowerCase() : ""
            const activeMatch = doc.trang_thai === "het_hieu_luc" && normCode ? activeDocByCode.get(normCode) : null
            const newDocId = activeMatch && activeMatch.id !== itemId ? activeMatch.id : null

            seen.set(itemId, {
              recipientId: row.id,
              docId: itemId,
              itemType: "document",
              ma_tai_lieu: doc.ma_tai_lieu,
              ten_tai_lieu: doc.ten_tai_lieu,
              loai_tai_lieu: doc.loai_tai_lieu,
              trang_thai: doc.trang_thai,
              ngay_hieu_luc: doc.ngay_hieu_luc,
              lan_ban_hanh: doc.lan_ban_hanh,
              ngay_nhan: row.created_at,
              first_viewed_at: row.first_viewed_at,
              first_downloaded_at: row.first_downloaded_at,
              file_url: getFileUrl(doc),
              created_by: doc.created_by,
              soan_thao_user_id: doc.soan_thao_user_id,
              xem_xet_user_id: doc.xem_xet_user_id,
              phe_duyet_user_id: doc.phe_duyet_user_id,
              is_owner: isOwner,
              new_doc_id: newDocId,
              new_doc_ma: activeMatch?.lan_ban_hanh || null,
            })
          }
        }

        // 2. Bổ sung các tài liệu do user tạo/soạn thảo/soát xét nếu chưa có trong danh sách phân phối
        for (const doc of ((userDocsRes.data || []) as any[])) {
          const itemId = doc.id
          const normCode = doc.ma_tai_lieu ? doc.ma_tai_lieu.trim().toLowerCase() : ""
          const activeMatch = doc.trang_thai === "het_hieu_luc" && normCode ? activeDocByCode.get(normCode) : null
          const newDocId = activeMatch && activeMatch.id !== itemId ? activeMatch.id : null

          if (seen.has(itemId)) {
            // Cập nhật cờ owner và context
            const exist = seen.get(itemId)!
            exist.is_owner = true
            exist.created_by = doc.created_by
            exist.soan_thao_user_id = doc.soan_thao_user_id
            exist.xem_xet_user_id = doc.xem_xet_user_id
            exist.phe_duyet_user_id = doc.phe_duyet_user_id
            if (!exist.new_doc_id && newDocId) {
              exist.new_doc_id = newDocId
              exist.new_doc_ma = activeMatch?.lan_ban_hanh || null
            }
          } else {
            seen.set(itemId, {
              recipientId: `owner-${itemId}`,
              docId: itemId,
              itemType: "document",
              ma_tai_lieu: doc.ma_tai_lieu,
              ten_tai_lieu: doc.ten_tai_lieu,
              loai_tai_lieu: doc.loai_tai_lieu,
              trang_thai: doc.trang_thai,
              ngay_hieu_luc: doc.ngay_hieu_luc,
              lan_ban_hanh: doc.lan_ban_hanh,
              ngay_nhan: doc.created_at,
              first_viewed_at: null,
              first_downloaded_at: null,
              file_url: getFileUrl(doc),
              created_by: doc.created_by,
              soan_thao_user_id: doc.soan_thao_user_id,
              xem_xet_user_id: doc.xem_xet_user_id,
              phe_duyet_user_id: doc.phe_duyet_user_id,
              is_owner: true,
              new_doc_id: newDocId,
              new_doc_ma: activeMatch?.lan_ban_hanh || null,
            })
          }
        }

        // 3. Bổ sung hồ sơ do user lập nếu chưa có
        for (const form of ((userFormsRes.data || []) as any[])) {
          const itemId = form.id
          if (seen.has(itemId)) {
            const exist = seen.get(itemId)!
            exist.is_owner = true
            exist.nguoi_tao = form.nguoi_tao
            exist.xem_xet_user_id = form.xem_xet_user_id
            exist.phe_duyet_user_id = form.phe_duyet_user_id
          } else {
            const tmpl = form.template_doc_id ? tmplMap.get(form.template_doc_id) : null
            seen.set(itemId, {
              recipientId: `owner-${itemId}`,
              docId: itemId,
              itemType: "form",
              ma_tai_lieu: tmpl?.ma_tai_lieu || "Biểu mẫu",
              ten_tai_lieu: form.tieu_de || tmpl?.ten_tai_lieu || "Hồ sơ thực hiện",
              loai_tai_lieu: "Hồ sơ thực hiện",
              trang_thai: form.trang_thai === "da_phe_duyet" ? "co_hieu_luc" : form.trang_thai,
              ngay_hieu_luc: form.ky_phe_duyet_at || null,
              lan_ban_hanh: "—",
              ngay_nhan: form.created_at,
              first_viewed_at: null,
              first_downloaded_at: null,
              file_url: form.final_pdf_url || form.soan_thao_signed_url || form.draft_file_url || null,
              nguoi_tao: form.nguoi_tao,
              xem_xet_user_id: form.xem_xet_user_id,
              phe_duyet_user_id: form.phe_duyet_user_id,
              is_owner: true,
            })
          }
        }

        setItems([...seen.values()])
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      const session = await getFreshAuthSession()
      const uid = session?.user?.id
      if (!fid || !uid) {
        setLoading(false)
        return
      }
      setFactoryId(fid)
      setUserId(uid)
      setUser(JSON.parse(localStorage.getItem("erp_user") || "{}") as SessionUser)
    }
    void bootstrap()
  }, [])

  useEffect(() => {
    if (factoryId && userId) void loadItems(factoryId, userId)
  }, [factoryId, userId, loadItems])

  const allLoai = [...new Set(items.map((it) => it.loai_tai_lieu).filter(Boolean))] as string[]

  const filtered = items.filter((it) => {
    if (filterLoai.length > 0 && !filterLoai.includes(it.loai_tai_lieu || ""))
      return false
    if (filterTrangThai === "co_hieu_luc" && it.trang_thai !== "co_hieu_luc")
      return false
    if (filterTrangThai === "het_hieu_luc" && it.trang_thai !== "het_hieu_luc")
      return false
    return true
  })

  const hetHieuLucCount = items.filter((it) => it.trang_thai === "het_hieu_luc").length


  return (
    <IsoShell>
      <div className="space-y-4">
        {trackError && (
          <div className="fixed left-1/2 top-4 z-50 flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-2xl bg-red-600 px-5 py-3 text-white shadow-2xl">
            <span className="text-sm font-bold">{trackError}</span>
            <button type="button" onClick={() => setTrackError(null)} className="text-xs font-bold underline">
              Đóng
            </button>
          </div>
        )}
        <PageBackgroundMotif theme="rubber" />
        <PageHeaderBanner
          title="Kho của tôi"
          subtitle="Tài liệu ISO đã được phân phối đến bạn"
          theme="rubber"
          icon={BadgeCheck}
          collapsible={true}
          storageKey="banner_collapsed_iso_kho"
          action={
            <span className="rounded-full bg-white/15 border border-white/40 px-3 py-1 text-xs font-bold text-white">
              {items.length} tài liệu & hồ sơ
            </span>
          }
        />

        {/* Cảnh báo tài liệu hết hiệu lực */}
        {hetHieuLucCount > 0 && (
          <div className="flex items-center gap-2 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
            <AlertTriangle size={14} className="shrink-0 text-amber-600" />
            <span>
              Có <strong>{hetHieuLucCount}</strong> tài liệu/hồ sơ đã hết hiệu lực. Tài liệu
              hết hiệu lực được giữ lại trong kho để bạn đối chiếu lịch sử nhưng
              không nên áp dụng trong vận hành thực tế.
            </span>
          </div>
        )}

        {/* Filter bar */}
        <FilterBar>
          {/* Loại tài liệu */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs font-bold text-slate-500">Loại:</span>
            {allLoai.map((loai) => {
              const active = filterLoai.includes(loai)
              return (
                <button
                  key={loai}
                  onClick={() =>
                    setFilterLoai((prev) =>
                      active ? prev.filter((l) => l !== loai) : [...prev, loai],
                    )
                  }
                  className={
                    "text-xs font-semibold px-2.5 py-1 rounded-lg transition-all " +
                    (active
                      ? "bg-brand-700 text-white shadow-xs"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-600")
                  }
                >
                  {loaiLabel(loai)}
                </button>
              )
            })}
            {filterLoai.length > 0 && (
              <button
                onClick={() => setFilterLoai([])}
                className="text-xs text-slate-400 hover:text-slate-600 underline"
              >
                Xóa lọc
              </button>
            )}
          </div>

          {/* Trạng thái hiệu lực */}
          <div className="flex items-center gap-1">
            {(
              [
                { key: "all", label: "Tất cả" },
                { key: "co_hieu_luc", label: "Đang hiệu lực" },
                { key: "het_hieu_luc", label: "Hết hiệu lực" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setFilterTrangThai(tab.key)}
                className={
                  "text-xs font-semibold px-2.5 py-1 rounded-lg transition-all " +
                  (filterTrangThai === tab.key
                    ? "bg-slate-800 text-white shadow-xs"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-600")
                }
              >
                {tab.label}
              </button>
            ))}
          </div>
        </FilterBar>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-400">Đang tải...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <Archive size={40} className="mx-auto mb-3 opacity-30" />
              <p>Chưa có tài liệu nào</p>
            </div>
          ) : (
            <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
            <table className="enterprise-table">
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tên / Tiêu đề</th>
                  <th className="hidden md:table-cell">Phân loại</th>
                  <th className="hidden md:table-cell">Ngày nhận</th>
                  <th>Tình trạng</th>
                  <th>Trạng thái</th>
                  <th className="!text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const isHetHieuLuc = item.trang_thai === "het_hieu_luc"
                  return (
                    <tr
                      key={item.recipientId}
                      className={
                        "" +
                        (isHetHieuLuc ? "opacity-70" : "")
                      }
                    >
                      <td className="px-4 py-3 font-bold text-slate-800">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {item.itemType === "form" && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 bg-brand-50 text-brand-800 rounded border border-brand-200 shrink-0">
                              Hồ sơ
                            </span>
                          )}
                          {item.is_owner && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 bg-sky-50 text-sky-700 rounded border border-sky-200 shrink-0">
                              Của bạn
                            </span>
                          )}
                          <DocCodePill code={item.ma_tai_lieu} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700 max-w-xs truncate">
                        {item.ten_tai_lieu}
                      </td>
                      <td className="px-4 py-3 text-slate-500 hidden md:table-cell">
                        {item.loai_tai_lieu ? loaiLabel(item.loai_tai_lieu) : "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-500 hidden md:table-cell">
                        {new Date(item.ngay_nhan).toLocaleDateString("vi-VN")}
                      </td>
                      <td className="px-4 py-3">
                        {!isDistributedItem(item) ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-800"
                            title="Tài liệu bạn tham gia tạo/soạn/xem xét/phê duyệt — không qua phân phối nên không theo dõi lượt xem/tải"
                          >
                            Tài liệu của bạn
                          </span>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <span
                              className={
                                "flex items-center gap-1 text-xs " +
                                (item.first_viewed_at
                                  ? "text-brand-600"
                                  : "text-slate-400")
                              }
                            >
                              <Eye size={11} />
                              {item.first_viewed_at
                                ? `Đã xem ${new Date(item.first_viewed_at).toLocaleDateString("vi-VN")}`
                                : "Chưa xem"}
                            </span>
                            <span
                              className={
                                "flex items-center gap-1 text-xs " +
                                (item.first_downloaded_at
                                  ? "text-sky-700"
                                  : "text-slate-400")
                              }
                            >
                              <Download size={11} />
                              {item.first_downloaded_at
                                ? `Đã tải ${new Date(item.first_downloaded_at).toLocaleDateString("vi-VN")}`
                                : "Chưa tải"}
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {isHetHieuLuc ? (
                          <StatusBadge tone="danger" label="Hết hiệu lực" />
                        ) : (
                          <StatusBadge tone="valid" label="Đang hiệu lực" />
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end flex-wrap">
                          {!item.file_url ? (
                            <span className="text-xs text-slate-400">
                              Chưa có file
                            </span>
                          ) : !canOpenIsoFile(item.trang_thai, user, item, userId) ? (
                            // Tài liệu đã phân phối trước đây nhưng nay hết hiệu lực: người
                            // chưa được cấp iso.view_het_hieu_luc không mở/tải được nữa, vẫn
                            // thấy nguyên dòng để biết mình từng nhận tài liệu này.
                            <div className="flex items-center gap-1.5 flex-wrap justify-end">
                              <span
                                title={EXPIRED_FILE_HINT}
                                className="rounded-lg bg-red-50 px-2 py-1 text-[10px] font-bold text-red-600"
                              >
                                Hết hiệu lực — cần quyền xem
                              </span>
                              {item.new_doc_id && (
                                <Link
                                  href={`/dashboard/iso/documents/${item.new_doc_id}`}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-bold rounded-lg transition-all"
                                  title={`Xem bản mới có hiệu lực (${item.new_doc_ma || ""})`}
                                >
                                  Xem bản mới <ArrowUpRight size={12} />
                                </Link>
                              )}
                            </div>
                          ) : (
                            <>
                              <IconAction
                                icon={Eye}
                                label="Xem tài liệu"
                                onClick={() => {
                                  void openSecureFile(fileUrlEndpoint(item))
                                  void handleTrack(item, "view")
                                }}
                              />
                              <IconAction
                                icon={Download}
                                label="Tải xuống"
                                onClick={() => {
                                  void openSecureFile(fileUrlEndpoint(item, true))
                                  void handleTrack(item, "download")
                                }}
                              />
                              {isHetHieuLuc && item.new_doc_id && (
                                <Link
                                  href={`/dashboard/iso/documents/${item.new_doc_id}`}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-brand-50 hover:bg-brand-100 text-brand-700 text-xs font-bold rounded-lg transition-all"
                                  title={`Xem bản mới có hiệu lực (${item.new_doc_ma || ""})`}
                                >
                                  Bản mới <ArrowUpRight size={12} />
                                </Link>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </ResponsiveTableWrapper>
          )}
        </div>
      </div>
    </IsoShell>
  )
}

"use client"

import { useState, useEffect, useCallback } from "react"
import { Archive, Eye, Download, AlertTriangle, BadgeCheck } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, getFreshAuthSession, type SessionUser } from "@/lib/auth"
import { canOpenIsoFile, EXPIRED_FILE_HINT } from "@/app/dashboard/iso/_components/iso-file-access"
// `<a download>` bị trình duyệt BỎ QUA khi file khác origin (Supabase Storage) — nút "Tải" khi đó
// chỉ mở tab xem. Phải đi qua `?download=` của Storage, xem src/lib/storage-download.ts.
import { buildStorageDownloadUrl } from "@/lib/storage-download"
import { IsoShell } from "@/app/dashboard/iso/_components/iso-shell"
import { FilterBar } from "@/app/dashboard/_components/filter-bar"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { PageBackgroundMotif } from "@/app/dashboard/_components/page-background-motif"

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
  ngay_nhan: string // created_at của recipient row
  first_viewed_at: string | null
  first_downloaded_at: string | null
  file_url: string | null // ưu tiên: signed_pdf > signed_office > goc
}

function getFileUrl(doc: {
  file_signed_pdf_url: string | null
  file_signed_office_url: string | null
  file_goc_url: string | null
}): string | null {
  return doc.file_signed_pdf_url || doc.file_signed_office_url || doc.file_goc_url || null
}

async function trackAction(docId: string, action: "view" | "download") {
  await fetch("/api/iso/distribute/track", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ docId, action }),
  }).catch(() => {})
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

  // Filters
  const [filterLoai, setFilterLoai] = useState<string[]>([])
  const [filterTrangThai, setFilterTrangThai] = useState<string>("all")

  const loadItems = useCallback(
    async (fid: string, uid: string) => {
      setLoading(true)
      try {
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

        const [docsRes, formsRes] = await Promise.all([
          docIds.length > 0
            ? supabase
                .from("iso_documents")
                .select("id, ma_tai_lieu, ten_tai_lieu, loai_tai_lieu, trang_thai, ngay_hieu_luc, lan_ban_hanh, file_signed_pdf_url, file_signed_office_url, file_goc_url")
                .in("id", docIds)
            : Promise.resolve({ data: [] }),
          formIds.length > 0
            ? supabase
                .from("iso_form_instances")
                .select("id, tieu_de, trang_thai, template_doc_id, ky_phe_duyet_at, final_pdf_url, final_office_url, soan_thao_signed_url, draft_file_url")
                .in("id", formIds)
            : Promise.resolve({ data: [] }),
        ])

        const docsMap = new Map(((docsRes.data || []) as any[]).map((d) => [d.id, d]))
        const rawForms = (formsRes.data || []) as any[]

        // Lấy mã template cho form instances
        const tmplIds = rawForms.map((f) => f.template_doc_id).filter(Boolean) as string[]
        const tmplRes = tmplIds.length > 0
          ? await supabase.from("iso_documents").select("id, ma_tai_lieu, ten_tai_lieu").in("id", tmplIds)
          : { data: [] }
        const tmplMap = new Map(((tmplRes.data || []) as any[]).map((t) => [t.id, t]))

        const formsMap = new Map(rawForms.map((f) => [f.id, f]))

        // Deduplicate: mỗi item giữ row mới nhất
        const seen = new Map<string, KhoItem>()
        for (const row of rawRows) {
          const isForm = row.item_type === "form" || (!!row.iso_form_instance_id && !row.iso_document_id)
          const itemId = isForm ? row.iso_form_instance_id! : row.iso_document_id!
          if (!itemId || seen.has(itemId)) continue

          if (isForm) {
            const form = formsMap.get(itemId)
            if (!form) continue
            const tmpl = form.template_doc_id ? tmplMap.get(form.template_doc_id) : null
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
            })
          } else {
            const doc = docsMap.get(itemId)
            if (!doc) continue
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
        <PageBackgroundMotif theme="indigo" />
        <PageHeaderBanner
          title="Kho của tôi"
          subtitle="Tài liệu ISO đã được phân phối đến bạn"
          theme="indigo"
          icon={BadgeCheck}
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
                      ? "bg-violet-600 text-white shadow-xs"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-600")
                  }
                >
                  {loai}
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
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-slate-400">Đang tải...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <Archive size={40} className="mx-auto mb-3 opacity-30" />
              <p>Chưa có tài liệu nào</p>
            </div>
          ) : (
            <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left">
                  <th className="px-4 py-3 font-bold text-slate-600 text-xs">Mã</th>
                  <th className="px-4 py-3 font-bold text-slate-600 text-xs">Tên / Tiêu đề</th>
                  <th className="px-4 py-3 font-bold text-slate-600 text-xs hidden md:table-cell">Phân loại</th>
                  <th className="px-4 py-3 font-bold text-slate-600 text-xs hidden md:table-cell">Ngày nhận</th>
                  <th className="px-4 py-3 font-bold text-slate-600 text-xs">Tình trạng</th>
                  <th className="px-4 py-3 font-bold text-slate-600 text-xs">Trạng thái</th>
                  <th className="px-4 py-3 font-bold text-slate-600 text-xs text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const isHetHieuLuc = item.trang_thai === "het_hieu_luc"
                  return (
                    <tr
                      key={item.recipientId}
                      className={
                        "border-b border-slate-50 transition-colors hover:bg-slate-50 " +
                        (isHetHieuLuc ? "opacity-70" : "")
                      }
                    >
                      <td className="px-4 py-3 font-bold text-slate-800">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {item.itemType === "form" && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded border border-indigo-200 shrink-0">
                              Hồ sơ
                            </span>
                          )}
                          <span>{item.ma_tai_lieu || "—"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700 max-w-xs truncate">
                        {item.ten_tai_lieu}
                      </td>
                      <td className="px-4 py-3 text-slate-500 hidden md:table-cell">
                        {item.loai_tai_lieu || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-500 hidden md:table-cell">
                        {new Date(item.ngay_nhan).toLocaleDateString("vi-VN")}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-0.5">
                          <span
                            className={
                              "flex items-center gap-1 text-xs " +
                              (item.first_viewed_at
                                ? "text-emerald-600"
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
                                ? "text-blue-600"
                                : "text-slate-400")
                            }
                          >
                            <Download size={11} />
                            {item.first_downloaded_at
                              ? `Đã tải ${new Date(item.first_downloaded_at).toLocaleDateString("vi-VN")}`
                              : "Chưa tải"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {isHetHieuLuc ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-600 rounded-full text-xs font-bold">
                            <AlertTriangle size={10} />
                            Hết hiệu lực
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full text-xs font-bold">
                            Đang hiệu lực
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          {!item.file_url ? (
                            <span className="text-xs text-slate-400">
                              Chưa có file
                            </span>
                          ) : !canOpenIsoFile(item.trang_thai, user) ? (
                            // Tài liệu đã phân phối trước đây nhưng nay hết hiệu lực: người
                            // chưa được cấp iso.view_het_hieu_luc không mở/tải được nữa, vẫn
                            // thấy nguyên dòng để biết mình từng nhận tài liệu này.
                            <span
                              title={EXPIRED_FILE_HINT}
                              className="rounded-lg bg-red-50 px-2 py-1 text-[10px] font-bold text-red-600"
                            >
                              Hết hiệu lực — cần quyền xem
                            </span>
                          ) : (
                            <>
                              <a
                                href={item.file_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() =>
                                  void trackAction(item.docId, "view")
                                }
                                className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-all"
                                title="Xem"
                              >
                                <Eye size={12} />
                                Xem
                              </a>
                              <a
                                href={buildStorageDownloadUrl(
                                  item.file_url,
                                  `${item.ma_tai_lieu || "Tài liệu ISO"} ${item.ten_tai_lieu || ""}`.trim(),
                                )}
                                download
                                onClick={() =>
                                  void trackAction(item.docId, "download")
                                }
                                className="flex items-center gap-1 px-2.5 py-1 bg-violet-50 hover:bg-violet-100 text-violet-700 text-xs font-bold rounded-lg transition-all"
                                title="Tải xuống"
                              >
                                <Download size={12} />
                                Tải
                              </a>
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

"use client"

import { useState, useEffect, useCallback } from "react"
import { Archive, Eye, Download, AlertTriangle } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, getFreshAuthSession } from "@/lib/auth"
import { IsoShell } from "@/app/dashboard/iso/_components/iso-shell"

type KhoItem = {
  recipientId: string
  docId: string
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
  const [items, setItems] = useState<KhoItem[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [filterLoai, setFilterLoai] = useState<string[]>([])
  const [filterTrangThai, setFilterTrangThai] = useState<string>("all")

  const loadItems = useCallback(
    async (fid: string, uid: string) => {
      setLoading(true)
      try {
        const { data } = await supabase
          .from("iso_distribution_recipients")
          .select(
            `id, iso_document_id, first_viewed_at, first_downloaded_at, created_at,
             iso_documents!iso_document_id(
               id, ma_tai_lieu, ten_tai_lieu, loai_tai_lieu, trang_thai,
               ngay_hieu_luc, lan_ban_hanh,
               file_signed_pdf_url, file_signed_office_url, file_goc_url
             )`,
          )
          .eq("factory_id", fid)
          .eq("recipient_user_id", uid)
          .order("created_at", { ascending: false })

        type DocJoined = {
          id: string
          ma_tai_lieu: string | null
          ten_tai_lieu: string
          loai_tai_lieu: string | null
          trang_thai: string
          ngay_hieu_luc: string | null
          lan_ban_hanh: string | null
          file_signed_pdf_url: string | null
          file_signed_office_url: string | null
          file_goc_url: string | null
        }
        type RawRecipient = {
          id: string
          iso_document_id: string
          first_viewed_at: string | null
          first_downloaded_at: string | null
          created_at: string
          iso_documents: DocJoined | DocJoined[] | null
        }
        const rows = ((data || []) as unknown) as RawRecipient[]

        // Deduplicate by doc — giữ row cũ nhất (ngày nhận đầu tiên)
        const seen = new Map<string, KhoItem>()
        for (const row of rows) {
          const rawDoc = row.iso_documents
          const doc = Array.isArray(rawDoc) ? (rawDoc[0] ?? null) : rawDoc
          if (!doc) continue
          if (!seen.has(row.iso_document_id)) {
            seen.set(row.iso_document_id, {
              recipientId: row.id,
              docId: row.iso_document_id,
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
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
              <Archive size={22} className="text-violet-600" />
              Kho của tôi
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Tài liệu ISO đã được phân phối đến bạn
            </p>
          </div>
          <div className="text-sm text-slate-500">
            {items.length} tài liệu
          </div>
        </div>

        {/* Cảnh báo hết hiệu lực */}
        {hetHieuLucCount > 0 && (
          <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
            <AlertTriangle size={15} className="shrink-0" />
            <span>
              <span className="font-bold">{hetHieuLucCount}</span> tài liệu bạn đã nhận đã hết hiệu lực.
              Liên hệ Ban ISO để nhận bản mới.
            </span>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex flex-wrap gap-3 items-center">
          <div className="flex flex-wrap gap-2">
            {allLoai.map((loai) => (
              <button
                key={loai}
                onClick={() =>
                  setFilterLoai((prev) =>
                    prev.includes(loai)
                      ? prev.filter((x) => x !== loai)
                      : [...prev, loai],
                  )
                }
                className={
                  "px-3 py-1 rounded-full text-xs font-bold border transition-all " +
                  (filterLoai.includes(loai)
                    ? "bg-violet-600 text-white border-violet-600"
                    : "bg-white text-slate-600 border-slate-300 hover:border-violet-400")
                }
              >
                {loai}
              </button>
            ))}
          </div>

          <select
            value={filterTrangThai}
            onChange={(e) => setFilterTrangThai(e.target.value)}
            className="px-3 py-1.5 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="co_hieu_luc">Đang hiệu lực</option>
            <option value="het_hieu_luc">Hết hiệu lực</option>
          </select>
        </div>

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
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left">
                  <th className="px-4 py-3 font-bold text-slate-600 text-xs">Mã tài liệu</th>
                  <th className="px-4 py-3 font-bold text-slate-600 text-xs">Tên tài liệu</th>
                  <th className="px-4 py-3 font-bold text-slate-600 text-xs hidden md:table-cell">Loại</th>
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
                        {item.ma_tai_lieu || "—"}
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
                          {item.file_url ? (
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
                                href={item.file_url}
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
                          ) : (
                            <span className="text-xs text-slate-400">
                              Chưa có file
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </IsoShell>
  )
}

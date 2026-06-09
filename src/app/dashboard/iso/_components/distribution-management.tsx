"use client"

import { useState, useEffect, useCallback } from "react"
import { Eye, Download, X, ChevronDown, ChevronRight, Users } from "lucide-react"
import { supabase } from "@/lib/supabase"

type RecipientRow = {
  id: string
  recipient_user_id: string
  first_viewed_at: string | null
  first_downloaded_at: string | null
  created_at: string
  recipient_profile: {
    id: string
    full_name: string | null
    username: string | null
    department: string | null
  } | null
}

type DocDistrib = {
  docId: string
  ma_tai_lieu: string
  ten_tai_lieu: string
  recipients: RecipientRow[]
  expanded: boolean
}

type Props = {
  factoryId: string
  userId: string
  docId?: string // nếu undefined → hiển thị tất cả docs của factory
  canDistribute: boolean
}

function fmtDate(iso: string | null) {
  if (!iso) return null
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function DistributionManagement({
  factoryId,
  docId,
  canDistribute,
}: Props) {
  const [docDistribs, setDocDistribs] = useState<DocDistrib[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      let query = supabase
        .from("iso_distribution_recipients")
        .select(
          `id, iso_document_id, recipient_user_id, first_viewed_at, first_downloaded_at, created_at,
           recipient_profile:profiles!recipient_user_id(id, full_name, username, department)`,
        )
        .eq("factory_id", factoryId)
        .order("created_at", { ascending: false })

      if (docId) {
        query = query.eq("iso_document_id", docId)
      }

      const { data: rows } = await query

      // Lấy thông tin tài liệu
      const docIds = [
        ...new Set(
          ((rows || []) as Array<{ iso_document_id: string }>).map(
            (r) => r.iso_document_id,
          ),
        ),
      ]

      let docInfoMap = new Map<
        string,
        { ma_tai_lieu: string; ten_tai_lieu: string }
      >()

      if (docIds.length > 0) {
        const { data: docsData } = await supabase
          .from("iso_documents")
          .select("id, ma_tai_lieu, ten_tai_lieu")
          .in("id", docIds)
          .eq("factory_id", factoryId)

        docInfoMap = new Map(
          ((docsData || []) as Array<{
            id: string
            ma_tai_lieu: string | null
            ten_tai_lieu: string
          }>).map((d) => [
            d.id,
            {
              ma_tai_lieu: d.ma_tai_lieu || "",
              ten_tai_lieu: d.ten_tai_lieu,
            },
          ]),
        )
      }

      // Group by doc
      const grouped = new Map<string, RecipientRow[]>()
      type RawRow = {
        id: string
        iso_document_id: string
        recipient_user_id: string
        first_viewed_at: string | null
        first_downloaded_at: string | null
        created_at: string
        recipient_profile: Array<{ id: string; full_name: string | null; username: string | null; department: string | null }> | null
      }
      for (const rawRow of ((rows || []) as unknown) as RawRow[]) {
        const profileArr = rawRow.recipient_profile
        const row: RecipientRow & { iso_document_id: string } = {
          ...rawRow,
          recipient_profile: Array.isArray(profileArr) ? (profileArr[0] ?? null) : (profileArr as RecipientRow["recipient_profile"]),
        }
        const key = row.iso_document_id
        if (!grouped.has(key)) grouped.set(key, [])
        grouped.get(key)!.push(row)
      }

      const result: DocDistrib[] = []
      for (const [dId, recips] of grouped) {
        const info = docInfoMap.get(dId)
        result.push({
          docId: dId,
          ma_tai_lieu: info?.ma_tai_lieu || dId,
          ten_tai_lieu: info?.ten_tai_lieu || "",
          recipients: recips,
          expanded: !!docId, // auto-expand nếu xem 1 doc
        })
      }

      setDocDistribs(result)
    } finally {
      setLoading(false)
    }
  }, [factoryId, docId])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleRevoke = async (recipientId: string) => {
    setRevoking(recipientId)
    setRevokeError(null)
    try {
      const res = await fetch(`/api/iso/distribute/recipient/${recipientId}`, {
        method: "DELETE",
      })
      const json = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok) {
        setRevokeError(json.error || "Lỗi thu hồi")
        return
      }
      void loadData()
    } catch (err) {
      setRevokeError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setRevoking(null)
    }
  }

  const toggleExpand = (dId: string) => {
    setDocDistribs((prev) =>
      prev.map((d) =>
        d.docId === dId ? { ...d, expanded: !d.expanded } : d,
      ),
    )
  }

  if (loading) {
    return (
      <div className="p-4 text-center text-sm text-slate-400">Đang tải...</div>
    )
  }

  if (docDistribs.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-slate-400">
        Chưa có phân phối nào
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {revokeError && (
        <div className="px-3 py-2 bg-red-50 text-red-600 rounded-xl text-sm">
          {revokeError}
        </div>
      )}

      {docDistribs.map((dd) => {
        const viewedCount = dd.recipients.filter(
          (r) => r.first_viewed_at,
        ).length
        const downloadedCount = dd.recipients.filter(
          (r) => r.first_downloaded_at,
        ).length
        const totalCount = dd.recipients.length

        return (
          <div
            key={dd.docId}
            className="bg-white rounded-xl border border-slate-200 overflow-hidden"
          >
            {/* Header tóm tắt */}
            <button
              onClick={() => toggleExpand(dd.docId)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left"
            >
              {dd.expanded ? (
                <ChevronDown size={14} className="text-slate-400 shrink-0" />
              ) : (
                <ChevronRight size={14} className="text-slate-400 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 truncate">
                  {dd.ma_tai_lieu}
                  {dd.ten_tai_lieu && (
                    <span className="font-normal text-slate-500 ml-1">
                      — {dd.ten_tai_lieu}
                    </span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="flex items-center gap-1 text-xs text-slate-500">
                  <Users size={12} />
                  {totalCount} người
                </span>
                <span className="flex items-center gap-1 text-xs text-emerald-600">
                  <Eye size={12} />
                  {viewedCount}
                </span>
                <span className="flex items-center gap-1 text-xs text-blue-600">
                  <Download size={12} />
                  {downloadedCount}
                </span>
              </div>
            </button>

            {/* Danh sách người nhận */}
            {dd.expanded && (
              <div className="border-t border-slate-100">
                {dd.recipients.map((r) => {
                  const profile = r.recipient_profile
                  const name =
                    profile?.full_name || profile?.username || r.recipient_user_id
                  const dept = profile?.department || ""
                  const canRevoke =
                    canDistribute &&
                    !r.first_viewed_at &&
                    !r.first_downloaded_at

                  return (
                    <div
                      key={r.id}
                      className="flex items-center gap-3 px-4 py-2.5 border-b border-slate-50 last:border-0"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-800">
                          {name}
                          {dept && (
                            <span className="text-xs text-slate-400 ml-1">
                              — {dept}
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Nhận:{" "}
                          {new Date(r.created_at).toLocaleDateString("vi-VN")}
                        </p>
                      </div>

                      {/* Trạng thái xem */}
                      <div className="flex items-center gap-1 text-xs">
                        {r.first_viewed_at ? (
                          <span
                            className="flex items-center gap-1 text-emerald-700"
                            title={`Đã xem lúc ${fmtDate(r.first_viewed_at) || ""}`}
                          >
                            <Eye size={12} />
                            <span className="hidden sm:inline">
                              {fmtDate(r.first_viewed_at)}
                            </span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-slate-400">
                            <Eye size={12} />
                            <span className="hidden sm:inline">Chưa xem</span>
                          </span>
                        )}
                      </div>

                      {/* Trạng thái tải */}
                      <div className="flex items-center gap-1 text-xs">
                        {r.first_downloaded_at ? (
                          <span
                            className="flex items-center gap-1 text-blue-600"
                            title={`Đã tải lúc ${fmtDate(r.first_downloaded_at) || ""}`}
                          >
                            <Download size={12} />
                            <span className="hidden sm:inline">
                              {fmtDate(r.first_downloaded_at)}
                            </span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-slate-400">
                            <Download size={12} />
                            <span className="hidden sm:inline">Chưa tải</span>
                          </span>
                        )}
                      </div>

                      {/* Nút thu hồi */}
                      {canDistribute && (
                        <button
                          onClick={() => void handleRevoke(r.id)}
                          disabled={!canRevoke || revoking === r.id}
                          title={
                            canRevoke
                              ? "Thu hồi phân phối"
                              : "Không thể thu hồi: đã xem hoặc đã tải"
                          }
                          className={
                            "p-1 rounded-lg transition-all " +
                            (canRevoke
                              ? "text-red-400 hover:text-red-600 hover:bg-red-50"
                              : "text-slate-200 cursor-not-allowed")
                          }
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

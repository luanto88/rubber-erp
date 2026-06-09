"use client"

import { useState, useEffect, useCallback } from "react"
import {
  X,
  Send,
  ChevronRight,
  ChevronLeft,
  Search,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react"
import { supabase } from "@/lib/supabase"
import type { IsoDocument } from "./iso-types"

type RecipientOption = {
  id: string
  full_name: string | null
  username: string | null
  department: string | null
  displayName: string
  alreadyReceived?: boolean
}

type Props = {
  factoryId: string
  userId: string
  initialDocIds?: string[] // pre-filled từ trang chi tiết
  onClose: () => void
  onSuccess?: (distributed: number, skipped: number) => void
}

export function DistributionModal({
  factoryId,
  userId,
  initialDocIds,
  onClose,
  onSuccess,
}: Props) {
  const [step, setStep] = useState<1 | 2>(1)

  // Bước 1: chọn tài liệu
  const [docs, setDocs] = useState<IsoDocument[]>([])
  const [loadingDocs, setLoadingDocs] = useState(true)
  const [docFilterLoai, setDocFilterLoai] = useState<string[]>([])
  const [docSearch, setDocSearch] = useState("")
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(
    initialDocIds || [],
  )

  // Bước 2: chọn người nhận
  const [recipients, setRecipients] = useState<RecipientOption[]>([])
  const [loadingRecipients, setLoadingRecipients] = useState(false)
  const [deptFilter, setDeptFilter] = useState<string[]>([])
  const [recipientSearch, setRecipientSearch] = useState("")
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [ghiChu, setGhiChu] = useState("")

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [result, setResult] = useState<{
    distributed: number
    skipped: number
  } | null>(null)

  // Load docs có hiệu lực
  useEffect(() => {
    const loadDocs = async () => {
      setLoadingDocs(true)
      const { data } = await supabase
        .from("iso_documents")
        .select(
          "id, ma_tai_lieu, ten_tai_lieu, loai_tai_lieu, trang_thai, ngay_hieu_luc, lan_ban_hanh, file_signed_pdf_url, file_signed_office_url, file_goc_url",
        )
        .eq("factory_id", factoryId)
        .eq("trang_thai", "co_hieu_luc")
        .order("ma_tai_lieu")
      setDocs((data as IsoDocument[]) || [])
      setLoadingDocs(false)
    }
    void loadDocs()
  }, [factoryId])

  // Load người nhận khi vào bước 2
  const loadRecipients = useCallback(async () => {
    if (selectedDocIds.length === 0) return
    setLoadingRecipients(true)

    const [profilesRes, existingRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, username, department")
        .eq("factory_id", factoryId)
        .eq("status", "active"),
      supabase
        .from("iso_distribution_recipients")
        .select("recipient_user_id, iso_document_id")
        .eq("factory_id", factoryId)
        .in("iso_document_id", selectedDocIds),
    ])

    const existingSet = new Set(
      ((
        existingRes.data as Array<{
          recipient_user_id: string
          iso_document_id: string
        }>
      ) || []).map((r) => r.recipient_user_id),
    )

    const allProfiles = (
      profilesRes.data as Array<{
        id: string
        full_name: string | null
        username: string | null
        department: string | null
      }>
    ) || []

    setRecipients(
      allProfiles.map((p) => ({
        id: p.id,
        full_name: p.full_name,
        username: p.username,
        department: p.department,
        displayName: `${p.full_name || p.username || "Không rõ"} — ${p.department || "Chưa phân phòng"}`,
        alreadyReceived: existingSet.has(p.id),
      })),
    )
    setLoadingRecipients(false)
  }, [factoryId, selectedDocIds])

  useEffect(() => {
    if (step === 2) void loadRecipients()
  }, [step, loadRecipients])

  const allLoaiTl = [...new Set(docs.map((d) => d.loai_tai_lieu).filter(Boolean))]
  const filteredDocs = docs.filter((d) => {
    if (docFilterLoai.length > 0 && !docFilterLoai.includes(d.loai_tai_lieu || ""))
      return false
    if (
      docSearch &&
      !`${d.ma_tai_lieu} ${d.ten_tai_lieu}`
        .toLowerCase()
        .includes(docSearch.toLowerCase())
    )
      return false
    return true
  })

  const allDepts = [
    ...new Set(recipients.map((r) => r.department).filter(Boolean)),
  ] as string[]

  const filteredRecipients = recipients.filter((r) => {
    if (deptFilter.length > 0 && !deptFilter.includes(r.department || ""))
      return false
    if (
      recipientSearch &&
      !r.displayName.toLowerCase().includes(recipientSearch.toLowerCase())
    )
      return false
    return true
  })

  const newRecipients = filteredRecipients.filter((r) => !r.alreadyReceived)
  const alreadyReceivedInView = filteredRecipients.filter((r) => r.alreadyReceived)

  const handleSelectAllDept = () => {
    const ids = newRecipients.map((r) => r.id)
    setSelectedUserIds((prev) => {
      const existing = new Set(prev)
      ids.forEach((id) => existing.add(id))
      return [...existing]
    })
  }

  const handleSubmit = async () => {
    if (selectedDocIds.length === 0 || selectedUserIds.length === 0) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch("/api/iso/distribute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          factoryId,
          docIds: selectedDocIds,
          recipientUserIds: selectedUserIds,
          ghiChu: ghiChu || undefined,
          distributorUserId: userId,
        }),
      })
      const json = (await res.json()) as {
        ok?: boolean
        error?: string
        distributed?: number
        skipped?: number
      }
      if (!res.ok && !json.ok) {
        setSaveError(json.error || "Lỗi phân phối")
        return
      }
      setResult({
        distributed: json.distributed || 0,
        skipped: json.skipped || 0,
      })
      setSaveSuccess(true)
      onSuccess?.(json.distributed || 0, json.skipped || 0)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-base font-extrabold text-slate-800">
              Phân phối tài liệu ISO
            </h2>
            {!saveSuccess && (
              <p className="text-xs text-slate-500 mt-0.5">
                Bước {step}/2 —{" "}
                {step === 1 ? "Chọn tài liệu" : "Chọn người nhận"}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* ─── Thành công ─── */}
          {saveSuccess && result && (
            <div className="flex flex-col items-center py-8 gap-4">
              <CheckCircle2 size={48} className="text-emerald-500" />
              <div className="text-center">
                <p className="text-base font-bold text-slate-800">
                  Đã phân phối thành công!
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  Đã gửi cho{" "}
                  <span className="font-bold text-emerald-700">
                    {result.distributed}
                  </span>{" "}
                  người
                  {result.skipped > 0 && (
                    <>, bỏ qua {result.skipped} người đã nhận trước đó</>
                  )}
                  .
                </p>
              </div>
              <button
                onClick={onClose}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm"
              >
                Đóng
              </button>
            </div>
          )}

          {/* ─── Bước 1: Chọn tài liệu ─── */}
          {!saveSuccess && step === 1 && (
            <div className="space-y-4">
              {/* Filter loại tài liệu */}
              <div className="flex flex-wrap gap-2">
                {allLoaiTl.map((loai) => (
                  <button
                    key={loai}
                    onClick={() =>
                      setDocFilterLoai((prev) =>
                        prev.includes(loai!)
                          ? prev.filter((x) => x !== loai)
                          : [...prev, loai!],
                      )
                    }
                    className={
                      "px-3 py-1 rounded-full text-xs font-bold border transition-all " +
                      (docFilterLoai.includes(loai!)
                        ? "bg-violet-600 text-white border-violet-600"
                        : "bg-white text-slate-600 border-slate-300 hover:border-violet-400")
                    }
                  >
                    {loai}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={docSearch}
                  onChange={(e) => setDocSearch(e.target.value)}
                  placeholder="Tìm mã hoặc tên tài liệu..."
                  className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
                />
              </div>

              {/* Doc list */}
              {loadingDocs ? (
                <p className="text-sm text-slate-400 text-center py-6">
                  Đang tải...
                </p>
              ) : filteredDocs.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">
                  Không có tài liệu nào
                </p>
              ) : (
                <div className="space-y-1 max-h-96 overflow-y-auto">
                  <label className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 rounded-lg cursor-pointer">
                    <input
                      type="checkbox"
                      checked={
                        filteredDocs.length > 0 &&
                        filteredDocs.every((d) =>
                          selectedDocIds.includes(d.id),
                        )
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedDocIds((prev) => {
                            const s = new Set(prev)
                            filteredDocs.forEach((d) => s.add(d.id))
                            return [...s]
                          })
                        } else {
                          setSelectedDocIds((prev) =>
                            prev.filter(
                              (id) => !filteredDocs.find((d) => d.id === id),
                            ),
                          )
                        }
                      }}
                      className="accent-violet-600"
                    />
                    <span className="text-xs font-bold text-slate-500">
                      Chọn tất cả ({filteredDocs.length})
                    </span>
                  </label>
                  {filteredDocs.map((doc) => (
                    <label
                      key={doc.id}
                      className="flex items-start gap-2 px-3 py-2 hover:bg-slate-50 rounded-lg cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedDocIds.includes(doc.id)}
                        onChange={(e) =>
                          setSelectedDocIds((prev) =>
                            e.target.checked
                              ? [...prev, doc.id]
                              : prev.filter((id) => id !== doc.id),
                          )
                        }
                        className="mt-0.5 accent-violet-600"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">
                          {doc.ma_tai_lieu}
                        </p>
                        <p className="text-xs text-slate-500 truncate">
                          {doc.ten_tai_lieu}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {doc.loai_tai_lieu}
                          {doc.ngay_hieu_luc
                            ? ` • Hiệu lực: ${new Date(doc.ngay_hieu_luc).toLocaleDateString("vi-VN")}`
                            : ""}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ─── Bước 2: Chọn người nhận ─── */}
          {!saveSuccess && step === 2 && (
            <div className="space-y-4">
              {/* Filter phòng ban */}
              <div>
                <p className="text-xs font-bold text-slate-600 mb-2">
                  Phòng ban
                </p>
                <div className="flex flex-wrap gap-2">
                  {allDepts.map((dept) => (
                    <button
                      key={dept}
                      onClick={() =>
                        setDeptFilter((prev) =>
                          prev.includes(dept)
                            ? prev.filter((x) => x !== dept)
                            : [...prev, dept],
                        )
                      }
                      className={
                        "px-3 py-1 rounded-full text-xs font-bold border transition-all " +
                        (deptFilter.includes(dept)
                          ? "bg-violet-600 text-white border-violet-600"
                          : "bg-white text-slate-600 border-slate-300 hover:border-violet-400")
                      }
                    >
                      {dept}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search + chọn tất cả */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  />
                  <input
                    value={recipientSearch}
                    onChange={(e) => setRecipientSearch(e.target.value)}
                    placeholder="Tìm tên hoặc phòng ban..."
                    className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500"
                  />
                </div>
                <button
                  onClick={handleSelectAllDept}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl whitespace-nowrap"
                >
                  Chọn tất cả ({newRecipients.length})
                </button>
              </div>

              {/* Recipient list */}
              {loadingRecipients ? (
                <p className="text-sm text-slate-400 text-center py-6">
                  Đang tải...
                </p>
              ) : (
                <div className="space-y-1 max-h-72 overflow-y-auto">
                  {filteredRecipients.length === 0 && (
                    <p className="text-sm text-slate-400 text-center py-6">
                      Không có người dùng nào
                    </p>
                  )}
                  {filteredRecipients.map((r) => (
                    <label
                      key={r.id}
                      className={
                        "flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer " +
                        (r.alreadyReceived
                          ? "opacity-60 bg-amber-50"
                          : "hover:bg-slate-50")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={selectedUserIds.includes(r.id)}
                        disabled={r.alreadyReceived}
                        onChange={(e) =>
                          setSelectedUserIds((prev) =>
                            e.target.checked
                              ? [...prev, r.id]
                              : prev.filter((id) => id !== r.id),
                          )
                        }
                        className="accent-violet-600"
                      />
                      <span className="flex-1 text-sm text-slate-800">
                        {r.displayName}
                      </span>
                      {r.alreadyReceived && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">
                          Đã nhận
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              )}

              {/* Preview summary */}
              {selectedUserIds.length > 0 && (
                <p className="text-xs text-slate-500 bg-violet-50 rounded-xl px-3 py-2">
                  Sẽ phân phối{" "}
                  <span className="font-bold text-violet-700">
                    {selectedDocIds.length} tài liệu
                  </span>{" "}
                  cho{" "}
                  <span className="font-bold text-violet-700">
                    {selectedUserIds.length} người
                  </span>
                  {alreadyReceivedInView.length > 0 && (
                    <>
                      {" "}• bỏ qua {alreadyReceivedInView.length} người đã nhận
                    </>
                  )}
                  .
                </p>
              )}

              {/* Ghi chú */}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Ghi chú (tùy chọn)
                </label>
                <textarea
                  value={ghiChu}
                  onChange={(e) => setGhiChu(e.target.value)}
                  rows={2}
                  placeholder="Ghi chú về đợt phân phối này..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 resize-none"
                />
              </div>

              {/* Error */}
              {saveError && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 text-red-600 rounded-xl text-sm">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>{saveError}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!saveSuccess && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 shrink-0">
            <div className="text-xs text-slate-500">
              {step === 1
                ? `${selectedDocIds.length} tài liệu đã chọn`
                : `${selectedUserIds.length} người đã chọn`}
            </div>
            <div className="flex gap-2">
              {step === 2 && (
                <button
                  onClick={() => setStep(1)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  <ChevronLeft size={14} />
                  Quay lại
                </button>
              )}
              {step === 1 && (
                <button
                  onClick={() => setStep(2)}
                  disabled={selectedDocIds.length === 0}
                  className="flex items-center gap-1.5 px-5 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold rounded-xl text-sm transition-all"
                >
                  Tiếp theo
                  <ChevronRight size={14} />
                </button>
              )}
              {step === 2 && (
                <button
                  onClick={handleSubmit}
                  disabled={saving || selectedUserIds.length === 0}
                  className="flex items-center gap-1.5 px-5 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold rounded-xl text-sm transition-all"
                >
                  {saving ? (
                    "Đang phân phối..."
                  ) : (
                    <>
                      <Send size={14} />
                      Phân phối ngay
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

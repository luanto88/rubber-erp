"use client"

import { useEffect, useRef, useState } from "react"
import { supabase } from "@/lib/supabase"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import {
  CHE_DO_XEM_DESC,
  CHE_DO_XEM_LABEL,
  PHONG_BAN_VAN_BAN_OPTIONS,
  sanitizeStorageFileName,
  fmtDate,
  type VanBanDocument,
  type ThuTuKyStep,
} from "./documents-types"
import {
  AlertTriangle,
  FileText,
  Globe,
  Lock,
  Plus,
  Trash2,
  Upload,
  X,
  Eye,
  Loader2,
} from "lucide-react"

const STORAGE_BUCKET = "iso-documents"

export type EditStepForm = {
  id: string
  type: "phong_ban"
  phong_ban_code: string
  /** Người ký đích danh — bắt buộc từ 2026-09-05. */
  user_id: string
}

export type EditDeptUser = { id: string; full_name: string; username: string; department?: string }

function emptyEditStep(step: number): EditStepForm {
  return { id: `edit-step-${step}-${Date.now()}`, type: "phong_ban", phong_ban_code: "", user_id: "" }
}

function getFileNameFromUrl(url: string | null): string {
  if (!url) return ""
  try {
    const pathname = new URL(url).pathname
    const filename = decodeURIComponent(pathname.split("/").pop() || "")
    return filename.replace(/^\d+_/, "")
  } catch {
    return url.split("/").pop() || "Tệp đính kèm"
  }
}

function getFileExt(urlOrName: string | null): string {
  if (!urlOrName) return ""
  const match = urlOrName.match(/\.([a-zA-Z0-9]+)($|\?)/)
  return match ? match[1].toLowerCase() : ""
}

export function EditDocModal({
  doc,
  factoryId,
  onClose,
  onSaved,
}: {
  doc: VanBanDocument
  factoryId: string
  onClose: () => void
  onSaved: () => void
}) {
  const isDonVi = doc.pham_vi === "Don_vi"

  const [cheDoXem, setCheDoXem] = useState(doc.che_do_xem === "gioi_han" ? "gioi_han" : "cong_khai")
  const isGioiHan = cheDoXem === "gioi_han"

  const [tenVanBan, setTenVanBan] = useState(doc.ten_van_ban)
  const [ghiChu, setGhiChu] = useState(doc.ghi_chu || "")
  const [moTaTimKiem, setMoTaTimKiem] = useState(doc.mo_ta_tim_kiem || "")

  // Quản lý thay thế file đính kèm
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [newFile, setNewFile] = useState<File | null>(null)

  const [steps, setSteps] = useState<EditStepForm[]>(
    !isDonVi
      ? (doc.thu_tu_ky_json || [])
          .filter((s) => s.type === "phong_ban")
          .map((s, i) => ({
            id: `edit-step-${i}-${Date.now()}`,
            type: "phong_ban" as const,
            phong_ban_code: s.phong_ban_code || "",
            user_id: s.user_id || s.mat_recipient_user_id || "",
          }))
      : [],
  )
  const [selectedUnitUserIds, setSelectedUnitUserIds] = useState<string[]>(
    isDonVi
      ? (doc.thu_tu_ky_json || []).filter((s) => s.type === "ca_nhan").map((s) => s.user_id || "").filter(Boolean)
      : [],
  )
  const [unitUsers, setUnitUsers] = useState<EditDeptUser[]>([])
  const [deptLeaders, setDeptLeaders] = useState<Record<string, EditDeptUser[]>>({})
  const [approverDept, setApproverDept] = useState("")
  const [saving, setSaving] = useState(false)
  const [savingText, setSavingText] = useState("")
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      if (isDonVi) {
        if (!doc.phong_ban) return
        try {
          const res = await fetch(
            `/api/documents/dept-users?factoryId=${factoryId}&dept=${encodeURIComponent(doc.phong_ban)}&leadership=false`,
          )
          if (res.ok) setUnitUsers((await res.json()) as EditDeptUser[])
        } catch { /* bỏ qua */ }
      } else if (doc.phe_duyet_user_id) {
        try {
          const res = await fetch(`/api/documents/approvers?factoryId=${factoryId}`)
          if (res.ok) {
            const list = (await res.json()) as EditDeptUser[]
            const approver = list.find((a) => a.id === doc.phe_duyet_user_id)
            setApproverDept(approver?.department || "")
          }
        } catch { /* bỏ qua */ }
      }
    }
    void load()
  }, [factoryId, isDonVi, doc.phong_ban, doc.phe_duyet_user_id])

  const loadDeptLeaders = async (deptCode: string) => {
    if (!deptCode || deptLeaders[deptCode]) return
    try {
      const res = await fetch(`/api/documents/dept-users?factoryId=${factoryId}&dept=${deptCode}&leadership=false`)
      if (res.ok) {
        const data = (await res.json()) as EditDeptUser[]
        setDeptLeaders((prev) => ({ ...prev, [deptCode]: data }))
      }
    } catch { /* bỏ qua */ }
  }

  useEffect(() => {
    if (isDonVi || !factoryId) return
    const codes = [...new Set(
      (doc.thu_tu_ky_json || [])
        .filter((s) => s.type === "phong_ban" && s.phong_ban_code)
        .map((s) => s.phong_ban_code as string),
    )]
    let alive = true
    void (async () => {
      for (const code of codes) {
        try {
          const res = await fetch(`/api/documents/dept-users?factoryId=${factoryId}&dept=${code}&leadership=false`)
          if (!res.ok || !alive) continue
          const data = (await res.json()) as EditDeptUser[]
          if (alive) setDeptLeaders((prev) => (prev[code] ? prev : { ...prev, [code]: data }))
        } catch { /* bỏ qua — chỉ mất gợi ý, không chặn sửa */ }
      }
    })()
    return () => { alive = false }
  }, [factoryId, isDonVi, doc.thu_tu_ky_json])

  const addStep = () => setSteps((prev) => [...prev, emptyEditStep(prev.length + 1)])
  const removeStep = (id: string) => setSteps((prev) => prev.filter((s) => s.id !== id))
  const updateStepPhongBan = (id: string, phong_ban_code: string) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, phong_ban_code, user_id: "" } : s)))
    if (phong_ban_code) void loadDeptLeaders(phong_ban_code)
  }
  const updateStepSigner = (id: string, user_id: string) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, user_id } : s)))
  }

  const handleSave = async () => {
    if (!tenVanBan.trim()) { setSaveError("Vui lòng nhập Tên / Trích yếu."); return }

    let thuTuKyJson: ThuTuKyStep[]
    if (isDonVi) {
      thuTuKyJson = selectedUnitUserIds.map((uid, i) => {
        const u = unitUsers.find((x) => x.id === uid)
        return { step: i + 1, type: "ca_nhan" as const, user_id: uid, ten: u?.full_name || u?.username || "", chuc_vu: "" }
      })
    } else {
      for (const s of steps) {
        if (!s.phong_ban_code) { setSaveError("Vui lòng chọn phòng ban cho tất cả các bước ký."); return }
        if (!s.user_id) {
          setSaveError(`Vui lòng chọn người ký cho bước phòng ban "${s.phong_ban_code}".`)
          return
        }
      }
      thuTuKyJson = steps.map((s, i) => {
        const signer = (deptLeaders[s.phong_ban_code] || []).find((u) => u.id === s.user_id)
        return {
          step: i + 1,
          type: "phong_ban" as const,
          phong_ban_code: s.phong_ban_code,
          phong_ban_name: s.phong_ban_code,
          user_id: s.user_id,
          ten: signer?.full_name || signer?.username || "",
          chuc_vu: "",
        }
      })
    }

    setSaving(true)
    setSaveError(null)
    try {
      let fileGocUrl = doc.file_goc_url
      let fileReplaced = false

      if (newFile) {
        setSavingText("Đang tải tệp đính kèm mới lên lưu trữ...")
        const filePath = `${factoryId}/vanban/drafts/${Date.now()}_${sanitizeStorageFileName(newFile.name)}`
        const { error: uploadErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(filePath, newFile, { upsert: false })
        if (uploadErr) throw new Error(`Tải tệp lên thất bại: ${uploadErr.message}`)
        const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath)
        fileGocUrl = urlData.publicUrl
        fileReplaced = true
      }

      setSavingText("Đang lưu dữ liệu văn bản...")
      const updatePayload: Record<string, unknown> = {
        ten_van_ban: tenVanBan.trim(),
        ghi_chu: ghiChu.trim() || null,
        mo_ta_tim_kiem: moTaTimKiem.trim() || null,
        thu_tu_ky_json: thuTuKyJson,
        so_buoc_tong: thuTuKyJson.length,
        che_do_xem: isDonVi ? "cong_khai" : cheDoXem,
        updated_at: new Date().toISOString(),
      }

      if (fileReplaced) {
        updatePayload.file_goc_url = fileGocUrl
        updatePayload.file_signed_pdf_url = null
        updatePayload.file_signed_office_url = null
        updatePayload.file_signed_office_type = null
        updatePayload.placement_ky = {}
      }

      const { error } = await supabase
        .from("van_ban_documents")
        .update(updatePayload)
        .eq("id", doc.id)

      if (error) { setSaveError(error.message); return }
      onSaved()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Lỗi lưu văn bản")
    } finally {
      setSaving(false)
      setSavingText("")
    }
  }

  const currentDisplayFile = doc.file_signed_pdf_url || doc.file_signed_office_url || doc.file_goc_url

  return (
    <ModalShell
      title="Sửa văn bản"
      onClose={onClose}
      maxWidth="lg"
      footer={
        <>
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
          >
            Hủy
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex-1 py-2.5 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl transition-all flex items-center justify-center gap-2 shadow-md"
          >
            {saving ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>{savingText || "Đang lưu..."}</span>
              </>
            ) : (
              "Lưu thay đổi"
            )}
          </button>
        </>
      }
    >
      {/* Banner thông tin lý do trả về khi văn bản bị trả về */}
      {doc.trang_thai === "tra_ve" && (
        <div className="mb-4 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 space-y-1">
          <div className="flex items-center gap-1.5 font-bold text-rose-700">
            <AlertTriangle size={15} className="shrink-0 text-rose-600" />
            <span>Yêu cầu chỉnh sửa khi trả về:</span>
          </div>
          <p className="pl-5 leading-relaxed font-medium">
            <strong>{doc.tra_ve_nguoi || "Người xem xét"}</strong>
            {doc.tra_ve_step != null ? ` (tại bước ${doc.tra_ve_step + 1})` : ""}:{" "}
            <span className="text-rose-900 font-semibold">{doc.tra_ve_ly_do || "Không có ghi chú thêm."}</span>
          </p>
          {doc.tra_ve_at && (
            <p className="pl-5 text-[11px] text-rose-500 font-normal">{fmtDate(doc.tra_ve_at)}</p>
          )}
        </div>
      )}

      {saveError && (
        <div className="mb-3 flex items-center gap-1.5 text-xs text-red-600 font-bold bg-red-50 border border-red-200 p-2.5 rounded-lg">
          <AlertTriangle size={14} className="shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      <div className="space-y-4">
        {/* Tên / Trích yếu nội dung */}
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">
            Tên / Trích yếu nội dung <span className="text-red-500">*</span>
          </label>
          <input
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
            value={tenVanBan}
            onChange={(e) => setTenVanBan(e.target.value)}
          />
        </div>

        {/* Quản lý tệp đính kèm (cho phép thay thế tệp khác khi sửa) */}
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">
            Tệp đính kèm văn bản
          </label>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ""
              if (f) {
                const ext = f.name.split(".").pop()?.toLowerCase() || ""
                if (!["pdf", "docx", "xlsx"].includes(ext)) {
                  setSaveError("Chỉ hỗ trợ tệp định dạng PDF, DOCX hoặc XLSX.")
                  return
                }
                setNewFile(f)
                setSaveError(null)
              }
            }}
          />

          {newFile ? (
            <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                    <Upload size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-emerald-900 truncate">
                      {newFile.name}
                    </p>
                    <p className="text-[11px] text-emerald-700">
                      {(newFile.size / 1024).toFixed(1)} KB — Tệp mới sẵn sàng thay thế khi bấm Lưu
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setNewFile(null)}
                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-white rounded-lg transition-all shrink-0"
                  title="Hủy chọn tệp mới, giữ lại tệp cũ"
                >
                  <X size={15} />
                </button>
              </div>
              <p className="text-[11px] text-emerald-800 leading-relaxed font-normal">
                💡 Tệp mới này sẽ thay thế tệp hiện tại khi bạn nhấn <strong>Lưu thay đổi</strong>. Các dữ liệu ký của vòng trước (nếu có) sẽ được dọn sạch để chuẩn bị cho lượt ký lại.
              </p>
            </div>
          ) : currentDisplayFile ? (
            <div className="flex items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                  <FileText size={16} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800 truncate" title={getFileNameFromUrl(currentDisplayFile)}>
                    {getFileNameFromUrl(currentDisplayFile)}
                  </p>
                  <p className="text-[11px] text-slate-400 uppercase">
                    Định dạng: {getFileExt(currentDisplayFile) || "file"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <a
                  href={currentDisplayFile}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-all"
                >
                  <Eye size={12} />
                  Xem file
                </a>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-all"
                >
                  <Upload size={12} />
                  Thay tệp khác
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl text-xs font-bold text-slate-600 hover:text-blue-600 hover:bg-blue-50/50 transition-all"
            >
              <Upload size={15} />
              Đính kèm tệp văn bản (PDF, DOCX, XLSX)
            </button>
          )}
        </div>

        {!isDonVi && (
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Phạm vi hiển thị</label>
            <div className="flex rounded-xl overflow-hidden border border-slate-200">
              {([
                { val: "cong_khai", Icon: Globe },
                { val: "gioi_han", Icon: Lock },
              ] as const).map(({ val, Icon }) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setCheDoXem(val)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-bold transition-all ${
                    cheDoXem === val
                      ? val === "gioi_han"
                        ? "bg-amber-600 text-white"
                        : "bg-slate-700 text-white"
                      : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                  }`}
                >
                  <Icon size={14} />
                  {CHE_DO_XEM_LABEL[val]}
                </button>
              ))}
            </div>
            <p className={`text-xs mt-1.5 ${isGioiHan ? "text-amber-700 font-medium" : "text-slate-400"}`}>
              {isGioiHan ? CHE_DO_XEM_DESC.gioi_han : CHE_DO_XEM_DESC.cong_khai}
            </p>
          </div>
        )}

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú</label>
          <textarea
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500 resize-none"
            rows={2}
            value={ghiChu}
            onChange={(e) => setGhiChu(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Mô tả tìm kiếm AI</label>
          <textarea
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-400 resize-none"
            rows={2}
            value={moTaTimKiem}
            onChange={(e) => setMoTaTimKiem(e.target.value)}
          />
        </div>

        {isDonVi ? (
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Ký xác nhận (tùy chọn)</label>
            {!doc.phong_ban ? (
              <p className="text-xs text-amber-600">Văn bản chưa có phòng ban.</p>
            ) : unitUsers.length === 0 ? (
              <p className="text-xs text-slate-400">Không tìm thấy người dùng trong phòng ban {doc.phong_ban}.</p>
            ) : (
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                {unitUsers
                  .filter((u) => u.id !== doc.phe_duyet_user_id)
                  .map((u) => {
                    const idx = selectedUnitUserIds.indexOf(u.id)
                    const selected = idx >= 0
                    return (
                      <label
                        key={u.id}
                        className={`flex items-center gap-2.5 p-2 rounded-lg border cursor-pointer transition-all ${
                          selected ? "border-blue-300 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(e) => {
                            setSelectedUnitUserIds((prev) =>
                              e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id),
                            )
                          }}
                          className="rounded"
                        />
                        {selected && (
                          <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold shrink-0">
                            {idx + 1}
                          </span>
                        )}
                        <span className="text-sm text-slate-700 flex-1">{u.full_name || u.username}</span>
                      </label>
                    )
                  })}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-600">Các bước ký phòng ban</label>
              <button
                onClick={addStep}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-all"
              >
                <Plus size={12} /> Thêm bước
              </button>
            </div>
            {steps.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-3">Chưa có bước ký.</p>
            ) : (
              <div className="space-y-2">
                {steps.map((s, i) => (
                  <div key={s.id} className={`rounded-lg border p-2.5 space-y-2 ${isGioiHan ? "border-amber-200 bg-amber-50/40" : "border-slate-200"}`}>
                    <div className="flex items-center gap-2">
                      <div className="flex-none w-6 h-6 flex items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0">
                        {i + 1}
                      </div>
                      <select
                        className="flex-1 px-2 py-1.5 border border-slate-300 rounded-lg text-sm outline-none focus:border-blue-500"
                        value={s.phong_ban_code}
                        onChange={(e) => updateStepPhongBan(s.id, e.target.value)}
                      >
                        <option value="">— Chọn phòng ban —</option>
                        {PHONG_BAN_VAN_BAN_OPTIONS.filter((pb) => pb !== approverDept).map((pb) => (
                          <option key={pb} value={pb}>{pb}</option>
                        ))}
                      </select>
                      <button onClick={() => removeStep(s.id)} className="p-1.5 text-slate-300 hover:text-red-500 rounded transition-all">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="ml-8">
                      <label className="text-[10px] font-bold text-slate-600 block mb-1">
                        Người ký <span className="text-red-500">*</span>
                      </label>
                      <select
                        className={`w-full px-2 py-1.5 text-xs border rounded-lg outline-none ${
                          !s.user_id && s.phong_ban_code
                            ? "border-amber-300 bg-amber-50 focus:border-amber-400"
                            : "border-slate-300 focus:border-blue-400"
                        }`}
                        value={s.user_id}
                        onChange={(e) => updateStepSigner(s.id, e.target.value)}
                        disabled={!s.phong_ban_code}
                      >
                        <option value="">{s.phong_ban_code ? "— Chọn người ký —" : "— Chọn phòng ban trước —"}</option>
                        {(deptLeaders[s.phong_ban_code] || []).map((u) => (
                          <option key={u.id} value={u.id}>{u.full_name || u.username}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  )
}

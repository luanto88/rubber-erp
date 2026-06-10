"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hydrateActiveSession } from "@/lib/auth"
import { DocumentsShell } from "../_components/documents-shell"
import {
  LOAI_VAN_BAN_KY_HIEU,
  LOAI_VAN_BAN_LABEL,
  LOAI_VAN_BAN_OPTIONS,
  PHONG_BAN_VAN_BAN_OPTIONS,
  buildMaVanBan,
  type VanBanDocumentType,
  type ThuTuKyStep,
} from "../_components/documents-types"
import { Plus, Trash2, AlertTriangle, X, FileText, GripVertical, Lock } from "lucide-react"

const STORAGE_BUCKET = "iso-documents"

type ApproverUser = {
  id: string
  full_name: string
  username: string
  role: string
}

type StepForm = {
  id: string
  type: "phong_ban"
  phong_ban_code: string
  // Người nhận đích danh khi phan_loai = 'Mat'
  mat_recipient_user_id: string
}

function emptyStep(step: number): StepForm {
  return {
    id: `step-${step}-${Date.now()}`,
    type: "phong_ban",
    phong_ban_code: "",
    mat_recipient_user_id: "",
  }
}

export default function NewDocumentPage() {
  const router = useRouter()
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [userFullName, setUserFullName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [docTypes, setDocTypes] = useState<VanBanDocumentType[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Danh sách người có quyền phê duyệt
  const [approvers, setApprovers] = useState<ApproverUser[]>([])
  // Cache danh sách leadership theo từng phòng ban (key = phong_ban_code)
  const [deptLeaders, setDeptLeaders] = useState<Record<string, ApproverUser[]>>({})

  const [form, setForm] = useState({
    loai_van_ban: "",
    phong_ban: "",
    ten_van_ban: "",
    cap_tl: "Cấp 1",
    phan_loai: "Thuong",    // 'Thuong' | 'Mat'
    phe_duyet_user_id: "",  // UUID người phê duyệt
    ghi_chu: "",
  })

  const [steps, setSteps] = useState<StepForm[]>([])
  const [file, setFile] = useState<File | null>(null)

  const loadTypes = useCallback(async () => {
    const { data } = await supabase
      .from("van_ban_document_types")
      .select("id, code, name, ky_hieu, sort_order, is_active")
      .eq("is_active", true)
      .order("sort_order")
    if (data?.length) setDocTypes(data as VanBanDocumentType[])
    else {
      setDocTypes(
        LOAI_VAN_BAN_OPTIONS.map((code, i) => ({
          id: code,
          code,
          name: LOAI_VAN_BAN_LABEL[code],
          ky_hieu: LOAI_VAN_BAN_KY_HIEU[code],
          sort_order: i + 1,
          is_active: true,
        })),
      )
    }
  }, [])

  const loadApprovers = useCallback(async (fid: string) => {
    try {
      const res = await fetch(`/api/documents/approvers?factoryId=${fid}`)
      if (res.ok) {
        const data = (await res.json()) as ApproverUser[]
        setApprovers(data)
      }
    } catch { /* lỗi nhỏ, bỏ qua */ }
  }, [])

  const loadDeptLeaders = useCallback(async (fid: string, deptCode: string) => {
    if (!deptCode || deptLeaders[deptCode]) return
    try {
      const res = await fetch(
        `/api/documents/dept-users?factoryId=${fid}&dept=${deptCode}&leadership=true`,
      )
      if (res.ok) {
        const data = (await res.json()) as ApproverUser[]
        setDeptLeaders((prev) => ({ ...prev, [deptCode]: data }))
      }
    } catch { /* bỏ qua */ }
  }, [deptLeaders])

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      setFactoryId(fid)

      const { user: sessionUser } = await hydrateActiveSession()
      if (sessionUser) {
        setUserId(sessionUser.id)
        setUserFullName(sessionUser.full_name || sessionUser.username || null)
      }
      await Promise.all([loadTypes(), loadApprovers(fid)])
      setLoading(false)
    }
    void bootstrap()
  }, [loadTypes, loadApprovers])

  const addStep = () => {
    setSteps((prev) => [...prev, emptyStep(prev.length + 1)])
  }

  const removeStep = (id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id))
  }

  const updateStepPhongBan = (id: string, phong_ban_code: string) => {
    setSteps((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, phong_ban_code, mat_recipient_user_id: "" } : s,
      ),
    )
    // Pre-load danh sách leadership nếu là văn bản Mật
    if (form.phan_loai === "Mat" && factoryId && phong_ban_code) {
      void loadDeptLeaders(factoryId, phong_ban_code)
    }
  }

  const updateStepRecipient = (id: string, mat_recipient_user_id: string) => {
    setSteps((prev) =>
      prev.map((s) => s.id === id ? { ...s, mat_recipient_user_id } : s),
    )
  }

  // Khi đổi phan_loai sang Mật, pre-load leaders của các bước đã chọn phòng ban
  const handlePhanLoaiChange = (val: string) => {
    setForm((f) => ({ ...f, phan_loai: val }))
    if (val === "Mat" && factoryId) {
      for (const s of steps) {
        if (s.phong_ban_code) {
          void loadDeptLeaders(factoryId, s.phong_ban_code)
        }
      }
    }
  }

  const handleSave = async () => {
    if (!factoryId || !userId) return

    if (!form.loai_van_ban || !form.phong_ban || !form.ten_van_ban.trim()) {
      setSaveError("Vui lòng điền đầy đủ: Loại văn bản, Phòng ban, Tên văn bản.")
      return
    }

    if (!form.phe_duyet_user_id) {
      setSaveError("Vui lòng chọn Người phê duyệt cuối.")
      return
    }

    if (form.cap_tl === "Cấp 1" && steps.length === 0) {
      setSaveError("Cấp 1 cần ít nhất 1 bước ký phòng ban.")
      return
    }
    for (const s of steps) {
      if (!s.phong_ban_code) {
        setSaveError("Vui lòng chọn phòng ban cho tất cả các bước ký.")
        return
      }
      if (form.phan_loai === "Mat" && !s.mat_recipient_user_id) {
        setSaveError(
          `Văn bản Mật: vui lòng chọn đích danh người nhận cho bước ký phòng ban "${s.phong_ban_code}".`,
        )
        return
      }
    }

    setSaving(true)
    setSaveError(null)
    try {
      // 1. Lấy số thứ tự
      const nam = new Date().getFullYear()
      const numRes = await fetch("/api/documents/number", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factoryId, loai: form.loai_van_ban, phong_ban: form.phong_ban, nam }),
      })
      if (!numRes.ok) {
        const err = (await numRes.json()) as { error?: string }
        throw new Error(err.error || "Không lấy được số văn bản")
      }
      const { so } = (await numRes.json()) as { so: number }

      // 2. Xây mã văn bản
      const selectedType = docTypes.find((t) => t.code === form.loai_van_ban)
      const kyHieu =
        selectedType?.ky_hieu || LOAI_VAN_BAN_KY_HIEU[form.loai_van_ban] || form.loai_van_ban
      const maVanBan = buildMaVanBan(so, kyHieu, form.phong_ban)

      // 3. Build thu_tu_ky_json từ steps
      const thuTuKyJson: ThuTuKyStep[] = steps.map((s, i) => ({
        step: i + 1,
        type: "phong_ban",
        phong_ban_code: s.phong_ban_code,
        phong_ban_name: s.phong_ban_code,
        ...(form.phan_loai === "Mat" && s.mat_recipient_user_id
          ? { mat_recipient_user_id: s.mat_recipient_user_id }
          : {}),
      }))
      const soBuocTong = thuTuKyJson.length

      // 4. Tên người phê duyệt (snapshot từ approvers list)
      const approverUser = approvers.find((a) => a.id === form.phe_duyet_user_id)
      const pheDuyetName = approverUser?.full_name || approverUser?.username || ""

      // 5. Upload file nếu có
      let fileGocUrl: string | null = null
      if (file) {
        const filePath = `${factoryId}/vanban/drafts/${Date.now()}_${file.name.replace(/\s+/g, "_")}`
        const { error: uploadErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(filePath, file, { upsert: false })
        if (uploadErr) throw new Error(`Upload file thất bại: ${uploadErr.message}`)
        const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath)
        fileGocUrl = urlData.publicUrl
      }

      // 6. Insert
      const payload = {
        factory_id: factoryId,
        ma_van_ban: maVanBan,
        ten_van_ban: form.ten_van_ban.trim(),
        loai_van_ban: form.loai_van_ban,
        phong_ban: form.phong_ban,
        so_van_ban: String(so).padStart(2, "0"),
        nam,
        cap_tl: form.cap_tl,
        phan_loai: form.phan_loai,
        trang_thai: "draft",
        is_uploaded: false,
        thu_tu_ky_json: thuTuKyJson,
        buoc_hien_tai: 0,
        so_buoc_tong: soBuocTong,
        nguoi_ky: {},
        placement_ky: {},
        soan_thao_user_id: userId,
        nguoi_soan_thao_display: userFullName,
        phe_duyet_user_id: form.phe_duyet_user_id || null,
        phe_duyet: pheDuyetName || null,
        ghi_chu: form.ghi_chu.trim() || null,
        file_goc_url: fileGocUrl,
      }

      const { data: inserted, error: insertErr } = await supabase
        .from("van_ban_documents")
        .insert(payload)
        .select("id")
        .single()
      if (insertErr) throw new Error(insertErr.message)

      router.push(`/dashboard/documents/${inserted.id}`)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Lỗi không xác định")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <DocumentsShell>
        <div className="p-12 text-center text-slate-400">Đang tải...</div>
      </DocumentsShell>
    )
  }

  const selectedType = docTypes.find((t) => t.code === form.loai_van_ban)
  const maPreview =
    form.loai_van_ban && form.phong_ban
      ? buildMaVanBan(1, selectedType?.ky_hieu || form.loai_van_ban, form.phong_ban)
      : null
  const isMat = form.phan_loai === "Mat"
  const selectedApprover = approvers.find((a) => a.id === form.phe_duyet_user_id)

  return (
    <DocumentsShell>
      {saveError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-red-600 text-white rounded-2xl shadow-2xl max-w-xl">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="text-sm font-bold">{saveError}</span>
          <button onClick={() => setSaveError(null)} className="ml-2 hover:opacity-70">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Soạn thảo văn bản mới</h1>
          <p className="text-sm text-slate-500 mt-0.5">Tạo văn bản và cấu hình vòng ký phòng ban</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Cột trái: thông tin văn bản */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-sm font-bold text-slate-700 mb-4">Thông tin văn bản</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Loại văn bản <span className="text-red-500">*</span>
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
                    value={form.loai_van_ban}
                    onChange={(e) => setForm((f) => ({ ...f, loai_van_ban: e.target.value }))}
                  >
                    <option value="">— Chọn loại —</option>
                    {docTypes.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.name} ({t.ky_hieu})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    Phòng ban soạn thảo <span className="text-red-500">*</span>
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
                    value={form.phong_ban}
                    onChange={(e) => setForm((f) => ({ ...f, phong_ban: e.target.value }))}
                  >
                    <option value="">— Chọn phòng ban —</option>
                    {PHONG_BAN_VAN_BAN_OPTIONS.map((pb) => (
                      <option key={pb} value={pb}>
                        {pb}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Phân loại Thường / Mật */}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Phân loại <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => handlePhanLoaiChange("Thuong")}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                      !isMat
                        ? "bg-slate-700 text-white border-slate-700 shadow"
                        : "bg-white text-slate-500 border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    Thường
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePhanLoaiChange("Mat")}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                      isMat
                        ? "bg-red-600 text-white border-red-600 shadow"
                        : "bg-white text-slate-500 border-slate-300 hover:bg-red-50"
                    }`}
                  >
                    <Lock size={13} />
                    Mật
                  </button>
                </div>
                <p className={`text-xs mt-1.5 ${isMat ? "text-red-500" : "text-slate-400"}`}>
                  {isMat
                    ? "Văn bản Mật: mỗi bước ký cần chọn đích danh người nhận thông báo."
                    : "Văn bản Thường: thông báo đến trưởng/phó phòng ban tương ứng."}
                </p>
              </div>

              {maPreview && (
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl">
                  <FileText size={14} className="text-blue-600 shrink-0" />
                  <span className="text-sm text-blue-700">
                    Mã văn bản sẽ được sinh tự động, ví dụ:{" "}
                    <strong className="font-mono">{maPreview}</strong>
                  </span>
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Tên / Trích yếu nội dung <span className="text-red-500">*</span>
                </label>
                <input
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
                  placeholder="Nhập tên hoặc trích yếu nội dung văn bản..."
                  value={form.ten_van_ban}
                  onChange={(e) => setForm((f) => ({ ...f, ten_van_ban: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Cấp văn bản</label>
                <select
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
                  value={form.cap_tl}
                  onChange={(e) => setForm((f) => ({ ...f, cap_tl: e.target.value }))}
                >
                  <option value="Cấp 1">Cấp 1 — Ký vòng phòng ban, sau đó phê duyệt</option>
                  <option value="Cấp 2">Cấp 2 — Phê duyệt trực tiếp</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú</label>
                <textarea
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500 resize-none"
                  rows={2}
                  placeholder="Ghi chú thêm (nếu có)..."
                  value={form.ghi_chu}
                  onChange={(e) => setForm((f) => ({ ...f, ghi_chu: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  File đính kèm (tùy chọn)
                </label>
                {file ? (
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                    <FileText size={16} className="text-blue-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{file.name}</p>
                      <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <button
                      onClick={() => setFile(null)}
                      className="p-1 text-slate-400 hover:text-red-600 rounded"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all">
                    <Plus size={16} className="text-slate-400" />
                    <span className="text-sm text-slate-500">
                      Đính kèm file nháp (PDF, DOCX, XLSX)
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.docx,.xlsx,.doc,.xls"
                      className="hidden"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                    />
                  </label>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Cột phải: vòng ký + người phê duyệt */}
        <div className="space-y-4">
          {/* Vòng ký phòng ban */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-slate-700">
                Vòng ký phòng ban
                {form.cap_tl === "Cấp 2" && (
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    (bỏ qua với Cấp 2)
                  </span>
                )}
              </h2>
              {form.cap_tl === "Cấp 1" && (
                <button
                  onClick={addStep}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-all"
                >
                  <Plus size={12} />
                  Thêm bước
                </button>
              )}
            </div>

            {form.cap_tl === "Cấp 2" ? (
              <div className="text-sm text-slate-400 text-center py-4">
                Văn bản Cấp 2 chuyển thẳng lên phê duyệt.
              </div>
            ) : steps.length === 0 ? (
              <div className="text-sm text-slate-400 text-center py-4">
                Chưa có bước ký. Nhấn{" "}
                <span className="font-bold text-blue-600">+ Thêm bước</span>.
              </div>
            ) : (
              <div className="space-y-3">
                {steps.map((s, i) => (
                  <div
                    key={s.id}
                    className={`rounded-lg border p-2.5 space-y-2 ${
                      isMat ? "border-red-200 bg-red-50/40" : "border-slate-200"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 w-5 shrink-0 text-slate-300">
                        <GripVertical size={14} />
                      </div>
                      <div className="flex-none w-6 h-6 flex items-center justify-center rounded-full bg-blue-100 text-blue-700 text-xs font-bold shrink-0">
                        {i + 1}
                      </div>
                      <select
                        className="flex-1 px-2 py-1.5 border border-slate-300 rounded-lg text-sm outline-none focus:border-blue-500"
                        value={s.phong_ban_code}
                        onChange={(e) => updateStepPhongBan(s.id, e.target.value)}
                      >
                        <option value="">— Chọn phòng ban —</option>
                        {PHONG_BAN_VAN_BAN_OPTIONS.map((pb) => (
                          <option key={pb} value={pb}>
                            {pb}
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeStep(s.id)}
                        className="p-1.5 text-slate-300 hover:text-red-500 rounded transition-all"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    {/* Chọn đích danh khi Mật */}
                    {isMat && (
                      <div className="ml-7">
                        <label className="text-[10px] font-bold text-red-600 block mb-1">
                          Người nhận thông báo (đích danh) <span className="text-red-500">*</span>
                        </label>
                        <select
                          className={`w-full px-2 py-1.5 text-xs border rounded-lg outline-none focus:border-red-400 ${
                            isMat && !s.mat_recipient_user_id && s.phong_ban_code
                              ? "border-red-300 bg-red-50"
                              : "border-slate-300"
                          }`}
                          value={s.mat_recipient_user_id}
                          onChange={(e) => updateStepRecipient(s.id, e.target.value)}
                          disabled={!s.phong_ban_code}
                        >
                          <option value="">
                            {s.phong_ban_code
                              ? "— Chọn đích danh —"
                              : "— Chọn phòng ban trước —"}
                          </option>
                          {(deptLeaders[s.phong_ban_code] || []).map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.full_name || u.username}
                            </option>
                          ))}
                        </select>
                        {s.phong_ban_code && !(deptLeaders[s.phong_ban_code]?.length) && (
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            Không tìm thấy trưởng/phó phòng {s.phong_ban_code}.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {form.cap_tl === "Cấp 1" && steps.length > 0 && selectedApprover && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <div className="flex items-center gap-2 text-xs text-slate-400">
                  <div className="w-5 h-5 flex items-center justify-center rounded-full bg-emerald-100 text-emerald-700 font-bold shrink-0">
                    ✓
                  </div>
                  <span>
                    Phê duyệt cuối:{" "}
                    <strong className="text-slate-600">
                      {selectedApprover.full_name || selectedApprover.username}
                    </strong>
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Người phê duyệt cuối */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-sm font-bold text-slate-700 mb-3">
              Người phê duyệt cuối <span className="text-red-500">*</span>
            </h2>
            <select
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
              value={form.phe_duyet_user_id}
              onChange={(e) => setForm((f) => ({ ...f, phe_duyet_user_id: e.target.value }))}
            >
              <option value="">— Chọn người phê duyệt —</option>
              {approvers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.full_name || a.username}
                </option>
              ))}
            </select>
            {approvers.length === 0 && (
              <p className="text-xs text-slate-400 mt-1.5">
                Chưa có người dùng nào có quyền phê duyệt.
              </p>
            )}
          </div>

          {/* Nút lưu */}
          <div className="flex flex-col gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center justify-center gap-2 w-full px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-md transition-all"
            >
              {saving ? (
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <FileText size={15} />
              )}
              {saving ? "Đang tạo..." : "Tạo văn bản"}
            </button>
            <button
              onClick={() => router.push("/dashboard/documents")}
              disabled={saving}
              className="px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all text-center"
            >
              Hủy
            </button>
          </div>
        </div>
      </div>
    </DocumentsShell>
  )
}

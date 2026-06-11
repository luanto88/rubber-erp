"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId } from "@/lib/auth"
import { DocumentsShell } from "../../_components/documents-shell"
import {
  LOAI_VAN_BAN_KY_HIEU,
  LOAI_VAN_BAN_LABEL,
  LOAI_VAN_BAN_OPTIONS,
  PHONG_BAN_VAN_BAN_OPTIONS,
  buildMaVanBan,
  type VanBanDocumentType,
} from "../../_components/documents-types"
import { Upload, AlertTriangle, X, FileText, CheckCircle2 } from "lucide-react"

const STORAGE_BUCKET = "iso-documents"

export default function UploadVanBanPage() {
  const router = useRouter()
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [docTypes, setDocTypes] = useState<VanBanDocumentType[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)

  const [form, setForm] = useState({
    loai_van_ban: "",
    phong_ban: "",
    ten_van_ban: "",
    ngay_phe_duyet: "",
    ghi_chu: "",
  })

  // Mã văn bản editable — giống new/page.tsx
  const [maVanBan, setMaVanBan] = useState("")
  const [maVanBanEdited, setMaVanBanEdited] = useState(false)
  const [maVanBanExists, setMaVanBanExists] = useState(false)
  const [nextSoPreview, setNextSoPreview] = useState<number | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const dupCheckRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      setFactoryId(fid)
      await loadTypes()
      setLoading(false)
    }
    void bootstrap()
  }, [loadTypes])

  // Peek số tiếp theo khi loại + phòng ban thay đổi
  const loadNextSo = useCallback(async (fid: string, loai: string, phongBan: string) => {
    if (!loai || !phongBan) return
    const { data } = await supabase
      .from("van_ban_sequences")
      .select("last_so")
      .eq("factory_id", fid)
      .eq("loai", loai)
      .eq("phong_ban", phongBan)
      .single()
    const nextSo = (data?.last_so ?? 0) + 1
    setNextSoPreview(nextSo)
    setMaVanBanEdited((prev) => {
      if (!prev) {
        const kyHieu = docTypes.find((t) => t.code === loai)?.ky_hieu || LOAI_VAN_BAN_KY_HIEU[loai] || loai
        setMaVanBan(buildMaVanBan(nextSo, kyHieu, phongBan))
      }
      return prev
    })
  }, [docTypes])

  useEffect(() => {
    if (factoryId && form.loai_van_ban && form.phong_ban) {
      void loadNextSo(factoryId, form.loai_van_ban, form.phong_ban)
    }
  }, [factoryId, form.loai_van_ban, form.phong_ban, loadNextSo])

  // Debounced duplicate check — 300ms
  useEffect(() => {
    if (dupCheckRef.current) clearTimeout(dupCheckRef.current)
    if (!factoryId || !maVanBan.trim()) { setMaVanBanExists(false); return }
    dupCheckRef.current = setTimeout(async () => {
      const { count } = await supabase
        .from("van_ban_documents")
        .select("id", { count: "exact", head: true })
        .eq("factory_id", factoryId)
        .eq("ma_van_ban", maVanBan.trim())
      setMaVanBanExists((count ?? 0) > 0)
    }, 300)
    return () => { if (dupCheckRef.current) clearTimeout(dupCheckRef.current) }
  }, [maVanBan, factoryId])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setFile(f)
    if (!form.ten_van_ban.trim()) {
      const base = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim()
      setForm((prev) => ({ ...prev, ten_van_ban: base }))
    }
    setPreviewUrl(URL.createObjectURL(f))
  }

  const handleSave = async () => {
    if (!factoryId) return
    if (!form.loai_van_ban || !form.phong_ban || !form.ten_van_ban.trim()) {
      setSaveError("Vui lòng điền đầy đủ thông tin bắt buộc: Loại văn bản, Phòng ban, Tên văn bản.")
      return
    }
    if (!maVanBan.trim()) {
      setSaveError("Mã văn bản không được để trống.")
      return
    }
    if (maVanBanExists) {
      setSaveError("Mã văn bản đã tồn tại trong hệ thống. Vui lòng chọn mã khác.")
      return
    }
    if (!file) {
      setSaveError("Vui lòng chọn file văn bản đã ký.")
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      let finalMa = maVanBan.trim()
      let soStr = "01"

      if (maVanBanEdited) {
        // Dùng mã user đã nhập — parse số từ phần đầu
        const parsed = parseInt(finalMa.split("/")[0])
        soStr = isNaN(parsed) ? "01" : String(parsed).padStart(2, "0")
      } else {
        // Lấy số atomic từ API (không race condition)
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
        const selectedType = docTypes.find((t) => t.code === form.loai_van_ban)
        const kyHieu = selectedType?.ky_hieu || LOAI_VAN_BAN_KY_HIEU[form.loai_van_ban] || form.loai_van_ban
        finalMa = buildMaVanBan(so, kyHieu, form.phong_ban)
        soStr = String(so).padStart(2, "0")
      }

      // Upload file lên Storage
      setUploading(true)
      const ext = file.name.split(".").pop() || "pdf"
      const filePath = `${factoryId}/vanban/uploads/${Date.now()}_${file.name.replace(/\s+/g, "_")}`
      const { error: uploadErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(filePath, file, { upsert: false })
      if (uploadErr) throw new Error(`Upload file thất bại: ${uploadErr.message}`)
      setUploading(false)

      const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath)
      const fileUrl = urlData.publicUrl

      const nam = new Date().getFullYear()
      const payload = {
        factory_id: factoryId,
        ma_van_ban: finalMa,
        ten_van_ban: form.ten_van_ban.trim(),
        loai_van_ban: form.loai_van_ban,
        phong_ban: form.phong_ban,
        so_van_ban: soStr,
        nam,
        trang_thai: "da_phe_duyet",
        is_uploaded: true,
        ngay_phe_duyet: form.ngay_phe_duyet || null,
        file_signed_pdf_url: ext === "pdf" ? fileUrl : null,
        file_goc_url: ext !== "pdf" ? fileUrl : null,
        ghi_chu: form.ghi_chu.trim() || null,
      }
      const { error: insertErr } = await supabase.from("van_ban_documents").insert(payload)
      if (insertErr) throw new Error(insertErr.message)

      setSaveOk(true)
      setTimeout(() => router.push("/dashboard/documents"), 1500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Lỗi không xác định")
      setUploading(false)
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

  // Kiểm tra có nhảy số không
  const parsedSoFromInput = maVanBan ? parseInt(maVanBan.split("/")[0]) : NaN
  const hasSoJump = maVanBanEdited && nextSoPreview !== null && !isNaN(parsedSoFromInput) && parsedSoFromInput !== nextSoPreview

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

      {saveOk && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-emerald-600 text-white rounded-2xl shadow-2xl">
          <CheckCircle2 size={16} />
          <span className="text-sm font-bold">Đã lưu văn bản thành công!</span>
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Upload văn bản đã ký tay</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Tải lên văn bản đã ký tay, hệ thống tự sinh số và lưu vào hồ sơ
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 max-w-2xl">
        <div className="space-y-5">
          {/* Loại văn bản */}
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">
              Loại văn bản <span className="text-red-500">*</span>
            </label>
            <select
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
              value={form.loai_van_ban}
              onChange={(e) => {
                setForm((f) => ({ ...f, loai_van_ban: e.target.value }))
                setMaVanBanEdited(false)
              }}
            >
              <option value="">— Chọn loại văn bản —</option>
              {docTypes.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name} ({t.ky_hieu})
                </option>
              ))}
            </select>
          </div>

          {/* Phòng ban */}
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">
              Phòng ban <span className="text-red-500">*</span>
            </label>
            <select
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
              value={form.phong_ban}
              onChange={(e) => {
                setForm((f) => ({ ...f, phong_ban: e.target.value }))
                setMaVanBanEdited(false)
              }}
            >
              <option value="">— Chọn phòng ban —</option>
              {PHONG_BAN_VAN_BAN_OPTIONS.map((pb) => (
                <option key={pb} value={pb}>{pb}</option>
              ))}
            </select>
          </div>

          {/* Mã văn bản — editable */}
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">
              Mã văn bản <span className="text-red-500">*</span>
            </label>
            <input
              className={`w-full px-3 py-2 border rounded-xl text-sm font-mono outline-none focus:border-blue-500 ${maVanBanExists ? "border-red-400 bg-red-50" : "border-slate-300"}`}
              placeholder="Ví dụ: 01/BC-NMCB"
              value={maVanBan}
              onChange={(e) => {
                setMaVanBan(e.target.value.toUpperCase())
                setMaVanBanEdited(true)
              }}
            />
            {hasSoJump && (
              <div className="mt-1 flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-700">
                <AlertTriangle size={12} />
                Số này khác số tiếp theo ({nextSoPreview}). Hệ thống vẫn lưu đúng số bạn nhập.
              </div>
            )}
            {maVanBanExists && (
              <div className="mt-1 flex items-center gap-2 px-3 py-1.5 bg-red-50 border border-red-300 rounded-lg text-xs text-red-700">
                <AlertTriangle size={12} />
                Mã văn bản này đã tồn tại trong hệ thống.
              </div>
            )}
          </div>

          {/* Tên văn bản */}
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">
              Tên / Trích yếu văn bản <span className="text-red-500">*</span>
            </label>
            <input
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
              placeholder="Nhập tên hoặc trích yếu nội dung văn bản..."
              value={form.ten_van_ban}
              onChange={(e) => setForm((f) => ({ ...f, ten_van_ban: e.target.value }))}
            />
          </div>

          {/* Ngày phê duyệt */}
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày ký / Ngày phê duyệt</label>
            <input
              type="date"
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
              value={form.ngay_phe_duyet}
              onChange={(e) => setForm((f) => ({ ...f, ngay_phe_duyet: e.target.value }))}
            />
          </div>

          {/* Ghi chú */}
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

          {/* Upload file */}
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">
              File văn bản đã ký <span className="text-red-500">*</span>
            </label>
            {file ? (
              <div className="flex items-center gap-3 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                <FileText size={16} className="text-blue-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{file.name}</p>
                  <p className="text-xs text-slate-400">{(file.size / 1024).toFixed(1)} KB</p>
                </div>
                <div className="flex items-center gap-1">
                  {previewUrl && (
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg"
                    >
                      Xem
                    </a>
                  )}
                  <button
                    onClick={() => { setFile(null); setPreviewUrl(null) }}
                    className="p-1 text-slate-400 hover:text-red-600 rounded"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex flex-col items-center gap-2 px-4 py-6 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-all">
                <Upload size={24} className="text-slate-400" />
                <span className="text-sm text-slate-500">
                  Kéo thả file hoặc <span className="text-blue-600 font-bold">chọn từ máy tính</span>
                </span>
                <span className="text-xs text-slate-400">PDF, DOCX, XLSX — tối đa 20MB</span>
                <input
                  type="file"
                  accept=".pdf,.docx,.xlsx,.doc,.xls"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
            )}
          </div>

          {/* Nút hành động */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving || uploading || maVanBanExists}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl shadow-md transition-all"
            >
              {saving || uploading ? (
                <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Upload size={15} />
              )}
              {uploading ? "Đang tải file..." : saving ? "Đang lưu..." : "Lưu văn bản"}
            </button>
            <button
              onClick={() => router.push("/dashboard/documents")}
              disabled={saving}
              className="px-5 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
            >
              Hủy
            </button>
          </div>
        </div>
      </div>
    </DocumentsShell>
  )
}

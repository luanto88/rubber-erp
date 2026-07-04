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
import { Upload, AlertTriangle, X, FileText, CheckCircle2, Plus, Trash2 } from "lucide-react"

const STORAGE_BUCKET = "iso-documents"

type ApproverUser = { id: string; full_name: string; username: string; role: string; department: string }
type LeaderCandidate = { id: string; full_name: string; username: string; chuc_vu: string }
type UploadStep = { id: string; phong_ban_code: string; user_id: string }

type ParsedVanBan = {
  matched: boolean
  loai_van_ban?: string
  phong_ban?: string
  so?: number
  ten_van_ban?: string
}

const normalizeVn = (s: string) => s.normalize("NFC").toLowerCase()

// Khớp 1 trong các `candidates` ở đầu chuỗi `str` (không phân biệt hoa/thường, chuẩn hóa dấu),
// ưu tiên candidate dài nhất trước để tránh khớp nhầm khi các mã có tiền tố chung.
function matchPrefix(str: string, candidates: string[]): { matched: string; rest: string } | null {
  const sorted = [...candidates].filter(Boolean).sort((a, b) => b.length - a.length)
  for (const c of sorted) {
    if (normalizeVn(str.slice(0, c.length)) === normalizeVn(c)) {
      return { matched: c, rest: str.slice(c.length) }
    }
  }
  return null
}

// Giống matchPrefix nhưng bắt buộc ranh giới từ sau khi khớp (hết chuỗi hoặc theo sau là khoảng trắng),
// tránh khớp nhầm 1 phần của mã phòng ban dài hơn (ví dụ "CS" trong 1 chuỗi thực ra là "CSKH").
function matchPhongBanPrefix(str: string): { matched: string; rest: string } | null {
  const upper = str.toUpperCase()
  const sorted = [...PHONG_BAN_VAN_BAN_OPTIONS].sort((a, b) => b.length - a.length)
  for (const pb of sorted) {
    if (upper.startsWith(pb)) {
      const rest = str.slice(pb.length)
      if (rest.length === 0 || /^\s/.test(rest)) return { matched: pb, rest }
    }
  }
  return null
}

// Windows không cho phép ký tự "/" trong tên file, nên người dùng đặt tên file theo nhiều biến thể
// không dấu gạch chéo, ví dụ với "01/ĐN-NMCB Đề nghị thay máy lạnh...":
//   "01 ĐN-NMCB Đề nghị thay máy lạnh..."   (dấu cách thay "/")
//   "01ĐN-NMCB Đề nghị thay máy lạnh..."    (không có ký tự phân cách trước ký hiệu)
//   "01ĐNNMCB Đề nghị thay máy lạnh..."     (không có ký tự phân cách nào cả)
// Parser tách tuần tự: số thứ tự (chữ số đầu) → ký hiệu loại văn bản (so khớp docTypes/hằng số tĩnh)
// → mã phòng ban (so khớp PHONG_BAN_VAN_BAN_OPTIONS, có ranh giới) → phần còn lại là tên/trích yếu.
function parseVanBanFileName(fileName: string, docTypes: VanBanDocumentType[]): ParsedVanBan {
  const base = fileName.replace(/\.[^.]+$/, "").trim()

  const soMatch = base.match(/^(\d{1,4})/)
  if (!soMatch) return { matched: false }
  const so = parseInt(soMatch[1], 10)
  const afterSo = base.slice(soMatch[0].length).replace(/^[\s\-/]+/, "")

  const kyHieuCandidates = Array.from(
    new Set([...docTypes.map((t) => t.ky_hieu), ...Object.values(LOAI_VAN_BAN_KY_HIEU)]),
  )
  const kyHieuMatch = matchPrefix(afterSo, kyHieuCandidates)
  if (!kyHieuMatch) return { matched: false }

  const matchedType = docTypes.find((t) => normalizeVn(t.ky_hieu) === normalizeVn(kyHieuMatch.matched))
  let loai_van_ban: string | undefined = matchedType?.code
  if (!loai_van_ban) {
    const reverseEntry = Object.entries(LOAI_VAN_BAN_KY_HIEU).find(
      ([, ky]) => normalizeVn(ky) === normalizeVn(kyHieuMatch.matched),
    )
    loai_van_ban = reverseEntry?.[0]
  }

  const afterKyHieu = kyHieuMatch.rest.replace(/^[\s\-/]+/, "")
  const phongBanMatch = matchPhongBanPrefix(afterKyHieu)
  if (!phongBanMatch) return { matched: false }

  const ten_van_ban = phongBanMatch.rest.replace(/^[\s\-/]+/, "").trim()

  return {
    matched: true,
    loai_van_ban,
    phong_ban: phongBanMatch.matched,
    so,
    ten_van_ban: ten_van_ban || undefined,
  }
}

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
    pham_vi: "Cong_ty" as "Cong_ty" | "Don_vi",
    soan_thao_user_id: "",
    phe_duyet_user_id: "",
    phe_duyet_is_kt: false,
  })

  // Người phê duyệt
  const [approvers, setApprovers] = useState<ApproverUser[]>([])
  const [deptLeaderCandidates, setDeptLeaderCandidates] = useState<LeaderCandidate[]>([])
  const [deptLeaderLoading, setDeptLeaderLoading] = useState(false)
  const [deptLeaderQueried, setDeptLeaderQueried] = useState(false)

  // Người lập (chỉ Nội bộ đơn vị)
  const [donViUsers, setDonViUsers] = useState<ApproverUser[]>([])
  const [donViUsersLoading, setDonViUsersLoading] = useState(false)

  // Phòng ban đã ký (chỉ Nội bộ công ty)
  const [steps, setSteps] = useState<UploadStep[]>([])
  const [stepUsersCache, setStepUsersCache] = useState<Record<string, ApproverUser[]>>({})
  const [stepUsersLoading, setStepUsersLoading] = useState<Record<string, boolean>>({})

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

  const loadApprovers = useCallback(async (fid: string) => {
    try {
      const res = await fetch(`/api/documents/approvers?factoryId=${fid}`)
      if (!res.ok) return
      setApprovers((await res.json()) as ApproverUser[])
    } catch {
      setApprovers([])
    }
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      setFactoryId(fid)
      await Promise.all([loadTypes(), loadApprovers(fid)])
      setLoading(false)
    }
    void bootstrap()
  }, [loadTypes, loadApprovers])

  // Người phê duyệt (Nội bộ đơn vị) — auto-detect lãnh đạo phòng ban
  const loadDeptLeaderCandidates = useCallback(async (fid: string, dept: string) => {
    setDeptLeaderLoading(true)
    setDeptLeaderQueried(false)
    try {
      const res = await fetch(`/api/documents/dept-leader?factoryId=${fid}&dept=${encodeURIComponent(dept)}`)
      const data = res.ok ? ((await res.json()) as LeaderCandidate[]) : []
      setDeptLeaderCandidates(data)
      setForm((f) => ({ ...f, phe_duyet_user_id: data.length === 1 ? data[0].id : "" }))
    } catch {
      setDeptLeaderCandidates([])
    } finally {
      setDeptLeaderLoading(false)
      setDeptLeaderQueried(true)
    }
  }, [])

  useEffect(() => {
    if (factoryId && form.pham_vi === "Don_vi" && form.phong_ban) {
      void loadDeptLeaderCandidates(factoryId, form.phong_ban)
    } else {
      setDeptLeaderCandidates([])
      setDeptLeaderQueried(false)
    }
  }, [factoryId, form.phong_ban, form.pham_vi, loadDeptLeaderCandidates])

  // Người lập (Nội bộ đơn vị) — danh sách nhân sự thật trong phòng ban
  const loadDonViUsers = useCallback(async (fid: string, dept: string) => {
    setDonViUsersLoading(true)
    try {
      const res = await fetch(`/api/documents/dept-users?factoryId=${fid}&dept=${encodeURIComponent(dept)}`)
      setDonViUsers(res.ok ? ((await res.json()) as ApproverUser[]) : [])
    } catch {
      setDonViUsers([])
    } finally {
      setDonViUsersLoading(false)
    }
  }, [])

  useEffect(() => {
    if (factoryId && form.pham_vi === "Don_vi" && form.phong_ban) {
      void loadDonViUsers(factoryId, form.phong_ban)
    } else {
      setDonViUsers([])
    }
  }, [factoryId, form.phong_ban, form.pham_vi, loadDonViUsers])

  // Người ký từng bước phòng ban (Nội bộ công ty) — lazy load theo mã phòng ban
  const ensureStepUsersLoaded = useCallback(async (dept: string) => {
    if (!factoryId || !dept || stepUsersCache[dept] || stepUsersLoading[dept]) return
    setStepUsersLoading((prev) => ({ ...prev, [dept]: true }))
    try {
      const res = await fetch(`/api/documents/dept-users?factoryId=${factoryId}&dept=${encodeURIComponent(dept)}`)
      const data = res.ok ? ((await res.json()) as ApproverUser[]) : []
      setStepUsersCache((prev) => ({ ...prev, [dept]: data }))
    } catch {
      setStepUsersCache((prev) => ({ ...prev, [dept]: [] }))
    } finally {
      setStepUsersLoading((prev) => ({ ...prev, [dept]: false }))
    }
  }, [factoryId, stepUsersCache, stepUsersLoading])

  const addStep = () => {
    setSteps((prev) => [...prev, { id: crypto.randomUUID(), phong_ban_code: "", user_id: "" }])
  }
  const removeStep = (id: string) => {
    setSteps((prev) => prev.filter((s) => s.id !== id))
  }
  const updateStepDept = (id: string, code: string) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, phong_ban_code: code, user_id: "" } : s)))
    if (code) void ensureStepUsersLoaded(code)
  }
  const updateStepUser = (id: string, userId: string) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, user_id: userId } : s)))
  }

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
    setPreviewUrl(URL.createObjectURL(f))

    const parsed = parseVanBanFileName(f.name, docTypes)
    if (!parsed.matched) {
      if (!form.ten_van_ban.trim()) {
        const base = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim()
        setForm((prev) => ({ ...prev, ten_van_ban: base }))
      }
      return
    }

    setForm((prev) => {
      const next = { ...prev }
      if (parsed.loai_van_ban && !prev.loai_van_ban) next.loai_van_ban = parsed.loai_van_ban
      if (parsed.phong_ban && !prev.phong_ban) next.phong_ban = parsed.phong_ban
      if (parsed.ten_van_ban && !prev.ten_van_ban.trim()) next.ten_van_ban = parsed.ten_van_ban
      return next
    })

    const effectiveLoai = form.loai_van_ban || parsed.loai_van_ban
    const effectivePb = form.phong_ban || parsed.phong_ban
    if (!maVanBanEdited && parsed.so && effectiveLoai && effectivePb) {
      const kyHieu = docTypes.find((t) => t.code === effectiveLoai)?.ky_hieu || LOAI_VAN_BAN_KY_HIEU[effectiveLoai] || effectiveLoai
      setMaVanBan(buildMaVanBan(parsed.so, kyHieu, effectivePb))
      setMaVanBanEdited(true)
    }
  }

  const approverDept = form.pham_vi === "Cong_ty"
    ? approvers.find((a) => a.id === form.phe_duyet_user_id)?.department || ""
    : ""

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

    if (form.pham_vi === "Don_vi") {
      if (deptLeaderLoading) {
        setSaveError("Đang xác định người phê duyệt, vui lòng đợi.")
        return
      }
      if (!form.phe_duyet_user_id || !deptLeaderCandidates.some((c) => c.id === form.phe_duyet_user_id)) {
        setSaveError("Vui lòng chọn người phê duyệt hợp lệ cho phòng ban này.")
        return
      }
      if (!form.soan_thao_user_id) {
        setSaveError("Vui lòng chọn người lập.")
        return
      }
    } else {
      if (!form.phe_duyet_user_id) {
        setSaveError("Vui lòng chọn người phê duyệt.")
        return
      }
      if (steps.length > 0) {
        for (const s of steps) {
          if (!s.phong_ban_code || !s.user_id) {
            setSaveError("Vui lòng chọn đầy đủ phòng ban và người ký cho tất cả các bước, hoặc xóa bước còn trống.")
            return
          }
        }
        const deptCodes = steps.map((s) => s.phong_ban_code)
        if (new Set(deptCodes).size !== deptCodes.length) {
          setSaveError("Có phòng ban được chọn trùng ở nhiều bước ký. Vui lòng kiểm tra lại.")
          return
        }
      }
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

      const approverUser = form.pham_vi === "Don_vi"
        ? deptLeaderCandidates.find((c) => c.id === form.phe_duyet_user_id)
        : approvers.find((a) => a.id === form.phe_duyet_user_id)
      const pheDuyetName = approverUser?.full_name || approverUser?.username || ""
      const soanThaoUser = donViUsers.find((u) => u.id === form.soan_thao_user_id)

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
        pham_vi: form.pham_vi,
        soan_thao_user_id: form.pham_vi === "Don_vi" ? (form.soan_thao_user_id || null) : null,
        nguoi_soan_thao_display: form.pham_vi === "Don_vi" ? (soanThaoUser?.full_name || soanThaoUser?.username || null) : null,
        phe_duyet_user_id: form.phe_duyet_user_id || null,
        phe_duyet: pheDuyetName || null,
        phe_duyet_is_kt: form.phe_duyet_is_kt,
        thu_tu_ky_json: form.pham_vi === "Cong_ty"
          ? steps.map((s, i) => ({
              step: i + 1,
              type: "phong_ban" as const,
              phong_ban_code: s.phong_ban_code,
              phong_ban_name: s.phong_ban_code,
            }))
          : [],
        nguoi_ky: form.pham_vi === "Cong_ty"
          ? Object.fromEntries(steps.map((s, i) => {
              const signer = (stepUsersCache[s.phong_ban_code] || []).find((u) => u.id === s.user_id)
              return [
                String(i + 1),
                {
                  ten: signer?.full_name || signer?.username || "",
                  chuc_vu: "",
                  ky_at: form.ngay_phe_duyet || new Date().toISOString(),
                },
              ]
            }))
          : {},
        buoc_hien_tai: form.pham_vi === "Cong_ty" ? steps.length : 0,
        so_buoc_tong: form.pham_vi === "Cong_ty" ? steps.length : 0,
        phong_ban_ky_display: form.pham_vi === "Cong_ty" && steps.length ? steps.map((s) => s.phong_ban_code) : null,
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Cột trái: thông tin văn bản */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <h2 className="text-sm font-bold text-slate-700 mb-4">Thông tin văn bản</h2>
            <div className="space-y-5">
              {/* Upload file — đặt lên đầu vì auto-fill các trường bên dưới phụ thuộc vào tên file */}
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
                    <span className="text-xs text-slate-400">
                      PDF, DOCX, XLSX — tối đa 20MB. Đặt tên file dạng &quot;01 ĐN-NMCB Tên văn bản&quot; để hệ thống tự điền các trường bên dưới.
                    </span>
                    <input
                      type="file"
                      accept=".pdf,.docx,.xlsx,.doc,.xls"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                  </label>
                )}
              </div>

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

              {/* Phạm vi lưu hành */}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Phạm vi lưu hành</label>
                <div className="flex rounded-xl overflow-hidden border border-slate-200">
                  {[
                    { val: "Cong_ty" as const, label: "Nội bộ công ty" },
                    { val: "Don_vi" as const, label: "Nội bộ đơn vị" },
                  ].map(({ val, label }) => (
                    <button
                      key={val}
                      type="button"
                      className={`flex-1 py-2 text-sm font-bold transition-all ${
                        form.pham_vi === val
                          ? "bg-blue-600 text-white"
                          : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                      }`}
                      onClick={() => {
                        setForm((f) => ({ ...f, pham_vi: val, phe_duyet_user_id: "", soan_thao_user_id: "" }))
                        setSteps([])
                        setDeptLeaderCandidates([])
                        setDeptLeaderQueried(false)
                        setDonViUsers([])
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
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

            </div>
          </div>
        </div>

        {/* Cột phải: người phê duyệt + phòng ban đã ký / người lập */}
        <div className="space-y-4">
          {/* Người phê duyệt */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-sm font-bold text-slate-700 mb-3">
              Người phê duyệt <span className="text-red-500">*</span>
            </h2>

            {form.pham_vi === "Don_vi" ? (
              <>
                {!form.phong_ban ? (
                  <p className="text-xs text-amber-600">
                    Chọn phòng ban trước để xác định người phê duyệt.
                  </p>
                ) : deptLeaderLoading ? (
                  <p className="text-xs text-slate-400 flex items-center gap-1.5">
                    <span className="w-3 h-3 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
                    Đang xác định người phê duyệt...
                  </p>
                ) : deptLeaderQueried && deptLeaderCandidates.length === 0 ? (
                  <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <span>
                      Không tìm thấy lãnh đạo hợp lệ cho phòng ban <strong>{form.phong_ban}</strong>. Kiểm tra:
                      (1) đã gán Chức vụ / Chức vụ chính quyền lãnh đạo (Trưởng/Phó phòng, Giám đốc/Phó giám đốc)
                      trong Nhân sự bảo trì; (2) người đó đã được &quot;Liên kết tài khoản&quot;; (3) người đó đã
                      được cấp quyền phê duyệt văn bản.
                    </span>
                  </div>
                ) : deptLeaderCandidates.length === 1 ? (
                  <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-700 truncate">
                        {deptLeaderCandidates[0].full_name || deptLeaderCandidates[0].username}
                      </p>
                      <p className="text-xs text-slate-500">{deptLeaderCandidates[0].chuc_vu}</p>
                    </div>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">
                      Tự động xác định
                    </span>
                  </div>
                ) : (
                  <select
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
                    value={form.phe_duyet_user_id}
                    onChange={(e) => setForm((f) => ({ ...f, phe_duyet_user_id: e.target.value }))}
                  >
                    <option value="">— Chọn người phê duyệt —</option>
                    {deptLeaderCandidates.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.full_name || c.username} — {c.chuc_vu}
                      </option>
                    ))}
                  </select>
                )}
              </>
            ) : (
              <>
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
                {approverDept && (
                  <p className="text-xs text-slate-400 mt-1.5">
                    Phòng ban: <strong className="text-slate-600">{approverDept}</strong>
                    {" "}— sẽ được loại khỏi danh sách phòng ban ký
                  </p>
                )}
              </>
            )}

            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer mt-3">
              <input
                type="checkbox"
                checked={form.phe_duyet_is_kt}
                onChange={(e) => setForm((f) => ({ ...f, phe_duyet_is_kt: e.target.checked }))}
                className="rounded"
              />
              Ký thay — thêm <strong className="font-mono text-slate-700">KT.</strong> trước chức danh
            </label>
          </div>

          {/* Phòng ban đã ký (Cong_ty) / Người lập (Don_vi) */}
          {form.pham_vi === "Cong_ty" ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-slate-700">Phòng ban đã ký</h2>
                <button
                  type="button"
                  onClick={addStep}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg"
                >
                  <Plus size={12} /> Thêm bước
                </button>
              </div>
              {steps.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Chưa có phòng ban nào — bấm &quot;Thêm bước&quot; nếu văn bản giấy có chữ ký phòng ban.
                </p>
              ) : (
                <div className="space-y-3">
                  {steps.map((s, i) => {
                    const usedByOthers = new Set(
                      steps.filter((o) => o.id !== s.id).map((o) => o.phong_ban_code).filter(Boolean),
                    )
                    const deptOptions = PHONG_BAN_VAN_BAN_OPTIONS.filter(
                      (pb) => pb !== approverDept && !usedByOthers.has(pb),
                    )
                    const usersForDept = s.phong_ban_code ? stepUsersCache[s.phong_ban_code] : undefined
                    const loadingUsers = s.phong_ban_code ? !!stepUsersLoading[s.phong_ban_code] : false
                    return (
                      <div key={s.id} className="flex items-start gap-2">
                        <span className="mt-2 w-5 h-5 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold shrink-0">
                          {i + 1}
                        </span>
                        <div className="flex-1 space-y-1.5">
                          <select
                            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-blue-500"
                            value={s.phong_ban_code}
                            onChange={(e) => updateStepDept(s.id, e.target.value)}
                          >
                            <option value="">— Chọn phòng ban —</option>
                            {deptOptions.map((pb) => (
                              <option key={pb} value={pb}>{pb}</option>
                            ))}
                          </select>
                          <select
                            className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
                            value={s.user_id}
                            disabled={!s.phong_ban_code}
                            onChange={(e) => updateStepUser(s.id, e.target.value)}
                          >
                            <option value="">
                              {!s.phong_ban_code ? "— Chọn phòng ban trước —" : loadingUsers ? "Đang tải..." : "— Chọn người ký —"}
                            </option>
                            {(usersForDept || []).map((u) => (
                              <option key={u.id} value={u.id}>{u.full_name || u.username}</option>
                            ))}
                          </select>
                          {s.phong_ban_code && !loadingUsers && usersForDept?.length === 0 && (
                            <p className="text-[11px] text-amber-600">Chưa có nhân sự nào trong phòng ban này.</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeStep(s.id)}
                          className="mt-1.5 p-1 text-slate-400 hover:text-red-600 rounded shrink-0"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-bold text-slate-700 mb-3">
                Người lập <span className="text-red-500">*</span>
              </h2>
              {!form.phong_ban ? (
                <p className="text-xs text-amber-600">Chọn phòng ban trước để chọn người lập.</p>
              ) : donViUsersLoading ? (
                <p className="text-xs text-slate-400 flex items-center gap-1.5">
                  <span className="w-3 h-3 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
                  Đang tải danh sách...
                </p>
              ) : (
                <>
                  <select
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
                    value={form.soan_thao_user_id}
                    onChange={(e) => setForm((f) => ({ ...f, soan_thao_user_id: e.target.value }))}
                  >
                    <option value="">— Chọn người lập —</option>
                    {donViUsers.filter((u) => u.id !== form.phe_duyet_user_id).map((u) => (
                      <option key={u.id} value={u.id}>{u.full_name || u.username}</option>
                    ))}
                  </select>
                  {donViUsers.length === 0 && (
                    <p className="text-xs text-slate-400 mt-1.5">Chưa có nhân sự nào trong phòng ban này.</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Nút hành động */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || uploading || maVanBanExists || (form.pham_vi === "Don_vi" && deptLeaderLoading)}
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

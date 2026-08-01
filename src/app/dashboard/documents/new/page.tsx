"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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
  computeNextVanBanSo,
  parseVanBanFileName,
  sanitizeStorageFileName,
  type VanBanDocumentType,
  type ThuTuKyStep,
} from "../_components/documents-types"
import {
  Plus,
  Trash2,
  AlertTriangle,
  X,
  FileText,
  GripVertical,
  Lock,
  Shield,
  Sparkles,
} from "lucide-react"

const STORAGE_BUCKET = "iso-documents"

type ApproverUser = {
  id: string
  full_name: string
  username: string
  role: string
  department: string  // Bug 3
}

// Nội bộ đơn vị: lãnh đạo phòng ban tự động xác định qua Chức vụ (Nhân sự bảo trì)
type LeaderCandidate = {
  id: string
  full_name: string
  username: string
  chuc_vu: string
}

type StepForm = {
  id: string
  type: "phong_ban"
  phong_ban_code: string
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

  const [approvers, setApprovers] = useState<ApproverUser[]>([])
  const [deptLeaders, setDeptLeaders] = useState<Record<string, ApproverUser[]>>({})

  const [form, setForm] = useState({
    loai_van_ban: "",
    phong_ban: "",
    ten_van_ban: "",
    cap_tl: "Cấp 1",
    phan_loai: "Thuong",
    pham_vi: "Cong_ty",        // 'Cong_ty' | 'Don_vi'
    phe_duyet_user_id: "",
    ghi_chu: "",
    mo_ta_tim_kiem: "",  // Bug 6e: AI search description
  })

  // Nội bộ đơn vị — danh sách user trong đơn vị và người được chọn ký xác nhận
  const [unitUsers, setUnitUsers] = useState<ApproverUser[]>([])
  const [selectedUnitUserIds, setSelectedUnitUserIds] = useState<string[]>([])

  // Nội bộ đơn vị — lãnh đạo phòng ban tự động xác định (thay cho dropdown phê duyệt tự do)
  const [deptLeaderCandidates, setDeptLeaderCandidates] = useState<LeaderCandidate[]>([])
  const [deptLeaderLoading, setDeptLeaderLoading] = useState(false)
  const [deptLeaderQueried, setDeptLeaderQueried] = useState(false)

  // Bug 2: editable mã văn bản
  const [maVanBan, setMaVanBan] = useState("")
  const [maVanBanEdited, setMaVanBanEdited] = useState(false)
  const [nextSoPreview, setNextSoPreview] = useState<number | null>(null)
  const [maVanBanChecking, setMaVanBanChecking] = useState(false)
  const [maVanBanExists, setMaVanBanExists] = useState(false)
  const maCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Văn bản không có mã (VD: danh sách, chứng nhận không theo khuôn số) — vẫn đi qua
  // đúng luồng ký duyệt hiện tại, chỉ bỏ qua yêu cầu bắt buộc phải có mã.
  const [khongCoMa, setKhongCoMa] = useState(false)

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
    } catch { /* bỏ qua */ }
  }, [])

  // Bug 1 fix: dùng leadership=false để lấy TẤT CẢ user trong phòng ban,
  // không chỉ admin/manager — Phó GĐ có role='user' sẽ không bị lọc ra nữa
  const loadDeptLeaders = useCallback(async (fid: string, deptCode: string) => {
    if (!deptCode || deptLeaders[deptCode]) return
    try {
      const res = await fetch(
        `/api/documents/dept-users?factoryId=${fid}&dept=${deptCode}&leadership=false`,
      )
      if (res.ok) {
        const data = (await res.json()) as ApproverUser[]
        setDeptLeaders((prev) => ({ ...prev, [deptCode]: data }))
      }
    } catch { /* bỏ qua */ }
  }, [deptLeaders])

  // Nội bộ đơn vị: load user trong phòng ban có quyền tạo/ký phòng ban/phê duyệt văn bản
  const loadUnitUsers = useCallback(async (fid: string, dept: string) => {
    if (!dept) return
    try {
      const res = await fetch(
        `/api/documents/dept-users?factoryId=${fid}&dept=${dept}&leadership=false&permission=documents.create,documents.ky_phong_ban,documents.phe_duyet`,
      )
      if (res.ok) setUnitUsers((await res.json()) as ApproverUser[])
    } catch { /* bỏ qua */ }
  }, [])

  // Nội bộ đơn vị: tự động xác định lãnh đạo phòng ban (Trưởng/Phó phòng, Giám đốc/Phó giám đốc)
  // đủ điều kiện phê duyệt — thay cho dropdown chọn tay tự do.
  const loadDeptLeaderCandidates = useCallback(async (fid: string, dept: string) => {
    setDeptLeaderLoading(true)
    setDeptLeaderQueried(false)
    try {
      const res = await fetch(`/api/documents/dept-leader?factoryId=${fid}&dept=${dept}`)
      if (res.ok) {
        const data = (await res.json()) as LeaderCandidate[]
        setDeptLeaderCandidates(data)
        if (data.length === 1) {
          setForm((f) => ({ ...f, phe_duyet_user_id: data[0].id }))
        } else {
          setForm((f) => ({ ...f, phe_duyet_user_id: "" }))
        }
      } else {
        setDeptLeaderCandidates([])
        setForm((f) => ({ ...f, phe_duyet_user_id: "" }))
      }
    } catch {
      setDeptLeaderCandidates([])
      setForm((f) => ({ ...f, phe_duyet_user_id: "" }))
    } finally {
      setDeptLeaderLoading(false)
      setDeptLeaderQueried(true)
    }
  }, [])

  // Peek số tiếp theo — tính từ dữ liệu THẬT trong van_ban_documents (xem
  // computeNextVanBanSo trong documents-types.ts).
  const loadNextSo = useCallback(async (fid: string, loai: string, pb: string): Promise<number> => {
    const nam = new Date().getFullYear()
    return computeNextVanBanSo(fid, loai, pb, nam)
  }, [])

  // Bug 2: Debounced duplicate check
  const checkMaExists = useCallback(async (fid: string, ma: string) => {
    if (!ma.trim()) { setMaVanBanExists(false); setMaVanBanChecking(false); return }
    setMaVanBanChecking(true)
    try {
      const { data } = await supabase
        .from("van_ban_documents")
        .select("id")
        .eq("factory_id", fid)
        .eq("ma_van_ban", ma.trim())
        .maybeSingle()
      setMaVanBanExists(!!data)
    } finally {
      setMaVanBanChecking(false)
    }
  }, [])

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

  // Bug 2: Auto-rebuild maVanBan preview when loai or phong_ban changes (only if not manually edited)
  useEffect(() => {
    if (!factoryId || !form.loai_van_ban || !form.phong_ban) {
      setNextSoPreview(null)
      return
    }
    const selectedType = docTypes.find((t) => t.code === form.loai_van_ban)
    const kyHieu = selectedType?.ky_hieu || LOAI_VAN_BAN_KY_HIEU[form.loai_van_ban] || form.loai_van_ban
    void loadNextSo(factoryId, form.loai_van_ban, form.phong_ban).then((nextSo) => {
      setNextSoPreview(nextSo)
      if (!maVanBanEdited) {
        setMaVanBan(buildMaVanBan(nextSo, kyHieu, form.phong_ban))
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryId, form.loai_van_ban, form.phong_ban, docTypes])

  // Bug 2: Debounced duplicate check on maVanBan change
  useEffect(() => {
    if (!factoryId || !maVanBan.trim()) { setMaVanBanExists(false); return }
    if (maCheckTimerRef.current) clearTimeout(maCheckTimerRef.current)
    maCheckTimerRef.current = setTimeout(() => {
      void checkMaExists(factoryId, maVanBan)
    }, 300)
    return () => { if (maCheckTimerRef.current) clearTimeout(maCheckTimerRef.current) }
  }, [factoryId, maVanBan, checkMaExists])

  // Load danh sách user đơn vị khi phong_ban thay đổi và pham_vi là Don_vi
  useEffect(() => {
    if (factoryId && form.pham_vi === "Don_vi" && form.phong_ban) {
      void loadUnitUsers(factoryId, form.phong_ban)
    } else {
      setUnitUsers([])
    }
  }, [factoryId, form.phong_ban, form.pham_vi, loadUnitUsers])

  // Nội bộ đơn vị: tự động tra cứu lãnh đạo phòng ban khi đổi phòng ban / chuyển sang Don_vi
  useEffect(() => {
    if (factoryId && form.pham_vi === "Don_vi" && form.phong_ban) {
      void loadDeptLeaderCandidates(factoryId, form.phong_ban)
    } else {
      setDeptLeaderCandidates([])
      setDeptLeaderQueried(false)
    }
  }, [factoryId, form.phong_ban, form.pham_vi, loadDeptLeaderCandidates])

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
    if (form.phan_loai === "Mat" && factoryId && phong_ban_code) {
      void loadDeptLeaders(factoryId, phong_ban_code)
    }
  }

  const updateStepRecipient = (id: string, mat_recipient_user_id: string) => {
    setSteps((prev) =>
      prev.map((s) => s.id === id ? { ...s, mat_recipient_user_id } : s),
    )
  }

  const handlePhanLoaiChange = (val: string) => {
    setForm((f) => ({ ...f, phan_loai: val }))
    if (val === "Mat" && factoryId) {
      for (const s of steps) {
        if (s.phong_ban_code) void loadDeptLeaders(factoryId, s.phong_ban_code)
      }
    }
  }

  // Bug 4: Auto-fill tên từ tên file khi trường đang trống
  // Tự nhận diện Loại VB/Phòng ban/Tên từ tên file dạng "01/ĐN-NMCB Tên văn bản"
  // (nhiều biến thể không dấu "/", xem parseVanBanFileName) — mirror tính năng đã
  // có sẵn ở Upload ký tay, trước đây trang này chỉ lấy nguyên tên file làm tên văn
  // bản (không tách được loại/phòng ban lẫn trong tên, và tên còn dính cả mã).
  // CHỈ điền vào trường đang trống, không ghi đè lựa chọn tay. Mã văn bản KHÔNG lấy
  // số từ tên file ở trang này (khác Upload) — mã luôn do hệ thống tự sinh theo số
  // tiếp theo hợp lệ (qua effect nextSoPreview), vì đây là văn bản đang soạn thảo
  // mới, số trong tên file (nếu có) chỉ là số nháp người dùng tự đặt, không phải số
  // chính thức đã cấp.
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null
    setFile(f)
    if (!f) return

    const parsed = parseVanBanFileName(f.name, docTypes)
    const willFillLoai = !!parsed.loai_van_ban && !form.loai_van_ban
    const willFillPb = !!parsed.phong_ban && !form.phong_ban

    setForm((prev) => {
      const next = { ...prev }
      if (parsed.loai_van_ban && !prev.loai_van_ban) next.loai_van_ban = parsed.loai_van_ban
      if (parsed.phong_ban && !prev.phong_ban) next.phong_ban = parsed.phong_ban
      if (!prev.ten_van_ban.trim()) {
        const fallbackTen =
          parsed.ten_van_ban || f.name.replace(/\.(pdf|docx?|xlsx?)$/i, "").replace(/[_-]+/g, " ").trim()
        if (fallbackTen) next.ten_van_ban = fallbackTen
      }
      return next
    })
    // Mã được auto-tính theo loai_van_ban/phong_ban mới — reset cờ "đã sửa tay" giống
    // hệt hành vi của 2 dropdown Loại VB/Phòng ban khi người dùng tự chọn trực tiếp.
    if (willFillLoai || willFillPb) setMaVanBanEdited(false)
  }

  const handleSave = async () => {
    if (!factoryId || !userId) return

    if (!form.loai_van_ban || !form.phong_ban || !form.ten_van_ban.trim()) {
      setSaveError("Vui lòng điền đầy đủ: Loại văn bản, Phòng ban, Tên văn bản.")
      return
    }
    if (form.pham_vi === "Don_vi") {
      if (deptLeaderLoading) {
        setSaveError("Đang xác định người phê duyệt cuối, vui lòng đợi...")
        return
      }
      if (!form.phe_duyet_user_id || !deptLeaderCandidates.some((c) => c.id === form.phe_duyet_user_id)) {
        setSaveError(
          deptLeaderQueried && deptLeaderCandidates.length === 0
            ? "Không tìm thấy lãnh đạo hợp lệ cho phòng ban này. Kiểm tra Chức vụ trong Nhân sự bảo trì, liên kết tài khoản, và quyền phê duyệt."
            : "Vui lòng chọn Người phê duyệt cuối.",
        )
        return
      }
    } else if (!form.phe_duyet_user_id) {
      setSaveError("Vui lòng chọn Người phê duyệt cuối.")
      return
    }
    if (form.cap_tl === "Cấp 1" && form.pham_vi === "Cong_ty" && steps.length === 0) {
      setSaveError("Cấp 1 Nội bộ công ty cần ít nhất 1 bước ký phòng ban.")
      return
    }
    if (form.pham_vi === "Cong_ty") {
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
    }
    if (!khongCoMa && maVanBanExists) {
      setSaveError("Mã văn bản này đã tồn tại trong hệ thống. Vui lòng kiểm tra lại.")
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      let finalMa = ""
      let finalSoStr: string | null = null

      if (!khongCoMa) {
        let finalSo: number
        finalMa = maVanBan.trim()
        if (maVanBanEdited && finalMa) {
          // User tự nhập mã — parse số từ mã
          const match = finalMa.match(/^(\d+)\//)
          finalSo = match ? parseInt(match[1]) : 1
        } else {
          // Tính lại số tiếp theo NGAY TRƯỚC khi lưu (không tái dùng nextSoPreview đã
          // tính trước đó) để giảm khoảng hở race nếu có văn bản khác vừa được tạo.
          const nam = new Date().getFullYear()
          const so = await computeNextVanBanSo(factoryId, form.loai_van_ban, form.phong_ban, nam)
          finalSo = so
          const selectedType = docTypes.find((t) => t.code === form.loai_van_ban)
          const kyHieu =
            selectedType?.ky_hieu || LOAI_VAN_BAN_KY_HIEU[form.loai_van_ban] || form.loai_van_ban
          finalMa = buildMaVanBan(so, kyHieu, form.phong_ban)
        }
        finalSoStr = String(finalSo).padStart(2, "0")
      }

      let thuTuKyJson: ThuTuKyStep[]
      if (form.pham_vi === "Don_vi") {
        thuTuKyJson = selectedUnitUserIds.map((uid, i) => {
          const u = unitUsers.find((x) => x.id === uid)
          return {
            step: i + 1,
            type: "ca_nhan" as const,
            user_id: uid,
            ten: u?.full_name || u?.username || "",
            chuc_vu: "",
          }
        })
      } else {
        thuTuKyJson = steps.map((s, i) => ({
          step: i + 1,
          type: "phong_ban" as const,
          phong_ban_code: s.phong_ban_code,
          phong_ban_name: s.phong_ban_code,
          ...(form.phan_loai === "Mat" && s.mat_recipient_user_id
            ? { mat_recipient_user_id: s.mat_recipient_user_id }
            : {}),
        }))
      }
      const soBuocTong = thuTuKyJson.length

      const approverUser =
        form.pham_vi === "Don_vi"
          ? deptLeaderCandidates.find((c) => c.id === form.phe_duyet_user_id)
          : approvers.find((a) => a.id === form.phe_duyet_user_id)
      const pheDuyetName = approverUser?.full_name || approverUser?.username || ""

      let fileGocUrl: string | null = null
      if (file) {
        const filePath = `${factoryId}/vanban/drafts/${Date.now()}_${sanitizeStorageFileName(file.name)}`
        const { error: uploadErr } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(filePath, file, { upsert: false })
        if (uploadErr) throw new Error(`Upload file thất bại: ${uploadErr.message}`)
        const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(filePath)
        fileGocUrl = urlData.publicUrl
      }

      const payload = {
        factory_id: factoryId,
        ma_van_ban: khongCoMa ? null : finalMa,
        ten_van_ban: form.ten_van_ban.trim(),
        loai_van_ban: form.loai_van_ban,
        phong_ban: form.phong_ban,
        so_van_ban: finalSoStr,
        nam: new Date().getFullYear(),
        cap_tl: form.pham_vi === "Don_vi" ? "Cấp 1" : form.cap_tl,
        phan_loai: form.pham_vi === "Don_vi" ? "Thuong" : form.phan_loai,
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
        pham_vi: form.pham_vi,
        ghi_chu: form.ghi_chu.trim() || null,
        mo_ta_tim_kiem: form.mo_ta_tim_kiem.trim() || null,
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

  const isMat = form.phan_loai === "Mat"
  // Nội bộ đơn vị: người phê duyệt là lãnh đạo phòng ban tự động xác định (deptLeaderCandidates),
  // không nằm trong danh sách approvers toàn nhà máy dùng cho Nội bộ công ty.
  const selectedApprover =
    form.pham_vi === "Don_vi"
      ? deptLeaderCandidates.find((c) => c.id === form.phe_duyet_user_id)
      : approvers.find((a) => a.id === form.phe_duyet_user_id)
  // Bug 3: phòng ban của người phê duyệt cuối → loại khỏi dropdown bước ký (chỉ áp dụng Cong_ty)
  const approverDept =
    form.pham_vi === "Don_vi" ? "" : (approvers.find((a) => a.id === form.phe_duyet_user_id)?.department || "")
  // approvers API đã lọc đúng (admin/manager + explicit phe_duyet)
  const filteredApprovers = approvers

  const selectedType = docTypes.find((t) => t.code === form.loai_van_ban)
  const kyHieu = selectedType?.ky_hieu || LOAI_VAN_BAN_KY_HIEU[form.loai_van_ban] || form.loai_van_ban

  // Bug 2: gap warning — khi user tự nhập số khác với số tiếp theo của sequence
  const maMatch = maVanBan.match(/^(\d+)\//)
  const maSo = maMatch ? parseInt(maMatch[1]) : null
  const hasGapWarning =
    maVanBanEdited && nextSoPreview !== null && maSo !== null && maSo !== nextSoPreview

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

              {/* File đính kèm — đặt đầu tiên vì các trường bên dưới phụ thuộc auto-fill từ tên file */}
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
                      <span className="ml-1 text-slate-400 text-xs">— tên file sẽ tự điền tên VB nếu trống</span>
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

              {/* Phạm vi lưu hành — quyết định luồng ký, đặt sớm để các section bên dưới hiện đúng nhánh */}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Phạm vi lưu hành</label>
                <div className="flex rounded-xl overflow-hidden border border-slate-200">
                  {[
                    { val: "Cong_ty", label: "Nội bộ công ty" },
                    { val: "Don_vi", label: "Nội bộ đơn vị" },
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
                        setForm((f) => ({
                          ...f,
                          pham_vi: val,
                          ...(val === "Don_vi" ? { cap_tl: "Cấp 1", phan_loai: "Thuong" } : {}),
                          phe_duyet_user_id: "",
                        }))
                        setSelectedUnitUserIds([])
                        if (val === "Don_vi" && factoryId && form.phong_ban) {
                          void loadUnitUsers(factoryId, form.phong_ban)
                          // loadDeptLeaderCandidates được effect [factoryId, phong_ban, pham_vi] tự gọi
                        }
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {form.pham_vi === "Don_vi" && (
                  <p className="text-xs text-blue-600 mt-1">
                    Văn bản chỉ lưu hành trong đơn vị. Người trong phòng ban ký xác nhận tuần tự.
                  </p>
                )}
              </div>

              {/* Phân loại Thường/Mật — chỉ áp dụng Nội bộ công ty */}
              {form.pham_vi !== "Don_vi" && (
                <div className="p-4 rounded-xl border-2 border-slate-200 bg-slate-50">
                  <label className="text-xs font-bold text-slate-600 block mb-2.5">
                    Phân loại <span className="text-red-500">*</span>
                  </label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => handlePhanLoaiChange("Thuong")}
                      className={`flex items-center gap-2 px-6 py-3 rounded-xl text-base font-bold border-2 transition-all ${
                        !isMat
                          ? "bg-slate-700 text-white border-slate-700 shadow-md"
                          : "bg-white text-slate-500 border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <Shield size={17} />
                      Thường
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePhanLoaiChange("Mat")}
                      className={`flex items-center gap-2 px-6 py-3 rounded-xl text-base font-bold border-2 transition-all ${
                        isMat
                          ? "bg-red-600 text-white border-red-600 shadow-md"
                          : "bg-white text-red-500 border-red-300 hover:bg-red-50"
                      }`}
                    >
                      <Lock size={17} />
                      Mật
                    </button>
                  </div>
                  <p className={`text-xs mt-2 ${isMat ? "text-red-500 font-medium" : "text-slate-400"}`}>
                    {isMat
                      ? "Văn bản Mật: mỗi bước ký cần chọn đích danh người nhận thông báo."
                      : "Văn bản Thường: thông báo đến trưởng/phó phòng ban tương ứng."}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
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
              </div>

              {/* Bug 2: Editable mã văn bản với cảnh báo — checkbox "không có mã" luôn hiện,
                  không chờ chọn xong Loại VB + Phòng ban mới hiện (2 trường đó chỉ cần thiết
                  để auto-sinh/preview mã, không cần thiết để quyết định có-mã-hay-không). */}
              <div>
                <label className="flex items-center gap-2 mb-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={khongCoMa}
                    onChange={(e) => {
                      const checked = e.target.checked
                      setKhongCoMa(checked)
                      if (checked) {
                        setMaVanBan("")
                        setMaVanBanEdited(false)
                      }
                    }}
                    className="rounded"
                  />
                  <span className="text-xs font-bold text-slate-600">
                    Văn bản này không có mã (VD: danh sách, chứng nhận không theo khuôn số)
                  </span>
                </label>
                {!khongCoMa && form.loai_van_ban && form.phong_ban && (
                  <>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">
                      Mã văn bản
                      <span className="ml-1.5 text-xs font-normal text-slate-400">(tự sinh — có thể sửa)</span>
                    </label>
                    <div className="relative">
                      <input
                        className={`w-full px-3 py-2 border rounded-xl text-sm font-mono outline-none transition-colors ${
                          maVanBanExists
                            ? "border-red-400 bg-red-50 focus:border-red-500"
                            : hasGapWarning
                            ? "border-amber-400 bg-amber-50 focus:border-amber-500"
                            : "border-slate-300 focus:border-blue-500"
                        }`}
                        value={maVanBan}
                        onChange={(e) => {
                          setMaVanBan(e.target.value)
                          setMaVanBanEdited(true)
                        }}
                        placeholder={
                          form.loai_van_ban && form.phong_ban
                            ? `VD: ${buildMaVanBan(nextSoPreview || 1, kyHieu, form.phong_ban)}`
                            : "Chọn Loại VB và Phòng ban trước"
                        }
                      />
                      {maVanBanChecking && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2">
                          <div className="w-3.5 h-3.5 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin" />
                        </div>
                      )}
                    </div>
                    {maVanBanExists && (
                      <div className="flex items-center gap-1.5 mt-1.5 text-xs text-red-600 font-bold">
                        <AlertTriangle size={12} />
                        Mã văn bản này đã tồn tại trong hệ thống.
                      </div>
                    )}
                    {!maVanBanExists && hasGapWarning && nextSoPreview !== null && (
                      <div className="flex items-start gap-1.5 mt-1.5 text-xs text-amber-700 font-medium">
                        <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                        <span>
                          Cảnh báo: Số tiếp theo được đề xuất là{" "}
                          <strong className="font-mono">{buildMaVanBan(nextSoPreview, kyHieu, form.phong_ban)}</strong>.
                          {" "}Kiểm tra kiểm soát nhảy số trước khi lưu.
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>

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

              {form.pham_vi !== "Don_vi" && (
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Cấp văn bản</label>
                  <select
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
                    value={form.cap_tl}
                    onChange={(e) => setForm((f) => ({ ...f, cap_tl: e.target.value }))}
                  >
                    <option value="Cấp 1">Cấp 1 — Ký xác nhận/vòng ký, sau đó phê duyệt</option>
                    <option value="Cấp 2">Cấp 2 — Phê duyệt trực tiếp</option>
                  </select>
                </div>
              )}

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

              {/* Bug 6e: Mô tả tìm kiếm AI */}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  <Sparkles size={12} className="inline mr-1 text-violet-500" />
                  Mô tả tìm kiếm AI
                  <span className="ml-1.5 text-xs font-normal text-slate-400">(tùy chọn)</span>
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-400 resize-none"
                  rows={2}
                  placeholder="Mô tả ngắn gọn nội dung để AI tìm kiếm chính xác hơn (VD: kế hoạch sản xuất quý 3 NMCB)..."
                  value={form.mo_ta_tim_kiem}
                  onChange={(e) => setForm((f) => ({ ...f, mo_ta_tim_kiem: e.target.value }))}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Cột phải: vòng ký + người phê duyệt */}
        <div className="space-y-4">
          {/* Người phê duyệt cuối — đặt trước vòng ký để approverDept luôn được chọn trước */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-sm font-bold text-slate-700 mb-3">
              Người phê duyệt cuối <span className="text-red-500">*</span>
            </h2>

            {form.pham_vi === "Don_vi" ? (
              /* --- Nội bộ đơn vị: tự động xác định lãnh đạo phòng ban theo Chức vụ --- */
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
              /* --- Nội bộ công ty: chọn tay từ danh sách toàn nhà máy --- */
              <>
                <select
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-blue-500"
                  value={form.phe_duyet_user_id}
                  onChange={(e) => setForm((f) => ({ ...f, phe_duyet_user_id: e.target.value }))}
                >
                  <option value="">— Chọn người phê duyệt —</option>
                  {filteredApprovers.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.full_name || a.username}
                    </option>
                  ))}
                </select>
                {filteredApprovers.length === 0 && (
                  <p className="text-xs text-slate-400 mt-1.5">
                    Chưa có người dùng nào có quyền phê duyệt.
                  </p>
                )}
                {approverDept && (
                  <p className="text-xs text-slate-400 mt-1.5">
                    Phòng ban:{" "}
                    <strong className="text-slate-600">{approverDept}</strong>
                    {" "}— sẽ được loại khỏi danh sách bước ký
                  </p>
                )}
              </>
            )}
          </div>

          {/* Vòng ký / Ký xác nhận — phân nhánh theo pham_vi */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            {form.pham_vi === "Don_vi" ? (
              /* --- Nội bộ đơn vị: chọn người ký xác nhận --- */
              <>
                <h2 className="text-sm font-bold text-slate-700 mb-3">
                  Ký xác nhận (Nội bộ đơn vị)
                  <span className="ml-2 text-xs font-normal text-slate-400">(tùy chọn — có thể để trống)</span>
                </h2>
                {!form.phong_ban ? (
                  <p className="text-sm text-amber-600 text-center py-4">
                    Chọn Phòng ban trước để hiện danh sách người ký.
                  </p>
                ) : unitUsers.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">
                    Không tìm thấy người dùng trong phòng ban{" "}
                    <strong>{form.phong_ban}</strong>.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
                    {unitUsers
                      .filter((u) => u.id !== form.phe_duyet_user_id)
                      .map((u) => {
                        const idx = selectedUnitUserIds.indexOf(u.id)
                        const selected = idx >= 0
                        return (
                          <label
                            key={u.id}
                            className={`flex items-center gap-2.5 p-2 rounded-lg border cursor-pointer transition-all ${
                              selected
                                ? "border-blue-300 bg-blue-50"
                                : "border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={(e) => {
                                setSelectedUnitUserIds((prev) =>
                                  e.target.checked
                                    ? [...prev, u.id]
                                    : prev.filter((id) => id !== u.id),
                                )
                              }}
                              className="rounded"
                            />
                            {selected && (
                              <span className="w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center font-bold shrink-0">
                                {idx + 1}
                              </span>
                            )}
                            <span className="text-sm text-slate-700 flex-1">
                              {u.full_name || u.username}
                            </span>
                            <span className="text-xs text-slate-400">{u.department}</span>
                          </label>
                        )
                      })}
                  </div>
                )}
                {selectedUnitUserIds.length > 0 && selectedApprover && (
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-400">
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
                )}
              </>
            ) : (
              /* --- Nội bộ công ty: vòng ký phòng ban --- */
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-bold text-slate-700">
                    Vòng ký phòng ban
                    {form.cap_tl === "Cấp 2" && (
                      <span className="ml-2 text-xs font-normal text-slate-400">(bỏ qua với Cấp 2)</span>
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
                    {steps.map((s, i) => {
                      const isApproverDept = !!approverDept && s.phong_ban_code === approverDept
                      return (
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
                              className={`flex-1 px-2 py-1.5 border rounded-lg text-sm outline-none ${
                                isApproverDept
                                  ? "border-amber-400 bg-amber-50 focus:border-amber-500"
                                  : "border-slate-300 focus:border-blue-500"
                              }`}
                              value={s.phong_ban_code}
                              onChange={(e) => updateStepPhongBan(s.id, e.target.value)}
                            >
                              <option value="">— Chọn phòng ban —</option>
                              {PHONG_BAN_VAN_BAN_OPTIONS.filter((pb) => pb !== approverDept).map((pb) => (
                                <option key={pb} value={pb}>{pb}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => removeStep(s.id)}
                              className="p-1.5 text-slate-300 hover:text-red-500 rounded transition-all"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>

                          {isApproverDept && (
                            <div className="ml-7 flex items-center gap-1.5 text-xs text-amber-700">
                              <AlertTriangle size={11} />
                              Phòng ban này trùng với người phê duyệt cuối.
                            </div>
                          )}

                          {isMat && (
                            <div className="ml-7">
                              <label className="text-[10px] font-bold text-red-600 block mb-1">
                                Người nhận thông báo (đích danh) <span className="text-red-500">*</span>
                              </label>
                              <select
                                className={`w-full px-2 py-1.5 text-xs border rounded-lg outline-none ${
                                  isMat && !s.mat_recipient_user_id && s.phong_ban_code
                                    ? "border-red-300 bg-red-50 focus:border-red-400"
                                    : "border-slate-300 focus:border-red-400"
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
                                  Không tìm thấy người dùng trong phòng {s.phong_ban_code}.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
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
              </>
            )}
          </div>

          {/* Hướng dẫn tag template */}
          <TagGuidePanel />

          {/* Nút lưu */}
          <div className="flex flex-col gap-2">
            <button
              onClick={handleSave}
              disabled={
                saving ||
                maVanBanExists ||
                (form.pham_vi === "Don_vi" && deptLeaderQueried && deptLeaderCandidates.length === 0)
              }
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

// ─── TagGuidePanel ────────────────────────────────────────────────────────────

function TagGuidePanel() {
  const [open, setOpen] = useState(false)

  const groups = [
    {
      label: "Metadata văn bản",
      tags: [
        { tag: "{{SO_VAN_BAN}}", desc: "Số văn bản (VD: 01)" },
        { tag: "{{MA_VAN_BAN}}", desc: "Mã đầy đủ (VD: 01/BC-NMCB)" },
        { tag: "{{LOAI_VAN_BAN}}", desc: "Loại văn bản (VD: Báo cáo)" },
        { tag: "{{QR}}", desc: "Mã QR trỏ về trang chi tiết" },
      ],
    },
    {
      label: "Chữ ký từng bước (thay N = 1, 2, 3...)",
      tags: [
        { tag: "{{TEN_BUOC_N}}", desc: "Tên người ký bước N" },
        { tag: "{{CHU_KY_BUOC_N}}", desc: "Ảnh chữ ký bước N" },
        { tag: "{{CHUC_VU_BUOC_N}}", desc: "Chức vụ người ký bước N" },
        { tag: "{{NGAY_KY_BUOC_N}}", desc: "Ngày ký bước N" },
      ],
    },
    {
      label: "Phê duyệt cuối",
      tags: [
        { tag: "{{TEN_PHE_DUYET}}", desc: "Tên người phê duyệt" },
        { tag: "{{CHU_KY_PHE_DUYET}}", desc: "Ảnh chữ ký người phê duyệt" },
        { tag: "{{CHUC_VU_PHE_DUYET}}", desc: "Chức vụ người phê duyệt" },
        { tag: "{{NGAY_BAN_HANH}}", desc: "Ngày ban hành (phê duyệt)" },
      ],
    },
  ]

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between w-full px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-all text-left"
        type="button"
      >
        <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">
          Hướng dẫn đặt tag trong file DOCX / XLSX
        </span>
        <span className="text-slate-400 text-xs">{open ? "▲ Thu gọn" : "▼ Xem tag"}</span>
      </button>

      {open && (
        <div className="p-4 space-y-4">
          <p className="text-xs text-slate-500">
            Đặt các tag sau vào file DOCX / XLSX. Hệ thống tự thay thế khi ký duyệt.
            Tag đúng nhưng không có trong file → bỏ qua. Tag sai cú pháp → hệ thống cảnh báo yêu cầu sửa template.
          </p>
          {groups.map((g) => (
            <div key={g.label}>
              <p className="text-xs font-bold text-slate-500 mb-2">{g.label}</p>
              <div className="space-y-1">
                {g.tags.map(({ tag, desc }) => (
                  <div key={tag} className="flex items-center gap-3 text-xs">
                    <code className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded font-mono shrink-0">
                      {tag}
                    </code>
                    <span className="text-slate-500">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

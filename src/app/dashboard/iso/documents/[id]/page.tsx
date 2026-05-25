"use client"

import { type RefObject, useCallback, useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, getFreshAuthSession, hasPermission, type SessionUser } from "@/lib/auth"
import { IsoShell } from "../../_components/iso-shell"
import {
  TRANG_THAI_LABEL,
  TRANG_THAI_COLOR,
  LOAI_TAI_LIEU_LABEL,
  LOAI_CHA_OPTIONS,
  LOAI_CON_OPTIONS,
  LOAI_PHONG_BAN_MAP,
  PHONG_BAN_OPTIONS,
  buildMaTaiLieu,
  buildMaTaiLieuCon,
  parseMaTaiLieuCon,
  parseParentCode,
  emptyIsoForm,
  fmtDate,
  type IsoDocument,
  type IsoDocumentForm,
} from "../../_components/iso-types"
import {
  ArrowLeft,
  Save,
  Upload,
  FileText,
  Eye,
  Download,
  Send,
  CheckCircle2,
  AlertTriangle,
  X,
  KeyRound,
  EyeOff,
  Loader2,
  RotateCcw,
  Lock,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import Link from "next/link"
import { QRCodeSVG } from "qrcode.react"
import Draggable from "react-draggable"
import { Resizable } from "re-resizable"

type ProfileOption = {
  id: string
  full_name: string
  username: string
  role: string
}

type PinModalAction = "gui_xem_xet" | "gui_phe_duyet" | "phe_duyet" | "tra_ve" | "khong_xem_xet" | "tu_choi_phe_duyet" | "gui_lai_phe_duyet" | "tra_ve_nhap"

type SignPlacement = {
  page: number
  x: number
  y: number
  width: number
  height: number
  showSignerName?: boolean
  nameX?: number
  nameY?: number
  nameWidth?: number
  nameHeight?: number
}

type PreviewSignature = SignPlacement & {
  signerUserId: string
  url: string
}

export default function IsoDocumentDetailPage() {
  const params = useParams()
  const router = useRouter()
  const docId = params.id as string
  const isNew = docId === "new-doc"

  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [doc, setDoc] = useState<IsoDocument | null>(null)
  const [form, setForm] = useState<IsoDocumentForm>(emptyIsoForm())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // File upload
  const [fileUploading, setFileUploading] = useState(false)
  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null)
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Users for selectors â€” all active, xem_xet-filtered, phe_duyet-filtered
  const [profilesAll, setProfilesAll] = useState<ProfileOption[]>([])
  const [profilesXemXet, setProfilesXemXet] = useState<ProfileOption[]>([])
  const [profilesPheDuyet, setProfilesPheDuyet] = useState<ProfileOption[]>([])

  // PIN modal
  const [pinModal, setPinModal] = useState<{
    action: PinModalAction
    label: string
  } | null>(null)
  const [pin, setPin] = useState("")
  const [showPin, setShowPin] = useState(false)
  const [pinError, setPinError] = useState("")
  const [pinLoading, setPinLoading] = useState(false)
  const [lyDoTraVe, setLyDoTraVe] = useState("")

  // Signature placement modal
  const [placementModal, setPlacementModal] = useState<{
    show: boolean
    token: string
    action: PinModalAction
    lyDo: string
    sigX: number
    sigY: number
    sigW: number
    sigH: number
    nameX: number
    nameY: number
    nameW: number
    nameH: number
    currentPage: number
    totalPages: number
    canvasScale: number
    pdfPageHeight: number
    sigImgUrl: string | null
    previewSignatures: PreviewSignature[]
    signerName: string
    showSignerName: boolean
  } | null>(null)
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null)
  const draggableNodeRef = useRef<HTMLDivElement>(null)
  const nameNodeRef = useRef<HTMLDivElement>(null)
  const pdfDocRef = useRef<unknown>(null)

  // Success toast
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)

  // Header mismatch warnings from generate-pdf
  const [headerMismatchWarnings, setHeaderMismatchWarnings] = useState<Array<{ found: string; expected: string }>>([])
  // Labels user confirmed are intentional (not errors) â€” skip in future generate-pdf calls
  const [confirmedSkipTags, setConfirmedSkipTags] = useState<string[]>([])


  const appUrl = typeof window !== "undefined" ? window.location.origin : ""
  const recordUrl = `${appUrl}/dashboard/iso/documents/${docId}`

  // Load profiles filtered by permission code â€” dĂ¹ng API server-side Ä‘á»ƒ bypass RLS trĂªn user_permissions
  const loadProfilesByPermission = useCallback(async (fid: string, permCode: string): Promise<ProfileOption[]> => {
    try {
      const res = await fetch(`/api/iso/profiles-by-permission?factoryId=${fid}&permCode=${encodeURIComponent(permCode)}`)
      if (!res.ok) return []
      const json = await res.json()
      return (json.profiles || []) as ProfileOption[]
    } catch {
      return []
    }
  }, [])

  const loadProfiles = useCallback(async (fid: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("id, full_name, username, role")
      .eq("factory_id", fid)
      .eq("status", "active")
      .order("full_name")
    setProfilesAll((data || []) as ProfileOption[])

    const [xemXetList, pheDuyetList] = await Promise.all([
      loadProfilesByPermission(fid, "iso.xem_xet"),
      loadProfilesByPermission(fid, "iso.phe_duyet"),
    ])
    setProfilesXemXet(xemXetList)
    setProfilesPheDuyet(pheDuyetList)
  }, [loadProfilesByPermission])

  const loadDoc = useCallback(async (id: string, fid: string) => {
    const { data, error } = await supabase
      .from("iso_documents")
      .select("*")
      .eq("id", id)
      .eq("factory_id", fid)
      .single()
    if (error || !data) return
    const d = data as IsoDocument
    setDoc(d)
    const isCon = d.phan_loai_tl === "con" || d.loai_tai_lieu === "F"

    let soHieu = ""
    let maTaiLieuCha = ""
    let loaiTaiLieuCha = "QT"
    let soHieuCha = ""

    if (isCon && d.ma_tai_lieu && d.loai_tai_lieu) {
      // Parse mĂ£ Con: "NMCB-QT01-PL01" â†’ { maCha: "NMCB-QT01", soHieu: "1" }
      const parsed = parseMaTaiLieuCon(d.ma_tai_lieu, d.loai_tai_lieu)
      if (parsed.maCha) {
        maTaiLieuCha = parsed.maCha
        soHieu = parsed.soHieu
        const parentParsed = parseParentCode(parsed.maCha)
        if (parentParsed) {
          loaiTaiLieuCha = parentParsed.loai
          soHieuCha = parentParsed.so
        }
      } else {
        const last = (d.ma_tai_lieu || "").match(/(\d+)$/)
        soHieu = last ? String(parseInt(last[1])) : ""
      }
    } else {
      // Cha: mĂ£ dáº¡ng NMCB-QT01 â†’ tĂ¡ch sá»‘ cuá»‘i
      const last = (d.ma_tai_lieu || "").match(/(\d+)$/)
      soHieu = last ? String(parseInt(last[1])) : ""
    }

    setForm({
      ma_tai_lieu: d.ma_tai_lieu || "",
      so_hieu: soHieu,
      loai_tai_lieu_cha: loaiTaiLieuCha,
      so_hieu_cha: soHieuCha,
      ma_tai_lieu_cha: maTaiLieuCha,
      ten_tai_lieu: d.ten_tai_lieu,
      loai_tai_lieu: d.loai_tai_lieu || "QT",
      phong_ban: d.phong_ban || "",
      cap_tl: d.cap_tl || "Cáº¥p 1",
      chon_quy_trinh: d.chon_quy_trinh || "Soáº¡n tháº£o",
      lan_ban_hanh: String(d.lan_ban_hanh ?? 0),
      soan_thao: d.soan_thao || "",
      soan_thao_user_id: d.soan_thao_user_id || "",
      xem_xet: d.xem_xet || "",
      xem_xet_user_id: d.xem_xet_user_id || "",
      phe_duyet: d.phe_duyet || "",
      phe_duyet_user_id: d.phe_duyet_user_id || "",
      ghi_chu: d.ghi_chu || "",
      ma_tai_lieu_moi: d.ma_tai_lieu_moi || "",
      phan_loai_tl: d.phan_loai_tl || "cha",
    })
    if (d.file_goc_url) {
      setUploadedFileUrl(d.file_goc_url)
      const parts = d.file_goc_url.split("/")
      setUploadedFileName(decodeURIComponent(parts[parts.length - 1]))
    }
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      const session = await getFreshAuthSession()
      if (!session?.user) { setLoading(false); return }
      const erp = JSON.parse(localStorage.getItem("erp_user") || "{}")
      setUser(erp)
      setFactoryId(fid)
      void loadProfiles(fid)
      if (!isNew) {
        await loadDoc(docId, fid)
      }
      setLoading(false)
    }
    void bootstrap()
  }, [isNew, docId, loadDoc, loadProfiles])

  // Auto-set soáº¡n tháº£o = user hiá»‡n táº¡i khi táº¡o má»›i
  useEffect(() => {
    if (isNew && user && !form.soan_thao_user_id) {
      setForm((f) => ({
        ...f,
        soan_thao_user_id: user.id,
        soan_thao: user.full_name || user.username,
      }))
    }
  }, [isNew, user, form.soan_thao_user_id])

  // Load PDF khi má»Ÿ placement modal â€” pdfjs v5+
  useEffect(() => {
    if (!placementModal?.show || !doc?.file_goc_url) return
    const loadPdf = async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist")
        // DĂ¹ng version tá»« package Ä‘á»ƒ khá»›p vá»›i CDN worker (trĂ¡nh version mismatch crash)
        const ver = pdfjsLib.version
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          `https://cdn.jsdelivr.net/npm/pdfjs-dist@${ver}/build/pdf.worker.min.mjs`
        const pdfDoc = await pdfjsLib.getDocument(doc.file_goc_url!).promise
        pdfDocRef.current = pdfDoc
        setPlacementModal((p) => p ? { ...p, totalPages: pdfDoc.numPages } : null)
        await renderPdfPage(pdfDoc, 1)
      } catch (err) {
        console.error("PDF load failed:", err)
        showToast(false, "KhĂ´ng táº£i Ä‘Æ°á»£c file PDF Ä‘á»ƒ Ä‘áº·t chá»¯ kĂ½. Chá»¯ kĂ½ sáº½ chá»‰ hiá»‡n trĂªn Phiáº¿u KĂ½ Duyá»‡t.")
        // ÄĂ³ng modal trÆ°á»›c, rá»“i gá»i doTransition bĂªn ngoĂ i setState (trĂ¡nh side-effect trong setter)
        const snapshot = placementModal
        setPlacementModal(null)
        if (snapshot) void doTransition(snapshot.action, snapshot.token, null, snapshot.lyDo)
      }
    }
    void loadPdf()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placementModal?.show])

  const renderPdfPage = async (pdfDoc: unknown, pageNum: number) => {
    const pd = pdfDoc as { getPage: (n: number) => Promise<unknown> }
    const page = await pd.getPage(pageNum)
    const p = page as {
      getViewport: (o: { scale: number }) => { width: number; height: number }
      view: number[]
      render: (ctx: object) => { promise: Promise<void> }
    }
    const viewport = p.getViewport({ scale: 1.5 })
    const canvas = pdfCanvasRef.current
    if (!canvas) return
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext("2d")!
    await p.render({ canvasContext: ctx, viewport }).promise
    const pdfPageH = p.view[3] - p.view[1]
    const scale = viewport.height / pdfPageH
    setPlacementModal((prev) => prev ? { ...prev, canvasScale: scale, pdfPageHeight: pdfPageH } : null)
  }

  const trangThai = doc?.trang_thai || "draft"
  const userId = user?.id ?? ""
  // Pháº£i lĂ  Ä‘Ăºng ngÆ°á»i Ä‘Æ°á»£c chá»‰ Ä‘á»‹nh VĂ€ cĂ³ quyá»n
  const canXemXet = hasPermission(user, "iso.xem_xet") && !!userId && userId === doc?.xem_xet_user_id
  const canApprove = hasPermission(user, "iso.phe_duyet") && !!userId && userId === doc?.phe_duyet_user_id
  const isEditable = isNew || trangThai === "draft" || trangThai === "tra_ve" || (trangThai === "bi_tu_choi_phe_duyet" && canXemXet)

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text })
    setTimeout(() => setToast(null), 4000)
  }

  const handleFileUpload = async (file: File) => {
    if (!factoryId) return
    const allowed = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
    if (!allowed.some((t) => file.type.includes(t.split("/")[1])) && !file.name.match(/\.(pdf|docx|xlsx)$/i)) {
      setSaveError("Chá»‰ há»— trá»£ file PDF, DOCX, XLSX")
      return
    }
    setFileUploading(true)
    setSaveError(null)
    setHeaderMismatchWarnings([])
    try {
      const safeName = file.name.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._\-]/g, (c) => encodeURIComponent(c))
      const path = `${factoryId}/iso/${Date.now()}_${safeName}`
      const { error } = await supabase.storage.from("iso-documents").upload(path, file, { upsert: true })
      if (error) { setSaveError(error.message); return }
      const { data: urlData } = supabase.storage.from("iso-documents").getPublicUrl(path)
      setUploadedFileUrl(urlData.publicUrl)
      setUploadedFileName(file.name)
    } finally {
      setFileUploading(false)
    }
  }

  const handleSave = async () => {
    if (!factoryId) return
    if (!form.ten_tai_lieu.trim()) { setSaveError("Vui lĂ²ng nháº­p tĂªn tĂ i liá»‡u"); return }
    setSaving(true)
    setSaveError(null)
    try {
      const session = await getFreshAuthSession()
      const payload = {
        factory_id: factoryId,
        ma_tai_lieu: form.ma_tai_lieu || null,
        ten_tai_lieu: form.ten_tai_lieu,
        loai_tai_lieu: form.loai_tai_lieu || null,
        phong_ban: form.phong_ban || null,
        cap_tl: form.cap_tl || null,
        chon_quy_trinh: form.chon_quy_trinh || null,
        lan_ban_hanh: parseInt(form.lan_ban_hanh) || 0,
        soan_thao: form.soan_thao || null,
        soan_thao_user_id: form.soan_thao_user_id || null,
        xem_xet: form.xem_xet || null,
        xem_xet_user_id: form.xem_xet_user_id || null,
        phe_duyet: form.phe_duyet || null,
        phe_duyet_user_id: form.phe_duyet_user_id || null,
        ghi_chu: form.ghi_chu || null,
        ma_tai_lieu_moi: form.ma_tai_lieu_moi || null,
        phan_loai_tl: form.phan_loai_tl || "cha",
        file_goc_url: uploadedFileUrl || null,
        created_by: session?.user?.id,
      }

      if (isNew) {
        const { data, error } = await supabase
          .from("iso_documents")
          .insert(payload)
          .select("id")
          .single()
        if (error) { setSaveError(error.message); return }
        showToast(true, "ÄĂ£ táº¡o tĂ i liá»‡u")
        router.replace(`/dashboard/iso/documents/${data.id}`)
      } else {
        const { error } = await supabase
          .from("iso_documents")
          .update(payload)
          .eq("id", docId)
          .eq("factory_id", factoryId)
        if (error) { setSaveError(error.message); return }
        showToast(true, "ÄĂ£ lÆ°u thay Ä‘á»•i")
        void loadDoc(docId, factoryId)
      }
    } finally {
      setSaving(false)
    }
  }

  // Helper: danh sĂ¡ch user nháº­n thĂ´ng bĂ¡o theo action
  const getNotifyRecipients = (action: PinModalAction, d: IsoDocument): string[] => {
    switch (action) {
      case "gui_xem_xet":
        if (d.cap_tl === "Cáº¥p 2") return [d.phe_duyet_user_id].filter(Boolean) as string[]
        return [d.xem_xet_user_id].filter(Boolean) as string[]
      case "gui_phe_duyet": return [d.phe_duyet_user_id].filter(Boolean) as string[]
      case "phe_duyet": return [d.soan_thao_user_id, d.xem_xet_user_id].filter(Boolean) as string[]
      case "tra_ve":
      case "khong_xem_xet": return [d.soan_thao_user_id].filter(Boolean) as string[]
      case "tu_choi_phe_duyet":
        if (d.cap_tl === "Cáº¥p 2") return [d.soan_thao_user_id].filter(Boolean) as string[]
        return [d.xem_xet_user_id, d.soan_thao_user_id].filter(Boolean) as string[]
      case "gui_lai_phe_duyet": return [d.phe_duyet_user_id].filter(Boolean) as string[]
      case "tra_ve_nhap": return [d.soan_thao_user_id].filter(Boolean) as string[]
      default: return []
    }
  }

  // Thá»±c hiá»‡n chuyá»ƒn tráº¡ng thĂ¡i sau khi PIN Ä‘Ă£ Ä‘Æ°á»£c xĂ¡c minh
  const doTransition = async (
    action: PinModalAction,
    token: string | null,
    placement: SignPlacement | null,
    lyDo?: string,
  ) => {
    if (!factoryId || !user || !doc) return
    const now = new Date().toISOString()
    let invalidatedIds: string[] = []

    try {
      if (action === "gui_xem_xet") {
        // Cáº¥p 2 Ä‘i tháº³ng vĂ o cho_phe_duyet; Cáº¥p 1 qua cho_xem_xet
        const newStatus = doc.cap_tl === "Cáº¥p 2" ? "cho_phe_duyet" : "cho_xem_xet"
        const { error } = await supabase
          .from("iso_documents")
          .update({ trang_thai: newStatus, ky_soan_thao_at: now })
          .eq("id", docId).eq("factory_id", factoryId)
        if (error) { showToast(false, error.message); return }

      } else if (action === "gui_phe_duyet") {
        const { error } = await supabase
          .from("iso_documents")
          .update({ trang_thai: "cho_phe_duyet", ky_xem_xet_at: now })
          .eq("id", docId).eq("factory_id", factoryId)
        if (error) { showToast(false, error.message); return }

      } else if (action === "phe_duyet") {
        // Thu tháº­p ID tĂ i liá»‡u cÅ© TRÆ¯á»C khi Ä‘á»•i mĂ£ (dĂ¹ng mĂ£ HIá»†N Táº I cá»§a doc)
        if (doc.chon_quy_trinh === "SoĂ¡t xĂ©t" && doc.ma_tai_lieu) {
          const { data: toInvalidate } = await supabase
            .from("iso_documents")
            .select("id")
            .eq("factory_id", factoryId)
            .eq("ma_tai_lieu", doc.ma_tai_lieu)
            .eq("trang_thai", "co_hieu_luc")
            .neq("id", docId)
          invalidatedIds = (toInvalidate || []).map((d) => d.id)
        }
        const updatePayload: Record<string, unknown> = {
          trang_thai: "co_hieu_luc",
          ky_phe_duyet_at: now,
          ngay_hieu_luc: now,
        }
        // SoĂ¡t xĂ©t Ä‘á»•i mĂ£: gĂ¡n mĂ£ má»›i tá»« ma_tai_lieu_moi
        if (doc.chon_quy_trinh === "SoĂ¡t xĂ©t" && doc.ma_tai_lieu_moi) {
          updatePayload.ma_tai_lieu = doc.ma_tai_lieu_moi
        }
        const { error } = await supabase
          .from("iso_documents")
          .update(updatePayload)
          .eq("id", docId).eq("factory_id", factoryId)
        if (error) { showToast(false, error.message); return }
        // ÄĂ¡nh dáº¥u háº¿t hiá»‡u lá»±c cĂ¡c doc cÅ©
        if (invalidatedIds.length > 0) {
          await supabase
            .from("iso_documents")
            .update({ trang_thai: "het_hieu_luc", ngay_het_hieu_luc: now })
            .in("id", invalidatedIds)
            .eq("factory_id", factoryId)
        }

      } else if (action === "tra_ve" || action === "khong_xem_xet") {
        const { error } = await supabase
          .from("iso_documents")
          .update({ trang_thai: "tra_ve", ghi_chu: lyDo || null })
          .eq("id", docId).eq("factory_id", factoryId)
        if (error) { showToast(false, error.message); return }

      } else if (action === "tu_choi_phe_duyet") {
        // Cáº¥p 1 â†’ bi_tu_choi_phe_duyet (xem xĂ©t quyáº¿t Ä‘á»‹nh tiáº¿p theo)
        // Cáº¥p 2 â†’ tra_ve trá»±c tiáº¿p (khĂ´ng cĂ³ xem xĂ©t)
        const newStatus = doc.cap_tl === "Cáº¥p 2" ? "tra_ve" : "bi_tu_choi_phe_duyet"
        const { error } = await supabase
          .from("iso_documents")
          .update({ trang_thai: newStatus, ghi_chu: lyDo || null })
          .eq("id", docId).eq("factory_id", factoryId)
        if (error) { showToast(false, error.message); return }

      } else if (action === "gui_lai_phe_duyet") {
        // Xem xĂ©t kĂ½ láº¡i vĂ  gá»­i phĂª duyá»‡t láº¡i
        const { error } = await supabase
          .from("iso_documents")
          .update({ trang_thai: "cho_phe_duyet", ky_xem_xet_at: now })
          .eq("id", docId).eq("factory_id", factoryId)
        if (error) { showToast(false, error.message); return }

      } else if (action === "tra_ve_nhap") {
        // Xem xĂ©t tráº£ tĂ i liá»‡u vá» nhĂ¡p
        const { error } = await supabase
          .from("iso_documents")
          .update({ trang_thai: "draft", ghi_chu: lyDo || null })
          .eq("id", docId).eq("factory_id", factoryId)
        if (error) { showToast(false, error.message); return }
      }

      // Ghi audit log
      await supabase.from("doc_approval_log").insert({
        factory_id: factoryId,
        doc_id: docId,
        doc_type: "iso",
        user_id: user.id,
        action,
        ly_do: lyDo || null,
      })

      // Táº¡o PDF kĂ½ duyá»‡t (khĂ´ng block UI náº¿u lá»—i)
      const noSignActions: PinModalAction[] = ["tra_ve", "khong_xem_xet", "tu_choi_phe_duyet", "tra_ve_nhap"]
      let pdfError: string | null = null
      if (token && !noSignActions.includes(action) && doc.file_goc_url) {
        try {
          const pdfRes = await fetch("/api/sign/generate-pdf", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, docId, docType: "iso", signaturePlacement: placement, skipTagLabels: confirmedSkipTags }),
          })
          const pdfJson = await pdfRes.json()
          console.log("[generate-pdf] status:", pdfRes.status, "response:", pdfJson)
          if (pdfJson.ok) {
            // Cáº­p nháº­t state ngay Ä‘á»ƒ UI hiá»ƒn thá»‹ link PDF mĂ  khĂ´ng cáº§n chá» loadDoc
            if (pdfJson.signedPdfUrl) {
              setDoc((prev) => prev ? { ...prev, file_signed_pdf_url: pdfJson.signedPdfUrl as string } : prev)
            }
            if (pdfJson.metaMismatched?.length > 0) {
              setHeaderMismatchWarnings(pdfJson.metaMismatched as Array<{ found: string; expected: string }>)
            }
            const failedSigs = pdfJson.diagnostics?.sigImgLoadFailed as string[] | undefined
            if (failedSigs && failedSigs.length > 0) {
              pdfError = `${failedSigs.length} ngÆ°á»i kĂ½ chÆ°a cĂ³ áº£nh chá»¯ kĂ½. VĂ o CĂ i Ä‘áº·t â†’ Chá»¯ kĂ½ cĂ¡ nhĂ¢n Ä‘á»ƒ upload.`
            }
          } else {
            pdfError = (pdfJson.error as string) ?? "KhĂ´ng rĂµ lá»—i"
          }
        } catch (pdfErr) {
          pdfError = pdfErr instanceof Error ? pdfErr.message : String(pdfErr)
        }
      }

      // Restamp PDF tĂ i liá»‡u cÅ© bá»‹ há»§y hiá»‡u lá»±c
      if (invalidatedIds.length > 0) {
        void fetch("/api/sign/restamp-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docIds: invalidatedIds, factoryId }),
        })
      }

      // Gá»­i thĂ´ng bĂ¡o
      const recipients = getNotifyRecipients(action, doc)
      if (recipients.length > 0) {
        void fetch("/api/iso/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docId,
            factoryId,
            action,
            recipientUserIds: recipients,
            actorUserId: user.id,
            lyDo: lyDo || undefined,
          }),
        })
      }

      if (pdfError) {
        showToast(false, "ÄĂ£ kĂ½ duyá»‡t nhÆ°ng táº¡o PDF tháº¥t báº¡i: " + pdfError)
      } else {
        showToast(true, "ÄĂ£ cáº­p nháº­t tráº¡ng thĂ¡i")
      }
      void loadDoc(docId, factoryId)
    } catch (err) {
      showToast(false, err instanceof Error ? err.message : "Lá»—i xá»­ lĂ½")
    }
  }

  // XĂ¡c nháº­n PIN â†’ má»Ÿ placement modal hoáº·c transition trá»±c tiáº¿p
  const handlePinConfirm = async () => {
    if (!pinModal || !factoryId || !user) return
    if (!pin.trim()) { setPinError("Vui lĂ²ng nháº­p PIN"); return }
    setPinLoading(true)
    setPinError("")
    try {
      const verifyRes = await fetch("/api/sign/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, pin, docId, docType: "iso" }),
      })
      const verifyJson = await verifyRes.json()
      if (!verifyRes.ok) { setPinError(verifyJson.error || "PIN khĂ´ng Ä‘Ăºng"); return }

      const action = pinModal.action
      const currentLyDo = lyDoTraVe

      // ÄĂ³ng PIN modal
      setPinModal(null)
      setPin("")
      setLyDoTraVe("")

      // CĂ¡c action khĂ´ng cáº§n Ä‘áº·t chá»¯ kĂ½
      const noSignActions: PinModalAction[] = ["tra_ve", "khong_xem_xet", "tu_choi_phe_duyet", "tra_ve_nhap"]
      if (noSignActions.includes(action)) {
        await doTransition(action, verifyJson.token, null, currentLyDo)
        return
      }

      // CĂ³ file gá»‘c â†’ má»Ÿ placement modal Ä‘á»ƒ Ä‘áº·t chá»¯ kĂ½
      if (doc?.file_goc_url) {
        const sigPath = `signatures/${factoryId}/${user.id}/chu_ky.png`
        const { data: sigUrlData } = supabase.storage.from("iso-documents").getPublicUrl(sigPath)
        setPlacementModal({
          show: true,
          token: verifyJson.token,
          action,
          lyDo: currentLyDo,
          sigX: 100,
          sigY: 100,
          sigW: 120,
          sigH: 60,
          nameX: 90,
          nameY: 168,
          nameW: 140,
          nameH: 26,
          currentPage: 1,
          totalPages: 1,
          canvasScale: 1,
          pdfPageHeight: 842,
          sigImgUrl: sigUrlData.publicUrl,
          previewSignatures: buildPreviewSignatures(),
          signerName: user.full_name || user.username || "",
          showSignerName: true,
        })
        return
      }

      // KhĂ´ng cĂ³ file â†’ transition trá»±c tiáº¿p
      await doTransition(action, verifyJson.token, null)
    } finally {
      setPinLoading(false)
    }
  }

  // XĂ¡c nháº­n vá»‹ trĂ­ chá»¯ kĂ½ â†’ convert tá»a Ä‘á»™ canvas â†’ PDF rá»“i transition
  const handlePlacementConfirm = async () => {
    if (!placementModal) return
    const { token, action, lyDo, sigX, sigY, sigW, sigH, canvasScale, pdfPageHeight, currentPage } = placementModal
    const placement: SignPlacement = {
      page: currentPage,
      x: sigX / canvasScale,
      y: pdfPageHeight - (sigY / canvasScale) - (sigH / canvasScale),
      width: sigW / canvasScale,
      height: sigH / canvasScale,
      showSignerName: placementModal.showSignerName,
      nameX: placementModal.nameX / canvasScale,
      nameY: pdfPageHeight - (placementModal.nameY / canvasScale) - (placementModal.nameH / canvasScale),
      nameWidth: placementModal.nameW / canvasScale,
      nameHeight: placementModal.nameH / canvasScale,
    }
    setPlacementModal(null)
    await doTransition(action, token, placement, lyDo)
  }

  const handlePageChange = async (newPage: number) => {
    if (!pdfDocRef.current || !placementModal) return
    setPlacementModal((p) => p ? { ...p, currentPage: newPage } : null)
    await renderPdfPage(pdfDocRef.current, newPage)
  }

  const profileName = (uid: string) => {
    const p = profilesAll.find((p) => p.id === uid)
    return p ? (p.full_name || p.username) : ""
  }

  const buildPreviewSignatures = () => {
    if (!doc || !factoryId || !user) return [] as PreviewSignature[]

    const candidates = [
      {
        signerUserId: doc.soan_thao_user_id,
        placement: doc.soan_thao_placement,
        signedAt: doc.ky_soan_thao_at,
      },
      {
        signerUserId: doc.xem_xet_user_id,
        placement: doc.xem_xet_placement,
        signedAt: doc.ky_xem_xet_at,
      },
      {
        signerUserId: doc.phe_duyet_user_id,
        placement: doc.phe_duyet_placement,
        signedAt: doc.ky_phe_duyet_at,
      },
    ]

    return candidates.flatMap((entry) => {
      if (!entry.signerUserId || !entry.placement || !entry.signedAt || entry.signerUserId === user.id) return []
      const sigPath = `signatures/${factoryId}/${entry.signerUserId}/chu_ky.png`
      const { data } = supabase.storage.from("iso-documents").getPublicUrl(sigPath)
      return [{
        signerUserId: entry.signerUserId,
        url: data.publicUrl,
        page: Number(entry.placement.page ?? 0),
        x: Number(entry.placement.x ?? 0),
        y: Number(entry.placement.y ?? 0),
        width: Number(entry.placement.width ?? 0),
        height: Number(entry.placement.height ?? 0),
      }]
    }).filter((entry) => entry.page > 0 && entry.width > 0 && entry.height > 0)
  }

  if (loading) {
    return (
      <IsoShell>
        <div className="p-10 text-center text-slate-400">Äang táº£i...</div>
      </IsoShell>
    )
  }

  if (!isNew && !doc) {
    return (
      <IsoShell>
        <div className="p-10 text-center text-slate-400">KhĂ´ng tĂ¬m tháº¥y tĂ i liá»‡u</div>
      </IsoShell>
    )
  }

  return (
    <IsoShell>
      <div className="space-y-4">
        {/* Toast */}
        {toast && (
          <div className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl shadow-2xl max-w-xl ${toast.ok ? "bg-emerald-600" : "bg-red-600"} text-white`}>
            {toast.ok ? <CheckCircle2 size={16} className="shrink-0" /> : <AlertTriangle size={16} className="shrink-0" />}
            <span className="text-sm font-bold">{toast.text}</span>
            <button onClick={() => setToast(null)} className="ml-2 hover:opacity-70"><X size={14} /></button>
          </div>
        )}

        {/* Save error */}
        {saveError && (
          <div className="flex items-center gap-3 px-5 py-3 bg-red-50 border border-red-200 text-red-700 rounded-xl">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="text-sm">{saveError}</span>
            <button onClick={() => setSaveError(null)} className="ml-auto hover:opacity-70"><X size={14} /></button>
          </div>
        )}

        {/* Header mismatch warning */}
        {headerMismatchWarnings.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-xl p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-bold text-amber-800">PhĂ¡t hiá»‡n tag khĂ´ng khá»›p trong tĂ i liá»‡u</p>
                <ul className="mt-1 text-xs text-amber-700 space-y-0.5">
                  {headerMismatchWarnings.map((w, i) => (
                    <li key={i}>
                      {w.expected === "Footer máº«u"
                        ? (
                          <>
                            &quot;<span className="font-mono">{w.found}</span>&quot; â€” cĂ³ thá»ƒ lĂ  footer máº«u chÆ°a Ä‘Ăºng cáº¥u trĂºc chuáº©n
                          </>
                        )
                        : (
                          <>
                            &quot;<span className="font-mono">{w.found}</span>&quot; â€” cĂ³ thá»ƒ Ä‘Ă£ nháº­p sai thay vĂ¬ &quot;<span className="font-mono">{w.expected}:</span>&quot;
                          </>
                        )}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-amber-600">
                  Náº¿u Ä‘Ă¢y lĂ  lá»—i: táº£i láº¡i file Ä‘Ă£ sá»­a vĂ  kĂ½ láº¡i. Náº¿u khĂ´ng pháº£i lá»—i, báº¥m &quot;Bá» qua&quot; Ä‘á»ƒ há»‡ thá»‘ng khĂ´ng cá»‘ Ä‘iá»n tag nĂ y.
                </p>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => {
                      setConfirmedSkipTags((prev) => [
                        ...prev,
                        ...headerMismatchWarnings.map((w) => w.expected).filter((e) => !prev.includes(e)),
                      ])
                      setHeaderMismatchWarnings([])
                    }}
                    className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 text-xs font-bold rounded-lg"
                  >
                    Bá» qua, khĂ´ng Ä‘iá»n tag nĂ y
                  </button>
                  <button
                    onClick={() => setHeaderMismatchWarnings([])}
                    className="px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-100 rounded-lg"
                  >
                    ÄĂ³ng
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Link href="/dashboard/iso/documents" className="p-2 hover:bg-slate-100 rounded-xl transition-all">
              <ArrowLeft size={18} className="text-slate-600" />
            </Link>
            <div>
              <h1 className="text-xl font-extrabold text-slate-800">
                {isNew ? "Táº¡o tĂ i liá»‡u ISO má»›i" : (doc?.ten_tai_lieu || "Chi tiáº¿t tĂ i liá»‡u")}
              </h1>
              {!isNew && doc && (
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="font-mono text-xs text-violet-700">{doc.ma_tai_lieu || "(chÆ°a cĂ³ mĂ£)"}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${TRANG_THAI_COLOR[trangThai]}`}>
                    {TRANG_THAI_LABEL[trangThai]}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* QR code khi Ä‘Ă£ cĂ³ mĂ£ */}
            {!isNew && doc?.ma_tai_lieu && (
              <QRCodeSVG value={recordUrl} size={48} className="rounded-lg border border-slate-200 p-1" />
            )}

            {/* NĂºt workflow â€” dĂ¹ng inline style Ä‘á»ƒ trĂ¡nh Tailwind purge */}
            {!isNew && trangThai === "draft" && (
              <button
                onClick={() => {
                  const label = form.cap_tl === "Cáº¥p 2" ? "XĂ¡c nháº­n gá»­i phĂª duyá»‡t" : "XĂ¡c nháº­n gá»­i xem xĂ©t"
                  setPinModal({ action: "gui_xem_xet", label })
                  setPin("")
                  setPinError("")
                }}
                disabled={form.cap_tl === "Cáº¥p 2" ? !form.phe_duyet_user_id : (!form.xem_xet_user_id || !form.phe_duyet_user_id)}
                style={{ background: "#d97706" }}
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-all hover:opacity-90"
              >
                <Send size={14} />
                {form.cap_tl === "Cáº¥p 2" ? "Gá»­i phĂª duyá»‡t" : "Gá»­i xem xĂ©t"}
              </button>
            )}

            {/* Xem xĂ©t â†’ gá»­i phĂª duyá»‡t */}
            {!isNew && trangThai === "cho_xem_xet" && canXemXet && (
              <button
                onClick={() => { setPinModal({ action: "gui_phe_duyet", label: "KĂ½ xem xĂ©t & gá»­i phĂª duyá»‡t" }); setPin(""); setPinError("") }}
                style={{ background: "#ea580c" }}
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-xl transition-all hover:opacity-90"
              >
                <Send size={14} /> Gá»­i phĂª duyá»‡t
              </button>
            )}

            {/* Tá»« chá»‘i xem xĂ©t */}
            {!isNew && trangThai === "cho_xem_xet" && canXemXet && (
              <button
                onClick={() => { setPinModal({ action: "khong_xem_xet", label: "Tá»« chá»‘i xem xĂ©t" }); setPin(""); setPinError("") }}
                style={{ background: "#e11d48" }}
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-xl transition-all hover:opacity-90"
              >
                <X size={14} /> Tá»« chá»‘i
              </button>
            )}

            {/* PhĂª duyá»‡t */}
            {!isNew && (trangThai === "cho_phe_duyet") && canApprove && (
              <button
                onClick={() => { setPinModal({ action: "phe_duyet", label: "PhĂª duyá»‡t tĂ i liá»‡u" }); setPin(""); setPinError("") }}
                style={{ background: "#16a34a" }}
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-xl transition-all hover:opacity-90"
              >
                <CheckCircle2 size={14} /> PhĂª duyá»‡t
              </button>
            )}

            {/* KhĂ´ng phĂª duyá»‡t (tá»« cho_phe_duyet â€” chá»‰ canApprove, khĂ´ng dĂ¹ng cho cho_xem_xet) */}
            {!isNew && trangThai === "cho_phe_duyet" && canApprove && (
              <button
                onClick={() => { setPinModal({ action: "tu_choi_phe_duyet", label: "KhĂ´ng phĂª duyá»‡t" }); setPin(""); setPinError(""); setLyDoTraVe("") }}
                style={{ background: "#e11d48" }}
                className="flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-xl transition-all hover:opacity-90"
              >
                <X size={14} /> KhĂ´ng phĂª duyá»‡t
              </button>
            )}

            {/* Xem xĂ©t xá»­ lĂ½ sau khi phĂª duyá»‡t tá»« chá»‘i */}
            {!isNew && trangThai === "bi_tu_choi_phe_duyet" && canXemXet && (
              <>
                <button
                  onClick={() => { setPinModal({ action: "gui_lai_phe_duyet", label: "KĂ½ xem xĂ©t & gá»­i phĂª duyá»‡t láº¡i" }); setPin(""); setPinError("") }}
                  style={{ background: "#ea580c" }}
                  className="flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-xl transition-all hover:opacity-90"
                >
                  <Send size={14} /> Gá»­i phĂª duyá»‡t láº¡i
                </button>
                <button
                  onClick={() => { setPinModal({ action: "tra_ve_nhap", label: "Tráº£ vá» NhĂ¡p" }); setPin(""); setPinError(""); setLyDoTraVe("") }}
                  style={{ background: "#64748b" }}
                  className="flex items-center gap-2 px-4 py-2 text-white text-sm font-bold rounded-xl transition-all hover:opacity-90"
                >
                  <RotateCcw size={14} /> Tráº£ vá» NhĂ¡p
                </button>
              </>
            )}

            {/* NĂºt lÆ°u */}
            {isEditable && (
              <button
                onClick={() => void handleSave()}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl shadow-md disabled:opacity-50 transition-all"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? "Äang lÆ°u..." : "LÆ°u"}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Form chĂ­nh */}
          <div className="lg:col-span-2 space-y-4">
            {/* ThĂ´ng tin cÆ¡ báº£n */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-extrabold text-slate-700 mb-4">ThĂ´ng tin tĂ i liá»‡u</h2>
              {/* Helper: isCon dĂ¹ng cho logic sinh mĂ£ */}
              {(() => {
                const isCon = form.phan_loai_tl === "con"

                const loaiForPb = isCon ? form.loai_tai_lieu_cha : form.loai_tai_lieu
                const pbAllowed: readonly string[] = (loaiForPb && LOAI_PHONG_BAN_MAP[loaiForPb])
                  ? LOAI_PHONG_BAN_MAP[loaiForPb]
                  : PHONG_BAN_OPTIONS

                const rebuildMa = (patch: Partial<IsoDocumentForm>) => {
                  setForm((f) => {
                    const next = { ...f, ...patch }
                    const isConNext = next.phan_loai_tl === "con"
                    if (isConNext) {
                      const maCha = buildMaTaiLieu(next.phong_ban, next.loai_tai_lieu_cha, next.so_hieu_cha)
                      next.ma_tai_lieu_cha = maCha
                      next.ma_tai_lieu = buildMaTaiLieuCon(maCha, next.loai_tai_lieu, next.so_hieu)
                    } else {
                      next.ma_tai_lieu_cha = ""
                      next.ma_tai_lieu = buildMaTaiLieu(next.phong_ban, next.loai_tai_lieu, next.so_hieu)
                    }
                    return next
                  })
                }

                return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Toggle TĂ i liá»‡u / Há»“ sÆ¡ */}
                <div className="sm:col-span-2">
                  <div className="flex rounded-xl border border-slate-200 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => {
                        if (!isEditable) return
                        const newLoai = (LOAI_CHA_OPTIONS as readonly string[]).includes(form.loai_tai_lieu) ? form.loai_tai_lieu : "QT"
                        rebuildMa({ phan_loai_tl: "cha", loai_tai_lieu: newLoai })
                      }}
                      className={`flex-1 py-2 text-sm font-bold transition-all ${!isCon ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-slate-50"} ${!isEditable ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      TĂ i liá»‡u (Cha)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!isEditable) return
                        const newLoai = (LOAI_CON_OPTIONS as readonly string[]).includes(form.loai_tai_lieu) ? form.loai_tai_lieu : "PL"
                        rebuildMa({ phan_loai_tl: "con", loai_tai_lieu: newLoai })
                      }}
                      className={`flex-1 py-2 text-sm font-bold transition-all ${isCon ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-slate-50"} ${!isEditable ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      Há»“ sÆ¡ (Con)
                    </button>
                  </div>
                </div>

                {/* MĂ£ tĂ i liá»‡u (auto, ná»•i báº­t, Ä‘áº§u form) */}
                <div className="sm:col-span-2">
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">MĂ£ tĂ i liá»‡u</label>
                  <div className="px-4 py-3 bg-violet-50 border border-violet-200 rounded-xl font-mono text-lg font-bold text-violet-700 min-h-[52px] flex items-center">
                    {form.ma_tai_lieu || <span className="text-violet-300 font-normal text-sm">(tá»± táº¡o)</span>}
                  </div>
                </div>

                {/* PhĂ²ng ban */}
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">PhĂ²ng ban</label>
                  <select
                    value={form.phong_ban}
                    onChange={(e) => rebuildMa({ phong_ban: e.target.value })}
                    disabled={!isEditable}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                  >
                    <option value="">â€” Chá»n phĂ²ng ban â€”</option>
                    {pbAllowed.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>

                {/* Láº§n sá»­a Ä‘á»•i */}
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Láº§n sá»­a Ä‘á»•i</label>
                  <input
                    type="number"
                    min="0"
                    value={form.lan_ban_hanh}
                    onChange={(e) => setForm((f) => ({ ...f, lan_ban_hanh: e.target.value }))}
                    disabled={!isEditable}
                    placeholder="00"
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                  />
                </div>

                {/* TĂ i liá»‡u (Cha) mode */}
                {!isCon && (
                  <>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Loáº¡i tĂ i liá»‡u</label>
                      <select
                        value={form.loai_tai_lieu}
                        onChange={(e) => rebuildMa({ loai_tai_lieu: e.target.value })}
                        disabled={!isEditable}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                      >
                        {LOAI_CHA_OPTIONS.map((l) => (
                          <option key={l} value={l}>{l} â€” {LOAI_TAI_LIEU_LABEL[l]}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Sá»‘ hiá»‡u</label>
                      <input
                        type="number"
                        min="1"
                        max="99"
                        value={form.so_hieu}
                        onChange={(e) => rebuildMa({ so_hieu: e.target.value })}
                        disabled={!isEditable}
                        placeholder="01"
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 font-mono"
                      />
                    </div>
                  </>
                )}

                {/* Há»“ sÆ¡ (Con) mode */}
                {isCon && (
                  <>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Loáº¡i tĂ i liá»‡u cha</label>
                      <select
                        value={form.loai_tai_lieu_cha}
                        onChange={(e) => rebuildMa({ loai_tai_lieu_cha: e.target.value })}
                        disabled={!isEditable}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                      >
                        {LOAI_CHA_OPTIONS.map((l) => (
                          <option key={l} value={l}>{l} â€” {LOAI_TAI_LIEU_LABEL[l]}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Sá»‘ hiá»‡u cha</label>
                      <input
                        type="number"
                        min="1"
                        max="99"
                        value={form.so_hieu_cha}
                        onChange={(e) => rebuildMa({ so_hieu_cha: e.target.value })}
                        disabled={!isEditable}
                        placeholder="01"
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 font-mono"
                      />
                    </div>
                    {form.ma_tai_lieu_cha && (
                      <div className="sm:col-span-2 flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl">
                        <span className="text-xs text-slate-500">MĂ£ tĂ i liá»‡u cha:</span>
                        <span className="font-mono text-sm text-slate-700">{form.ma_tai_lieu_cha}</span>
                      </div>
                    )}
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Loáº¡i há»“ sÆ¡</label>
                      <select
                        value={form.loai_tai_lieu}
                        onChange={(e) => rebuildMa({ loai_tai_lieu: e.target.value })}
                        disabled={!isEditable}
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                      >
                        {LOAI_CON_OPTIONS.map((l) => (
                          <option key={l} value={l}>{l} â€” {LOAI_TAI_LIEU_LABEL[l]}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">Sá»‘ hiá»‡u con</label>
                      <input
                        type="number"
                        min="1"
                        max="99"
                        value={form.so_hieu}
                        onChange={(e) => rebuildMa({ so_hieu: e.target.value })}
                        disabled={!isEditable}
                        placeholder="01"
                        className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 font-mono"
                      />
                    </div>
                  </>
                )}

                {/* TĂªn tĂ i liá»‡u */}
                <div className="sm:col-span-2">
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">TĂªn tĂ i liá»‡u <span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={form.ten_tai_lieu}
                    onChange={(e) => setForm((f) => ({ ...f, ten_tai_lieu: e.target.value }))}
                    disabled={!isEditable}
                    placeholder="Nháº­p tĂªn tĂ i liá»‡u..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                  />
                </div>

                {/* Cáº¥p tĂ i liá»‡u */}
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Cáº¥p tĂ i liá»‡u</label>
                  <select
                    value={form.cap_tl}
                    onChange={(e) => setForm((f) => ({ ...f, cap_tl: e.target.value }))}
                    disabled={!isEditable}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                  >
                    <option value="Cáº¥p 1">Cáº¥p 1 (3 bÆ°á»›c: Soáº¡n tháº£o â†’ Xem xĂ©t â†’ PhĂª duyá»‡t)</option>
                    <option value="Cáº¥p 2">Cáº¥p 2 (2 bÆ°á»›c: Soáº¡n tháº£o â†’ PhĂª duyá»‡t)</option>
                  </select>
                </div>

                {/* Quy trĂ¬nh */}
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Quy trĂ¬nh</label>
                  <select
                    value={form.chon_quy_trinh}
                    onChange={(e) => setForm((f) => ({ ...f, chon_quy_trinh: e.target.value }))}
                    disabled={!isEditable}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                  >
                    <option value="Soáº¡n tháº£o">Soáº¡n tháº£o má»›i</option>
                    <option value="SoĂ¡t xĂ©t">SoĂ¡t xĂ©t (thay tháº¿ tĂ i liá»‡u cÅ©)</option>
                  </select>
                </div>

                {form.chon_quy_trinh === "SoĂ¡t xĂ©t" && (
                  <div className="sm:col-span-2">
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">MĂ£ tĂ i liá»‡u má»›i (sau soĂ¡t xĂ©t)</label>
                    <input
                      type="text"
                      value={form.ma_tai_lieu_moi}
                      onChange={(e) => setForm((f) => ({ ...f, ma_tai_lieu_moi: e.target.value }))}
                      disabled={!isEditable}
                      placeholder="Äá»ƒ trá»‘ng = giá»¯ nguyĂªn mĂ£ cÅ©"
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 font-mono"
                    />
                  </div>
                )}

                <div className="sm:col-span-2">
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chĂº</label>
                  <textarea
                    value={form.ghi_chu}
                    onChange={(e) => setForm((f) => ({ ...f, ghi_chu: e.target.value }))}
                    disabled={!isEditable}
                    rows={2}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 resize-none"
                  />
                </div>
              </div>
                )
              })()}
            </div>

            {/* NhĂ¢n sá»± */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-extrabold text-slate-700 mb-4">NhĂ¢n sá»± kĂ½ duyá»‡t</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Soáº¡n tháº£o â€” auto-set, read-only */}
                <div>
                  <label className="text-xs font-bold text-slate-600 flex items-center gap-1 mb-1.5">
                    NgÆ°á»i soáº¡n tháº£o
                    {isNew && <Lock size={10} className="text-slate-400" />}
                  </label>
                  <div className="relative">
                    <select
                      value={form.soan_thao_user_id}
                      onChange={(e) => {
                        if (!isNew) {
                          const uid = e.target.value
                          setForm((f) => ({ ...f, soan_thao_user_id: uid, soan_thao: profileName(uid) }))
                        }
                      }}
                      disabled={!isEditable || isNew}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                    >
                      <option value="">â€” Chá»n ngÆ°á»i â€”</option>
                      {profilesAll.map((p) => (
                        <option key={p.id} value={p.id}>{p.full_name || p.username}</option>
                      ))}
                    </select>
                  </div>
                  {doc?.ky_soan_thao_at && (
                    <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                      <CheckCircle2 size={10} /> ÄĂ£ kĂ½ {fmtDate(doc.ky_soan_thao_at)}
                    </p>
                  )}
                </div>

                {/* Xem xĂ©t (chá»‰ Cáº¥p 1) â€” chá»‰ liá»‡t kĂª user cĂ³ iso.xem_xet */}
                {form.cap_tl === "Cáº¥p 1" && (
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">NgÆ°á»i xem xĂ©t</label>
                    <select
                      value={form.xem_xet_user_id}
                      onChange={(e) => {
                        const uid = e.target.value
                        setForm((f) => ({
                          ...f,
                          xem_xet_user_id: uid,
                          xem_xet: profileName(uid),
                          phe_duyet_user_id: f.phe_duyet_user_id === uid ? "" : f.phe_duyet_user_id,
                          phe_duyet: f.phe_duyet_user_id === uid ? "" : f.phe_duyet,
                        }))
                      }}
                      disabled={!isEditable}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                    >
                      <option value="">â€” Chá»n ngÆ°á»i â€”</option>
                      {profilesXemXet
                        .filter((p) => p.id !== form.soan_thao_user_id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>{p.full_name || p.username}</option>
                        ))}
                    </select>
                    {doc?.ky_xem_xet_at && (
                      <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                        <CheckCircle2 size={10} /> ÄĂ£ kĂ½ {fmtDate(doc.ky_xem_xet_at)}
                      </p>
                    )}
                  </div>
                )}

                {/* PhĂª duyá»‡t â€” chá»‰ liá»‡t kĂª user cĂ³ iso.phe_duyet */}
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">NgÆ°á»i phĂª duyá»‡t</label>
                  <select
                    value={form.phe_duyet_user_id}
                    onChange={(e) => {
                      const uid = e.target.value
                      setForm((f) => ({ ...f, phe_duyet_user_id: uid, phe_duyet: profileName(uid) }))
                    }}
                    disabled={!isEditable}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50"
                  >
                    <option value="">â€” Chá»n ngÆ°á»i â€”</option>
                    {profilesPheDuyet
                      .filter((p) => p.id !== form.soan_thao_user_id && p.id !== form.xem_xet_user_id)
                      .map((p) => (
                        <option key={p.id} value={p.id}>{p.full_name || p.username}</option>
                      ))}
                  </select>
                  {doc?.ky_phe_duyet_at && (
                    <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                      <CheckCircle2 size={10} /> ÄĂ£ duyá»‡t {fmtDate(doc.ky_phe_duyet_at)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar: File & thĂ´ng tin */}
          <div className="space-y-4">
            {/* File Ä‘Ă­nh kĂ¨m */}
            <div id="file-goc-upload" className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
              <h2 className="text-sm font-extrabold text-slate-700 mb-3">File tĂ i liá»‡u</h2>
              <p className="text-xs text-slate-500 mb-3">PDF, DOCX hoáº·c XLSX</p>

              {/* HÆ°á»›ng dáº«n nhĂ£n header */}
              <div className="mb-3 p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700">
                <p className="font-bold mb-1">NhĂ£n há»‡ thá»‘ng tá»± nháº­n diá»‡n trong pháº§n header tĂ i liá»‡u:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li><code className="bg-blue-100 px-1 rounded">MĂ£ tĂ i liá»‡u:</code></li>
                  <li><code className="bg-blue-100 px-1 rounded">Láº§n ban hĂ nh:</code> hoáº·c <code className="bg-blue-100 px-1 rounded">Láº§n sá»­a Ä‘á»•i:</code></li>
                  <li><code className="bg-blue-100 px-1 rounded">TĂ¬nh tráº¡ng:</code></li>
                  <li><code className="bg-blue-100 px-1 rounded">NgĂ y hiá»‡u lá»±c:</code></li>
                  <li><code className="bg-blue-100 px-1 rounded">QR:</code> hoáº·c <code className="bg-blue-100 px-1 rounded">QR</code></li>
                </ul>
                <p className="mt-1 text-blue-600">Náº¿u dĂ¹ng nhĂ£n khĂ¡c (VD: &quot;Tráº¡ng thĂ¡i:&quot;, &quot;MĂ£ há»“ sÆ¡:&quot;), há»‡ thá»‘ng sáº½ cáº£nh bĂ¡o vĂ  khĂ´ng Ä‘iá»n vĂ o Ä‘Ă³.</p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void handleFileUpload(f)
                  e.target.value = ""
                }}
              />

              {uploadedFileUrl && !doc?.file_signed_pdf_url ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 p-3 bg-violet-50 rounded-xl">
                    <FileText size={16} className="text-violet-600 shrink-0" />
                    <span className="text-xs text-slate-700 flex-1 truncate">{uploadedFileName}</span>
                    <a href={uploadedFileUrl} target="_blank" rel="noreferrer" className="shrink-0 p-1 hover:bg-violet-100 rounded-lg">
                      <Eye size={13} className="text-violet-600" />
                    </a>
                    <a href={uploadedFileUrl} download className="shrink-0 p-1 hover:bg-violet-100 rounded-lg">
                      <Download size={13} className="text-violet-600" />
                    </a>
                  </div>
                  {isEditable && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={fileUploading}
                      className="w-full px-3 py-2 border border-dashed border-slate-300 hover:border-violet-400 text-slate-500 hover:text-violet-600 text-xs font-medium rounded-xl transition-all"
                    >
                      {fileUploading ? "Äang táº£i..." : "Thay file"}
                    </button>
                  )}
                </div>
              ) : !doc?.file_signed_pdf_url ? (
                isEditable && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={fileUploading}
                    className="w-full flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-slate-200 hover:border-violet-400 rounded-xl text-slate-400 hover:text-violet-600 transition-all"
                  >
                    <Upload size={20} />
                    <span className="text-xs font-medium">
                      {fileUploading ? "Äang táº£i lĂªn..." : "Nháº¥n Ä‘á»ƒ chá»n file"}
                    </span>
                  </button>
                )
              ) : null}


              {/* PDF Ä‘Ă£ kĂ½ */}
              {doc?.file_signed_pdf_url && (
                <div className="mt-3 flex items-center gap-2 p-3 bg-emerald-50 rounded-xl">
                  <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
                  <span className="text-xs text-emerald-700 flex-1">PDF cĂ³ chá»¯ kĂ½</span>
                  <a href={doc.file_signed_pdf_url} target="_blank" rel="noreferrer" className="shrink-0">
                    <Eye size={13} className="text-emerald-600" />
                  </a>
                  <a href={doc.file_signed_pdf_url} download className="shrink-0">
                    <Download size={13} className="text-emerald-600" />
                  </a>
                </div>
              )}
            </div>

            {/* ThĂ´ng tin hiá»‡u lá»±c */}
            {!isNew && doc && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
                <h2 className="text-sm font-extrabold text-slate-700">ThĂ´ng tin hiá»‡u lá»±c</h2>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">NgĂ y hiá»‡u lá»±c</span>
                    <span className="font-medium text-slate-700">{fmtDate(doc.ngay_hieu_luc) || "â€”"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">NgĂ y háº¿t hiá»‡u lá»±c</span>
                    <span className="font-medium text-slate-700">{fmtDate(doc.ngay_het_hieu_luc) || "â€”"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Cáº¥p tĂ i liá»‡u</span>
                    <span className="font-medium text-slate-700">{doc.cap_tl || "â€”"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Láº§n ban hĂ nh</span>
                    <span className="font-mono font-bold text-slate-700">{doc.lan_ban_hanh}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">PhĂ¢n loáº¡i</span>
                    <span className="font-medium text-slate-700">{doc.phan_loai_tl === "con" ? "Con" : "Cha"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Táº¡o lĂºc</span>
                    <span className="font-medium text-slate-700">{fmtDate(doc.created_at)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Signature Placement Modal */}
        {placementModal?.show && (
          <div className="fixed inset-0 bg-black/70 z-50 flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shrink-0 flex-wrap gap-2">
              <h3 className="font-bold text-slate-800 text-sm">Äáº·t chá»¯ kĂ½ trĂªn tĂ i liá»‡u</h3>
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-500 mr-1">
                  Trang {placementModal.currentPage} / {placementModal.totalPages}
                </span>
                <button
                  onClick={() => void handlePageChange(placementModal.currentPage - 1)}
                  disabled={placementModal.currentPage <= 1}
                  className="p-1.5 hover:bg-slate-100 rounded-lg disabled:opacity-40 transition-all"
                >
                  <ChevronLeft size={16} className="text-slate-600" />
                </button>
                <button
                  onClick={() => void handlePageChange(placementModal.currentPage + 1)}
                  disabled={placementModal.currentPage >= placementModal.totalPages}
                  className="p-1.5 hover:bg-slate-100 rounded-lg disabled:opacity-40 transition-all"
                >
                  <ChevronRight size={16} className="text-slate-600" />
                </button>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700 border border-amber-200">
                  Không đặt ảnh chữ ký hoặc tên tràn ra ngoài ô chứa
                </span>
                <button
                  onClick={() => setPlacementModal((p) => p ? { ...p, showSignerName: !p.showSignerName } : null)}
                  className="px-2 py-1 rounded-lg border border-slate-300 hover:bg-slate-50 transition-all"
                >
                  {placementModal.showSignerName ? "áº¨n tĂªn (X)" : "Hiá»‡n tĂªn"}
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const { action, token, lyDo } = placementModal
                    setPlacementModal(null)
                    void doTransition(action, token, null, lyDo)
                  }}
                  className="px-3 py-1.5 text-sm text-slate-600 border border-slate-300 rounded-xl hover:bg-slate-50 transition-all"
                >
                  Bá» qua chá»¯ kĂ½
                </button>
                <button
                  onClick={() => void handlePlacementConfirm()}
                  style={{ background: "#7c3aed" }}
                  className="px-4 py-1.5 text-sm text-white font-bold rounded-xl hover:opacity-90 transition-all"
                >
                  XĂ¡c nháº­n vá»‹ trĂ­
                </button>
              </div>
            </div>
            {/* Canvas area */}
            <div className="flex-1 overflow-auto flex items-start justify-center p-4 bg-slate-100">
              <div className="relative inline-block shadow-2xl bg-white select-none">
                <canvas ref={pdfCanvasRef} className="block" />
                {placementModal.previewSignatures
                  .filter((entry) => entry.page === placementModal.currentPage)
                  .map((entry) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={`${entry.signerUserId}-${entry.page}`}
                      src={entry.url}
                      alt=""
                      draggable={false}
                      style={{
                        position: "absolute",
                        left: entry.x * placementModal.canvasScale,
                        top: (placementModal.pdfPageHeight - entry.y - entry.height) * placementModal.canvasScale,
                        width: entry.width * placementModal.canvasScale,
                        height: entry.height * placementModal.canvasScale,
                        objectFit: "contain",
                        opacity: 0.45,
                        pointerEvents: "none",
                        zIndex: 5,
                      }}
                    />
                  ))}
                {placementModal.sigImgUrl && (
                  <Draggable
                    nodeRef={draggableNodeRef as RefObject<HTMLElement>}
                    position={{ x: placementModal.sigX, y: placementModal.sigY }}
                    onStop={(_, d) => setPlacementModal((p) => p ? { ...p, sigX: d.x, sigY: d.y } : null)}
                    bounds="parent"
                  >
                    <div ref={draggableNodeRef} style={{ position: "absolute", top: 0, left: 0, zIndex: 10, cursor: "move" }}>
                      <Resizable
                        size={{ width: placementModal.sigW, height: placementModal.sigH }}
                        onResizeStop={(_, __, ref) => setPlacementModal((p) => p ? {
                          ...p,
                          sigW: parseInt(ref.style.width) || p.sigW,
                          sigH: parseInt(ref.style.height) || p.sigH,
                        } : null)}
                        minWidth={40}
                        minHeight={20}
                        style={{ border: "2px dashed #7c3aed", position: "relative" }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={placementModal.sigImgUrl}
                          alt="chá»¯ kĂ½"
                          style={{ width: "100%", height: "100%", objectFit: "contain", opacity: 0.9, display: "block" }}
                          draggable={false}
                        />
                        <span style={{
                          position: "absolute",
                          top: -20,
                          left: 0,
                          fontSize: 10,
                          color: "#7c3aed",
                          background: "rgba(255,255,255,0.92)",
                          padding: "1px 5px",
                          borderRadius: 4,
                          whiteSpace: "nowrap",
                          pointerEvents: "none",
                        }}>
                          KĂ©o áº£nh chá»¯ kĂ½ Ä‘á»ƒ Ä‘áº·t vá»‹ trĂ­
                        </span>
                      </Resizable>
                    </div>
                  </Draggable>
                )}
                {placementModal.showSignerName && placementModal.signerName && (
                  <Draggable
                    nodeRef={nameNodeRef as RefObject<HTMLElement>}
                    position={{ x: placementModal.nameX, y: placementModal.nameY }}
                    onStop={(_, d) => setPlacementModal((p) => p ? { ...p, nameX: d.x, nameY: d.y } : null)}
                    bounds="parent"
                  >
                    <div
                      ref={nameNodeRef}
                      style={{ position: "absolute", top: 0, left: 0, zIndex: 11, cursor: "move" }}
                    >
                      <Resizable
                        size={{ width: placementModal.nameW, height: placementModal.nameH }}
                        onResizeStop={(_, __, ref) => setPlacementModal((p) => p ? {
                          ...p,
                          nameW: parseInt(ref.style.width) || p.nameW,
                          nameH: parseInt(ref.style.height) || p.nameH,
                        } : null)}
                        minWidth={90}
                        minHeight={22}
                        style={{
                          border: "2px dashed #0f766e",
                          position: "relative",
                          background: "rgba(255,255,255,0.95)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: "2px 8px",
                        }}
                      >
                        <button
                          type="button"
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={() => setPlacementModal((p) => p ? { ...p, showSignerName: false } : null)}
                          className="absolute -left-2 -top-2 shrink-0 rounded-full border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500 shadow-sm hover:bg-slate-50"
                        >
                          (X)
                        </button>
                        <span
                          style={{
                            fontFamily: "\"Times New Roman\", serif",
                            fontSize: 13,
                            lineHeight: 1.1,
                            color: "#111827",
                            maxWidth: "100%",
                            textAlign: "center",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            pointerEvents: "none",
                          }}
                        >
                          {placementModal.signerName}
                        </span>
                        <span style={{
                          position: "absolute",
                          top: -20,
                          left: 0,
                          fontSize: 10,
                          color: "#0f766e",
                          background: "rgba(255,255,255,0.92)",
                          padding: "1px 5px",
                          borderRadius: 4,
                          whiteSpace: "nowrap",
                          pointerEvents: "none",
                        }}>
                          KĂ©o tĂªn Ä‘á»ƒ Ä‘áº·t vá»‹ trĂ­
                        </span>
                      </Resizable>
                    </div>
                  </Draggable>
                )}
              </div>
            </div>
          </div>
        )}

        {/* PIN Modal */}
        {pinModal && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-violet-100 rounded-xl">
                  <KeyRound size={18} className="text-violet-600" />
                </div>
                <div>
                  <h3 className="font-extrabold text-slate-800">{pinModal.label}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">Nháº­p PIN kĂ½ duyá»‡t Ä‘á»ƒ xĂ¡c nháº­n</p>
                </div>
              </div>

              {(pinModal.action === "tra_ve" || pinModal.action === "khong_xem_xet" || pinModal.action === "tu_choi_phe_duyet" || pinModal.action === "tra_ve_nhap") && (
                <div className="mb-4">
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">
                    {pinModal.action === "khong_xem_xet" ? "LĂ½ do tá»« chá»‘i xem xĂ©t" : pinModal.action === "tu_choi_phe_duyet" ? "LĂ½ do khĂ´ng phĂª duyá»‡t" : "LĂ½ do tráº£ vá»"}
                  </label>
                  <textarea
                    value={lyDoTraVe}
                    onChange={(e) => setLyDoTraVe(e.target.value)}
                    rows={3}
                    placeholder="Nháº­p lĂ½ do..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 resize-none"
                  />
                </div>
              )}

              <div className="mb-4">
                <label className="text-xs font-bold text-slate-600 block mb-1.5">PIN kĂ½ duyá»‡t</label>
                <div className="relative">
                  <input
                    type={showPin ? "text" : "password"}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoFocus
                    value={pin}
                    onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setPinError("") }}
                    placeholder="4â€“6 chá»¯ sá»‘"
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 pr-9 font-mono tracking-widest text-center text-lg"
                    onKeyDown={(e) => { if (e.key === "Enter") void handlePinConfirm() }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPin((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                {pinError && (
                  <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                    <AlertTriangle size={11} /> {pinError}
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => { setPinModal(null); setPin(""); setPinError(""); setLyDoTraVe("") }}
                  className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Há»§y
                </button>
                <button
                  onClick={() => void handlePinConfirm()}
                  disabled={pinLoading || !pin}
                  className="flex items-center gap-2 px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-xl disabled:opacity-50 transition-all"
                >
                  {pinLoading ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
                  {pinLoading ? "Äang xá»­ lĂ½..." : "XĂ¡c nháº­n"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </IsoShell>
  )
}

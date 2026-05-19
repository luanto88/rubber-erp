"use client"

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { QRCodeSVG } from "qrcode.react"
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ImagePlus, Loader2, Plus,
  Printer, QrCode, RotateCcw, Save, Send, Trash2, Wrench, X,
} from "lucide-react"
import { getActiveFactoryId, getFreshAuthSession, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { supabase } from "@/lib/supabase"
import { MaintenanceShell } from "../../_components/maintenance-shell"
import {
  BO_PHAN_LIST,
  currencySymbol,
  generateMaBB,
  loadMaintenanceAssets,
  loadMaintenanceExtMaterials,
  loadMaintenanceStaff,
  suggestLoaiSuaChua,
  type MaintenanceAsset,
  type MaintenanceExtMaterial,
  type MaintenanceRecord,
  type MaintenanceRecordLine,
  type MaintenanceStaff,
} from "../../_components/maintenance-data"

type InventoryItemOption = {
  id: string
  code: string
  name: string
  unit: string
  currentStock: number
}

type DraftMaterial = {
  id: string
  nguon: "trong_kho" | "ben_ngoai"
  inventory_item_id: string
  ten_vat_tu: string
  dvt: string
  so_luong: string
  don_gia: string
  loai_tien: string
}

type DraftLine = {
  id: string // temp id for UI
  db_id?: string // real DB id if editing
  asset_id: string
  ten_tb: string
  ma_tb: string
  ten_tai_xe: string
  noi_dung: string
  nguyen_nhan: string
  cac_khac_phuc: string
  loai_sua_chua: string
  chi_phi_dk: string
  loai_tien: string
  cong_tho: string
  nhien_lieu_su_dung: string
  dvt_do: string
  so_luong_do: string
  image_urls: string[]
  materials: DraftMaterial[]
  expanded: boolean
}

const CURRENCIES = ["USD", "KHR", "VND"]
const IMAGE_BUCKET = "order-files"

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_")
}

function emptyMaterial(): DraftMaterial {
  return { id: crypto.randomUUID(), nguon: "ben_ngoai", inventory_item_id: "", ten_vat_tu: "", dvt: "", so_luong: "", don_gia: "", loai_tien: "USD" }
}

function emptyLine(asset?: MaintenanceAsset): DraftLine {
  return {
    id: crypto.randomUUID(),
    asset_id: asset?.id || "",
    ten_tb: asset?.ten_tb || "",
    ma_tb: asset?.ma_tb || "",
    ten_tai_xe: "",
    noi_dung: "",
    nguyen_nhan: "",
    cac_khac_phuc: "",
    loai_sua_chua: "nho",
    chi_phi_dk: "0",
    loai_tien: "USD",
    cong_tho: "0",
    nhien_lieu_su_dung: "",
    dvt_do: "",
    so_luong_do: "",
    image_urls: [],
    materials: [],
    expanded: true,
  }
}

export default function MaintenanceRecordFormPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const isNew = id === "new"
  const router = useRouter()

  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notifying, setNotifying] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null)
  const [record, setRecord] = useState<MaintenanceRecord | null>(null)

  // Image slot upload
  const [uploadingSlot, setUploadingSlot] = useState<{ lineId: string; slot: number } | null>(null)
  const slotInputRef = useRef<HTMLInputElement | null>(null)
  const activeSlotRef = useRef<{ lineId: string; slot: number } | null>(null)

  // Master data
  const [assets, setAssets] = useState<MaintenanceAsset[]>([])
  const [staffList, setStaffList] = useState<MaintenanceStaff[]>([])
  const [extMaterials, setExtMaterials] = useState<MaintenanceExtMaterial[]>([])
  const [inventoryItems, setInventoryItems] = useState<InventoryItemOption[]>([])

  type NewItemModalContext = { lineId: string; matId: string }
  const [newItemModal, setNewItemModal] = useState<NewItemModalContext | null>(null)
  const [newItemForm, setNewItemForm] = useState({ code: "", name: "", unit: "" })
  const [savingNewItem, setSavingNewItem] = useState(false)

  // Header form
  const [hangMuc, setHangMuc] = useState<"Sửa chữa" | "Bảo dưỡng">("Sửa chữa")
  const [ngay, setNgay] = useState(new Date().toISOString().slice(0, 10))
  const [tuGio, setTuGio] = useState("")
  const [denGio, setDenGio] = useState("")
  const [boPhan, setBoPhan] = useState<string>(BO_PHAN_LIST[0])
  const [ghiChu, setGhiChu] = useState("")

  // Personnel
  const [selectedStaff, setSelectedStaff] = useState<string[]>([])
  const [nvPhuTrach, setNvPhuTrach] = useState("")
  const [phuTrachBaoTri, setPhuTrachBaoTri] = useState("")
  const [bgdPhuTrach, setBgdPhuTrach] = useState("")
  const [giamDoc, setGiamDoc] = useState("")

  // Equipment lines
  const [lines, setLines] = useState<DraftLine[]>([])
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([])

  // Asset picker state
  const [assetSearch, setAssetSearch] = useState("")
  const [assetDropdownOpen, setAssetDropdownOpen] = useState(false)
  const assetDropdownRef = useRef<HTMLDivElement | null>(null)

  const filteredAssets = assets.filter((a) => {
    const matchBoPhan = a.bo_phan === boPhan
    const matchSearch = !assetSearch || a.ten_tb.toLowerCase().includes(assetSearch.toLowerCase()) || a.ma_tb.toLowerCase().includes(assetSearch.toLowerCase())
    return matchBoPhan && matchSearch
  })

  // Close dropdown on outside click
  useEffect(() => {
    if (!assetDropdownOpen) return
    const handler = (e: PointerEvent) => {
      if (!assetDropdownRef.current?.contains(e.target as Node)) {
        setAssetDropdownOpen(false)
        setAssetSearch("")
      }
    }
    document.addEventListener("pointerdown", handler)
    return () => document.removeEventListener("pointerdown", handler)
  }, [assetDropdownOpen])

  const toggleAsset = (asset: MaintenanceAsset) => {
    const alreadySelected = selectedAssetIds.includes(asset.id)
    if (alreadySelected) {
      setSelectedAssetIds((prev) => prev.filter((id) => id !== asset.id))
      setLines((prev) => prev.filter((l) => l.asset_id !== asset.id))
    } else {
      setSelectedAssetIds((prev) => [...prev, asset.id])
      setLines((prev) => [...prev, emptyLine(asset)])
    }
  }

  const updateLine = (lineId: string, patch: Partial<DraftLine>) => {
    setLines((prev) => prev.map((l) => {
      if (l.id !== lineId) return l
      const next = { ...l, ...patch }
      // Auto-suggest loai_sua_chua khi thay doi chi_phi_dk hoac loai_tien
      if ((patch.chi_phi_dk !== undefined || patch.loai_tien !== undefined) && hangMuc === "Sửa chữa") {
        const cost = parseFloat(next.chi_phi_dk) || 0
        next.loai_sua_chua = suggestLoaiSuaChua(cost, next.loai_tien)
      }
      return next
    }))
  }

  const addMaterial = (lineId: string) => {
    setLines((prev) => prev.map((l) => l.id === lineId ? { ...l, materials: [...l.materials, emptyMaterial()] } : l))
  }

  const updateMaterial = (lineId: string, matId: string, patch: Partial<DraftMaterial>) => {
    setLines((prev) => prev.map((l) => {
      if (l.id !== lineId) return l
      return { ...l, materials: l.materials.map((m) => m.id === matId ? { ...m, ...patch } : m) }
    }))
  }

  const removeMaterial = (lineId: string, matId: string) => {
    setLines((prev) => prev.map((l) => l.id === lineId ? { ...l, materials: l.materials.filter((m) => m.id !== matId) } : l))
  }

  const handleSlotClick = (lineId: string, slot: number) => {
    if (!factoryId) return
    activeSlotRef.current = { lineId, slot }
    slotInputRef.current?.click()
  }

  const handleSlotFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    const active = activeSlotRef.current
    if (!file || !active || !factoryId) { e.target.value = ""; return }
    setUploadingSlot(active)
    try {
      const path = `${factoryId}/maintenance/${Date.now()}_${sanitizeFilename(file.name)}`
      const { data: uploaded, error: upErr } = await supabase.storage
        .from(IMAGE_BUCKET).upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data: urlData } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(uploaded.path)
      setLines((prev) => prev.map((l) => {
        if (l.id !== active.lineId) return l
        const urls = [...l.image_urls]
        urls[active.slot] = urlData.publicUrl
        return { ...l, image_urls: urls.filter(Boolean) }
      }))
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Không tải được ảnh")
    } finally {
      setUploadingSlot(null)
      activeSlotRef.current = null
      e.target.value = ""
    }
  }

  const isCreator = isNew || (
    record?.nguoi_tao != null &&
    (record.nguoi_tao === user?.full_name || record.nguoi_tao === user?.username)
  )
  // Người dùng hiện tại có phải Giám đốc hoặc BGĐ phụ trách được chọn trong form không
  const userName = user?.full_name || user?.username || ""
  const isGdOrBgd = !!userName && !isCreator && (
    (giamDoc && userName === giamDoc) ||
    (bgdPhuTrach && userName === bgdPhuTrach)
  )
  const isAdmin = user?.role === "admin"
  // Admin có thể chỉnh sửa kể cả trạng thái đã duyệt; hủy thì luôn read-only
  const isReadOnly =
    record?.trang_thai === "huy" ||
    (record?.trang_thai === "da_duyet" && !isAdmin) ||
    (!isNew && !isCreator && !isAdmin)

  const handleNotify = async () => {
    if (!id || !factoryId) return
    setNotifying(true)
    try {
      const res = await fetch("/api/maintenance/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordId: id, factoryId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Lỗi gửi thông báo")
      if (data.errors?.length > 0) {
        setSaveError(`Thông báo gửi một phần: ${(data.errors as string[]).join("; ")}`)
      } else {
        setSaveSuccess("Đã gửi thông báo thành công")
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Lỗi gửi thông báo")
    } finally {
      setNotifying(false)
    }
  }

  // Staff categories
  const bgdStaff = staffList.filter((s) => s.chuc_vu?.toLowerCase().includes("giám đốc"))
  const nvStaff = staffList.filter((s) => s.chuc_vu?.toLowerCase().includes("nhân viên"))
  const workerStaff = staffList.filter((s) => {
    const cv = s.chuc_vu?.toLowerCase() || ""
    return !cv.includes("giám đốc") && !cv.includes("nhân viên")
  })

  const loadInventoryItems = async (fid: string) => {
    const { data: items } = await supabase
      .from("inventory_items")
      .select("id, code, name, unit")
      .eq("factory_id", fid)
      .eq("is_active", true)
      .order("code")

    const { data: balances } = await supabase
      .from("inventory_stock_balances")
      .select("item_id, on_hand")
      .eq("factory_id", fid)

    const balanceMap = new Map<string, number>()
    for (const b of (balances || [])) {
      balanceMap.set(b.item_id, (balanceMap.get(b.item_id) || 0) + (b.on_hand || 0))
    }

    setInventoryItems(
      ((items || []) as { id: string; code: string; name: string; unit: string }[]).map((item) => ({
        ...item,
        currentStock: balanceMap.get(item.id) || 0,
      }))
    )
  }

  const loadRecord = useCallback(async (fid: string, recordId: string) => {
    const { data: rec } = await supabase
      .from("maintenance_records")
      .select("*")
      .eq("id", recordId)
      .eq("factory_id", fid)
      .single()

    if (!rec) return

    setRecord(rec as MaintenanceRecord)
    setHangMuc(rec.hang_muc)
    setNgay(rec.ngay)
    setTuGio(rec.tu_gio || "")
    setDenGio(rec.den_gio || "")
    setBoPhan(rec.bo_phan)
    setGhiChu(rec.ghi_chu || "")
    setSelectedStaff(rec.nguoi_thuc_hien || [])
    setNvPhuTrach(rec.nv_phu_trach || "")
    setPhuTrachBaoTri(rec.phu_trach_bao_tri || "")
    setBgdPhuTrach(rec.bgd_phu_trach || "")
    setGiamDoc(rec.giam_doc || "")

    // Load lines
    const { data: linesData } = await supabase
      .from("maintenance_record_lines")
      .select("*")
      .eq("record_id", recordId)
      .order("sort_order")

    const { data: matsData } = await supabase
      .from("maintenance_materials")
      .select("*")
      .eq("record_id", recordId)

    const matsMap = new Map<string, DraftMaterial[]>()
    for (const m of (matsData || [])) {
      const arr = matsMap.get(m.line_id) || []
      arr.push({
        id: m.id,
        nguon: m.nguon,
        inventory_item_id: m.inventory_item_id || "",
        ten_vat_tu: m.ten_vat_tu,
        dvt: m.dvt || "",
        so_luong: String(m.so_luong || 0),
        don_gia: String(m.don_gia || ""),
        loai_tien: m.loai_tien || "USD",
      })
      matsMap.set(m.line_id, arr)
    }

    const draftLines: DraftLine[] = (linesData || []).map((l) => ({
      id: crypto.randomUUID(),
      db_id: l.id,
      asset_id: l.asset_id || "",
      ten_tb: l.ten_tb,
      ma_tb: l.ma_tb,
      ten_tai_xe: l.ten_tai_xe || "",
      noi_dung: l.noi_dung || "",
      nguyen_nhan: l.nguyen_nhan || "",
      cac_khac_phuc: l.cac_khac_phuc || "",
      loai_sua_chua: l.loai_sua_chua || "nho",
      chi_phi_dk: String(l.chi_phi_dk || 0),
      loai_tien: l.loai_tien || "USD",
      cong_tho: String(l.cong_tho || 0),
      nhien_lieu_su_dung: l.nhien_lieu_su_dung || "",
      dvt_do: l.dvt_do || "",
      so_luong_do: String(l.so_luong_do || ""),
      image_urls: l.image_urls || [],
      materials: matsMap.get(l.id) || [],
      expanded: true,
    }))

    setLines(draftLines)
    setSelectedAssetIds(draftLines.map((l) => l.asset_id).filter(Boolean))
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      const { user: sessionUser } = await hydrateActiveSession()
      if (!sessionUser) { setLoading(false); return }
      setFactoryId(fid)
      setUser(sessionUser)

      const [a, s, e] = await Promise.all([
        loadMaintenanceAssets(fid),
        loadMaintenanceStaff(fid),
        loadMaintenanceExtMaterials(fid),
      ])
      setAssets(a)
      setStaffList(s)
      setExtMaterials(e)
      await loadInventoryItems(fid)

      if (!isNew) await loadRecord(fid, id)
    }
    void bootstrap().finally(() => setLoading(false))
  }, [id, isNew, loadRecord])

  // Auto-dismiss success toast after 4 seconds
  useEffect(() => {
    if (!saveSuccess) return
    const t = setTimeout(() => setSaveSuccess(null), 4000)
    return () => clearTimeout(t)
  }, [saveSuccess])

  const handleCancel = async () => {
    if (!factoryId || !id || id === "new") return
    if (!window.confirm("Hủy biên bản này? Thao tác không thể hoàn tác.")) return
    setSaving(true); setSaveError(null)
    try {
      const { error } = await supabase
        .from("maintenance_records")
        .update({ trang_thai: "huy" })
        .eq("id", id)
        .eq("factory_id", factoryId)
      if (error) { setSaveError(error.message); return }
      setSaveSuccess(`Biên bản ${record?.ma_bb || ""} đã được hủy.`)
      void loadRecord(factoryId, id)
    } finally {
      setSaving(false)
    }
  }

  const handleUnApprove = async () => {
    if (!factoryId || !id || id === "new") return
    if (!window.confirm("Hủy phê duyệt? Biên bản sẽ về trạng thái Chờ duyệt và phiếu xuất kho sẽ bị hủy (vật tư hoàn về kho).")) return
    setSaving(true); setSaveError(null)
    try {
      const session = await getFreshAuthSession()
      if (!session?.user) { setSaveError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."); return }

      // Hủy phiếu xuất kho qua RPC để hoàn tồn kho đúng cách
      if (record?.inventory_issue_doc_id) {
        const { error: cancelErr } = await supabase.rpc("inventory_cancel_document", {
          p_factory_id: factoryId,
          p_document_id: record.inventory_issue_doc_id,
          p_cancelled_by: session.user.id,
          p_cancel_reason: `Hủy phê duyệt biên bản ${record.ma_bb || ""}`,
        })
        if (cancelErr) { setSaveError(`Lỗi hủy phiếu xuất kho: ${cancelErr.message}`); return }
      }

      const { error } = await supabase
        .from("maintenance_records")
        .update({
          trang_thai: "cho_duyet",
          nguoi_duyet: null,
          ngay_duyet: null,
          inventory_issue_doc_id: null,
        })
        .eq("id", id)
        .eq("factory_id", factoryId)
      if (error) { setSaveError(error.message); return }
      setSaveSuccess(`Đã hủy phê duyệt. Biên bản ${record?.ma_bb || ""} về trạng thái Chờ duyệt. Tồn kho đã được hoàn nguyên.`)
      void loadRecord(factoryId, id)
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    if (!factoryId || lines.length === 0) {
      setSaveError("Vui lòng chọn ít nhất một thiết bị")
      return
    }
    setSaving(true); setSaveError(null)
    try {
      const maBB = isNew ? await generateMaBB(factoryId, ngay) : (record?.ma_bb || null)
      const nguoiTao = isNew ? (user?.full_name || user?.username || null) : record?.nguoi_tao

      const headerPayload = {
        factory_id: factoryId,
        ma_bb: maBB,
        hang_muc: hangMuc,
        ngay,
        tu_gio: tuGio || null,
        den_gio: denGio || null,
        bo_phan: boPhan,
        nguoi_tao: nguoiTao,
        nguoi_thuc_hien: selectedStaff,
        nv_phu_trach: nvPhuTrach || null,
        phu_trach_bao_tri: phuTrachBaoTri || null,
        bgd_phu_trach: bgdPhuTrach || null,
        giam_doc: giamDoc || null,
        ghi_chu: ghiChu || null,
        trang_thai: record?.trang_thai || "cho_duyet",
      }

      let recordId = id !== "new" ? id : null

      if (isNew) {
        const { data: inserted, error: insErr } = await supabase
          .from("maintenance_records")
          .insert(headerPayload)
          .select("id")
          .single()
        if (insErr) { setSaveError(insErr.message); return }
        recordId = inserted.id
      } else {
        const { error: updErr } = await supabase
          .from("maintenance_records")
          .update(headerPayload)
          .eq("id", id)
          .eq("factory_id", factoryId)
        if (updErr) { setSaveError(updErr.message); return }
      }

      if (!recordId) { setSaveError("Không tạo được biên bản"); return }

      // Delete old lines & materials when editing
      if (!isNew) {
        await supabase.from("maintenance_materials").delete().eq("record_id", recordId)
        await supabase.from("maintenance_record_lines").delete().eq("record_id", recordId)
      }

      // Insert lines
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]
        const linePayload = {
          record_id: recordId,
          factory_id: factoryId,
          sort_order: i,
          asset_id: l.asset_id || null,
          ten_tb: l.ten_tb,
          ma_tb: l.ma_tb,
          ten_tai_xe: l.ten_tai_xe || null,
          noi_dung: l.noi_dung || null,
          nguyen_nhan: l.nguyen_nhan || null,
          cac_khac_phuc: l.cac_khac_phuc || null,
          loai_sua_chua: hangMuc === "Sửa chữa" ? (l.loai_sua_chua || null) : null,
          chi_phi_dk: parseFloat(l.chi_phi_dk) || 0,
          loai_tien: l.loai_tien || "USD",
          cong_tho: parseFloat(l.cong_tho) || 0,
          nhien_lieu_su_dung: l.nhien_lieu_su_dung || null,
          dvt_do: l.dvt_do || null,
          so_luong_do: l.so_luong_do ? parseFloat(l.so_luong_do) : null,
          image_urls: l.image_urls,
        }

        const { data: insertedLine, error: lineErr } = await supabase
          .from("maintenance_record_lines")
          .insert(linePayload)
          .select("id")
          .single()
        if (lineErr) { setSaveError(lineErr.message); return }

        // Insert materials
        if (l.materials.length > 0) {
          const matPayloads = l.materials
            .filter((m) => m.ten_vat_tu.trim())
            .map((m, mi) => ({
              line_id: insertedLine.id,
              record_id: recordId,
              factory_id: factoryId,
              sort_order: mi,
              nguon: m.nguon,
              inventory_item_id: m.inventory_item_id || null,
              ten_vat_tu: m.ten_vat_tu.trim(),
              dvt: m.dvt.trim() || null,
              so_luong: parseFloat(m.so_luong) || 0,
              don_gia: m.nguon === "ben_ngoai" ? (parseFloat(m.don_gia) || null) : null,
              loai_tien: m.nguon === "ben_ngoai" ? (m.loai_tien || null) : null,
            }))

          if (matPayloads.length > 0) {
            const { error: matErr } = await supabase.from("maintenance_materials").insert(matPayloads)
            if (matErr) { setSaveError(matErr.message); return }
          }
        }
      }

      // Auto-save new ben_ngoai material names to master list
      const existingNames = new Set(extMaterials.map((m) => m.ten_vat_tu.trim().toLowerCase()))
      const seen = new Set<string>()
      const newExtMats = lines
        .flatMap((l) => l.materials.filter((m) => m.nguon === "ben_ngoai" && m.ten_vat_tu.trim()))
        .filter((m) => {
          const key = m.ten_vat_tu.trim().toLowerCase()
          if (existingNames.has(key) || seen.has(key)) return false
          seen.add(key)
          return true
        })
        .map((m) => ({ factory_id: factoryId, ten_vat_tu: m.ten_vat_tu.trim(), dvt: m.dvt.trim() || null }))
      if (newExtMats.length > 0) {
        await supabase.from("maintenance_external_materials").insert(newExtMats)
        void loadMaintenanceExtMaterials(factoryId!).then(setExtMaterials)
      }

      if (isNew) {
        router.push(`/dashboard/maintenance/records/${recordId}`)
      } else {
        setSaveSuccess(`Đã lưu biên bản ${record?.ma_bb || ""}. Trạng thái: Chờ duyệt.`)
        void loadRecord(factoryId, id)
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Lỗi không xác định")
    } finally {
      setSaving(false)
    }
  }

  const handleApprove = async () => {
    if (!factoryId || !id || id === "new") return
    setSaving(true); setSaveError(null)
    try {
      const session = await getFreshAuthSession()
      if (!session?.user) { setSaveError("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại."); return }
      const approverName = user?.full_name || user?.username || null

      // Chỉ lấy vật tư trong_kho có item id
      const inStockMats = lines.flatMap((l) => l.materials.filter((m) => m.nguon === "trong_kho" && m.inventory_item_id))

      // Validate tồn kho trước khi duyệt
      for (const mat of inStockMats) {
        const item = inventoryItems.find((i) => i.id === mat.inventory_item_id)
        if (item && parseFloat(mat.so_luong) > item.currentStock) {
          setSaveError(`Vật tư "${item.name}" không đủ tồn (cần ${mat.so_luong} ${item.unit}, còn ${item.currentStock} ${item.unit})`)
          return
        }
      }

      let issueDocId: string | null = null

      if (inStockMats.length > 0) {
        const docCode = `X-BT-${record?.ma_bb || id}`
        const maBB = record?.ma_bb || id

        // Kiểm tra phiếu xuất đã tồn tại chưa (tránh duplicate khi retry)
        const { data: existingDoc } = await supabase
          .from("inventory_documents")
          .select("id, status")
          .eq("factory_id", factoryId)
          .eq("document_code", docCode)
          .maybeSingle()

        if (existingDoc) {
          issueDocId = existingDoc.id
          // Xóa dòng cũ để insert lại cho đúng
          await supabase.from("inventory_document_lines").delete().eq("document_id", issueDocId)
          // Đặt lại về draft nếu đã posted, để post lại
          if (existingDoc.status !== "draft") {
            await supabase.from("inventory_documents").update({ status: "draft" }).eq("id", issueDocId)
          }
        } else {
          // Tạo phiếu xuất với status = "draft" — RPC sẽ chuyển sang "posted" và trừ tồn
          const { data: issueDoc, error: issueErr } = await supabase
            .from("inventory_documents")
            .insert({
              factory_id: factoryId,
              document_type: "export",
              document_code: docCode,
              document_date: ngay,
              status: "draft",
              notes: `Xuất kho cho biên bản sửa chữa/bảo trì số: ${maBB}`,
              requester_name: approverName,
            })
            .select("id")
            .single()
          if (issueErr) { setSaveError(`Lỗi tạo phiếu xuất kho: ${issueErr.message}`); return }
          issueDocId = issueDoc.id
        }

        // Insert dòng vật tư
        const issueLines = inStockMats.map((m, i) => ({
          document_id: issueDocId,
          factory_id: factoryId,
          item_id: m.inventory_item_id,
          quantity: parseFloat(m.so_luong) || 0,
          lot_no: null,
          expiry_date: null,
          line_notes: m.ten_vat_tu,
          sort_order: i,
        }))
        const { error: lineErr } = await supabase.from("inventory_document_lines").insert(issueLines)
        if (lineErr) { setSaveError(`Lỗi thêm dòng phiếu xuất: ${lineErr.message}`); return }

        // Ghi sổ — trừ tồn kho thực tế
        const { error: postErr } = await supabase.rpc("inventory_post_export_document", {
          p_factory_id: factoryId,
          p_document_id: issueDocId,
          p_posted_by: session.user.id,
        })
        if (postErr) { setSaveError(`Lỗi ghi sổ phiếu xuất: ${postErr.message}`); return }
      }

      const { error: appErr } = await supabase
        .from("maintenance_records")
        .update({
          trang_thai: "da_duyet",
          nguoi_duyet: approverName,
          ngay_duyet: new Date().toISOString(),
          inventory_issue_doc_id: issueDocId,
        })
        .eq("id", id)
        .eq("factory_id", factoryId)

      if (appErr) { setSaveError(appErr.message); return }
      setSaveSuccess(`Đã phê duyệt biên bản ${record?.ma_bb || ""}. Người duyệt: ${approverName || "—"}.`)
      void loadRecord(factoryId, id)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Lỗi không xác định")
    } finally {
      setSaving(false)
    }
  }

  const handleSaveNewItem = async () => {
    if (!factoryId || !newItemModal) return
    if (!newItemForm.code.trim() || !newItemForm.name.trim()) {
      setSaveError("Vui lòng nhập mã và tên vật tư")
      return
    }
    setSavingNewItem(true)
    try {
      const { data: inserted, error } = await supabase
        .from("inventory_items")
        .insert({
          factory_id: factoryId,
          code: newItemForm.code.trim(),
          name: newItemForm.name.trim(),
          unit: newItemForm.unit.trim() || null,
          is_active: true,
        })
        .select("id, code, name, unit")
        .single()
      if (error) { setSaveError(error.message); return }
      const newItem: InventoryItemOption = {
        id: inserted.id,
        code: inserted.code as string,
        name: inserted.name as string,
        unit: (inserted.unit as string | null) || "",
        currentStock: 0,
      }
      setInventoryItems((prev) => [...prev, newItem])
      updateMaterial(newItemModal.lineId, newItemModal.matId, {
        inventory_item_id: inserted.id,
        ten_vat_tu: inserted.name as string,
        dvt: (inserted.unit as string | null) || "",
      })
      setNewItemModal(null)
      setNewItemForm({ code: "", name: "", unit: "" })
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Lỗi tạo vật tư")
    } finally {
      setSavingNewItem(false)
    }
  }

  const recordQrUrl = useMemo(() => {
    if (!record?.id || typeof window === "undefined") return ""
    return `${window.location.origin}/dashboard/maintenance/records/${record.id}`
  }, [record?.id])

  if (loading) return <MaintenanceShell><div className="p-12 text-center text-slate-400">Đang tải...</div></MaintenanceShell>

  const statusBadge = record?.trang_thai === "da_duyet"
    ? <span className="px-3 py-1 rounded-full text-sm font-bold bg-emerald-100 text-emerald-700">Đã duyệt</span>
    : record?.trang_thai === "huy"
    ? <span className="px-3 py-1 rounded-full text-sm font-bold bg-red-100 text-red-600">Đã hủy</span>
    : <span className="px-3 py-1 rounded-full text-sm font-bold bg-amber-100 text-amber-700">Chờ duyệt</span>

  return (
    <MaintenanceShell>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-start gap-4">
          <div>
            <h1 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
              <Wrench size={20} className="text-orange-500" />
              {isNew ? "Tạo biên bản mới" : (record?.ma_bb || "Biên bản bảo trì")}
            </h1>
            {record && <div className="mt-1">{statusBadge}</div>}
          </div>
          {/* QR code — hiển thị sau khi có mã biên bản */}
          {record?.ma_bb && recordQrUrl && (
            <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <div className="rounded-lg border border-slate-200 bg-white p-1">
                <QRCodeSVG value={recordQrUrl} size={56} level="M" />
              </div>
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  <QrCode size={10} /> QR tra cứu
                </div>
                <div className="text-[11px] font-semibold text-slate-600 font-mono">{record.ma_bb}</div>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!isNew && (
            <>
              {record?.trang_thai === "da_duyet" ? (
                <>
                  {record.hang_muc === "Sửa chữa" && record.bo_phan !== "Đội xe" ? (
                    <Link
                      href={`/dashboard/maintenance/print?type=su_co_nho&record_id=${id}`}
                      target="_blank"
                      className="flex items-center gap-1 px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-all"
                    >
                      <Printer size={12} /> In biên bản
                    </Link>
                  ) : (
                    <>
                      <Link
                        href={`/dashboard/maintenance/print?type=su_co&record_id=${id}`}
                        target="_blank"
                        className="flex items-center gap-1 px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-all"
                      >
                        <Printer size={12} /> Sự cố
                      </Link>
                      <Link
                        href={`/dashboard/maintenance/print?type=de_nghi&record_id=${id}`}
                        target="_blank"
                        className="flex items-center gap-1 px-2 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-all"
                      >
                        <Printer size={12} /> Đề nghị
                      </Link>
                    </>
                  )}
                </>
              ) : (
                <>
                  {record?.hang_muc === "Sửa chữa" && record?.bo_phan !== "Đội xe" ? (
                    <span
                      title="Chỉ in được sau khi biên bản được phê duyệt"
                      className="flex items-center gap-1 px-2 py-1.5 bg-slate-50 text-slate-300 text-xs font-bold rounded-lg cursor-not-allowed select-none"
                    >
                      <Printer size={12} /> In biên bản
                    </span>
                  ) : (
                    <>
                      <span
                        title="Chỉ in được sau khi biên bản được phê duyệt"
                        className="flex items-center gap-1 px-2 py-1.5 bg-slate-50 text-slate-300 text-xs font-bold rounded-lg cursor-not-allowed select-none"
                      >
                        <Printer size={12} /> Sự cố
                      </span>
                      <span
                        title="Chỉ in được sau khi biên bản được phê duyệt"
                        className="flex items-center gap-1 px-2 py-1.5 bg-slate-50 text-slate-300 text-xs font-bold rounded-lg cursor-not-allowed select-none"
                      >
                        <Printer size={12} /> Đề nghị
                      </span>
                    </>
                  )}
                </>
              )}
            </>
          )}
          {/* GỬI PHÊ DUYỆT — creator khi cho_duyet (thông báo Telegram + Email cho GĐ/BGĐ) */}
          {!isNew && record?.trang_thai === "cho_duyet" && isCreator && (
            <button
              onClick={handleNotify}
              disabled={notifying}
              className="flex items-center gap-1 px-2 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-bold rounded-lg border border-blue-200 transition-all disabled:opacity-50"
            >
              <Send size={12} /> {notifying ? "Đang gửi..." : "Gửi phê duyệt"}
            </button>
          )}
          {/* HỦY BIÊN BẢN (vĩnh viễn) — chỉ creator khi cho_duyet */}
          {!isNew && record?.trang_thai === "cho_duyet" && isCreator && (
            <button
              onClick={handleCancel}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-bold rounded-lg border border-red-200 transition-all disabled:opacity-50"
            >
              <X size={12} /> Hủy biên bản
            </button>
          )}
          {/* PHÊ DUYỆT — chỉ GĐ/BGĐ khi cho_duyet */}
          {!isNew && record?.trang_thai === "cho_duyet" && isGdOrBgd && (
            <button
              onClick={handleApprove}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow transition-all disabled:opacity-50"
            >
              <CheckCircle2 size={13} /> {saving ? "Đang xử lý..." : "Phê duyệt"}
            </button>
          )}
          {/* HỦY PHÊ DUYỆT — chỉ GĐ/BGĐ khi da_duyet, trả về cho_duyet */}
          {!isNew && record?.trang_thai === "da_duyet" && isGdOrBgd && (
            <button
              onClick={handleUnApprove}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 text-xs font-bold rounded-lg border border-amber-200 transition-all disabled:opacity-50"
            >
              <RotateCcw size={12} /> {saving ? "Đang xử lý..." : "Hủy phê duyệt"}
            </button>
          )}
          {/* LƯU BIÊN BẢN — creator khi cho_duyet hoặc đang tạo mới */}
          {!isReadOnly && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1 px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow transition-all disabled:opacity-50"
            >
              <Save size={13} /> {saving ? "Đang lưu..." : "Lưu biên bản"}
            </button>
          )}
        </div>
      </div>

      {saveError && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-red-600 text-white rounded-2xl shadow-2xl max-w-xl">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="text-sm font-bold">{saveError}</span>
          <button onClick={() => setSaveError(null)} className="ml-2 hover:opacity-70"><X size={14} /></button>
        </div>
      )}
      {saveSuccess && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-emerald-600 text-white rounded-2xl shadow-2xl max-w-xl">
          <CheckCircle2 size={16} className="shrink-0" />
          <span className="text-sm font-bold">{saveSuccess}</span>
          <button onClick={() => setSaveSuccess(null)} className="ml-2 hover:opacity-70"><X size={14} /></button>
        </div>
      )}

      {/* Approved info banner */}
      {record?.trang_thai === "da_duyet" && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3 flex flex-wrap items-center gap-4 text-sm">
          <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
          <span className="text-emerald-700">
            <strong>Đã phê duyệt</strong> bởi <strong>{record.nguoi_duyet || "—"}</strong>
            {record.ngay_duyet && <> · {new Date(record.ngay_duyet).toLocaleString("vi-VN")}</>}
          </span>
          {record.inventory_issue_doc_id && (
            <Link
              href={`/dashboard/inventory/issues?documentId=${record.inventory_issue_doc_id}`}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-white border border-emerald-300 text-emerald-700 text-xs font-bold rounded-lg hover:bg-emerald-50 transition-all"
            >
              Xem phiếu xuất kho →
            </Link>
          )}
        </div>
      )}
      {record?.trang_thai === "huy" && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3 flex items-center gap-3 text-sm text-red-700">
          <X size={16} className="shrink-0" />
          <span>Biên bản đã bị hủy — không thể chỉnh sửa.</span>
        </div>
      )}

      {/* Header form */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Hạng mục *</label>
            <select
              value={hangMuc}
              onChange={(e) => setHangMuc(e.target.value as "Sửa chữa" | "Bảo dưỡng")}
              disabled={isReadOnly}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
            >
              <option value="Sửa chữa">Sửa chữa</option>
              <option value="Bảo dưỡng">Bảo dưỡng</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Ngày *</label>
            <input
              type="date"
              value={ngay}
              onChange={(e) => setNgay(e.target.value)}
              disabled={isReadOnly}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Giờ bắt đầu</label>
            <input
              type="time"
              value={tuGio}
              onChange={(e) => setTuGio(e.target.value)}
              disabled={isReadOnly}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Giờ kết thúc</label>
            <input
              type="time"
              value={denGio}
              onChange={(e) => setDenGio(e.target.value)}
              disabled={isReadOnly}
              className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Bộ phận *</label>
          <select
            value={boPhan}
            onChange={(e) => { setBoPhan(e.target.value); setSelectedAssetIds([]); setLines([]) }}
            disabled={isReadOnly}
            className="w-full md:w-64 px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
          >
            {BO_PHAN_LIST.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>

      {/* Asset picker */}
      {!isReadOnly && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-3">
          <label className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
            <Wrench size={12} className="text-orange-500" /> Thiết bị *
          </label>

          {/* Dropdown trigger */}
          <div ref={assetDropdownRef} className="relative z-10">
            <button
              type="button"
              onClick={() => setAssetDropdownOpen((o) => !o)}
              className="w-full flex items-center justify-between px-3 py-2.5 border border-slate-300 rounded-xl text-sm bg-white hover:border-orange-400 focus:border-orange-400 outline-none transition-colors"
            >
              <span className={selectedAssetIds.length > 0 ? "text-slate-700 font-semibold" : "text-slate-400"}>
                {selectedAssetIds.length > 0
                  ? `${selectedAssetIds.length} thiết bị đã chọn`
                  : `Chọn thiết bị trong bộ phận "${boPhan}"...`}
              </span>
              <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${assetDropdownOpen ? "rotate-180" : ""}`} />
            </button>

            {assetDropdownOpen && (
              <div className="absolute z-[80] mt-2 w-full rounded-2xl border border-slate-200 bg-white shadow-xl p-3">
                {/* Search inside dropdown */}
                <input
                  autoFocus
                  value={assetSearch}
                  onChange={(e) => setAssetSearch(e.target.value)}
                  placeholder="Tìm nhanh mã hoặc tên thiết bị..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-orange-400 mb-2"
                />

                {/* Quick actions */}
                <div className="flex items-center justify-between mb-2">
                  <button
                    type="button"
                    onClick={() => {
                      const newIds = filteredAssets.map((a) => a.id)
                      const addIds = newIds.filter((id) => !selectedAssetIds.includes(id))
                      setSelectedAssetIds((prev) => [...prev, ...addIds])
                      setLines((prev) => {
                        const existing = new Set(prev.map((l) => l.asset_id))
                        const toAdd = filteredAssets.filter((a) => !existing.has(a.id))
                        return [...prev, ...toAdd.map((a) => emptyLine(a))]
                      })
                    }}
                    className="text-xs font-bold text-orange-600 hover:bg-orange-50 px-2.5 py-1 rounded-lg transition-colors"
                  >
                    Chọn tất cả
                  </button>
                  {selectedAssetIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => { setSelectedAssetIds([]); setLines([]) }}
                      className="text-xs font-bold text-slate-500 hover:bg-slate-100 px-2.5 py-1 rounded-lg transition-colors"
                    >
                      Bỏ chọn
                    </button>
                  )}
                </div>

                {/* Asset list */}
                <div className="max-h-64 overflow-y-auto space-y-1 pr-0.5">
                  {filteredAssets.length === 0 ? (
                    <div className="text-sm text-slate-400 text-center py-4">
                      {assetSearch ? "Không tìm thấy thiết bị phù hợp" : `Không có thiết bị trong bộ phận "${boPhan}"`}
                    </div>
                  ) : (
                    filteredAssets.map((a) => {
                      const selected = selectedAssetIds.includes(a.id)
                      return (
                        <label
                          key={a.id}
                          className={`flex items-center gap-3 px-3 py-2 rounded-xl border cursor-pointer transition-all ${
                            selected
                              ? "border-emerald-200 bg-emerald-50"
                              : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleAsset(a)}
                            className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-bold font-mono text-slate-800 truncate">{a.ma_tb}</span>
                            <span className="block text-[11px] text-slate-600 truncate">{a.ten_tb}</span>
                          </span>
                          <span className={`text-[10px] font-semibold shrink-0 ${selected ? "text-emerald-600" : "text-slate-400"}`}>
                            {a.loai === "xe" ? "Xe" : "Máy"}
                          </span>
                        </label>
                      )
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Selected asset cards */}
          {selectedAssetIds.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 pt-1">
              {assets
                .filter((a) => selectedAssetIds.includes(a.id))
                .map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAsset(a)}
                    title="Bấm để bỏ chọn"
                    className="relative min-h-[84px] rounded-xl border border-emerald-400 bg-emerald-50 p-2.5 text-left transition-all hover:border-red-300 hover:bg-red-50 group"
                  >
                    {/* Check badge */}
                    <div className="absolute right-2 top-2 rounded-full p-1 bg-emerald-500 text-white group-hover:bg-red-400 transition-colors">
                      <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                        <path d="M2 5.5L4.5 8L9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <div className="pr-7">
                      <div className="text-xs font-bold font-mono text-slate-800 truncate">{a.ma_tb}</div>
                      <div className="mt-1 text-[11px] text-slate-600 line-clamp-2 leading-tight">{a.ten_tb}</div>
                      <div className="mt-1.5 text-[10px] font-semibold text-emerald-600">
                        {a.loai === "xe" ? "Xe" : "Máy"}{a.bien_so && ` · ${a.bien_so}`}
                      </div>
                    </div>
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Equipment lines */}
      {lines.map((line, idx) => (
        <div key={line.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Line header */}
          <div
            className="flex items-center justify-between px-5 py-3 bg-orange-50 border-b border-orange-100 cursor-pointer"
            onClick={() => updateLine(line.id, { expanded: !line.expanded })}
          >
            <div className="flex items-center gap-3">
              <span className="w-6 h-6 rounded-full bg-orange-200 text-orange-700 text-xs font-bold flex items-center justify-center">{idx + 1}</span>
              <div>
                <span className="font-bold text-slate-700">{line.ten_tb}</span>
                <span className="ml-2 text-xs text-slate-500 font-mono">{line.ma_tb}</span>
              </div>
              {hangMuc === "Sửa chữa" && line.loai_sua_chua && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${line.loai_sua_chua === "lon" ? "bg-red-100 text-red-600" : "bg-slate-100 text-slate-500"}`}>
                  {line.loai_sua_chua === "lon" ? "Lớn" : "Nhỏ"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isReadOnly && (
                <button
                  onClick={(e) => { e.stopPropagation(); setSelectedAssetIds((p) => p.filter((id) => id !== line.asset_id)); setLines((p) => p.filter((l) => l.id !== line.id)) }}
                  className="p-1.5 hover:bg-red-100 text-red-400 rounded-lg"
                >
                  <Trash2 size={13} />
                </button>
              )}
              {line.expanded ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
            </div>
          </div>

          {line.expanded && (
            <div className="p-5 space-y-4">
              {/* Vehicle driver */}
              {boPhan === "Đội xe" && (
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Tài xế</label>
                  <input
                    value={line.ten_tai_xe}
                    onChange={(e) => updateLine(line.id, { ten_tai_xe: e.target.value })}
                    disabled={isReadOnly}
                    className="w-full md:w-72 px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
                    placeholder="Tên tài xế"
                  />
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Nội dung {hangMuc === "Sửa chữa" ? "sự cố" : "bảo dưỡng"}</label>
                <textarea
                  value={line.noi_dung}
                  onChange={(e) => updateLine(line.id, { noi_dung: e.target.value })}
                  disabled={isReadOnly}
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50 resize-none"
                />
              </div>

              {hangMuc === "Sửa chữa" && (
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Nguyên nhân</label>
                  <textarea
                    value={line.nguyen_nhan}
                    onChange={(e) => updateLine(line.id, { nguyen_nhan: e.target.value })}
                    disabled={isReadOnly}
                    rows={2}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50 resize-none"
                  />
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Cách khắc phục</label>
                <textarea
                  value={line.cac_khac_phuc}
                  onChange={(e) => updateLine(line.id, { cac_khac_phuc: e.target.value })}
                  disabled={isReadOnly}
                  rows={2}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50 resize-none"
                />
              </div>

              {/* Cost */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Chi phí ước tính</label>
                  <input
                    type="number"
                    value={line.chi_phi_dk}
                    onChange={(e) => updateLine(line.id, { chi_phi_dk: e.target.value })}
                    disabled={isReadOnly}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại tiền</label>
                  <select
                    value={line.loai_tien}
                    onChange={(e) => updateLine(line.id, { loai_tien: e.target.value })}
                    disabled={isReadOnly}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
                  >
                    {CURRENCIES.map((c) => <option key={c} value={c}>{currencySymbol(c)} {c}</option>)}
                  </select>
                </div>
                {hangMuc === "Sửa chữa" && (
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại sửa chữa</label>
                    <select
                      value={line.loai_sua_chua}
                      onChange={(e) => updateLine(line.id, { loai_sua_chua: e.target.value })}
                      disabled={isReadOnly}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
                    >
                      <option value="nho">Nhỏ (≤ 200$)</option>
                      <option value="lon">Lớn (&gt; 200$)</option>
                    </select>
                  </div>
                )}
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Công thợ</label>
                  <input
                    type="number"
                    value={line.cong_tho}
                    onChange={(e) => updateLine(line.id, { cong_tho: e.target.value })}
                    disabled={isReadOnly}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
                  />
                </div>
              </div>

              {/* Fuel (Đội xe) */}
              {boPhan === "Đội xe" && (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Nhiên liệu sử dụng</label>
                    <input
                      value={line.nhien_lieu_su_dung}
                      onChange={(e) => updateLine(line.id, { nhien_lieu_su_dung: e.target.value })}
                      disabled={isReadOnly}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Đơn vị</label>
                    <input
                      value={line.dvt_do}
                      onChange={(e) => updateLine(line.id, { dvt_do: e.target.value })}
                      disabled={isReadOnly}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 block mb-1.5">Số lượng</label>
                    <input
                      type="number"
                      value={line.so_luong_do}
                      onChange={(e) => updateLine(line.id, { so_luong_do: e.target.value })}
                      disabled={isReadOnly}
                      className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50"
                    />
                  </div>
                </div>
              )}

              {/* Materials */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-600">Vật tư sử dụng</label>
                  {!isReadOnly && (
                    <button
                      onClick={() => addMaterial(line.id)}
                      className="flex items-center gap-1 px-2 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs font-bold rounded-lg"
                    >
                      <Plus size={11} /> Thêm vật tư
                    </button>
                  )}
                </div>
                {line.materials.map((mat) => (
                  <div key={mat.id} className="flex flex-wrap gap-2 items-end mb-2 p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="min-w-[120px]">
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">Nguồn</label>
                      <select
                        value={mat.nguon}
                        onChange={(e) => updateMaterial(line.id, mat.id, { nguon: e.target.value as "trong_kho" | "ben_ngoai", inventory_item_id: "", ten_vat_tu: "" })}
                        disabled={isReadOnly}
                        className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-500 disabled:bg-white"
                      >
                        <option value="ben_ngoai">Bên ngoài</option>
                        <option value="trong_kho">Trong kho</option>
                      </select>
                    </div>

                    {mat.nguon === "trong_kho" ? (
                      <div className="flex-1 min-w-[200px]">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] font-bold text-slate-500">Vật tư kho</label>
                          {!isReadOnly && (
                            <button
                              type="button"
                              onClick={() => { setNewItemModal({ lineId: line.id, matId: mat.id }); setNewItemForm({ code: "", name: "", unit: mat.dvt }) }}
                              className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 hover:text-emerald-700"
                            >
                              <Plus size={10} /> Thêm mới
                            </button>
                          )}
                        </div>
                        <select
                          value={mat.inventory_item_id}
                          onChange={(e) => {
                            const item = inventoryItems.find((i) => i.id === e.target.value)
                            updateMaterial(line.id, mat.id, { inventory_item_id: e.target.value, ten_vat_tu: item?.name || "", dvt: item?.unit || "" })
                          }}
                          disabled={isReadOnly}
                          className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-500 disabled:bg-white"
                        >
                          <option value="">— Chọn vật tư —</option>
                          {inventoryItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.code} - {item.name} (Tồn: {item.currentStock} {item.unit})
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="flex-1 min-w-[200px]">
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-[10px] font-bold text-slate-500">Vật tư bên ngoài</label>
                          {!isReadOnly && (
                            <button
                              type="button"
                              onClick={() => { setNewItemModal({ lineId: line.id, matId: mat.id }); setNewItemForm({ code: "", name: "", unit: mat.dvt }) }}
                              className="flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 hover:text-emerald-700"
                            >
                              <Plus size={10} /> Thêm mới
                            </button>
                          )}
                        </div>
                        <select
                          value={mat.inventory_item_id}
                          onChange={(e) => {
                            const item = inventoryItems.find((i) => i.id === e.target.value)
                            updateMaterial(line.id, mat.id, { inventory_item_id: e.target.value, ten_vat_tu: item?.name || "", dvt: item?.unit || mat.dvt })
                          }}
                          disabled={isReadOnly}
                          className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-500 disabled:bg-white"
                        >
                          <option value="">— Chọn vật tư —</option>
                          {inventoryItems.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.code} - {item.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div className="w-20">
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">Đơn vị</label>
                      <input
                        value={mat.dvt}
                        onChange={(e) => updateMaterial(line.id, mat.id, { dvt: e.target.value })}
                        disabled={isReadOnly}
                        className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-500 disabled:bg-white"
                      />
                    </div>

                    <div className="w-20">
                      <label className="text-[10px] font-bold text-slate-500 block mb-1">Số lượng</label>
                      <input
                        type="number"
                        value={mat.so_luong}
                        onChange={(e) => updateMaterial(line.id, mat.id, { so_luong: e.target.value })}
                        disabled={isReadOnly}
                        className={`w-full px-2 py-1.5 border rounded-lg text-xs outline-none focus:border-emerald-500 disabled:bg-white ${
                          mat.nguon === "trong_kho" && mat.inventory_item_id &&
                          parseFloat(mat.so_luong) > (inventoryItems.find(i => i.id === mat.inventory_item_id)?.currentStock ?? Infinity)
                            ? "border-red-400 bg-red-50"
                            : "border-slate-300"
                        }`}
                      />
                      {mat.nguon === "trong_kho" && mat.inventory_item_id && (() => {
                        const item = inventoryItems.find(i => i.id === mat.inventory_item_id)
                        if (item && parseFloat(mat.so_luong) > item.currentStock)
                          return <p className="text-red-500 text-[10px] mt-0.5">Vượt tồn ({item.currentStock})</p>
                      })()}
                    </div>

                    {mat.nguon === "ben_ngoai" && (
                      <>
                        <div className="w-24">
                          <label className="text-[10px] font-bold text-slate-500 block mb-1">Đơn giá</label>
                          <input
                            type="number"
                            value={mat.don_gia}
                            onChange={(e) => updateMaterial(line.id, mat.id, { don_gia: e.target.value })}
                            disabled={isReadOnly}
                            className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-500 disabled:bg-white"
                          />
                        </div>
                        <div className="w-20">
                          <label className="text-[10px] font-bold text-slate-500 block mb-1">Loại tiền</label>
                          <select
                            value={mat.loai_tien}
                            onChange={(e) => updateMaterial(line.id, mat.id, { loai_tien: e.target.value })}
                            disabled={isReadOnly}
                            className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-xs outline-none focus:border-emerald-500 disabled:bg-white"
                          >
                            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                      </>
                    )}

                    {!isReadOnly && (
                      <button onClick={() => removeMaterial(line.id, mat.id)} className="p-1.5 hover:bg-red-100 text-red-400 rounded-lg self-end">
                        <Trash2 size={12} />
                      </button>
                    )}
                  </div>
                ))}
                {line.materials.length === 0 && (
                  <p className="text-xs text-slate-400 italic">Chưa có vật tư nào</p>
                )}
              </div>

              {/* Images — 6 fixed slots */}
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-2">
                  Ảnh hiện trường
                  <span className="font-normal text-slate-400 ml-1">({line.image_urls.filter(Boolean).length}/6)</span>
                </label>
                <div className="grid grid-cols-6 gap-2">
                  {Array.from({ length: 6 }).map((_, slotIdx) => {
                    const url = line.image_urls[slotIdx]
                    const isUploading = uploadingSlot?.lineId === line.id && uploadingSlot.slot === slotIdx
                    return (
                      <div key={slotIdx} className="relative aspect-square">
                        {url ? (
                          <>
                            <img
                              src={url}
                              alt={`Ảnh ${slotIdx + 1}`}
                              className="w-full h-full object-cover rounded-xl border border-slate-200 cursor-pointer hover:opacity-90"
                              onClick={() => window.open(url, "_blank")}
                            />
                            {!isReadOnly && (
                              <button
                                onClick={() => {
                                  const newUrls = line.image_urls.filter((_, i) => i !== slotIdx)
                                  updateLine(line.id, { image_urls: newUrls })
                                }}
                                className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 shadow"
                              >
                                <X size={10} />
                              </button>
                            )}
                          </>
                        ) : (
                          <button
                            disabled={isReadOnly || isUploading}
                            onClick={() => handleSlotClick(line.id, slotIdx)}
                            className="w-full h-full rounded-xl border-2 border-dashed border-slate-200 hover:border-orange-400 hover:bg-orange-50 flex flex-col items-center justify-center gap-0.5 transition-all disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {isUploading
                              ? <Loader2 size={16} className="animate-spin text-orange-400" />
                              : <ImagePlus size={15} className="text-slate-300" />}
                            <span className="text-[9px] text-slate-300">{slotIdx + 1}</span>
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      ))}

      {lines.length === 0 && !loading && (
        <div className="bg-slate-50 rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
          <Wrench size={36} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Chọn thiết bị từ danh sách bên trên</p>
        </div>
      )}

      {/* Hidden file input for image slot upload */}
      <input
        ref={slotInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleSlotFileChange}
      />

      {/* Modal thêm vật tư mới vào inventory_items */}
      {newItemModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-extrabold text-slate-800">Thêm vật tư mới</h3>
              <button onClick={() => setNewItemModal(null)} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={16} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">Mã vật tư *</label>
                <input
                  autoFocus
                  value={newItemForm.code}
                  onChange={(e) => setNewItemForm((p) => ({ ...p, code: e.target.value }))}
                  placeholder="VD: VT001"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">Tên vật tư *</label>
                <input
                  value={newItemForm.name}
                  onChange={(e) => setNewItemForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Tên đầy đủ của vật tư"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">Đơn vị tính</label>
                <input
                  value={newItemForm.unit}
                  onChange={(e) => setNewItemForm((p) => ({ ...p, unit: e.target.value }))}
                  placeholder="Cái, kg, lít..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setNewItemModal(null)}
                className="flex-1 px-4 py-2 border border-slate-300 text-slate-600 font-bold rounded-xl text-sm hover:bg-slate-50"
              >
                Hủy
              </button>
              <button
                onClick={handleSaveNewItem}
                disabled={savingNewItem}
                className="flex-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm disabled:opacity-50"
              >
                {savingNewItem ? "Đang lưu..." : "Lưu vật tư"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Personnel section */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 space-y-4">
        <div className="font-extrabold text-slate-700 mb-1">Nhân sự</div>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-2">Người thực hiện</label>
          <div className="flex flex-wrap gap-2">
            {workerStaff.map((s) => {
              const sel = selectedStaff.includes(s.ten)
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    if (isReadOnly) return
                    setSelectedStaff((prev) => sel ? prev.filter((n) => n !== s.ten) : [...prev, s.ten])
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${sel ? "bg-emerald-100 border-emerald-300 text-emerald-700" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"}`}
                >
                  {s.ten}{s.chuc_vu && ` (${s.chuc_vu})`}
                </button>
              )
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Nhân viên phụ trách</label>
            <select value={nvPhuTrach} onChange={(e) => setNvPhuTrach(e.target.value)} disabled={isReadOnly} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50">
              <option value="">— Chọn —</option>
              {nvStaff.map((s) => <option key={s.id} value={s.ten}>{s.ten}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Phụ trách bảo trì</label>
            <select value={phuTrachBaoTri} onChange={(e) => setPhuTrachBaoTri(e.target.value)} disabled={isReadOnly} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50">
              <option value="">— Chọn —</option>
              {nvStaff.map((s) => <option key={s.id} value={s.ten}>{s.ten}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">BGĐ phụ trách</label>
            <select value={bgdPhuTrach} onChange={(e) => setBgdPhuTrach(e.target.value)} disabled={isReadOnly} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50">
              <option value="">— Chọn —</option>
              {bgdStaff.filter((s) => s.ten !== giamDoc).map((s) => <option key={s.id} value={s.ten}>{s.ten}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Giám đốc</label>
            <select value={giamDoc} onChange={(e) => setGiamDoc(e.target.value)} disabled={isReadOnly} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50">
              <option value="">— Chọn —</option>
              {bgdStaff.filter((s) => s.ten !== bgdPhuTrach).map((s) => <option key={s.id} value={s.ten}>{s.ten}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Ghi chú</label>
          <textarea
            value={ghiChu}
            onChange={(e) => setGhiChu(e.target.value)}
            disabled={isReadOnly}
            rows={2}
            className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 disabled:bg-slate-50 resize-none"
          />
        </div>
      </div>
    </MaintenanceShell>
  )
}

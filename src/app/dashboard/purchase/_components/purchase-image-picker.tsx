"use client"

// Chọn nhiều ảnh / chụp ảnh trực tiếp (camera sau) — dùng chung cho từng dòng vật tư của phiếu đề
// nghị, modal cập nhật ảnh dòng ở trang chi tiết, và modal Ghi nhận mua. Ảnh HEIC tự chuyển JPEG
// trong uploadInventoryImage (prepareImageForUpload).

import { useRef, useState } from "react"
import { Camera, ImagePlus, Loader2, X } from "lucide-react"
import { uploadInventoryImage } from "@/app/dashboard/inventory/_components/inventory-image-upload"
import { PURCHASE_MAX_IMAGES } from "@/lib/purchase/types"

const labelCls = "text-xs font-bold text-slate-600 block mb-1.5"

export function PurchaseImagePicker({
  factoryId, images, onChange, documentType, label, max = PURCHASE_MAX_IMAGES, compact = false, variant, title, onPreview,
}: {
  factoryId: string
  images: string[]
  onChange: (urls: string[]) => void
  documentType: "purchase-requests" | "purchase-receipts"
  label?: string
  max?: number
  /** Ô nhỏ hơn (giữ để tương thích — tương đương variant="compact"). */
  compact?: boolean
  /**
   * "default": nút vuông lớn (modal Ghi nhận mua). "compact": nút vuông nhỏ.
   * "inline": 2 nút ngang cao bằng ô nhập (form đề nghị), ảnh đã chọn hiện ngay dưới.
   */
  variant?: "default" | "compact" | "inline"
  /** Tooltip cho nhãn/nút — chỗ đặt mô tả dài thay vì in ra giao diện. */
  title?: string
  onPreview?: (url: string) => void
}) {
  const mode = variant ?? (compact ? "compact" : "default")
  const pickRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const box = mode === "default" ? "h-16 w-16" : "h-12 w-12"
  const btn = mode === "compact" ? "h-12 px-2 text-[10px]" : "h-16 px-3 text-[11px]"

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ""
    if (!files.length) return
    const room = max - images.length
    if (room <= 0) { setError(`Tối đa ${max} ảnh.`); return }
    const picked = files.slice(0, room)
    setUploading(true)
    setError(null)
    const ok: string[] = []
    const failed: string[] = []
    try {
      // Tải theo nhóm 3 để không nghẽn mạng điện thoại; ảnh lỗi không chặn ảnh khác.
      for (let i = 0; i < picked.length; i += 3) {
        const res = await Promise.allSettled(
          picked.slice(i, i + 3).map((file) => uploadInventoryImage({ factoryId, documentType, file })),
        )
        res.forEach((r, k) => {
          if (r.status === "fulfilled") ok.push(r.value.publicUrl)
          else failed.push(`${picked[i + k].name}: ${r.reason instanceof Error ? r.reason.message : "lỗi tải"}`)
        })
      }
      onChange([...images, ...ok])
      if (failed.length) setError(failed.join("\n"))
      else if (files.length > picked.length) setError(`Chỉ thêm được ${picked.length} ảnh (tối đa ${max}).`)
    } finally {
      setUploading(false)
    }
  }

  const thumbs = images.map((url, i) => (
    <div key={`${i}-${url}`} className={`relative ${box} overflow-hidden rounded-xl border border-slate-200 bg-slate-100`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`Ảnh ${i + 1}`}
        onClick={() => onPreview?.(url)}
        className={`h-full w-full object-cover ${onPreview ? "cursor-zoom-in" : ""}`}
      />
      <button type="button" onClick={() => onChange(images.filter((_, k) => k !== i))} className="absolute right-0.5 top-0.5 rounded-full bg-white/90 p-0.5 text-slate-600 shadow" aria-label="Xoá ảnh">
        <X size={11} />
      </button>
    </div>
  ))

  const inputs = (
    <>
      <input ref={pickRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFiles} />
    </>
  )

  if (mode === "inline") {
    const full = images.length >= max
    // Cao bằng ô nhập (py-2 text-sm + viền) để nằm thẳng hàng với 2 ô ngày bên cạnh.
    const inlineBtn = "relative flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-sm font-bold text-white shadow-sm transition-colors disabled:opacity-50"
    return (
      <div>
        {label && <label className={labelCls} title={title}>{label}</label>}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button" disabled={uploading || full} title={full ? `Đã đủ ${max} ảnh` : title}
            onClick={() => pickRef.current?.click()}
            className={`${inlineBtn} border-sky-600 bg-sky-600 hover:bg-sky-700`}
          >
            {uploading ? <Loader2 size={15} className="animate-spin shrink-0" /> : <ImagePlus size={15} className="shrink-0" />}
            <span className="truncate">Chọn ảnh</span>
            {images.length > 0 && (
              <span className="absolute -right-1.5 -top-1.5 min-w-5 rounded-full bg-amber-400 px-1.5 text-center text-[10px] font-extrabold leading-5 text-slate-900 shadow">
                {images.length}
              </span>
            )}
          </button>
          <button
            type="button" disabled={uploading || full} title={full ? `Đã đủ ${max} ảnh` : title}
            onClick={() => camRef.current?.click()}
            className={`${inlineBtn} border-violet-600 bg-violet-600 hover:bg-violet-700`}
          >
            <Camera size={15} className="shrink-0" />
            <span className="truncate">Chụp ảnh</span>
          </button>
        </div>
        {images.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{thumbs}</div>}
        {error && <p className="mt-1 whitespace-pre-line text-xs text-red-600">{error}</p>}
        {inputs}
      </div>
    )
  }

  return (
    <div>
      {label && <label className={labelCls} title={title}>{label}</label>}
      <div className="flex flex-wrap items-start gap-2">
        {thumbs}
        {images.length < max && (
          <>
            <button type="button" disabled={uploading} onClick={() => pickRef.current?.click()} className={`flex ${btn} flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-slate-300 font-semibold text-slate-500 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50`}>
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />} Chọn nhiều ảnh
            </button>
            <button type="button" disabled={uploading} onClick={() => camRef.current?.click()} className={`flex ${btn} flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-slate-300 font-semibold text-slate-500 hover:border-emerald-400 hover:bg-emerald-50 hover:text-emerald-700 disabled:opacity-50`}>
              <Camera size={16} /> Chụp ảnh
            </button>
          </>
        )}
      </div>
      {error && <p className="mt-1 whitespace-pre-line text-xs text-red-600">{error}</p>}
      {inputs}
    </div>
  )
}

/** Xem ảnh phóng to — bấm ra ngoài để đóng. */
export function ImageLightbox({ url, onClose }: { url: string | null; onClose: () => void }) {
  if (!url) return null
  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Ảnh" className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain" />
      <button type="button" onClick={onClose} className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-slate-700 shadow" aria-label="Đóng">
        <X size={18} />
      </button>
    </div>
  )
}

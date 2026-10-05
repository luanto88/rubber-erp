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
  factoryId, images, onChange, documentType, label, max = PURCHASE_MAX_IMAGES, compact = false, onPreview,
}: {
  factoryId: string
  images: string[]
  onChange: (urls: string[]) => void
  documentType: "purchase-requests" | "purchase-receipts"
  label?: string
  max?: number
  /** Ô nhỏ hơn — dùng trong từng dòng của form. */
  compact?: boolean
  onPreview?: (url: string) => void
}) {
  const pickRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const box = compact ? "h-12 w-12" : "h-16 w-16"
  const btn = compact ? "h-12 px-2 text-[10px]" : "h-16 px-3 text-[11px]"

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

  return (
    <div>
      {label && <label className={labelCls}>{label}</label>}
      <div className="flex flex-wrap items-start gap-2">
        {images.map((url, i) => (
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
        ))}
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
      <input ref={pickRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFiles} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFiles} />
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

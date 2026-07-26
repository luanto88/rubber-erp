"use client"
/* eslint-disable @next/next/no-img-element */

// Chọn/upload ảnh khi chấm điểm 5S — khuyến khích, không bắt buộc. Mirror NoteImagePicker
// (src/app/dashboard/_components/note-image-picker.tsx) nhưng gọi upload riêng cho bucket/path
// của module 5S (uploadKpi5sEvaluationImage cần thêm locationId).

import { useRef, useState } from "react"
import { ImagePlus, Loader2, X } from "lucide-react"
import { getKpi5sErrorMessage, uploadKpi5sEvaluationImage } from "@/lib/kpi-5s"

const MAX_IMAGES = 6

type Kpi5sImagePickerProps = {
  factoryId: string
  locationId: string
  images: string[]
  onChange: (urls: string[]) => void
}

export function Kpi5sImagePicker({ factoryId, locationId, images, onChange }: Kpi5sImagePickerProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)

  const remaining = MAX_IMAGES - images.length

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return
    if (remaining <= 0) {
      setError(`Tối đa ${MAX_IMAGES} ảnh.`)
      return
    }
    const files = Array.from(fileList).slice(0, remaining)
    setUploading(true)
    setError(null)
    try {
      const urls = await Promise.all(files.map((f) => uploadKpi5sEvaluationImage(factoryId, locationId, f)))
      onChange([...images, ...urls])
    } catch (err) {
      setError(getKpi5sErrorMessage(err, "Không tải được ảnh."))
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {images.map((url, i) => (
          <div key={`${url}-${i}`} className="group relative h-16 w-16 overflow-hidden rounded-xl bg-slate-100 shadow-sm">
            <img src={url} alt={`Ảnh ${i + 1}`} className="h-full w-full cursor-zoom-in object-cover" onClick={() => setZoomUrl(url)} />
            <button
              type="button"
              onClick={() => onChange(images.filter((_, idx) => idx !== i))}
              className="absolute right-0.5 top-0.5 rounded-full bg-white/90 p-0.5 text-slate-500 shadow-sm hover:bg-white"
              aria-label={`Xóa ảnh ${i + 1}`}
            >
              <X size={10} />
            </button>
          </div>
        ))}
        {images.length < MAX_IMAGES && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="flex h-16 w-16 items-center justify-center rounded-xl border border-dashed border-slate-300 text-slate-400 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
            title="Thêm ảnh"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
          </button>
        )}
      </div>
      {error && <div className="mt-1 text-[11px] font-semibold text-red-600">{error}</div>}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files)
          e.target.value = ""
        }}
      />
      {zoomUrl && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4" onClick={() => setZoomUrl(null)}>
          <button type="button" onClick={() => setZoomUrl(null)} className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white hover:bg-white/40" aria-label="Đóng">
            <X size={20} />
          </button>
          <img src={zoomUrl} alt="Xem ảnh" className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}

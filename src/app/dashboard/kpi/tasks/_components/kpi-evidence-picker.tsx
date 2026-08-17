"use client"
/* eslint-disable @next/next/no-img-element */

// Chọn/upload ảnh + file bằng chứng khi cập nhật tiến độ/nộp công việc — mirror
// NoteImagePicker (src/app/dashboard/_components/note-image-picker.tsx) nhưng gộp thêm
// nhánh file bất kỳ (không giới hạn ảnh) vì kpi_task_logs.file_urls tách riêng image_urls.

import { useEffect, useRef, useState } from "react"
import { Camera, File as FileIcon, ImagePlus, Loader2, Paperclip, X } from "lucide-react"
import { getKpiErrorMessage, uploadKpiEvidenceFile, uploadKpiEvidenceImage } from "@/lib/kpi-tasks"

const MAX_IMAGES = 6
const MAX_FILES = 4

type KpiEvidencePickerProps = {
  factoryId: string
  taskId: string
  imageUrls: string[]
  onImagesChange: (urls: string[]) => void
  fileUrls: { url: string; name: string }[]
  onFilesChange: (files: { url: string; name: string }[]) => void
  // Báo cho component cha biết đang có ảnh/file upload dở — cha dùng để khoá tạm nút Lưu/Nộp,
  // tránh race condition "chọn ảnh rồi bấm Lưu ngay" đọc phải imageUrls/fileUrls còn cũ (mất bằng
  // chứng, không báo lỗi gì).
  onUploadingChange?: (uploading: boolean) => void
}

export function KpiEvidencePicker({
  factoryId,
  taskId,
  imageUrls,
  onImagesChange,
  fileUrls,
  onFilesChange,
  onUploadingChange,
}: KpiEvidencePickerProps) {
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [zoomUrl, setZoomUrl] = useState<string | null>(null)

  useEffect(() => {
    onUploadingChange?.(uploadingImage || uploadingFile)
  }, [uploadingImage, uploadingFile, onUploadingChange])

  const handleImages = async (fileList: FileList | null) => {
    if (!fileList?.length) return
    const remaining = MAX_IMAGES - imageUrls.length
    if (remaining <= 0) {
      setError(`Tối đa ${MAX_IMAGES} ảnh.`)
      return
    }
    const files = Array.from(fileList).slice(0, remaining)
    setUploadingImage(true)
    setError(null)
    try {
      const urls = await Promise.all(files.map((f) => uploadKpiEvidenceImage(factoryId, taskId, f)))
      onImagesChange([...imageUrls, ...urls])
    } catch (err) {
      setError(getKpiErrorMessage(err, "Không tải được ảnh."))
    } finally {
      setUploadingImage(false)
    }
  }

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList?.length) return
    const remaining = MAX_FILES - fileUrls.length
    if (remaining <= 0) {
      setError(`Tối đa ${MAX_FILES} file.`)
      return
    }
    const files = Array.from(fileList).slice(0, remaining)
    setUploadingFile(true)
    setError(null)
    try {
      const uploaded = await Promise.all(files.map((f) => uploadKpiEvidenceFile(factoryId, taskId, f)))
      onFilesChange([...fileUrls, ...uploaded])
    } catch (err) {
      setError(getKpiErrorMessage(err, "Không tải được file."))
    } finally {
      setUploadingFile(false)
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs font-bold text-slate-600 mb-1.5">Ảnh bằng chứng</div>
        <div className="flex flex-wrap items-center gap-2">
          {imageUrls.map((url, i) => (
            <div key={`${url}-${i}`} className="group relative h-14 w-14 overflow-hidden rounded-xl bg-slate-100 shadow-sm">
              <img src={url} alt={`Ảnh ${i + 1}`} className="h-full w-full cursor-zoom-in object-cover" onClick={() => setZoomUrl(url)} />
              <button
                type="button"
                onClick={() => onImagesChange(imageUrls.filter((_, idx) => idx !== i))}
                className="absolute right-0.5 top-0.5 rounded-full bg-white/90 p-0.5 text-slate-500 shadow-sm hover:bg-white"
              >
                <X size={10} />
              </button>
            </div>
          ))}
          {imageUrls.length < MAX_IMAGES && (
            <>
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                disabled={uploadingImage}
                className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-slate-300 text-slate-400 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
                title="Chụp ảnh"
              >
                {uploadingImage ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
                <span className="text-[8px] font-bold">Chụp</span>
              </button>
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={uploadingImage}
                className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-dashed border-slate-300 text-slate-400 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-600 disabled:cursor-not-allowed disabled:opacity-50"
                title="Chọn từ thư viện"
              >
                {uploadingImage ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
                <span className="text-[8px] font-bold">Thư viện</span>
              </button>
            </>
          )}
        </div>
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            void handleImages(e.target.files)
            e.target.value = ""
          }}
        />
        <input
          ref={imageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleImages(e.target.files)
            e.target.value = ""
          }}
        />
      </div>

      <div>
        <div className="text-xs font-bold text-slate-600 mb-1.5">File đính kèm</div>
        <div className="space-y-1.5">
          {fileUrls.map((f, i) => (
            <div key={`${f.url}-${i}`} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-1.5">
              <FileIcon size={14} className="shrink-0 text-slate-400" />
              <a href={f.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-xs font-semibold text-slate-600 hover:underline">
                {f.name}
              </a>
              <button type="button" onClick={() => onFilesChange(fileUrls.filter((_, idx) => idx !== i))} className="text-slate-400 hover:text-red-600">
                <X size={12} />
              </button>
            </div>
          ))}
          {fileUrls.length < MAX_FILES && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingFile}
              className="flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-500 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-600 disabled:opacity-50"
            >
              {uploadingFile ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
              Thêm file
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFiles(e.target.files)
            e.target.value = ""
          }}
        />
      </div>

      {error && <div className="text-xs font-semibold text-red-600">{error}</div>}

      {zoomUrl && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4" onClick={() => setZoomUrl(null)}>
          <button type="button" onClick={() => setZoomUrl(null)} className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white hover:bg-white/40">
            <X size={20} />
          </button>
          <img src={zoomUrl} alt="Xem ảnh" className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}

"use client"
/* eslint-disable @next/next/no-img-element */

import { useRef, useState } from "react"
import { ImagePlus, Loader2, X, ZoomIn } from "lucide-react"
import { supabase } from "@/lib/supabase"

type UploadedImagePayload = {
  publicUrl: string
  fileName: string
}

type InventoryImageUploadProps = {
  factoryId: string | null
  documentType: string
  label: string
  value: string
  onChange: (url: string) => void
  bucket?: string
  helperText?: string
  onUploadComplete?: (payload: UploadedImagePayload) => void
}

type InventoryImageUploadGroupProps = {
  factoryId: string | null
  documentType: string
  label: string
  values: [string, string]
  onChange: (urls: [string, string]) => void
  bucket?: string
  helperText?: string
  onUploadComplete?: (payloads: Array<UploadedImagePayload & { slot: 1 | 2 }>) => void
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_")
}

function extractFilename(url: string) {
  try {
    return decodeURIComponent(url.split("/").pop() || "Ảnh đã tải")
  } catch {
    return "Ảnh đã tải"
  }
}

function isStorageConfigError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "")
  return /bucket.*not found|row-level security|permission denied|unauthorized|403/i.test(message)
}

async function uploadViaServer(params: {
  bucket: string
  documentType: string
  factoryId: string
  file: File
}) {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!data.session?.access_token) {
    throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.")
  }

  const body = new FormData()
  body.append("bucket", params.bucket)
  body.append("documentType", params.documentType)
  body.append("factoryId", params.factoryId)
  body.append("file", params.file)

  const response = await fetch("/api/storage/upload-image", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body,
  })

  const payload = (await response.json().catch(() => null)) as { error?: string; publicUrl?: string } | null
  if (!response.ok || !payload?.publicUrl) {
    throw new Error(payload?.error || "Không tải được ảnh lên máy chủ.")
  }

  return payload.publicUrl
}

export async function uploadInventoryImage(params: {
  bucket?: string
  documentType: string
  factoryId: string
  file: File
}) {
  const bucket = params.bucket || "inventory-files"
  const path = `${params.factoryId}/${params.documentType}/${Date.now()}_${sanitizeFilename(params.file.name)}`
  const uploadResult = await supabase.storage.from(bucket).upload(path, params.file, { upsert: true })

  if (uploadResult.error) {
    if (!isStorageConfigError(uploadResult.error)) throw uploadResult.error
    const publicUrl = await uploadViaServer({
      bucket,
      documentType: params.documentType,
      factoryId: params.factoryId,
      file: params.file,
    })
    return { publicUrl }
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(uploadResult.data.path)
  return { publicUrl: data.publicUrl }
}

function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/20 p-2 text-white transition hover:bg-white/40"
        aria-label="Đóng"
      >
        <X size={20} />
      </button>
      <img
        src={url}
        alt="Xem ảnh"
        className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  )
}

export function InventoryImageUpload({
  factoryId,
  documentType,
  label,
  value,
  onChange,
  bucket = "inventory-files",
  helperText,
  onUploadComplete,
}: InventoryImageUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  const handlePick = () => {
    inputRef.current?.click()
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!factoryId) {
      setError("Chưa xác định được nhà máy để tải ảnh.")
      event.target.value = ""
      return
    }

    setUploading(true)
    setError(null)

    try {
      const { publicUrl } = await uploadInventoryImage({ bucket, documentType, factoryId, file })
      onChange(publicUrl)
      onUploadComplete?.({ publicUrl, fileName: file.name })
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Không tải được ảnh.")
    } finally {
      setUploading(false)
      event.target.value = ""
    }
  }

  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold text-slate-600">{label}</label>
      {value ? (
        <div className="flex items-center gap-2">
          <div
            className="group relative h-14 w-14 cursor-zoom-in overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm"
            onClick={() => setLightboxUrl(value)}
            title="Nhấn để xem ảnh lớn"
          >
            <img src={value} alt="Ảnh đã tải" className="h-full w-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/20">
              <ZoomIn size={16} className="text-white opacity-0 transition group-hover:opacity-100" />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={handlePick}
              disabled={uploading}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            >
              {uploading ? <Loader2 size={12} className="animate-spin" /> : <ImagePlus size={12} />}
              {uploading ? "Đang tải..." : "Thay ảnh"}
            </button>
            <button
              type="button"
              onClick={() => onChange("")}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-red-500 hover:bg-red-50"
            >
              <X size={12} />
              Xóa ảnh
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={handlePick}
          disabled={uploading}
          className="flex min-h-[42px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm font-bold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
          {uploading ? "Đang tải..." : "Chọn ảnh"}
        </button>
      )}
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
      {helperText ? <div className="mt-1 text-[11px] text-slate-400">{helperText}</div> : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  )
}

export function InventoryImageUploadGroup({
  factoryId,
  documentType,
  label,
  values,
  onChange,
  bucket = "inventory-files",
  helperText,
  onUploadComplete,
}: InventoryImageUploadGroupProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const normalizedValues: [string, string] = [values[0] || "", values[1] || ""]
  const filledCount = normalizedValues.filter(Boolean).length

  const handlePick = () => {
    inputRef.current?.click()
  }

  const handleRemove = (slot: 0 | 1) => {
    const next = [...normalizedValues] as [string, string]
    next[slot] = ""
    onChange(next)
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ""
    if (files.length === 0) return

    if (!factoryId) {
      setError("Chưa xác định được nhà máy để tải ảnh.")
      return
    }

    const emptySlots = normalizedValues
      .map((value, index) => (value ? null : index))
      .filter((value): value is 0 | 1 => value !== null)

    if (emptySlots.length === 0) {
      setError("Đã đủ 2 ảnh. Vui lòng xóa bớt ảnh cũ để tải ảnh mới.")
      return
    }

    if (files.length > emptySlots.length) {
      setError(`Chỉ còn thể tải thêm ${emptySlots.length} ảnh.`)
      return
    }

    setUploading(true)
    setError(null)

    try {
      const uploads = await Promise.all(
        files.map((file) =>
          uploadInventoryImage({
            bucket,
            documentType,
            factoryId,
            file,
          }).then(({ publicUrl }) => ({ publicUrl, fileName: file.name })),
        ),
      )

      const next = [...normalizedValues] as [string, string]
      const payloads: Array<UploadedImagePayload & { slot: 1 | 2 }> = []

      uploads.forEach((upload, index) => {
        const slot = emptySlots[index]
        next[slot] = upload.publicUrl
        payloads.push({
          ...upload,
          slot: (slot + 1) as 1 | 2,
        })
      })

      onChange(next)
      onUploadComplete?.(payloads)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Không tải được ảnh.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold text-slate-600">{label}</label>
      <div className="flex flex-wrap items-start gap-2">
        {normalizedValues.map((value, index) =>
          value ? (
            <div
              key={`${index}-${value}`}
              className="group relative h-14 w-14 overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 shadow-sm"
            >
              <img
                src={value}
                alt={`Ảnh phiếu ${index + 1}`}
                className="h-full w-full cursor-zoom-in object-cover"
                onClick={() => setLightboxUrl(value)}
                title="Nhấn để xem ảnh lớn"
              />
              <div
                className="pointer-events-none absolute inset-0 flex items-end justify-center bg-black/0 pb-0.5 transition group-hover:bg-black/10"
              >
                <ZoomIn size={12} className="text-white opacity-0 drop-shadow transition group-hover:opacity-100" />
              </div>
              <button
                type="button"
                onClick={() => handleRemove(index as 0 | 1)}
                className="absolute right-1 top-1 rounded-full bg-white/90 p-1 text-slate-500 shadow-sm transition hover:bg-white"
                aria-label={`Xóa ảnh ${index + 1}`}
              >
                <X size={10} />
              </button>
            </div>
          ) : null,
        )}

        {filledCount < 2 ? (
          <button
            type="button"
            onClick={handlePick}
            disabled={uploading}
            className="flex h-14 w-14 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white text-slate-400 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            title={uploading ? "Đang tải ảnh..." : "Chọn ảnh (tối đa 2 ảnh)"}
          >
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
          </button>
        ) : null}
      </div>
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
      {helperText ? <div className="mt-1 text-[11px] text-slate-400">{helperText}</div> : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </div>
  )
}

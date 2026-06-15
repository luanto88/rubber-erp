"use client"

import { useRef, useState } from "react"
import { ImagePlus, Loader2, X } from "lucide-react"
import { supabase } from "@/lib/supabase"

type InventoryImageUploadProps = {
  factoryId: string | null
  documentType: string
  label: string
  value: string
  onChange: (url: string) => void
  bucket?: string
}

function sanitizeFilename(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_")
}

function extractFilename(url: string) {
  try {
    return decodeURIComponent(url.split("/").pop() || "Anh da tai")
  } catch {
    return "Anh da tai"
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
    throw new Error("Phien dang nhap da het han. Vui long dang nhap lai.")
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
    throw new Error(payload?.error || "Khong tai duoc anh len may chu.")
  }

  return payload.publicUrl
}

export function InventoryImageUpload({
  factoryId,
  documentType,
  label,
  value,
  onChange,
  bucket = "inventory-files",
}: InventoryImageUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePick = () => {
    inputRef.current?.click()
  }

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!factoryId) {
      setError("Chua xac dinh duoc nha may de tai anh.")
      event.target.value = ""
      return
    }

    setUploading(true)
    setError(null)

    const path = `${factoryId}/${documentType}/${Date.now()}_${sanitizeFilename(file.name)}`

    try {
      const uploadResult = await supabase.storage.from(bucket).upload(path, file, { upsert: true })

      if (uploadResult.error) {
        if (!isStorageConfigError(uploadResult.error)) throw uploadResult.error
        const publicUrl = await uploadViaServer({ bucket, documentType, factoryId, file })
        onChange(publicUrl)
        return
      }

      const { data } = supabase.storage.from(bucket).getPublicUrl(uploadResult.data.path)
      onChange(data.publicUrl)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Khong tai duoc anh.")
    } finally {
      setUploading(false)
      event.target.value = ""
    }
  }

  return (
    <div>
      <label className="mb-1.5 block text-xs font-bold text-slate-600">{label}</label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handlePick}
          disabled={uploading}
          className="flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm font-bold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
          {uploading ? "Dang tai..." : value ? extractFilename(value) : "Chon anh"}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Xoa anh"
          >
            <X size={14} />
          </button>
        ) : null}
      </div>
      {error ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  )
}

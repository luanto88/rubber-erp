"use client"

import { useRef, useState } from "react"
import { ImagePlus, Loader2, X } from "lucide-react"
import { supabase } from "@/lib/supabase"

type InventoryImageUploadProps = {
  factoryId: string | null
  documentType: "import" | "export" | "transfer"
  label: string
  value: string
  onChange: (url: string) => void
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

export function InventoryImageUpload({
  factoryId,
  documentType,
  label,
  value,
  onChange,
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
      setError("Chưa xác định được nhà máy để tải ảnh.")
      event.target.value = ""
      return
    }

    setUploading(true)
    setError(null)

    try {
      const path = `${factoryId}/${documentType}/${Date.now()}_${sanitizeFilename(file.name)}`
      const uploadResult = await supabase.storage.from("inventory-files").upload(path, file, { upsert: true })

      if (uploadResult.error) throw uploadResult.error

      const { data } = supabase.storage.from("inventory-files").getPublicUrl(uploadResult.data.path)
      onChange(data.publicUrl)
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
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handlePick}
          disabled={uploading}
          className="flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm font-bold text-slate-500 hover:bg-slate-50 disabled:opacity-50"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
          {uploading ? "Đang tải..." : value ? extractFilename(value) : "Chọn ảnh"}
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Xóa ảnh"
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

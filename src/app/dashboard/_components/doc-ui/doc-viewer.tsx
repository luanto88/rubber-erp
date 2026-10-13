"use client"

import dynamic from "next/dynamic"
import { EyeOff, Loader2 } from "lucide-react"
import type { DocViewerImplProps } from "./doc-viewer-impl"

/**
 * Khung xem tài liệu nhúng (Doc-UI, GĐ3). Vỏ mỏng: nạp phần thân (`doc-viewer-impl`, có
 * pdfjs-dist) bằng `next/dynamic` + `ssr: false` để pdfjs không bao giờ vào bundle server.
 *
 * `active = false` (tab mobile đang ở "Thông tin", hoặc modal ký đang mở) → chỉ hiện khung giữ
 * chỗ, KHÔNG mount phần thân ⇒ không tải/không render PDF 2 lần cùng lúc với modal ký.
 */
export type DocViewerProps = DocViewerImplProps & { active: boolean }

const VIEWER_HEIGHT = "h-[70dvh] lg:h-[min(78vh,820px)]"

function ViewerShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`flex ${VIEWER_HEIGHT} flex-col items-center justify-center gap-2 overflow-hidden rounded-[14px] border border-slate-700 bg-slate-800 text-[12.5px] text-slate-300 shadow-sm`}
    >
      {children}
    </div>
  )
}

const DocViewerImpl = dynamic(() => import("./doc-viewer-impl"), {
  ssr: false,
  loading: () => (
    <ViewerShell>
      <Loader2 size={20} className="animate-spin" />
      Đang tải trình xem...
    </ViewerShell>
  ),
})

export function DocViewer({ active, ...props }: DocViewerProps) {
  if (props.kind === "none") return null
  if (!active) {
    return (
      <ViewerShell>
        <EyeOff size={18} />
        Trình xem đang tạm ẩn
      </ViewerShell>
    )
  }
  return <DocViewerImpl {...props} heightClass={VIEWER_HEIGHT} />
}

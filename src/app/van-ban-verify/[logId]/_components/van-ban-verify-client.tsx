"use client"

import { useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, FileText, KeyRound, ListOrdered, Loader2, XCircle } from "lucide-react"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { DocCodePill } from "@/app/dashboard/_components/doc-ui/doc-code-pill"
import { InspectorCard, MetaList, MetaRow } from "@/app/dashboard/_components/doc-ui/inspector-card"
import type { StatusDomain, StatusTone } from "@/app/dashboard/_components/doc-ui/status-registry"

// Mirror src/app/sign-verify/[nguoiKyId]/_components/sign-verify-client.tsx (hệ ký dùng chung).
// Bản riêng DÙNG CHUNG cho Văn bản nội bộ + ISO: cả hai module này dùng hệ ký RIÊNG, định danh
// chữ ký theo dòng `doc_approval_log` chứ không phải bản ghi `nguoi_ky`.
//
// ⚠️ Giữ nguyên đường dẫn `/van-ban-verify/...` kể cả cho ISO — link đã được in vào các file PDF
// đã ký từ trước, không đổi lại được.

type Severity = "ok" | "warn" | "error"

type SigningStep = {
  id: string
  signerName: string
  buoc: string
  action: string | null
  kyLuc: string | null
  isCurrent: boolean
  hasPades: boolean
}

type VerifyResponse = {
  docType: "van_ban" | "iso" | "iso_form"
  signerName: string
  buoc: string
  kyLuc: string | null
  maTaiLieu: string | null
  tenTaiLieu: string | null
  trangThai: string | null
  contentHash: string | null
  valid: boolean
  severity: Severity
  reason?: string
  error?: string
  // Chỉ có khi valid === true — xem verifyPadesSignature() trong src/lib/signing/verify-pades.ts
  serialNumber?: string
  validFrom?: string
  validTo?: string
  keyAlgorithm?: string
  digestAlgorithm?: string
  rootCaId?: string
  rootCaName?: string
  isHistoricalRoot?: boolean
  padesSignerName?: string
  isInheritedSeal?: boolean
  inheritedNote?: string
  /** Chữ ký nằm ở giữa file: các bước sau được nối thêm, phần đã ký kiểm theo đúng revision. */
  revisionVerified?: boolean
  revisionNote?: string
  /** Dòng nhật ký của bản ISO trung gian đã bị thay thế bởi bản ban hành (không phải lỗi). */
  supersededDraft?: boolean
  signingHistory?: SigningStep[]
}

// Domain registry Doc-UI theo loại tài liệu — nhãn + tông trạng thái lấy từ status-registry.ts.
const STATUS_DOMAIN: Record<VerifyResponse["docType"], StatusDomain> = {
  van_ban: "doc",
  iso: "iso",
  iso_form: "form",
}

const SEVERITY_STYLE: Record<Severity, { box: string; title: string; text: string; tone: StatusTone; badge: string }> = {
  ok: { box: "border-[#a7f3d0] bg-[#ecfdf5]", title: "text-[#065f46]", text: "text-[#047857]", tone: "valid", badge: "Hợp lệ" },
  warn: { box: "border-[#fde68a] bg-[#fffbeb]", title: "text-[#92400e]", text: "text-[#92400e]", tone: "pending", badge: "Cần lưu ý" },
  error: { box: "border-[#fecaca] bg-[#fef2f2]", title: "text-[#991b1b]", text: "text-[#b91c1c]", tone: "danger", badge: "Không hợp lệ" },
}

function TechRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-dashed border-slate-200/80 py-1.5 last:border-0">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className={`min-w-0 text-right font-semibold text-slate-700 [overflow-wrap:anywhere] ${mono ? "font-code" : ""}`}>
        {value}
      </span>
    </div>
  )
}

export function VanBanVerifyClient({ logId }: { logId: string }) {
  const [data, setData] = useState<VerifyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/documents/verify/${logId}`)
        const json = (await res.json()) as VerifyResponse
        if (!res.ok) throw new Error(json.error || "Không xác thực được")
        if (alive) setData(json)
      } catch (err) {
        if (alive) setLoadError(err instanceof Error ? err.message : "Lỗi không xác định")
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [logId])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-[14px] border border-slate-200 bg-white p-8 text-sm text-slate-500 shadow-sm">
        <Loader2 size={18} className="animate-spin text-brand-600" /> Đang xác thực chữ ký...
      </div>
    )
  }

  if (loadError || !data) {
    return (
      <div className="rounded-[14px] border border-[#fecaca] bg-[#fef2f2] p-6 text-center text-sm font-semibold text-[#991b1b]">
        {loadError || "Không tải được thông tin chữ ký"}
      </div>
    )
  }

  const isIso = data.docType === "iso" || data.docType === "iso_form"
  // Tài liệu cũ (trước khi API trả `severity`) vẫn hiển thị đúng nhờ suy từ `valid`.
  const severity: Severity = data.severity ?? (data.valid ? "ok" : "error")
  const style = SEVERITY_STYLE[severity]

  const title =
    severity === "ok"
      ? "Chữ ký hợp lệ"
      : severity === "warn"
        ? data.supersededDraft
          ? "Bản trung gian đã được thay thế"
          : "Tài liệu đã hết hiệu lực"
        : "Không xác minh được"

  // Nhánh "warn" phát sinh ở 2 trường hợp đều là quy trình bình thường, KHÔNG phải dấu hiệu file
  // bị sửa trái phép: (1) ISO hết hiệu lực — bản ban hành bị đóng dấu lại; (2) dòng nhật ký của
  // bản ISO trung gian — đã bị bản ban hành thay thế (server gửi sẵn lý do trong `reason`).
  const message =
    severity === "warn" && !data.supersededDraft
      ? "Tài liệu này đã hết hiệu lực và được đóng dấu lại, nên chữ ký số của bản ban hành không còn nguyên vẹn — đây là điều bình thường, không phải dấu hiệu file bị can thiệp."
      : data.reason

  const fmtDateTime = (v: string | null | undefined) => (v ? new Date(v).toLocaleString("vi-VN") : "—")

  return (
    <div className="space-y-4">
      {/* Kết quả xác thực */}
      <div className={`flex items-start gap-3 rounded-[14px] border p-4 sm:p-5 ${style.box}`}>
        {severity === "ok" ? (
          <CheckCircle2 size={30} className="mt-0.5 shrink-0 text-[#15803d]" />
        ) : severity === "warn" ? (
          <AlertTriangle size={30} className="mt-0.5 shrink-0 text-[#d97706]" />
        ) : (
          <XCircle size={30} className="mt-0.5 shrink-0 text-[#dc2626]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className={`text-lg font-extrabold ${style.title}`}>{title}</p>
            <StatusBadge tone={style.tone} label={style.badge} size="xs" />
          </div>
          {message && <p className={`mt-1 text-sm leading-relaxed ${style.text}`}>{message}</p>}
        </div>
      </div>

      {/* Thông tin chữ ký */}
      <InspectorCard title={isIso ? "Thông tin tài liệu" : "Thông tin văn bản"} icon={FileText}>
        <MetaList>
          {data.maTaiLieu && (
            <MetaRow label={isIso ? "Mã tài liệu" : "Số/Mã văn bản"} value={<DocCodePill code={data.maTaiLieu} />} />
          )}
          {data.tenTaiLieu && <MetaRow label={isIso ? "Tên tài liệu" : "Trích yếu"} value={data.tenTaiLieu} />}
          <MetaRow label="Bước ký" value={data.buoc} />
          <MetaRow label="Người ký" value={data.signerName} />
          <MetaRow label="Thời gian ký" value={fmtDateTime(data.kyLuc)} />
          {data.trangThai && (
            <MetaRow
              label={isIso ? "Trạng thái tài liệu" : "Trạng thái văn bản"}
              value={<StatusBadge domain={STATUS_DOMAIN[data.docType] ?? "doc"} status={data.trangThai} size="xs" />}
            />
          )}
        </MetaList>
      </InspectorCard>

      {data.signingHistory && data.signingHistory.length > 1 && (
        <InspectorCard title="Tiến trình ký duyệt" icon={ListOrdered}>
          <ol className="space-y-2">
            {data.signingHistory.map((step, idx) => (
              <li key={step.id}>
                <a
                  href={`/van-ban-verify/${step.id}`}
                  className={`flex items-center justify-between gap-2 rounded-xl border p-2.5 text-xs transition-colors ${
                    step.isCurrent
                      ? "border-brand-300 bg-brand-50 ring-1 ring-brand-200"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${
                        step.isCurrent ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className={`truncate font-bold ${step.isCurrent ? "text-brand-800" : "text-slate-800"}`}>
                        {step.signerName}
                      </p>
                      <p className="truncate text-[11px] text-slate-500">{step.buoc}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {step.isCurrent ? (
                      <StatusBadge tone="info" label="Đang xem" size="xs" />
                    ) : (
                      <span className="text-[11px] text-slate-400">
                        {step.kyLuc ? new Date(step.kyLuc).toLocaleDateString("vi-VN") : "—"}
                      </span>
                    )}
                  </div>
                </a>
              </li>
            ))}
          </ol>
        </InspectorCard>
      )}

      {data.valid && (
        <InspectorCard title="Thông tin kỹ thuật chữ ký số" icon={KeyRound} bodyClassName="p-4 text-xs">
          {data.revisionNote && (
            <div className="mb-3 rounded-xl border border-[#a7f3d0] bg-[#ecfdf5] p-2.5 font-medium leading-relaxed text-[#065f46]">
              {data.revisionNote}
            </div>
          )}
          {data.inheritedNote && (
            <div className="mb-3 rounded-xl border border-brand-200 bg-brand-50 p-2.5 font-medium leading-relaxed text-brand-800">
              {data.inheritedNote}
            </div>
          )}
          {data.padesSignerName ? (
            <TechRow
              label={data.isInheritedSeal ? "Niêm phong PAdES bởi" : "Người ký chứng thư số"}
              value={data.padesSignerName}
            />
          ) : data.signerName ? (
            <TechRow label="Người ký xác thực" value={data.signerName} />
          ) : null}
          {!data.padesSignerName && data.kyLuc && <TechRow label="Thời gian ký duyệt" value={fmtDateTime(data.kyLuc)} />}
          <TechRow
            label="Cấp độ bảo mật"
            value={
              data.serialNumber
                ? "Cấp độ 2 — Chữ ký số PAdES niêm phong mật mã RSA-2048"
                : "Cấp độ 1 — Xác thực toàn vẹn nội dung & Nhật ký phê duyệt"
            }
          />
          {(data.keyAlgorithm || data.digestAlgorithm) && (
            <TechRow label="Thuật toán" value={[data.keyAlgorithm, data.digestAlgorithm].filter(Boolean).join(" + ")} />
          )}
          <TechRow
            label="Tổ chức phát hành"
            value={
              data.serialNumber
                ? "Chứng thư số nội bộ do hệ thống Rubber ERP tự phát hành"
                : "Hệ thống Rubber ERP (Xác thực toàn vẹn SHA-256)"
            }
          />
          {data.rootCaName && <TechRow label="Gốc chứng thư (Root CA)" value={data.rootCaName} />}
          {data.serialNumber && <TechRow label="Số hiệu chứng thư" value={data.serialNumber} mono />}
          {data.validFrom && <TechRow label="Hiệu lực từ" value={fmtDateTime(data.validFrom)} />}
          {data.validTo && <TechRow label="Hiệu lực đến" value={fmtDateTime(data.validTo)} />}
          {data.contentHash && (
            <div className="mt-2 border-t border-slate-200/70 pt-2">
              <p className="mb-0.5 text-slate-500">Mã băm toàn vẹn nội dung (SHA-256)</p>
              <p className="font-code break-all text-[10.5px] text-slate-600">{data.contentHash}</p>
            </div>
          )}
        </InspectorCard>
      )}
    </div>
  )
}

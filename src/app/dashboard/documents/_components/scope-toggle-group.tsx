"use client"

import { Building2, Globe, Lock, Users, type LucideIcon } from "lucide-react"
import { CHE_DO_XEM_DESC, CHE_DO_XEM_LABEL } from "./documents-types"

// Thanh phân đoạn 2 lựa chọn dùng chung cho "Phạm vi lưu hành" và "Phạm vi hiển thị" — cùng
// chiều cao/bo góc/cỡ chữ để 2 nhóm đặt cạnh nhau trái-phải trông như một khối thống nhất.
// Chỉ lo phần trình bày; mọi logic nghiệp vụ khi đổi lựa chọn vẫn nằm ở nơi gọi (`onChange`).

export type ScopeTone = "blue" | "slate" | "amber"

export type ScopeOption<T extends string> = {
  value: T
  label: string
  Icon: LucideIcon
  tone: ScopeTone
}

const ACTIVE_TONE: Record<ScopeTone, string> = {
  blue: "bg-blue-600 text-white shadow-sm",
  slate: "bg-slate-700 text-white shadow-sm",
  amber: "bg-amber-600 text-white shadow-sm",
}

const DESC_TONE: Record<ScopeTone, string> = {
  blue: "text-blue-700",
  slate: "text-slate-500",
  amber: "text-amber-700 font-medium",
}

export function ScopeToggleGroup<T extends string>({
  label,
  required,
  options,
  value,
  onChange,
  description,
  disabled,
  lockedHint,
}: {
  label: string
  required?: boolean
  options: readonly ScopeOption<T>[]
  value: T
  onChange?: (value: T) => void
  description?: string
  disabled?: boolean
  /** Ghi chú hiện cạnh nhãn khi khoá — giải thích vì sao không đổi được. */
  lockedHint?: string
}) {
  const active = options.find((o) => o.value === value)
  return (
    <div className={disabled ? "opacity-70" : undefined}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <label className="text-xs font-bold text-slate-600">
          {label} {required && !disabled && <span className="text-red-500">*</span>}
        </label>
        {disabled && lockedHint && (
          <span className="text-[11px] font-semibold text-slate-400">{lockedHint}</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
        {options.map(({ value: v, label: l, Icon, tone }) => {
          const isActive = v === value
          return (
            <button
              key={v}
              type="button"
              disabled={disabled}
              aria-pressed={isActive}
              onClick={() => onChange?.(v)}
              className={`flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-sm font-bold transition-all ${
                isActive
                  ? ACTIVE_TONE[tone]
                  : "text-slate-500 hover:bg-white hover:text-slate-700"
              } ${disabled ? "cursor-not-allowed" : ""}`}
            >
              <Icon size={15} className="shrink-0" />
              <span className="truncate">{l}</span>
            </button>
          )
        })}
      </div>
      {/* Chiều cao tối thiểu cố định để 2 cột không lệch khi mô tả dài/ngắn khác nhau. */}
      <p className={`mt-1.5 min-h-[2rem] text-xs leading-snug ${active ? DESC_TONE[active.tone] : "text-slate-400"}`}>
        {description}
      </p>
    </div>
  )
}

// ── Khối 2 cột "Phạm vi lưu hành" | "Phạm vi hiển thị" — dùng chung Soạn thảo / Upload / Sửa ──

export type PhamViCode = "Cong_ty" | "Don_vi"
export type CheDoXemValue = "cong_khai" | "gioi_han"

const PHAM_VI_OPTIONS: readonly ScopeOption<PhamViCode>[] = [
  { value: "Cong_ty", label: "Nội bộ công ty", Icon: Building2, tone: "blue" },
  { value: "Don_vi", label: "Nội bộ đơn vị", Icon: Users, tone: "blue" },
]

const PHAM_VI_DESC: Record<PhamViCode, string> = {
  Cong_ty: "Lưu hành toàn công ty, ký tuần tự qua các phòng ban rồi trình phê duyệt.",
  Don_vi: "Chỉ lưu hành trong đơn vị. Người trong phòng ban ký xác nhận tuần tự.",
}

const CHE_DO_XEM_OPTIONS_UI: readonly ScopeOption<CheDoXemValue>[] = [
  { value: "cong_khai", label: CHE_DO_XEM_LABEL.cong_khai, Icon: Globe, tone: "slate" },
  { value: "gioi_han", label: CHE_DO_XEM_LABEL.gioi_han, Icon: Lock, tone: "amber" },
]

/**
 * Luôn 2 cột trái-phải (xếp dọc trên mobile). Khi "Nội bộ đơn vị", cột Phạm vi hiển thị KHÔNG ẩn
 * mà khoá ở "Công khai" — bố cục không nhảy khi đổi lựa chọn (đã chốt với người dùng 2026-09-27).
 * Ghi chú về giới hạn file PDF đặt dưới cả khối, chỉ hiện khi đang "Giới hạn".
 */
export function DocumentScopeFields({
  phamVi,
  onPhamViChange,
  phamViLocked,
  cheDoXem,
  onCheDoXemChange,
}: {
  phamVi: PhamViCode
  onPhamViChange?: (value: PhamViCode) => void
  /** Chỉ đọc (vd modal Sửa — không đổi được luồng ký sau khi đã tạo). */
  phamViLocked?: boolean
  cheDoXem: CheDoXemValue
  onCheDoXemChange: (value: CheDoXemValue) => void
}) {
  const isDonVi = phamVi === "Don_vi"
  const effectiveCheDoXem: CheDoXemValue = isDonVi ? "cong_khai" : cheDoXem
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <ScopeToggleGroup
          label="Phạm vi lưu hành"
          options={PHAM_VI_OPTIONS}
          value={phamVi}
          onChange={onPhamViChange}
          disabled={phamViLocked}
          lockedHint="Cố định khi đã tạo"
          description={PHAM_VI_DESC[phamVi]}
        />
        <ScopeToggleGroup
          label="Phạm vi hiển thị"
          required
          options={CHE_DO_XEM_OPTIONS_UI}
          value={effectiveCheDoXem}
          onChange={onCheDoXemChange}
          disabled={isDonVi}
          lockedHint="Không áp dụng"
          description={
            isDonVi
              ? "Văn bản nội bộ đơn vị luôn công khai trong nhà máy."
              : CHE_DO_XEM_DESC[effectiveCheDoXem]
          }
        />
      </div>
      {!isDonVi && effectiveCheDoXem === "gioi_han" && (
        <p className="text-[11px] leading-relaxed text-slate-400">
          Lưu ý: giới hạn áp dụng cho danh sách, trang chi tiết và tìm kiếm. Người đang giữ sẵn
          đường dẫn tệp PDF vẫn tải được tệp đó.
        </p>
      )}
    </div>
  )
}

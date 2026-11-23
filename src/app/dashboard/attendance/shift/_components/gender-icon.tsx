// Icon người trên ô điểm danh: xanh = nam, hồng = nữ, xám = chưa rõ giới tính (maintenance_staff.gioi_tinh).

export function genderKind(gioiTinh: string | null | undefined): "nam" | "nu" | "khac" {
  const g = (gioiTinh || "").trim().toLowerCase()
  if (g === "nam" || g === "male") return "nam"
  if (g === "nữ" || g === "nu" || g === "female") return "nu"
  return "khac"
}

const COLORS = {
  nam: { fill: "#dbeafe", stroke: "#2563eb" },
  nu: { fill: "#fce7f3", stroke: "#db2777" },
  khac: { fill: "#f1f5f9", stroke: "#94a3b8" },
} as const

export function GenderIcon({ gioiTinh, size = 34, muted = false }: { gioiTinh: string | null | undefined; size?: number; muted?: boolean }) {
  const kind = genderKind(gioiTinh)
  const c = COLORS[kind]
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className={muted ? "opacity-40" : undefined}>
      <circle cx="20" cy="20" r="19" fill={c.fill} stroke={c.stroke} strokeWidth="1.5" />
      <circle cx="20" cy="15" r="6" fill={c.stroke} />
      {kind === "nu" ? (
        <path d="M11 33 L14.5 23.5 Q20 20.5 25.5 23.5 L29 33 Z" fill={c.stroke} />
      ) : (
        <path d="M10 33 Q10 23 20 23 Q30 23 30 33 Z" fill={c.stroke} />
      )}
    </svg>
  )
}

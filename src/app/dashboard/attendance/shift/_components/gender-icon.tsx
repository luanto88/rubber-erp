// Icon người trên màn điểm danh (A4, 2026-11-27): người đội mũ bảo hộ, cùng phong cách bộ icon Sơ đồ dây chuyền
// (diagram-icons.tsx: viewBox 48, nét #334155 mảnh, da #fef3c7, mũ cam #f59e0b, dây áo phản quang).
// Màu theo giới tính (maintenance_staff.gioi_tinh): xanh dương = nam, hồng = nữ (thêm tóc dài), xám = chưa khai.

export function genderKind(gioiTinh: string | null | undefined): "nam" | "nu" | "khac" {
  const g = (gioiTinh || "").trim().toLowerCase()
  if (g === "nam" || g === "male") return "nam"
  if (g === "nữ" || g === "nu" || g === "female") return "nu"
  return "khac"
}

const COLORS = {
  nam: { bg: "#dbeafe", ring: "#2563eb", shirt: "#93c5fd" },
  nu: { bg: "#fce7f3", ring: "#db2777", shirt: "#f9a8d4" },
  khac: { bg: "#f1f5f9", ring: "#94a3b8", shirt: "#cbd5e1" },
} as const

export function GenderIcon({ gioiTinh, size = 34, muted = false }: { gioiTinh: string | null | undefined; size?: number; muted?: boolean }) {
  const kind = genderKind(gioiTinh)
  const c = COLORS[kind]
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden
      className={muted ? "opacity-40" : undefined}
      fill="none"
      stroke="#334155"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="24" cy="24" r="22.5" fill={c.bg} stroke={c.ring} strokeWidth={1.5} />
      {kind === "nu" ? <path d="M16.6 19.5c-.8 4.6.2 8.2 2.6 10.2M31.4 19.5c.8 4.6-.2 8.2-2.6 10.2" stroke={c.ring} strokeWidth={2.2} /> : null}
      <path d={kind === "nu" ? "M12.5 41.5c.8-6 5.4-10 11.5-10s10.7 4 11.5 10" : "M11.5 41.5c0-6.5 5-10.5 12.5-10.5s12.5 4 12.5 10.5"} fill={c.shirt} />
      <path d="M18.5 31.6l5.5 9.6 5.5-9.6" stroke="#f59e0b" strokeWidth={1.5} />
      <circle cx="24" cy="20.5" r="6.3" fill="#fef3c7" />
      <path d="M16.6 19c0-4.6 3.3-7.7 7.4-7.7s7.4 3.1 7.4 7.7h-14.8z" fill="#f59e0b" />
      <path d="M15.2 19h17.6" />
      <path d="M24 11.3v3" stroke="#fef3c7" strokeWidth={1.1} />
    </svg>
  )
}

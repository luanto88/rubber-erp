export const fmtKg = (v: number) => v.toLocaleString("vi-VN")
export const fmtDate = (d: string) => {
  if (!d) return ""
  if (d.includes("-")) return d.split("-").reverse().join("/")
  return d
}
export const fmtNum = (n: number) => String(n).padStart(2, "0")
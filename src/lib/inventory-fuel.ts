// Nhận diện nhóm vật tư "nhiên liệu / dầu" — chỉ nhóm này mới được bật "Dùng chung bồn dầu".
// Hàm thuần, dùng được ở client lẫn server.
// Quy tắc: mã nhóm bắt đầu "NL", hoặc tên nhóm chứa "nhiên liệu" / "dầu" (giữ dấu: "đầu" KHÔNG khớp).

export function isFuelCategory(cat: { code?: string | null; name?: string | null } | null | undefined): boolean {
  if (!cat) return false
  const code = String(cat.code || "").trim().toUpperCase()
  if (code.startsWith("NL")) return true
  const name = String(cat.name || "").normalize("NFC").toLowerCase()
  return name.includes("nhiên liệu") || /(^|[^\p{L}])dầu([^\p{L}]|$)/u.test(name)
}

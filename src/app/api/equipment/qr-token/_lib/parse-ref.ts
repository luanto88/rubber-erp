import type { EquipmentKind } from "@/lib/equipment-lookup"

const UUID_RE = /^[0-9a-f-]{36}$/i

/** Body `{ assetId }` (máy móc) hoặc `{ vehicleId }` (xe Đội xe, GĐ4a) → tham chiếu. Sai ⇒ null. */
export function parseEquipmentRef(body: unknown): { kind: EquipmentKind; id: string } | null {
  const b = (body || {}) as { assetId?: unknown; vehicleId?: unknown }
  if (typeof b.vehicleId === "string" && UUID_RE.test(b.vehicleId)) return { kind: "vehicle", id: b.vehicleId }
  if (typeof b.assetId === "string" && UUID_RE.test(b.assetId)) return { kind: "asset", id: b.assetId }
  return null
}

/** Body `{ assetIds }` hoặc `{ vehicleIds }` → danh sách id hợp lệ (1 loại / lần gọi). */
export function parseEquipmentRefList(body: unknown): { kind: EquipmentKind; ids: string[] } {
  const b = (body || {}) as { assetIds?: unknown; vehicleIds?: unknown }
  const clean = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && UUID_RE.test(x)) : []
  const vehicleIds = clean(b.vehicleIds)
  if (vehicleIds.length > 0) return { kind: "vehicle", ids: vehicleIds }
  return { kind: "asset", ids: clean(b.assetIds) }
}

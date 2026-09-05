"use client"

import { supabase } from "@/lib/supabase"
import { forceRefreshAuthSession, getFreshAuthSession } from "@/lib/auth"

export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message
    if (typeof msg === "string" && msg) return msg
  }
  return fallback
}

export type GrantCandidate = { id: string; name: string }

export type ExportOrderGrant = {
  id: string
  export_order_id: string
  granted_to_user_id: string
  granted_by: string | null
  created_at: string
}

export type FactoryGrantItem = {
  id: string
  orderId: string
  userId: string
  userName: string
  grantedBy: string | null
  createdAt: string
}

async function callGrantsApi(path: string, options: RequestInit = {}) {
  const session = await getFreshAuthSession()
  let token = session?.access_token || ""
  let res = await fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
    },
  })
  let json = (await res.json().catch(() => null)) as any

  if (!res.ok && json?.code === "session_expired") {
    const freshSession = await forceRefreshAuthSession()
    token = freshSession?.access_token || ""
    res = await fetch(path, {
      ...options,
      headers: {
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    })
    json = (await res.json().catch(() => null)) as any
  }

  return { res, json }
}

export async function fetchGrantCandidates(factoryId: string): Promise<GrantCandidate[]> {
  const { res, json } = await callGrantsApi(
    `/api/export/customer-grant-candidates?factoryId=${encodeURIComponent(factoryId)}`
  )
  if (!res.ok) throw new Error(json?.error || "Không tải được danh sách khách hàng.")
  return (json?.users || []) as GrantCandidate[]
}

export async function fetchFactoryGrants(factoryId: string): Promise<FactoryGrantItem[]> {
  const { res, json } = await callGrantsApi(
    `/api/export/customer-grants?factoryId=${encodeURIComponent(factoryId)}`
  )
  if (res.ok && Array.isArray(json?.grants)) {
    return json.grants as FactoryGrantItem[]
  }

  // Fallback direct Supabase
  const { data, error } = await supabase
    .from("export_order_customer_grants")
    .select("id, export_order_id, granted_to_user_id, granted_by, created_at")
    .eq("factory_id", factoryId)
  if (error) throw error
  return (data || []).map((g) => ({
    id: g.id,
    orderId: g.export_order_id,
    userId: g.granted_to_user_id,
    userName: "Khách hàng",
    grantedBy: g.granted_by,
    createdAt: g.created_at,
  }))
}

export async function fetchExportOrderGrants(orderId: string): Promise<ExportOrderGrant[]> {
  const { data, error } = await supabase
    .from("export_order_customer_grants")
    .select("id, export_order_id, granted_to_user_id, granted_by, created_at")
    .eq("export_order_id", orderId)
  if (error) throw error
  return (data || []) as ExportOrderGrant[]
}

export async function setExportOrderGrants(input: {
  orderId: string
  factoryId: string
  actorId: string
  recipientUserIds: string[]
}) {
  const { res, json } = await callGrantsApi(`/api/export/customer-grants`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

  if (res.ok) {
    return
  }

  // Fallback direct Supabase
  const current = await fetchExportOrderGrants(input.orderId)
  const currentIds = new Set(current.map((g) => g.granted_to_user_id))
  const nextIds = new Set(input.recipientUserIds)

  const toAdd = input.recipientUserIds.filter((id) => !currentIds.has(id))
  const toRemove = current.filter((g) => !nextIds.has(g.granted_to_user_id))

  if (toAdd.length) {
    const { error } = await supabase.from("export_order_customer_grants").insert(
      toAdd.map((uid) => ({
        export_order_id: input.orderId,
        factory_id: input.factoryId,
        granted_to_user_id: uid,
        granted_by: input.actorId,
      })),
    )
    if (error) throw new Error(json?.error || error.message)
  }

  if (toRemove.length) {
    const { error } = await supabase
      .from("export_order_customer_grants")
      .delete()
      .in("id", toRemove.map((g) => g.id))
    if (error) throw new Error(json?.error || error.message)
  }
}

export async function deleteExportOrderGrant(grantId: string, factoryId?: string) {
  const qs = factoryId ? `?id=${encodeURIComponent(grantId)}&factoryId=${encodeURIComponent(factoryId)}` : `?id=${encodeURIComponent(grantId)}`
  const { res, json } = await callGrantsApi(`/api/export/customer-grants${qs}`, {
    method: "DELETE",
  })

  if (res.ok) {
    return
  }

  // Fallback direct Supabase
  const { error } = await supabase
    .from("export_order_customer_grants")
    .delete()
    .eq("id", grantId)

  if (error) throw new Error(json?.error || error.message)
}

"use client"

import type { SupabaseClient } from "@supabase/supabase-js"

export type RequiredNote = {
  id: string
  factory_id: string
  content: string
  sort_order: number
  is_active: boolean
}

export async function loadRequiredNotes(
  supabase: SupabaseClient,
  factoryId: string,
  onlyActive = true,
) {
  let query = supabase
    .from("required_notes")
    .select("id, factory_id, content, sort_order, is_active")
    .eq("factory_id", factoryId)
    .order("sort_order")
    .order("content")

  if (onlyActive) query = query.eq("is_active", true)

  const { data, error } = await query
  if (error) throw error
  return (data || []) as RequiredNote[]
}

export async function createRequiredNote(
  supabase: SupabaseClient,
  factoryId: string,
  content: string,
) {
  const trimmed = content.trim()
  if (!trimmed) throw new Error("Ghi chú không được để trống")

  const { data: existing } = await supabase
    .from("required_notes")
    .select("id, factory_id, content, sort_order, is_active")
    .eq("factory_id", factoryId)
    .ilike("content", trimmed)
    .maybeSingle()

  if (existing) {
    if (!existing.is_active) {
      const { error: updateError } = await supabase
        .from("required_notes")
        .update({ is_active: true })
        .eq("id", existing.id)
        .eq("factory_id", factoryId)
      if (updateError) throw updateError
    }
    return existing as RequiredNote
  }

  const { data: maxRows, error: maxError } = await supabase
    .from("required_notes")
    .select("sort_order")
    .eq("factory_id", factoryId)
    .order("sort_order", { ascending: false })
    .limit(1)

  if (maxError) throw maxError

  const nextSort = Number(maxRows?.[0]?.sort_order || 0) + 1
  const { data, error } = await supabase
    .from("required_notes")
    .insert({
      factory_id: factoryId,
      content: trimmed,
      sort_order: nextSort,
      is_active: true,
    })
    .select("id, factory_id, content, sort_order, is_active")
    .single()

  if (error) throw error
  return data as RequiredNote
}

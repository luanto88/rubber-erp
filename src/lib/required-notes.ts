"use client"

import type { SupabaseClient } from "@supabase/supabase-js"
import { isBlankNoteContent } from "@/lib/note-filter"

export type RequiredNote = {
  id: string
  factory_id: string
  content: string
  sort_order: number
  is_active: boolean
  mo_ta?: string | null
}

export async function loadRequiredNotes(
  supabase: SupabaseClient,
  factoryId: string,
  onlyActive = true,
) {
  let query = supabase
    .from("required_notes")
    .select("*")
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
  moTa?: string,
) {
  const trimmed = content.trim()
  if (isBlankNoteContent(trimmed)) throw new Error("Ký hiệu kỹ thuật không hợp lệ (không được để trống hoặc là số 0)")

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
  const payload: Record<string, unknown> = {
    factory_id: factoryId,
    content: trimmed,
    sort_order: nextSort,
    is_active: true,
  }
  if (moTa?.trim()) payload.mo_ta = moTa.trim()

  const { data, error } = await supabase
    .from("required_notes")
    .insert(payload)
    .select("id, factory_id, content, sort_order, is_active")
    .single()

  if (error) throw error
  return data as RequiredNote
}

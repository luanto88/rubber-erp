import { NextRequest, NextResponse } from "next/server"
import { getSupabaseAdmin } from "@/lib/supabase-admin"

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      factoryId?: string
      loai?: string
      phong_ban?: string
      nam?: number
    }
    const { factoryId, loai, phong_ban, nam } = body
    if (!factoryId || !loai || !phong_ban || !nam) {
      return NextResponse.json({ error: "Thiếu tham số bắt buộc" }, { status: 400 })
    }

    const admin = getSupabaseAdmin()
    const { data, error } = await admin.rpc("get_next_van_ban_so", {
      p_factory_id: factoryId,
      p_loai: loai,
      p_phong_ban: phong_ban,
      p_nam: nam,
    })
    if (error) throw error

    return NextResponse.json({ so: data as number })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { FileText, Upload, PenLine, ClipboardList, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, getFreshAuthSession } from "@/lib/auth"

type NavTab = {
  href: string
  label: string
  icon: LucideIcon
  matchPrefixes?: string[]
  excludePrefixes?: string[]
}

const tabs: NavTab[] = [
  {
    href: "/dashboard/documents",
    label: "Văn bản",
    icon: FileText,
    matchPrefixes: [],
  },
  {
    href: "/dashboard/documents/new",
    label: "Soạn thảo mới",
    icon: PenLine,
    matchPrefixes: ["/dashboard/documents/new"],
    excludePrefixes: ["/dashboard/documents/new/upload"],
  },
  {
    href: "/dashboard/documents/new/upload",
    label: "Upload ký tay",
    icon: Upload,
    matchPrefixes: ["/dashboard/documents/new/upload"],
  },
  {
    href: "/dashboard/documents/my-tasks",
    label: "Việc của tôi",
    icon: ClipboardList,
    matchPrefixes: ["/dashboard/documents/my-tasks"],
  },
]

function isActive(pathname: string, tab: NavTab) {
  if (tab.excludePrefixes?.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return false
  }
  if (tab.matchPrefixes && tab.matchPrefixes.length > 0) {
    return tab.matchPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  }
  return pathname === tab.href
}

type DocumentsShellProps = {
  children?: ReactNode
}

type ThuTuKyStepLite = { step: number; type: "phong_ban" | "ca_nhan"; phong_ban_code?: string; user_id?: string }
type VanBanTaskRow = {
  trang_thai: string
  thu_tu_ky_json: ThuTuKyStepLite[] | null
  buoc_hien_tai: number
  soan_thao_user_id: string | null
  phe_duyet_user_id: string | null
}

export function DocumentsShell({ children }: DocumentsShellProps) {
  const pathname = usePathname()
  // Badge "Việc của tôi" — mirror IsoShell (pendingTaskCount), trước đây module Văn bản
  // hoàn toàn không có badge này dù trang my-tasks/chuông thông báo đã tính đúng.
  const [pendingTaskCount, setPendingTaskCount] = useState(0)

  useEffect(() => {
    let alive = true
    let channel: ReturnType<typeof supabase.channel> | null = null

    const loadPendingTasks = async () => {
      const fid = await getActiveFactoryId()
      const session = await getFreshAuthSession()
      const uid = session?.user?.id
      if (!fid || !uid) {
        if (alive) setPendingTaskCount(0)
        return
      }

      // role + deptCode — cần cho đúng điều kiện đếm "cần ký phòng ban" (mirror
      // getDocumentsTasks trong _components/module-tasks.ts)
      let isAdmin = false
      try {
        const { data: profile } = await supabase.from("profiles").select("role").eq("id", uid).maybeSingle()
        isAdmin = (profile as { role?: string } | null)?.role === "admin"
      } catch { /* ignore */ }

      let deptCode: string | null = null
      if (!isAdmin) {
        try {
          const token = session?.access_token || ""
          const res = await fetch(`/api/documents/dept-code?userId=${uid}`, {
            headers: { Authorization: `Bearer ${token}` },
          })
          if (res.ok) deptCode = ((await res.json()) as { code: string | null }).code
        } catch { /* ignore */ }
      }

      const { data } = await supabase
        .from("van_ban_documents")
        .select("trang_thai, thu_tu_ky_json, buoc_hien_tai, soan_thao_user_id, phe_duyet_user_id")
        .eq("factory_id", fid)
        .in("trang_thai", ["draft", "cho_ky_phong_ban", "cho_phe_duyet", "tra_ve"])

      let count = 0
      for (const doc of ((data || []) as VanBanTaskRow[])) {
        if (doc.trang_thai === "draft" || doc.trang_thai === "tra_ve") {
          if (isAdmin || doc.soan_thao_user_id === uid) count++
          continue
        }
        if (doc.trang_thai === "cho_ky_phong_ban") {
          const step = (doc.thu_tu_ky_json || [])[doc.buoc_hien_tai]
          const match =
            isAdmin ||
            (step?.type === "phong_ban" && deptCode === step.phong_ban_code) ||
            (step?.type === "ca_nhan" && step.user_id === uid)
          if (match) count++
          continue
        }
        if (doc.trang_thai === "cho_phe_duyet" && (isAdmin || doc.phe_duyet_user_id === uid)) count++
      }
      if (alive) setPendingTaskCount(count)

      if (!alive || channel) return
      channel = supabase
        .channel(`vanban-task-count-${fid}-${uid}-${Date.now()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "van_ban_documents", filter: `factory_id=eq.${fid}` }, () => {
          void loadPendingTasks()
        })
        .subscribe()
    }

    void loadPendingTasks()

    return () => {
      alive = false
      if (channel) void supabase.removeChannel(channel)
    }
  }, [])

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex gap-1 p-2 overflow-x-auto">
          {tabs.map((tab) => {
            const active = isActive(pathname, tab)
            const Icon = tab.icon
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={
                  "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all " +
                  (active
                    ? "bg-blue-50 text-blue-700"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700")
                }
              >
                <Icon size={15} />
                <span>{tab.label}</span>
                {tab.href === "/dashboard/documents/my-tasks" && pendingTaskCount > 0 && (
                  <span className="ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-extrabold leading-none text-white">
                    {pendingTaskCount > 99 ? "99+" : pendingTaskCount}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      </div>
      {children}
    </div>
  )
}

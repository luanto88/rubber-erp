"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { FileText, LayoutDashboard, ClipboardCheck, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, getFreshAuthSession } from "@/lib/auth"

type NavTab = {
  href: string
  label: string
  icon: LucideIcon
  matchPrefixes?: string[]
}

const tabs: NavTab[] = [
  {
    href: "/dashboard/iso",
    label: "Tổng quan",
    icon: LayoutDashboard,
    matchPrefixes: [],
  },
  {
    href: "/dashboard/iso/documents",
    label: "Tài liệu ISO",
    icon: FileText,
    matchPrefixes: ["/dashboard/iso/documents"],
  },
  {
    href: "/dashboard/iso/my-tasks",
    label: "Việc của tôi",
    icon: ClipboardCheck,
    matchPrefixes: ["/dashboard/iso/my-tasks"],
  },
]

function isActive(pathname: string, tab: NavTab) {
  if (tab.matchPrefixes && tab.matchPrefixes.length > 0) {
    return tab.matchPrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  }
  return pathname === tab.href
}

type IsoShellProps = {
  children?: ReactNode
}

export function IsoShell({ children }: IsoShellProps) {
  const pathname = usePathname()
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

      const { data } = await supabase
        .from("iso_documents")
        .select("id, parent_doc_id, trang_thai, xem_xet_user_id, phe_duyet_user_id, soan_thao_user_id")
        .eq("factory_id", fid)
        .or(`xem_xet_user_id.eq.${uid},phe_duyet_user_id.eq.${uid},soan_thao_user_id.eq.${uid}`)
        .in("trang_thai", ["cho_xem_xet", "cho_phe_duyet", "bi_tu_choi_phe_duyet", "tra_ve"])

      const taskKeys = new Set<string>()
      ;(data || []).filter((doc) =>
        (doc.trang_thai === "cho_xem_xet" && doc.xem_xet_user_id === uid) ||
        (doc.trang_thai === "cho_phe_duyet" && doc.phe_duyet_user_id === uid) ||
        (doc.trang_thai === "bi_tu_choi_phe_duyet" && doc.xem_xet_user_id === uid) ||
        (doc.trang_thai === "tra_ve" && doc.soan_thao_user_id === uid)
      ).forEach((doc) => {
        taskKeys.add(doc.parent_doc_id || doc.id)
      })
      if (alive) setPendingTaskCount(taskKeys.size)

      if (!channel) {
        channel = supabase
          .channel(`iso-task-count-${fid}-${uid}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "iso_documents", filter: `factory_id=eq.${fid}` }, () => {
            void loadPendingTasks()
          })
          .subscribe()
      }
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
                    ? "bg-violet-50 text-violet-700"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700")
                }
              >
                <Icon size={15} />
                <span>{tab.label}</span>
                {tab.href === "/dashboard/iso/my-tasks" && pendingTaskCount > 0 && (
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

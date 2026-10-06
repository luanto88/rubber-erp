"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { FileText, LayoutDashboard, ClipboardCheck, FolderEdit, Archive, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, getFreshAuthSession } from "@/lib/auth"
import { stepSignerUserId, type ThuTuKyStep } from "@/app/dashboard/iso/_components/iso-types"
import { canSeeIsoOverview, canViewIsoLibrary, readCachedIsoUser } from "@/app/dashboard/iso/_components/iso-access"
import type { SessionUser } from "@/lib/auth"

type NavTab = {
  href: string
  label: string
  icon: LucideIcon
  matchPrefixes?: string[]
  /** GĐ3: điều kiện hiện tab (bảng B). Không khai báo = luôn hiện (layout đã đảm bảo iso.view). */
  visible?: (user: SessionUser | null) => boolean
}

const tabs: NavTab[] = [
  {
    href: "/dashboard/iso",
    label: "Tổng quan",
    icon: LayoutDashboard,
    matchPrefixes: [],
    visible: canSeeIsoOverview,
  },
  {
    href: "/dashboard/iso/documents",
    label: "Tài liệu ISO",
    icon: FileText,
    matchPrefixes: ["/dashboard/iso/documents"],
    visible: canViewIsoLibrary,
  },
  {
    href: "/dashboard/iso/my-tasks",
    label: "Việc của tôi",
    icon: ClipboardCheck,
    matchPrefixes: ["/dashboard/iso/my-tasks"],
  },
  {
    href: "/dashboard/iso/forms",
    label: "Thực hiện hồ sơ",
    icon: FolderEdit,
    matchPrefixes: ["/dashboard/iso/forms"],
  },
  {
    href: "/dashboard/iso/kho",
    label: "Kho của tôi",
    icon: Archive,
    matchPrefixes: ["/dashboard/iso/kho"],
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
  // Đọc quyền sau khi mount (localStorage không có ở SSR). Trước đó chỉ hiện các tab cơ bản.
  const [user, setUser] = useState<SessionUser | null>(null)
  const [userLoaded, setUserLoaded] = useState(false)

  useEffect(() => {
    // Đọc trong microtask (không setState đồng bộ trong effect — rule react-hooks).
    let alive = true
    void Promise.resolve().then(() => {
      if (!alive) return
      setUser(readCachedIsoUser())
      setUserLoaded(true)
    })
    return () => { alive = false }
  }, [])

  const visibleTabs = tabs.filter((tab) => !tab.visible || (userLoaded && tab.visible(user)))

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

      const [{ data: docData }, { data: formData }] = await Promise.all([
        supabase
          .from("iso_documents")
          .select("id, parent_doc_id, trang_thai, xem_xet_user_id, phe_duyet_user_id, soan_thao_user_id")
          .eq("factory_id", fid)
          .or(`xem_xet_user_id.eq.${uid},phe_duyet_user_id.eq.${uid},soan_thao_user_id.eq.${uid}`)
          .in("trang_thai", ["cho_xem_xet", "cho_phe_duyet", "bi_tu_choi_phe_duyet", "tra_ve"]),
        supabase
          .from("iso_form_instances")
          .select("id, trang_thai, nguoi_tao, xem_xet_user_id, phe_duyet_user_id, so_buoc_tong, buoc_hien_tai, thu_tu_ky_json")
          .eq("factory_id", fid)
          .in("trang_thai", ["draft", "cho_xem_xet", "cho_phe_duyet", "tra_ve"]),
      ])

      const taskKeys = new Set<string>()
      ;(docData || []).filter((doc) =>
        (doc.trang_thai === "cho_xem_xet" && doc.xem_xet_user_id === uid) ||
        (doc.trang_thai === "cho_phe_duyet" && doc.phe_duyet_user_id === uid) ||
        (doc.trang_thai === "bi_tu_choi_phe_duyet" && doc.xem_xet_user_id === uid) ||
        (doc.trang_thai === "tra_ve" && doc.soan_thao_user_id === uid)
      ).forEach((doc) => {
        taskKeys.add(doc.parent_doc_id || doc.id)
      })

      type FormRow = {
        trang_thai: string
        nguoi_tao: string | null
        xem_xet_user_id: string | null
        phe_duyet_user_id: string | null
        so_buoc_tong?: number | null
        buoc_hien_tai?: number | null
        thu_tu_ky_json?: ThuTuKyStep[] | null
      }
      const formCount = ((formData || []) as FormRow[]).filter((inst) => {
        if ((inst.so_buoc_tong ?? 0) > 0 && Array.isArray(inst.thu_tu_ky_json)) {
          const firstStep = inst.thu_tu_ky_json[0]
          const firstUid = firstStep ? stepSignerUserId(firstStep) : null
          if (inst.trang_thai === "tra_ve") return inst.nguoi_tao === uid || firstUid === uid
          if (inst.trang_thai === "draft") return inst.nguoi_tao === uid || firstUid === uid
          const curStep = inst.thu_tu_ky_json[inst.buoc_hien_tai ?? 0]
          const curUid = curStep ? stepSignerUserId(curStep) : null
          return curUid === uid
        }
        if (inst.trang_thai === "draft") return inst.nguoi_tao === uid
        if (inst.trang_thai === "cho_xem_xet") return inst.xem_xet_user_id === uid
        if (inst.trang_thai === "cho_phe_duyet") return inst.phe_duyet_user_id === uid
        if (inst.trang_thai === "tra_ve") return true
        return false
      }).length

      if (alive) setPendingTaskCount(taskKeys.size + formCount)

      if (!alive || channel) return
      channel = supabase
        .channel(`iso-task-count-${fid}-${uid}-${Date.now()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "iso_documents", filter: `factory_id=eq.${fid}` }, () => {
          void loadPendingTasks()
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "iso_form_instances", filter: `factory_id=eq.${fid}` }, () => {
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
          {visibleTabs.map((tab) => {
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

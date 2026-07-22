"use client"

import Link from "next/link"
import {
  Activity,
  BarChart3,
  ClipboardCheck,
  FileOutput,
  FileText,
  Map,
  NotebookPen,
  Package,
  Settings,
  Shield,
  Truck,
  Warehouse,
  Wrench,
} from "lucide-react"
import { hasPermission, type SessionUser } from "@/lib/auth"

// Danh sách lối tắt module chính — không import NAV từ layout.tsx (const đó không
// export và gắn với UI sidebar, không nên coupling vào đây).
const MODULES: { label: string; path: string; icon: typeof Package; permission?: string }[] = [
  { label: "Điều xe", path: "/dashboard/dispatch", icon: Truck, permission: "dispatch.view" },
  { label: "Sản lượng", path: "/dashboard/output", icon: BarChart3, permission: "output.view" },
  { label: "Kho nguyên liệu", path: "/dashboard/storage", icon: Warehouse, permission: "storage.view" },
  { label: "Quản lý kho", path: "/dashboard/inventory", icon: Warehouse, permission: "inventory.view" },
  { label: "Thành phẩm", path: "/dashboard/product", icon: Package, permission: "product.view" },
  { label: "Kho thành phẩm", path: "/dashboard/warehouse", icon: Warehouse, permission: "warehouse.view" },
  { label: "Chất lượng", path: "/dashboard/quality", icon: ClipboardCheck, permission: "quality.view" },
  { label: "Xuất hàng", path: "/dashboard/export", icon: FileOutput, permission: "export.view" },
  { label: "Bảo trì", path: "/dashboard/maintenance", icon: Wrench, permission: "maintenance.view" },
  { label: "Kiểm soát quá trình", path: "/dashboard/process", icon: Activity, permission: "process.view" },
  { label: "Quản lý ISO", path: "/dashboard/iso", icon: FileText, permission: "iso.view" },
  { label: "Văn bản nội bộ", path: "/dashboard/documents", icon: FileOutput, permission: "documents.view" },
  { label: "Ghi chú nhanh", path: "/dashboard/notes", icon: NotebookPen, permission: "notes.view" },
  { label: "Bản đồ lô", path: "/dashboard/map", icon: Map },
  { label: "EUDR / Truy xuất", path: "/dashboard/eudr", icon: Shield },
  { label: "Cài đặt", path: "/dashboard/settings", icon: Settings, permission: "settings.view" },
]

export function ModuleLauncherFallback({
  user,
  factoryName,
}: {
  user: SessionUser | null
  factoryName: string
}) {
  const available = MODULES.filter((m) => !m.permission || hasPermission(user, m.permission))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-800">Chọn module</h1>
        <p className="text-sm text-slate-500 mt-1">
          {factoryName || "—"} · Tài khoản của bạn chưa được cấp quyền xem Bảng điều khiển tổng hợp.
          Chọn module bên dưới để tiếp tục làm việc, hoặc liên hệ quản trị viên để được cấp thêm quyền.
        </p>
      </div>

      {available.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-8 text-center text-slate-400 text-sm">
          Tài khoản của bạn hiện chưa được cấp quyền truy cập module nào. Vui lòng liên hệ quản trị viên.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {available.map((m) => (
            <Link
              key={m.path}
              href={m.path}
              className="flex flex-col items-center gap-3 bg-white rounded-2xl border border-slate-200 shadow-md p-5 hover:shadow-lg hover:border-emerald-300 transition-all group"
            >
              <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center group-hover:bg-emerald-100 transition-colors">
                <m.icon size={20} className="text-emerald-600" />
              </div>
              <span className="text-sm font-bold text-slate-700 text-center">{m.label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

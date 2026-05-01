"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useState } from "react"
import { supabase } from "@/lib/supabase"
import {
  DEFAULT_PERMISSION_CODES,
  ROLE_DEFAULTS,
  getActiveFactoryId,
  hasPermission,
  hydrateActiveSession,
  type AppRole,
  type SessionUser,
} from "@/lib/auth"
import {
  Plus,
  Edit2,
  Trash2,
  X,
  Tag,
  AlertTriangle,
  Building2,
  Save,
  Users,
  ShieldCheck,
  Lock,
  CheckCircle2,
  UserCheck,
  SlidersHorizontal,
  Database,
  Warehouse,
  Boxes,
  Beaker,
  Ruler,
  ArrowUpRight,
} from "lucide-react"

type Suffix = {
  code: string
  name: string
  nguon: string
  chung_nhan: string
  factory_id: string
}

type SuffixForm = {
  code: string
  name: string
  nguon: string
  chung_nhan: string
}

type FactoryInfo = {
  full_name_en: string
  address_en: string
  contact_person: string
  contact_email: string
  website: string
  country_en: string
}

type FactoryOption = {
  id: string
  name: string
}

type ProfileRow = {
  id: string
  username: string
  full_name: string
  factory_id: string | null
  department: string | null
  role: AppRole
  status: "pending" | "active" | "disabled"
  approved_by: string | null
  approved_at: string | null
  disabled_by: string | null
  disabled_at: string | null
}

type PermissionOption = {
  code: string
  label: string
  module_name: string
  action_name: string
}

type UserEditor = {
  userId: string
  username: string
  fullName: string
  factoryId: string
  role: AppRole
  permissions: string[]
  mode: "approve" | "edit"
}

type SettingsTab = "company" | "users" | "permissions" | "factory-config" | "master-data"

const SYSTEM_CODES = ["cs", "m"]

function emptyForm(): SuffixForm {
  return { code: "", name: "", nguon: "", chung_nhan: "" }
}

function emptyFactoryInfo(): FactoryInfo {
  return {
    full_name_en: "",
    address_en: "",
    contact_person: "",
    contact_email: "",
    website: "",
    country_en: "",
  }
}

function labelPermission(code: string) {
  const [moduleName = "", actionName = ""] = code.split(".")
  return {
    code,
    module_name: moduleName,
    action_name: actionName,
    label: `${moduleName} · ${actionName}`,
  }
}

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("company")
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [suffixes, setSuffixes] = useState<Suffix[]>([])
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState<ProfileRow[]>([])
  const [permissionOptions, setPermissionOptions] = useState<PermissionOption[]>([])
  const [factories, setFactories] = useState<FactoryOption[]>([])

  const [factoryInfo, setFactoryInfo] = useState<FactoryInfo>(emptyFactoryInfo())
  const [savingFactory, setSavingFactory] = useState(false)
  const [factoryMsg, setFactoryMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const [modal, setModal] = useState<"add" | "edit" | null>(null)
  const [form, setForm] = useState<SuffixForm>(emptyForm())
  const [editCode, setEditCode] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [delConfirm, setDelConfirm] = useState<string | null>(null)
  const [error, setError] = useState("")

  const [userEditor, setUserEditor] = useState<UserEditor | null>(null)
  const [savingUser, setSavingUser] = useState(false)
  const [userError, setUserError] = useState("")

  const canManageSettings = hasPermission(user, "settings.manage_config")
  const canViewUsers = hasPermission(user, "users.view")
  const canApproveUsers = hasPermission(user, "users.approve")
  const canEditPermissions = hasPermission(user, "users.edit_permission")

  const loadSuffixes = useCallback(async (fid: string) => {
    const { data } = await supabase.from("suffixes").select("*").eq("factory_id", fid).order("code")
    setSuffixes(data || [])
  }, [])

  const loadProfiles = useCallback(async (fid: string) => {
    const { data } = await supabase
      .from("profiles")
      .select(
        "id, username, full_name, factory_id, department, role, status, approved_by, approved_at, disabled_by, disabled_at",
      )
      .eq("factory_id", fid)
      .order("status")
      .order("username")

    setProfiles((data || []) as ProfileRow[])
  }, [])

  const loadPermissions = useCallback(async () => {
    const { data, error } = await supabase
      .from("permissions")
      .select("code, module_name, action_name")
      .order("module_name")
      .order("action_name")

    if (error || !data?.length) {
      setPermissionOptions(DEFAULT_PERMISSION_CODES.map(labelPermission))
      return
    }

    setPermissionOptions(
      data.map((item) => ({
        code: item.code,
        module_name: item.module_name,
        action_name: item.action_name,
        label: `${item.module_name} · ${item.action_name}`,
      })),
    )
  }, [])

  const bootstrap = useCallback(async () => {
    const fid = await getActiveFactoryId()
    if (!fid) {
      setLoading(false)
      return
    }

    const { user: sessionUser } = await hydrateActiveSession()
    if (!sessionUser) {
      setLoading(false)
      return
    }

    setFactoryId(fid)
    setUser(sessionUser)

    await Promise.all([
      loadSuffixes(fid),
      loadProfiles(fid),
      loadPermissions(),
      supabase
        .from("factories")
        .select("id, name, full_name_en, address_en, contact_person, contact_email, website, country_en")
        .order("name")
        .then(({ data }) => {
          const rows = data || []
          setFactories(rows.map((item) => ({ id: item.id, name: item.name })))
          const ownFactory = rows.find((item) => item.id === fid)
          if (ownFactory) {
            setFactoryInfo({
              full_name_en: ownFactory.full_name_en || "",
              address_en: ownFactory.address_en || "",
              contact_person: ownFactory.contact_person || "",
              contact_email: ownFactory.contact_email || "",
              website: ownFactory.website || "",
              country_en: ownFactory.country_en || "",
            })
          }
        }),
    ])

    setLoading(false)
  }, [loadPermissions, loadProfiles, loadSuffixes])

  useEffect(() => {
    bootstrap()
  }, [bootstrap])

  const groupedPermissions = useMemo(() => {
    return permissionOptions.reduce<Record<string, PermissionOption[]>>((acc, item) => {
      acc[item.module_name] = acc[item.module_name] || []
      acc[item.module_name].push(item)
      return acc
    }, {})
  }, [permissionOptions])

  const handleSaveFactory = async () => {
    if (!factoryId || !canManageSettings) return
    setSavingFactory(true)
    setFactoryMsg(null)
    const { error: err } = await supabase.from("factories").update(factoryInfo).eq("id", factoryId)
    setSavingFactory(false)
    setFactoryMsg(err ? { ok: false, text: err.message } : { ok: true, text: "Da luu thong tin cong ty" })
    setTimeout(() => setFactoryMsg(null), 3000)
  }

  const openAdd = () => {
    setForm(emptyForm())
    setEditCode(null)
    setError("")
    setModal("add")
  }

  const openEdit = (s: Suffix) => {
    setForm({ code: s.code, name: s.name, nguon: s.nguon, chung_nhan: s.chung_nhan })
    setEditCode(s.code)
    setError("")
    setModal("edit")
  }

  const handleSave = async () => {
    if (!factoryId) return
    setError("")

    if (!form.code.trim()) {
      setError("Ma hau to khong duoc de trong")
      return
    }
    if (!form.name.trim()) {
      setError("Tên không được để trống")
      return
    }
    if (!/^[a-z0-9]+$/.test(form.code.trim())) {
      setError("Ma hau to chi duoc dung chu thuong va so")
      return
    }

    setSaving(true)
    try {
      if (modal === "add") {
        const { error: err } = await supabase.from("suffixes").insert({
          ...form,
          code: form.code.trim().toLowerCase(),
          factory_id: factoryId,
        })
        if (err) {
          setError(err.message)
          return
        }
      } else if (modal === "edit" && editCode) {
        const { error: err } = await supabase
          .from("suffixes")
          .update({ name: form.name, nguon: form.nguon, chung_nhan: form.chung_nhan })
          .eq("code", editCode)
          .eq("factory_id", factoryId)
        if (err) {
          setError(err.message)
          return
        }
      }
      setModal(null)
      await loadSuffixes(factoryId)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (code: string) => {
    if (!factoryId) return
    await supabase.from("suffixes").delete().eq("code", code).eq("factory_id", factoryId)
    setDelConfirm(null)
    await loadSuffixes(factoryId)
  }

  const loadUserPermissionCodes = async (userId: string) => {
    const { data } = await supabase
      .from("user_permissions")
      .select("permissions(code)")
      .eq("user_id", userId)
      .eq("granted", true)

    return (data || [])
      .map((row) => {
        const permission = Array.isArray(row.permissions) ? row.permissions[0] : row.permissions
        return permission?.code || ""
      })
      .filter(Boolean)
  }

  const openApproveModal = async (profile: ProfileRow) => {
    const selected = await loadUserPermissionCodes(profile.id)
    const fallback = selected.length ? selected : ROLE_DEFAULTS[profile.role] || []

    setUserError("")
    setUserEditor({
      userId: profile.id,
      username: profile.username,
      fullName: profile.full_name,
      factoryId: profile.factory_id || factoryId || "",
      role: profile.role,
      permissions: fallback,
      mode: "approve",
    })
  }

  const openEditUserModal = async (profile: ProfileRow) => {
    const selected = await loadUserPermissionCodes(profile.id)

    setUserError("")
    setUserEditor({
      userId: profile.id,
      username: profile.username,
      fullName: profile.full_name,
      factoryId: profile.factory_id || factoryId || "",
      role: profile.role,
      permissions: selected.length ? selected : ROLE_DEFAULTS[profile.role] || [],
      mode: "edit",
    })
  }

  const togglePermission = (code: string) => {
    if (!userEditor) return
    const exists = userEditor.permissions.includes(code)
    setUserEditor({
      ...userEditor,
      permissions: exists
        ? userEditor.permissions.filter((item) => item !== code)
        : [...userEditor.permissions, code].sort(),
    })
  }

  const handleRoleChange = (role: AppRole) => {
    if (!userEditor) return
    setUserEditor({
      ...userEditor,
      role,
      permissions: ROLE_DEFAULTS[role] || [],
    })
  }

  const saveUserApproval = async () => {
    if (!userEditor || !user) return
    if (!userEditor.factoryId) {
      setUserError("Vui long chon nha may")
      return
    }
    if (userEditor.permissions.length === 0) {
      setUserError("Vui long chon it nhat 1 permission")
      return
    }

    setSavingUser(true)
    setUserError("")

    try {
      const profilePatch =
        userEditor.mode === "approve"
          ? {
              factory_id: userEditor.factoryId,
              role: userEditor.role,
              status: "active",
              approved_by: user.id,
              approved_at: new Date().toISOString(),
              disabled_by: null,
              disabled_at: null,
            }
          : {
              factory_id: userEditor.factoryId,
              role: userEditor.role,
            }

      const { error: profileError } = await supabase
        .from("profiles")
        .update(profilePatch)
        .eq("id", userEditor.userId)

      if (profileError) {
        setUserError(profileError.message)
        return
      }

      const { error: deleteError } = await supabase
        .from("user_permissions")
        .delete()
        .eq("user_id", userEditor.userId)

      if (deleteError) {
        setUserError(deleteError.message)
        return
      }

      const rows = userEditor.permissions.map((code) => ({
        user_id: userEditor.userId,
        permission_code: code,
        granted: true,
        granted_by: user.id,
        granted_at: new Date().toISOString(),
      }))

      const { error: permissionError } = await supabase.from("user_permissions").insert(rows)
      if (permissionError) {
        setUserError(permissionError.message)
        return
      }

      setUserEditor(null)
      if (factoryId) await loadProfiles(factoryId)
    } finally {
      setSavingUser(false)
    }
  }

  const disableUser = async (profile: ProfileRow) => {
    if (!user || !canApproveUsers) return
    const { error } = await supabase
      .from("profiles")
      .update({
        status: "disabled",
        disabled_by: user.id,
        disabled_at: new Date().toISOString(),
      })
      .eq("id", profile.id)

    if (!error && factoryId) await loadProfiles(factoryId)
  }

  const pendingUsers = profiles.filter((item) => item.status === "pending")
  const activeUsers = profiles.filter((item) => item.status === "active")
  const disabledUsers = profiles.filter((item) => item.status === "disabled")

  const tabs = [
    { key: "company" as const, label: "Công ty", icon: Building2, show: true },
    { key: "users" as const, label: "Người dùng", icon: Users, show: canViewUsers },
    { key: "permissions" as const, label: "Phân quyền", icon: ShieldCheck, show: canViewUsers || canEditPermissions },
    { key: "factory-config" as const, label: "Cấu hình nhà máy", icon: SlidersHorizontal, show: canManageSettings },
    { key: "master-data" as const, label: "Danh mục", icon: Database, show: true },
  ].filter((item) => item.show)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Cài đặt</h1>
          <p className="text-sm text-slate-500 mt-0.5">Quản trị cấu hình, người dùng và phân quyền</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-2">
        <div className="flex flex-wrap gap-2">
          {tabs.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={
                "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all " +
                (tab === item.key
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                  : "bg-white text-slate-600 border-transparent hover:bg-slate-50")
              }
            >
              <item.icon size={15} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === "company" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
        <div className="bg-gradient-to-r from-violet-50 to-purple-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 size={16} className="text-violet-600" />
            <span className="font-extrabold text-slate-700">Thông tin công ty (EUDR Seller)</span>
          </div>
          {canManageSettings && (
            <button
              onClick={handleSaveFactory}
              disabled={savingFactory}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all disabled:opacity-50"
            >
              <Save size={13} /> {savingFactory ? "Đang lưu..." : "Lưu thông tin"}
            </button>
          )}
        </div>

        <div className="p-5">
          {factoryMsg && (
            <div
              className={`mb-4 px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 ${
                factoryMsg.ok
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-red-50 text-red-600 border border-red-200"
              }`}
            >
              {factoryMsg.ok ? <Save size={14} /> : <AlertTriangle size={14} />} {factoryMsg.text}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "Ten cong ty (tieng Anh)", field: "full_name_en", colSpan: true },
              { label: "Dia chi", field: "address_en", colSpan: true },
              { label: "Nguoi lien he", field: "contact_person", colSpan: false },
              { label: "Email", field: "contact_email", colSpan: false },
              { label: "Website", field: "website", colSpan: false },
              { label: "Quoc gia", field: "country_en", colSpan: false },
            ].map(({ label, field, colSpan }) => (
              <div key={field} className={colSpan ? "col-span-2" : ""}>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">{label}</label>
                <input
                  value={factoryInfo[field as keyof FactoryInfo]}
                  onChange={(e) => setFactoryInfo((prev) => ({ ...prev, [field]: e.target.value }))}
                  disabled={!canManageSettings}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
            ))}
          </div>
        </div>
      </div>
      )}

      {tab === "users" && canViewUsers && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
          <div className="bg-gradient-to-r from-blue-50 to-cyan-50 px-6 py-4 border-b border-slate-200 flex items-center gap-2">
            <Users size={16} className="text-blue-600" />
            <span className="font-extrabold text-slate-700">Người dùng và phê duyệt</span>
          </div>

          <div className="p-5 space-y-6">
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: "Cho duyet", value: pendingUsers.length, tone: "amber" },
                { label: "Đang hoạt động", value: activeUsers.length, tone: "emerald" },
                { label: "Da khoa", value: disabledUsers.length, tone: "red" },
              ].map((item) => (
                <div key={item.label} className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <div className="text-xs text-slate-500">{item.label}</div>
                  <div className="text-2xl font-black text-slate-800 mt-1">{item.value}</div>
                </div>
              ))}
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <UserCheck size={15} className="text-amber-600" />
                <h2 className="font-bold text-slate-800">Tai khoan cho duyet</h2>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Username", "Ho ten", "Phong ban", "Role", "Trang thai", ""].map((head) => (
                        <th key={head} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {pendingUsers.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                          Không có tài khoản chờ duyệt
                        </td>
                      </tr>
                    ) : (
                      pendingUsers.map((profile) => (
                        <tr key={profile.id} className="row-hover">
                          <td className="px-4 py-3 font-mono text-slate-700">{profile.username}</td>
                          <td className="px-4 py-3 font-semibold text-slate-800">{profile.full_name}</td>
                          <td className="px-4 py-3 text-slate-500">{profile.department || "—"}</td>
                          <td className="px-4 py-3 text-slate-500">{profile.role}</td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-700">
                              pending
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {canApproveUsers && (
                              <button
                                onClick={() => openApproveModal(profile)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg"
                              >
                                <CheckCircle2 size={13} />
                                Duyet
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck size={15} className="text-emerald-600" />
                <h2 className="font-bold text-slate-800">Tai khoan dang hoat dong</h2>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {["Username", "Ho ten", "Role", "Trang thai", "Phe duyet luc", ""].map((head) => (
                        <th key={head} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                          {head}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {activeUsers.map((profile) => (
                      <tr key={profile.id} className="row-hover">
                        <td className="px-4 py-3 font-mono text-slate-700">{profile.username}</td>
                        <td className="px-4 py-3 font-semibold text-slate-800">{profile.full_name}</td>
                        <td className="px-4 py-3 text-slate-500">{profile.role}</td>
                        <td className="px-4 py-3">
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                            active
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {profile.approved_at ? new Date(profile.approved_at).toLocaleString("vi-VN") : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {canEditPermissions && (
                              <button
                                onClick={() => openEditUserModal(profile)}
                                className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"
                              >
                                <Edit2 size={13} />
                              </button>
                            )}
                            {canApproveUsers && (
                              <button
                                onClick={() => disableUser(profile)}
                                className="p-1.5 hover:bg-red-50 text-red-500 rounded-lg transition-colors"
                              >
                                <Lock size={13} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "permissions" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
          <div className="bg-gradient-to-r from-indigo-50 to-sky-50 px-6 py-4 border-b border-slate-200 flex items-center gap-2">
            <ShieldCheck size={16} className="text-indigo-600" />
            <span className="font-extrabold text-slate-700">Phân quyền</span>
          </div>

          <div className="p-5 space-y-5">
            <div className="text-sm text-slate-500">
              Khu nay se la noi quan tri tap trung quyen theo module va action. Hien tai quyen dang duoc gan trong modal duyet user,
              va danh sach permission he thong da duoc tai san.
            </div>

            <div className="grid grid-cols-2 gap-4">
              {Object.entries(groupedPermissions).map(([moduleName, options]) => (
                <div key={moduleName} className="border border-slate-200 rounded-xl p-4">
                  <div className="font-bold text-slate-800 mb-3">{moduleName}</div>
                  <div className="flex flex-wrap gap-2">
                    {options.map((option) => (
                      <span
                        key={option.code}
                        className="px-2 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700"
                      >
                        {option.action_name}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "factory-config" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 px-6 py-4 border-b border-slate-200 flex items-center gap-2">
            <SlidersHorizontal size={16} className="text-amber-600" />
            <span className="font-extrabold text-slate-700">Cấu hình nhà máy</span>
          </div>

          <div className="p-5 space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
              Tại đây quản trị các cấu hình riêng theo nhà máy. Với module kho, danh mục kho, nhóm vật tư, vật tư hóa chất và định mức tiêu hao phải được mở từ khu vực này để giữ đúng quy ước toàn hệ thống.
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {[
                {
                  title: "Kho vật tư / hóa chất",
                  note: "Quản lý mã kho, tên kho, thủ kho và trạng thái hoạt động theo từng nhà máy.",
                  href: "/dashboard/inventory/settings?tab=warehouses",
                  icon: Warehouse,
                },
                {
                  title: "Nhóm vật tư",
                  note: "Phân loại vật tư để dùng cho nhập xuất tồn, thống kê và cảnh báo tồn kho.",
                  href: "/dashboard/inventory/settings?tab=categories",
                  icon: Boxes,
                },
                {
                  title: "Vật tư / hóa chất",
                  note: "Cấu hình kho chứa, quản lý số lô, hạn sử dụng và giới hạn tồn min-max.",
                  href: "/dashboard/inventory/settings?tab=items",
                  icon: Beaker,
                },
                {
                  title: "Định mức tiêu hao",
                  note: "Quản lý định mức theo thành phẩm để phục vụ báo cáo tháng và đối chiếu thực tế.",
                  href: "/dashboard/inventory/settings?tab=norms",
                  icon: Ruler,
                },
              ].map((entry) => (
                <Link
                  key={entry.title}
                  href={entry.href}
                  className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-700">
                      <entry.icon size={18} />
                    </div>
                    <ArrowUpRight size={16} className="text-slate-300 transition-colors group-hover:text-emerald-600" />
                  </div>
                  <div className="mt-4 text-base font-extrabold text-slate-800">{entry.title}</div>
                  <div className="mt-2 text-sm leading-6 text-slate-500">{entry.note}</div>
                </Link>
              ))}
            </div>

            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
              Ghi nhớ: người dùng vận hành kho sẽ thao tác trong module <span className="font-bold">Quản lý kho</span>, còn thay đổi danh mục và định mức phải đi qua <span className="font-bold">Cài đặt / Cấu hình nhà máy</span>.
            </div>
          </div>
        </div>
      )}

      {tab === "master-data" && (
        <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag size={16} className="text-emerald-600" />
            <span className="font-extrabold text-slate-700">Hậu tố mã lô</span>
            <span className="text-xs text-slate-500 ml-1">({suffixes.length} hậu tố)</span>
          </div>
          {canManageSettings && (
            <button
              onClick={openAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all"
            >
              <Plus size={13} /> Thêm hậu tố
            </button>
          )}
        </div>

        <div className="p-4">
          {loading ? (
            <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
          ) : suffixes.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <Tag size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">Chưa có hậu tố nào</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {["Ma", "Ten", "Nguon goc", "Chung nhan", "Vi du ma lo", ""].map((head) => (
                    <th key={head} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suffixes.map((item) => (
                  <tr key={item.code} className="row-hover">
                    <td className="px-4 py-3">
                      <span className="font-bold text-emerald-700 font-mono">{item.code}</span>
                      {SYSTEM_CODES.includes(item.code) && (
                        <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-600 text-[10px] font-bold rounded-full">
                          He thong
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-medium">{item.name}</td>
                    <td className="px-4 py-3 text-slate-500">{item.nguon || "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{item.chung_nhan || "—"}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">{`01${item.code}/26`}</td>
                    <td className="px-4 py-3">
                      {canManageSettings && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => openEdit(item)}
                            className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => setDelConfirm(item.code)}
                            className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-extrabold text-slate-800">
                {modal === "add" ? "Thêm hậu tố mới" : `Sửa hậu tố "${editCode}"`}
              </h2>
              <button onClick={() => setModal(null)} className="p-2 hover:bg-slate-100 rounded-xl">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2">
                  <AlertTriangle size={14} /> {error}
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Ma hau to *</label>
                <input
                  value={form.code}
                  onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value.toLowerCase() }))}
                  disabled={modal === "edit"}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 font-mono disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">Ten hau to *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Nguon goc</label>
                  <input
                    value={form.nguon}
                    onChange={(e) => setForm((prev) => ({ ...prev, nguon: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Chung nhan</label>
                  <input
                    value={form.chung_nhan}
                    onChange={(e) => setForm((prev) => ({ ...prev, chung_nhan: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-end gap-3 rounded-b-2xl">
              <button onClick={() => setModal(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Huy
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
              >
                {saving ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}

      {delConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-red-100 text-red-600 rounded-xl">
                <AlertTriangle size={18} />
              </div>
              <div>
                <h3 className="font-extrabold text-slate-800">Xóa hậu tố &quot;{delConfirm}&quot;?</h3>
                <p className="text-sm text-slate-500 mt-1">Hanh dong nay khong the hoan tac.</p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setDelConfirm(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Huy
              </button>
              <button onClick={() => handleDelete(delConfirm)} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-xl">
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}

      {userEditor && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <div>
                <h2 className="text-lg font-extrabold text-slate-800">
                  {userEditor.mode === "approve" ? "Duyệt tài khoản" : "Sửa quyền người dùng"}
                </h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {userEditor.fullName} ({userEditor.username})
                </p>
              </div>
              <button onClick={() => setUserEditor(null)} className="p-2 hover:bg-slate-100 rounded-xl">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {userError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2">
                  <AlertTriangle size={14} /> {userError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Nhà máy *</label>
                  <select
                    value={userEditor.factoryId}
                    onChange={(e) => setUserEditor({ ...userEditor, factoryId: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  >
                    {factories.map((factory) => (
                      <option key={factory.id} value={factory.id}>
                        {factory.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Role *</label>
                  <select
                    value={userEditor.role}
                    onChange={(e) => handleRoleChange(e.target.value as AppRole)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"
                  >
                    {(["admin", "manager", "user", "customer"] as AppRole[]).map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-3">Permissions *</label>
                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(groupedPermissions).map(([moduleName, options]) => (
                    <div key={moduleName} className="border border-slate-200 rounded-xl p-4">
                      <div className="font-bold text-slate-800 mb-3">{moduleName}</div>
                      <div className="space-y-2">
                        {options.map((option) => (
                          <label key={option.code} className="flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={userEditor.permissions.includes(option.code)}
                              onChange={() => togglePermission(option.code)}
                              className="rounded border-slate-300"
                            />
                            <span>{option.action_name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-end gap-3 rounded-b-2xl">
              <button onClick={() => setUserEditor(null)} className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">
                Huy
              </button>
              <button
                onClick={saveUserApproval}
                disabled={savingUser}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all disabled:opacity-50"
              >
                {savingUser ? "Đang lưu..." : userEditor.mode === "approve" ? "Duyệt và kích hoạt" : "Lưu quyền"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

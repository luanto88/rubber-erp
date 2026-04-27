"use client"
import { useState, useEffect, useCallback } from "react"
import { supabase } from "@/lib/supabase"
import { useScrollReveal } from "@/lib/useScrollReveal"
import { Plus, Edit2, Trash2, X, Tag, AlertTriangle, Building2, Save } from "lucide-react"

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

const SYSTEM_CODES = ["cs", "m"]  // hậu tố hệ thống, cảnh báo khi xóa

function emptyForm(): SuffixForm {
  return { code: "", name: "", nguon: "", chung_nhan: "" }
}

type FactoryInfo = {
  full_name_en: string
  address_en: string
  contact_person: string
  contact_email: string
  website: string
  country_en: string
}

function emptyFactoryInfo(): FactoryInfo {
  return { full_name_en: "", address_en: "", contact_person: "", contact_email: "", website: "", country_en: "" }
}

export default function SettingsPage() {
  useScrollReveal()

  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser]           = useState<{ role: string } | null>(null)
  const [suffixes, setSuffixes]   = useState<Suffix[]>([])
  const [loading, setLoading]     = useState(true)

  // Factory info state
  const [factoryInfo, setFactoryInfo] = useState<FactoryInfo>(emptyFactoryInfo())
  const [savingFactory, setSavingFactory] = useState(false)
  const [factoryMsg, setFactoryMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Modal state
  const [modal, setModal]         = useState<"add" | "edit" | null>(null)
  const [form, setForm]           = useState<SuffixForm>(emptyForm())
  const [editCode, setEditCode]   = useState<string | null>(null)
  const [saving, setSaving]       = useState(false)
  const [delConfirm, setDelConfirm] = useState<string | null>(null)
  const [error, setError]         = useState("")

  const loadSuffixes = useCallback(async (fid: string) => {
    setLoading(true)
    const { data } = await supabase.from("suffixes").select("*")
      .eq("factory_id", fid).order("code")
    setSuffixes(data || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    const fid  = localStorage.getItem("erp_factory")
    const u    = JSON.parse(localStorage.getItem("erp_user") || "{}")
    if (!fid) return
    setFactoryId(fid)
    setUser(u)
    loadSuffixes(fid)
    supabase.from("factories")
      .select("full_name_en,address_en,contact_person,contact_email,website,country_en")
      .eq("id", fid).single()
      .then(({ data }) => { if (data) setFactoryInfo(data as FactoryInfo) })
  }, [loadSuffixes])

  const isAdmin = user?.role === "admin"

  const handleSaveFactory = async () => {
    if (!factoryId || !isAdmin) return
    setSavingFactory(true)
    setFactoryMsg(null)
    const { error: err } = await supabase.from("factories")
      .update(factoryInfo).eq("id", factoryId)
    setSavingFactory(false)
    setFactoryMsg(err ? { ok: false, text: err.message } : { ok: true, text: "Đã lưu thông tin công ty" })
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

    if (!form.code.trim()) { setError("Mã hậu tố không được để trống"); return }
    if (!form.name.trim()) { setError("Tên không được để trống"); return }
    // Validate code: only lowercase letters and numbers, no spaces
    if (!/^[a-z0-9]+$/.test(form.code.trim())) {
      setError("Mã hậu tố chỉ được dùng chữ thường và số (ví dụ: gctbk, gccpk)")
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
        if (err) { setError(err.message); return }
      } else if (modal === "edit" && editCode) {
        const { error: err } = await supabase.from("suffixes").update({
          name: form.name, nguon: form.nguon, chung_nhan: form.chung_nhan,
        }).eq("code", editCode).eq("factory_id", factoryId)
        if (err) { setError(err.message); return }
      }
      setModal(null)
      loadSuffixes(factoryId)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (code: string) => {
    if (!factoryId) return
    await supabase.from("suffixes").delete().eq("code", code).eq("factory_id", factoryId)
    setDelConfirm(null)
    loadSuffixes(factoryId)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Cài đặt</h1>
          <p className="text-sm text-slate-500 mt-0.5">Quản lý cấu hình hệ thống</p>
        </div>
      </div>

      {/* ── Thông tin công ty (EUDR Seller) ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden mb-6">
        <div className="bg-gradient-to-r from-violet-50 to-purple-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 size={16} className="text-violet-600"/>
            <span className="font-extrabold text-slate-700">Thông tin công ty (EUDR Seller)</span>
            <span className="text-xs text-slate-400 ml-1">— dùng để tạo file DDS</span>
          </div>
          {isAdmin && (
            <button onClick={handleSaveFactory} disabled={savingFactory}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all disabled:opacity-50">
              <Save size={13}/> {savingFactory ? "Đang lưu..." : "Lưu thông tin"}
            </button>
          )}
        </div>
        <div className="p-5">
          {factoryMsg && (
            <div className={`mb-4 px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 ${factoryMsg.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-600 border border-red-200"}`}>
              {factoryMsg.ok ? <Save size={14}/> : <AlertTriangle size={14}/>} {factoryMsg.text}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: "Tên công ty (tiếng Anh)", field: "full_name_en", placeholder: "PTCS PHUOC HOA KAMPONG THOM CO., LTD", colSpan: true },
              { label: "Địa chỉ", field: "address_en", placeholder: "Kampong Thom Province, Kingdom of Cambodia", colSpan: true },
              { label: "Người liên hệ", field: "contact_person", placeholder: "Production Management Department", colSpan: false },
              { label: "Email", field: "contact_email", placeholder: "contact@example.com", colSpan: false },
              { label: "Website", field: "website", placeholder: "qlsxkpt.vercel.app", colSpan: false },
              { label: "Quốc gia", field: "country_en", placeholder: "Cambodia", colSpan: false },
            ].map(({ label, field, placeholder, colSpan }) => (
              <div key={field} className={colSpan ? "col-span-2" : ""}>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">{label}</label>
                <input
                  value={factoryInfo[field as keyof FactoryInfo]}
                  onChange={e => setFactoryInfo(f => ({ ...f, [field]: e.target.value }))}
                  disabled={!isAdmin}
                  placeholder={placeholder}
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-violet-500 disabled:bg-slate-50 disabled:text-slate-400"
                />
              </div>
            ))}
          </div>
          {!isAdmin && (
            <p className="text-xs text-slate-400 mt-3">Chỉ Admin mới có thể chỉnh sửa thông tin này.</p>
          )}
        </div>
      </div>

      {/* ── Hậu tố mã lô ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-md overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-50 to-teal-50 px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag size={16} className="text-emerald-600"/>
            <span className="font-extrabold text-slate-700">Hậu tố mã lô</span>
            <span className="text-xs text-slate-500 ml-1">({suffixes.length} hậu tố)</span>
          </div>
          {isAdmin && (
            <button onClick={openAdd}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all">
              <Plus size={13}/> Thêm hậu tố
            </button>
          )}
        </div>

        <div className="p-4">
          <p className="text-xs text-slate-500 mb-4">
            Hậu tố xác định dãy số lô và nguồn gốc nguyên liệu.
            Mỗi hậu tố có dãy số độc lập bắt đầu từ 01 (ví dụ: <strong>01cs</strong>, <strong>01m</strong>, <strong>01gctbk</strong>).
            Hậu tố <strong>Trống</strong> tạo mã lô dạng <strong>01/26</strong> (không có chữ suffix).
          </p>

          {loading ? (
            <div className="p-8 text-center text-slate-400 text-sm">Đang tải...</div>
          ) : suffixes.length === 0 ? (
            <div className="p-8 text-center text-slate-400">
              <Tag size={32} className="mx-auto mb-2 opacity-30"/>
              <p className="text-sm">Chưa có hậu tố nào</p>
              {isAdmin && <p className="text-xs mt-1">Nhấn &quot;Thêm hậu tố&quot; để bắt đầu</p>}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {["Mã", "Tên", "Nguồn gốc", "Chứng nhận", "Ví dụ mã lô", ""].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {suffixes.map(s => (
                  <tr key={s.code} className="row-hover">
                    <td className="px-4 py-3">
                      <span className="font-bold text-emerald-700 font-mono">{s.code || <em className="text-slate-400 not-italic">trống</em>}</span>
                      {SYSTEM_CODES.includes(s.code) && (
                        <span className="ml-2 px-1.5 py-0.5 bg-blue-100 text-blue-600 text-[10px] font-bold rounded-full">Hệ thống</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700 font-medium">{s.name}</td>
                    <td className="px-4 py-3 text-slate-500">{s.nguon || "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{s.chung_nhan || "—"}</td>
                    <td className="px-4 py-3 text-slate-400 font-mono text-xs">
                      {s.code ? `01${s.code}/26` : "01/26"}
                    </td>
                    <td className="px-4 py-3">
                      {isAdmin && (
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(s)}
                            className="p-1.5 hover:bg-blue-50 text-blue-500 rounded-lg transition-colors">
                            <Edit2 size={13}/>
                          </button>
                          <button onClick={() => setDelConfirm(s.code)}
                            className="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors">
                            <Trash2 size={13}/>
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

      {/* Add/Edit Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between rounded-t-2xl">
              <h2 className="text-lg font-extrabold text-slate-800">
                {modal === "add" ? "Thêm hậu tố mới" : `Sửa hậu tố "${editCode}"`}
              </h2>
              <button onClick={() => setModal(null)} className="p-2 hover:bg-slate-100 rounded-xl">
                <X size={18}/>
              </button>
            </div>

            <div className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600 flex items-center gap-2">
                  <AlertTriangle size={14}/> {error}
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Mã hậu tố <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.code}
                  onChange={e => setForm(f => ({ ...f, code: e.target.value.toLowerCase() }))}
                  disabled={modal === "edit"}
                  placeholder="vd: gctbk, gccpk"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500 font-mono disabled:bg-slate-50 disabled:text-slate-400"/>
                <p className="text-[10px] text-slate-400 mt-1">
                  Chỉ dùng chữ thường và số · Mã lô sẽ thành: <strong>01{form.code}/26</strong>
                </p>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">
                  Tên đầy đủ <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="vd: Gia công Tân Biên Kampong Thom"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500"/>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Nguồn gốc</label>
                  <select value={form.nguon} onChange={e => setForm(f => ({ ...f, nguon: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    <option value="">-- Chọn --</option>
                    <option value="NT">NT (Nội tuyển)</option>
                    <option value="M">M (Mua ngoài)</option>
                    <option value="GCA">GCA (Gia công)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-600 block mb-1.5">Chứng nhận</label>
                  <select value={form.chung_nhan} onChange={e => setForm(f => ({ ...f, chung_nhan: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                    <option value="">Không</option>
                    <option value="PEFC CS">PEFC CS</option>
                    <option value="PEFC FM">PEFC FM</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 bg-white border-t border-slate-200 px-6 py-4 flex justify-end gap-3 rounded-b-2xl">
              <button onClick={() => setModal(null)}
                className="px-5 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all">
                Hủy
              </button>
              <button onClick={handleSave} disabled={saving}
                className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl shadow-md transition-all disabled:opacity-50">
                {saving ? "Đang lưu..." : modal === "add" ? "Thêm hậu tố" : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {delConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full">
            <h3 className="font-extrabold text-slate-800 mb-2">Xác nhận xóa hậu tố?</h3>
            {SYSTEM_CODES.includes(delConfirm) && (
              <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2">
                <AlertTriangle size={14} className="text-amber-600 mt-0.5 shrink-0"/>
                <p className="text-xs text-amber-700">
                  <strong>&quot;{delConfirm}&quot;</strong> là hậu tố hệ thống. Xóa có thể ảnh hưởng đến các lô đã tạo với hậu tố này.
                </p>
              </div>
            )}
            <p className="text-sm text-slate-500 mb-5">
              Hậu tố <strong>&quot;{delConfirm}&quot;</strong> sẽ bị xóa khỏi danh sách. Các lô thành phẩm đã tạo không bị ảnh hưởng.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setDelConfirm(null)}
                className="flex-1 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl">Hủy</button>
              <button onClick={() => handleDelete(delConfirm)}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl shadow-md">Xóa</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

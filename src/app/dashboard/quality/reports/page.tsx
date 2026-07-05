"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { FileBarChart2, Printer } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hasPermission, type SessionUser } from "@/lib/auth"
import { FilterMultiSelect } from "@/app/dashboard/_components/filter-multi-select"
import {
  CHUNG_LOAI,
  TIEU_CHUAN_OPTIONS,
  chiTieuDisplayLabel,
  fetchQualityTargets,
  getVisibleChiTieu,
  type ChiTieuKey,
} from "@/lib/quality-stats"

const ALL_CHI_TIEU: ChiTieuKey[] = ["tap_chat", "tro", "bay_hoi", "nito", "po", "pri", "mooney", "mau_sac"]
const SAN_PHAM_LABELS: Record<string, string> = Object.fromEntries(CHUNG_LOAI.map((c) => [c, `CSR${c}`]))

const MONTH_NAMES = Array.from({ length: 12 }, (_, i) => i + 1)

export default function QualityReportsPage() {
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  const now = new Date()
  const [nam, setNam] = useState(now.getFullYear())
  const [thang, setThang] = useState(now.getMonth() + 1)
  const [sanPhamList, setSanPhamList] = useState<string[]>([...CHUNG_LOAI])
  const [tieuChuan, setTieuChuan] = useState(TIEU_CHUAN_OPTIONS[0])
  const [chiTieuList, setChiTieuList] = useState<ChiTieuKey[]>(["tap_chat", "po", "pri", "mooney"])
  const [includeSummary, setIncludeSummary] = useState(true)
  const [spcCombos, setSpcCombos] = useState<string[]>([]) // "sanPham|chiTieu"
  const [giamDocOptions, setGiamDocOptions] = useState<{ ten: string; chuc_vu: string }[]>([])
  const [giamDoc, setGiamDoc] = useState("")

  const nguoiThucHien = user?.full_name || user?.username || ""

  useEffect(() => {
    const bootstrap = async () => {
      const cachedUser = JSON.parse(localStorage.getItem("erp_user") || "null") as SessionUser | null
      if (!hasPermission(cachedUser, "quality.view")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      const fid = await getActiveFactoryId()
      if (!fid) { setLoading(false); return }
      setFactoryId(fid)
      setUser(cachedUser)
      setLoading(false)

      const { data } = await supabase.from("maintenance_staff").select("ten,chuc_vu").eq("factory_id", fid)
      const list = (data || []).filter((s) => (s.chuc_vu || "").toLowerCase().includes("giám đốc"))
      setGiamDocOptions(list)
      if (list.length > 0) setGiamDoc(list[0].ten)
    }
    void bootstrap()
  }, [])

  // Gợi ý chỉ tiêu mặc định = hợp của (chỉ tiêu đã có mục tiêu năm/sản phẩm đang chọn) ∪ (chỉ tiêu áp dụng theo sản phẩm)
  useEffect(() => {
    if (!factoryId) return
    const load = async () => {
      const targets = await fetchQualityTargets(factoryId, nam)
      const fromTargets = new Set(targets.filter((t) => sanPhamList.includes(t.san_pham) && t.chi_tieu !== "tccs_tong").map((t) => t.chi_tieu))
      const fromVisible = new Set<ChiTieuKey>()
      sanPhamList.forEach((sp) => getVisibleChiTieu(sp).forEach((c) => fromVisible.add(c)))
      const union = ALL_CHI_TIEU.filter((c) => fromTargets.has(c) || fromVisible.has(c))
      setChiTieuList(union)
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [factoryId, nam])

  const availableChiTieuForSp = useMemo(() => {
    const set = new Set<ChiTieuKey>()
    sanPhamList.forEach((sp) => getVisibleChiTieu(sp).forEach((c) => set.add(c)))
    return ALL_CHI_TIEU.filter((c) => set.has(c))
  }, [sanPhamList])

  const spcOptions = useMemo(() => {
    const opts: { key: string; label: string }[] = []
    for (const sp of sanPhamList) {
      for (const ct of chiTieuList) {
        if (!getVisibleChiTieu(sp).includes(ct)) continue
        opts.push({ key: `${sp}|${ct}`, label: `CSR${sp} - ${chiTieuDisplayLabel(ct, sp)}` })
      }
    }
    return opts
  }, [sanPhamList, chiTieuList])

  const toggleSpcCombo = (key: string) => {
    setSpcCombos((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]))
  }

  const buildPrintUrl = useCallback(() => {
    const params = new URLSearchParams()
    params.set("factoryId", factoryId || "")
    params.set("nam", String(nam))
    params.set("thang", String(thang))
    params.set("sanPham", sanPhamList.join(","))
    params.set("tieuChuan", tieuChuan)
    params.set("chiTieu", chiTieuList.join(","))
    params.set("summary", includeSummary ? "1" : "0")
    params.set("spc", spcCombos.join(","))
    params.set("giamDoc", giamDoc)
    params.set("nguoiThucHien", nguoiThucHien)
    return `/dashboard/quality/reports/print?${params.toString()}`
  }, [factoryId, nam, thang, sanPhamList, tieuChuan, chiTieuList, includeSummary, spcCombos, giamDoc, nguoiThucHien])

  const canPrint = hasPermission(user, "quality.print")
  const readyToPrint = !!factoryId && (includeSummary || spcCombos.length > 0) && sanPhamList.length > 0

  if (loading) return <div className="p-12 text-center text-slate-400">Đang tải...</div>

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">
          <FileBarChart2 size={22} className="text-emerald-600" /> Báo cáo thống kê chất lượng
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">Cấu hình bộ lọc rồi in báo cáo tháng theo mục tiêu và/hoặc báo cáo phân tích chi tiết từng chỉ tiêu.</p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-md p-6 space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Tháng</label>
            <select value={thang} onChange={(e) => setThang(Number(e.target.value))} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
              {MONTH_NAMES.map((m) => <option key={m} value={m}>Tháng {m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Năm</label>
            <input type="number" value={nam} onChange={(e) => setNam(Number(e.target.value) || nam)} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Tiêu chuẩn</label>
            <select value={tieuChuan} onChange={(e) => setTieuChuan(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
              {TIEU_CHUAN_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Loại CSR</label>
            <FilterMultiSelect
              options={CHUNG_LOAI}
              selected={sanPhamList}
              onChange={setSanPhamList}
              placeholder="Chọn loại CSR"
              labels={SAN_PHAM_LABELS}
              searchPlaceholder="Tìm loại CSR..."
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-1.5">Chỉ tiêu đưa vào báo cáo</label>
          <FilterMultiSelect
            options={availableChiTieuForSp}
            selected={chiTieuList}
            onChange={(next) => setChiTieuList(next as ChiTieuKey[])}
            placeholder="Chọn chỉ tiêu"
            labels={Object.fromEntries(availableChiTieuForSp.map((c) => [c, chiTieuDisplayLabel(c)]))}
            searchPlaceholder="Tìm chỉ tiêu..."
          />
          <p className="text-xs text-slate-400 mt-1">Dòng &quot;Tỷ lệ đạt tổng hợp&quot; luôn được thêm vào cuối mỗi loại CSR, không cần chọn.</p>
        </div>

        <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <input type="checkbox" checked={includeSummary} onChange={(e) => setIncludeSummary(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
          Bao gồm Bảng thống kê chất lượng tháng (mẫu tổng hợp)
        </label>

        <div>
          <label className="text-xs font-bold text-slate-600 block mb-2">Báo cáo phân tích chi tiết (SPC) — chọn cặp Loại CSR × Chỉ tiêu muốn in trang riêng</label>
          {spcOptions.length === 0 ? (
            <p className="text-sm text-slate-400">Chọn Loại CSR và Chỉ tiêu ở trên để hiện danh sách.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {spcOptions.map((opt) => (
                <label key={opt.key} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm cursor-pointer transition-colors ${spcCombos.includes(opt.key) ? "bg-emerald-50 border-emerald-300 text-emerald-700" : "border-slate-200 hover:bg-slate-50"}`}>
                  <input type="checkbox" checked={spcCombos.includes(opt.key)} onChange={() => toggleSpcCombo(opt.key)} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
                  {opt.label}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100">
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Giám đốc nhà máy</label>
            {giamDocOptions.length > 0 ? (
              <select value={giamDoc} onChange={(e) => setGiamDoc(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:border-emerald-500">
                {giamDocOptions.map((s) => <option key={s.ten} value={s.ten}>{s.ten} — {s.chuc_vu}</option>)}
              </select>
            ) : (
              <div className="px-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-400 bg-slate-50">
                Chưa có nhân sự chức vụ Giám đốc/Phó giám đốc trong Cài đặt → Bảo trì → Nhân sự bảo trì
              </div>
            )}
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 block mb-1.5">Người lập báo cáo / Nhân viên kỹ thuật</label>
            <div className="px-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 bg-slate-50">{nguoiThucHien || "—"}</div>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          {canPrint && readyToPrint ? (
            <Link
              href={buildPrintUrl()}
              target="_blank"
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md transition-all"
            >
              <Printer size={16} /> Xem trước &amp; In báo cáo
            </Link>
          ) : (
            <span className="flex items-center gap-2 px-5 py-2.5 bg-slate-200 text-slate-400 font-bold rounded-xl cursor-not-allowed">
              <Printer size={16} /> Xem trước &amp; In báo cáo
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

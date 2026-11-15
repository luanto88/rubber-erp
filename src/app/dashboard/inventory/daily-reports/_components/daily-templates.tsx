"use client"

// Kho vật tư — "Mẫu báo cáo" sử dụng theo ngày: mỗi mẫu = danh sách CỘT, mỗi cột tick 1 hay nhiều vật tư (người dùng
// chốt 2026-11-15: mẫu 55 tick chọn vật tư ngay trong Kho). Mẫu 55 có "Thêm cột từ vật tư" (mỗi vật tư tick = 1 cột);
// 12B gộp nhiều mã dầu vào 1 cột mục đích. Đổi cấu hình ⇒ phiên bản +1, báo cáo đã lập giữ bản chụp cũ. Rule 13.

import { useEffect, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, ListPlus, Plus, Save, Search, Trash2, X } from "lucide-react"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import {
  createDailyTemplate,
  deleteDailyTemplate,
  loadDailyTemplates,
  loadPickItems,
  saveDailyTemplate,
  type PickItem,
} from "@/lib/inventory-daily-report/client"
import { DAILY_REPORT_KIEU_LABEL, type DailyReportColumn, type DailyReportConfig, type DailyReportKieu, type DailyReportTemplate } from "@/lib/inventory-daily-report/types"
import { btnCls, btnPrimaryCls, dailyErrText, inputCls } from "./daily-ui"

const DEFAULT_TITLE: Record<DailyReportKieu, string> = {
  vt_hc: "BÁO CÁO SỬ DỤNG VẬT TƯ HÓA CHẤT TRONG SẢN XUẤT CHẾ BIẾN",
  dau_12b: "BÁO CÁO SỬ DỤNG DẦU TRONG SẢN XUẤT CHẾ BIẾN",
}

// ── Hộp chọn vật tư ──────────────────────────────────────────────────────────

function ItemPicker({
  items,
  initial,
  title,
  onClose,
  onConfirm,
}: {
  items: PickItem[]
  initial: string[]
  title: string
  onClose: () => void
  onConfirm: (ids: string[]) => void
}) {
  const [q, setQ] = useState("")
  const [cat, setCat] = useState("")
  const [sel, setSel] = useState<Set<string>>(new Set(initial))
  const cats = useMemo(() => [...new Set(items.map((i) => i.category))].sort((a, b) => a.localeCompare(b, "vi")), [items])
  const needle = q.trim().toLowerCase()
  const shown = items.filter((i) => (!cat || i.category === cat) && (!needle || `${i.code} ${i.name}`.toLowerCase().includes(needle))).slice(0, 300)
  const toggle = (id: string) =>
    setSel((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  return (
    <ModalShell
      title={title}
      onClose={onClose}
      maxWidth="lg"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-600">Đã chọn {sel.size} vật tư</span>
          <div className="flex gap-2">
            <button type="button" className={btnCls} onClick={onClose}>
              Huỷ
            </button>
            <button type="button" className={btnPrimaryCls} onClick={() => onConfirm([...sel])}>
              Xong
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-2">
        <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
          <div className="flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3">
            <Search size={15} className="text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mã / tên vật tư…" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </div>
          <select className={inputCls} value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">Mọi nhóm vật tư</option>
            {cats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="max-h-[55vh] overflow-y-auto rounded-xl border border-slate-200">
          {shown.map((i) => (
            <label key={i.id} className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0 hover:bg-slate-50">
              <input type="checkbox" checked={sel.has(i.id)} onChange={() => toggle(i.id)} />
              <span className="font-code text-xs font-bold text-slate-700">{i.code}</span>
              <span className="min-w-0 flex-1 truncate">{i.name}</span>
              <span className="shrink-0 text-xs text-slate-500">
                {i.unit} · {i.category}
              </span>
            </label>
          ))}
          {!shown.length && <div className="px-3 py-6 text-center text-sm text-slate-500">Không có vật tư phù hợp.</div>}
        </div>
      </div>
    </ModalShell>
  )
}

// ── Thẻ 1 mẫu ────────────────────────────────────────────────────────────────

function TemplateCard({ t, items, onSaved, onError }: { t: DailyReportTemplate; items: PickItem[]; onSaved: (msg: string) => void; onError: (msg: string) => void }) {
  const cfg = t.config || {}
  const [name, setName] = useState(t.name)
  const [active, setActive] = useState(t.is_active)
  const [tieuDe, setTieuDe] = useState(cfg.tieuDe || DEFAULT_TITLE[t.kieu])
  const [maMau, setMaMau] = useState(cfg.maMau || "")
  const [nhanLap, setNhanLap] = useState(cfg.nhanLap || "LẬP BẢNG")
  const [chucVuLap, setChucVuLap] = useState(cfg.chucVuLap || "")
  const [hideZero, setHideZero] = useState(!!cfg.hideZero)
  const [cols, setCols] = useState<DailyReportColumn[]>(cfg.columns || [])
  const [picker, setPicker] = useState<{ mode: "column"; index: number } | { mode: "newColumns" } | null>(null)
  const [busy, setBusy] = useState(false)
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])

  const patchCol = (i: number, p: Partial<DailyReportColumn>) => setCols((cs) => cs.map((c, j) => (j === i ? { ...c, ...p } : c)))
  const move = (i: number, d: -1 | 1) =>
    setCols((cs) => {
      const j = i + d
      if (j < 0 || j >= cs.length) return cs
      const n = [...cs]
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })
  const usedIds = new Set(cols.flatMap((c) => c.itemIds))

  const save = async () => {
    const bad = cols.findIndex((c) => !c.label.trim())
    if (bad >= 0) return onError(`Cột ${bad + 1} chưa có tên.`)
    setBusy(true)
    try {
      const config: DailyReportConfig = {
        ...cfg,
        tieuDe: tieuDe.trim(),
        maMau: maMau.trim(),
        nhanLap: nhanLap.trim() || "LẬP BẢNG",
        chucVuLap: chucVuLap.trim(),
        hideZero,
        columns: cols.map((c) => ({ label: c.label.trim(), subLabel: (c.subLabel || "").trim(), itemIds: c.itemIds })),
      }
      await saveDailyTemplate(t.id, { name: name.trim() || t.name, is_active: active, config })
      onSaved(`Đã lưu mẫu ${name.trim() || t.name}`)
    } catch (e) {
      onError(dailyErrText(e, "Không lưu được mẫu."))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm(`Xoá mẫu "${t.name}"? (Chỉ xoá được khi chưa lập báo cáo nào từ mẫu này.)`)) return
    try {
      await deleteDailyTemplate(t.id)
      onSaved("Đã xoá mẫu")
    } catch (e) {
      onError(dailyErrText(e, "Không xoá được mẫu (đã có báo cáo dùng mẫu này?)."))
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-code text-sm font-bold text-slate-800">{t.code}</div>
          <div className="text-xs text-slate-500">
            {DAILY_REPORT_KIEU_LABEL[t.kieu]} · phiên bản {t.phien_ban}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Đang dùng
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-600">Tên báo cáo</span>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-600">Mã mẫu in trên QR (vd Mẫu 12B-NMCB — để trống nếu không có)</span>
          <input className={inputCls} value={maMau} onChange={(e) => setMaMau(e.target.value)} />
        </label>
        <label className="block space-y-1 sm:col-span-2">
          <span className="text-xs font-semibold text-slate-600">Tiêu đề in trên báo cáo</span>
          <input className={inputCls} value={tieuDe} onChange={(e) => setTieuDe(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-600">Nhãn ô ký người lập</span>
          <input className={inputCls} value={nhanLap} onChange={(e) => setNhanLap(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-slate-600">Chức vụ dưới ô ký (khi người lập chưa khai chức vụ)</span>
          <input className={inputCls} value={chucVuLap} onChange={(e) => setChucVuLap(e.target.value)} placeholder="Nhân viên kỹ thuật" />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={hideZero} onChange={(e) => setHideZero(e.target.checked)} /> Ẩn cột không phát sinh cả kỳ
      </label>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold text-slate-800">Cột báo cáo ({cols.length})</span>
          <div className="flex flex-wrap gap-2">
            {t.kieu === "vt_hc" && (
              <button type="button" className={btnCls} onClick={() => setPicker({ mode: "newColumns" })}>
                <ListPlus size={15} /> Thêm cột từ vật tư
              </button>
            )}
            <button type="button" className={btnCls} onClick={() => setCols((cs) => [...cs, { label: "", subLabel: "", itemIds: [] }])}>
              <Plus size={15} /> Thêm cột trống
            </button>
          </div>
        </div>
        {!cols.length && <div className="rounded-xl border border-dashed border-slate-300 px-3 py-4 text-center text-sm text-slate-500">Chưa có cột nào.</div>}
        {cols.map((c, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2">
            <div className="grid gap-2 sm:grid-cols-[2rem_1fr_1fr_auto]">
              <span className="hidden self-center text-center text-xs font-bold text-slate-500 sm:block">{i + 1}</span>
              <input className={inputCls} value={c.label} onChange={(e) => patchCol(i, { label: e.target.value })} placeholder="Tên cột (vd Cấp xe xúc)" />
              <input className={inputCls} value={c.subLabel || ""} onChange={(e) => patchCol(i, { subLabel: e.target.value })} placeholder="Dòng phụ (vd 85%, VRG CSR10)" />
              <div className="flex justify-end gap-1">
                <button type="button" className={btnCls} aria-label="Lên" title="Lên" disabled={i === 0} onClick={() => move(i, -1)}>
                  <ArrowUp size={14} />
                </button>
                <button type="button" className={btnCls} aria-label="Xuống" title="Xuống" disabled={i === cols.length - 1} onClick={() => move(i, 1)}>
                  <ArrowDown size={14} />
                </button>
                <button type="button" className={btnCls} aria-label="Xoá cột" title="Xoá cột" onClick={() => setCols((cs) => cs.filter((_, j) => j !== i))}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {c.itemIds.map((id) => {
                const it = byId.get(id)
                return (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                    <span className="font-code">{it?.code || "(đã xoá)"}</span>
                    {it && <span className="font-normal text-slate-500">{it.name}</span>}
                    <button type="button" aria-label="Bỏ vật tư" className="text-slate-400 hover:text-red-600" onClick={() => patchCol(i, { itemIds: c.itemIds.filter((x) => x !== id) })}>
                      <X size={12} />
                    </button>
                  </span>
                )
              })}
              <button type="button" className="text-xs font-semibold text-brand-700 hover:underline" onClick={() => setPicker({ mode: "column", index: i })}>
                {c.itemIds.length ? "Sửa vật tư…" : "Chọn vật tư…"}
              </button>
              {!c.itemIds.length && <span className="text-xs text-amber-700">Cột chưa gắn vật tư — luôn bằng 0.</span>}
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap justify-between gap-2">
        <button type="button" className={btnCls} onClick={() => void remove()}>
          <Trash2 size={15} /> Xoá mẫu
        </button>
        <button type="button" className={btnPrimaryCls} disabled={busy} onClick={() => void save()}>
          <Save size={15} /> {busy ? "Đang lưu…" : "Lưu mẫu"}
        </button>
      </div>

      {picker && (
        <ItemPicker
          items={items}
          title={picker.mode === "column" ? `Vật tư của cột ${picker.index + 1}` : "Tick vật tư — mỗi vật tư thành 1 cột"}
          initial={picker.mode === "column" ? cols[picker.index]?.itemIds || [] : []}
          onClose={() => setPicker(null)}
          onConfirm={(ids) => {
            if (picker.mode === "column") patchCol(picker.index, { itemIds: ids })
            else {
              const fresh = ids.filter((id) => !usedIds.has(id))
              setCols((cs) => [...cs, ...fresh.map((id) => ({ label: byId.get(id)?.name || "", subLabel: "", itemIds: [id] }))])
            }
            setPicker(null)
          }}
        />
      )}
    </div>
  )
}

// ── Danh sách mẫu ────────────────────────────────────────────────────────────

export function DailyTemplatesConfig({ factoryId, onToast }: { factoryId: string; onToast: (kind: "ok" | "error", msg: string) => void }) {
  const [list, setList] = useState<DailyReportTemplate[] | null>(null)
  const [items, setItems] = useState<PickItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    void (async () => {
      try {
        const [t, it] = await Promise.all([loadDailyTemplates(factoryId), loadPickItems(factoryId)])
        setList(t)
        setItems(it)
      } catch (e) {
        setError(dailyErrText(e, "Không tải được mẫu báo cáo."))
      }
    })()
  }, [factoryId, nonce])

  const add = async (kieu: DailyReportKieu) => {
    const code = kieu === "vt_hc" ? `BC-VTHC-${Date.now().toString(36).toUpperCase()}` : `BC-DAU-${Date.now().toString(36).toUpperCase()}`
    try {
      await createDailyTemplate(factoryId, kieu, code, kieu === "vt_hc" ? "Báo cáo sử dụng vật tư hóa chất" : "Báo cáo sử dụng dầu", {
        tieuDe: DEFAULT_TITLE[kieu],
        maMau: kieu === "dau_12b" ? "Mẫu 12B-NMCB" : "",
        nhanLap: "LẬP BẢNG",
        chucVuLap: "Nhân viên kỹ thuật",
        columns: [],
      })
      setNonce((n) => n + 1)
    } catch (e) {
      onToast("error", dailyErrText(e, "Không tạo được mẫu."))
    }
  }

  if (error) return <ListState kind="error" message={error} />
  if (!list) return <ListState kind="loading" />
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">Số liệu = xuất kho theo ngày của các vật tư trong cột (cộng cả dữ liệu lịch sử trước khi dùng app).</p>
        <div className="flex gap-2">
          <button type="button" className={btnCls} onClick={() => void add("vt_hc")}>
            <Plus size={15} /> Mẫu vật tư hóa chất
          </button>
          <button type="button" className={btnCls} onClick={() => void add("dau_12b")}>
            <Plus size={15} /> Mẫu dầu (12B)
          </button>
        </div>
      </div>
      {!list.length && <ListState kind="empty" message="Chưa có mẫu — bấm thêm mẫu ở trên." />}
      <div className="grid gap-4 xl:grid-cols-2">
        {list.map((t) => (
          <TemplateCard
            key={`${t.id}-${t.phien_ban}-${nonce}`}
            t={t}
            items={items}
            onSaved={(m) => {
              onToast("ok", m)
              setNonce((n) => n + 1)
            }}
            onError={(m) => onToast("error", m)}
          />
        ))}
      </div>
    </div>
  )
}

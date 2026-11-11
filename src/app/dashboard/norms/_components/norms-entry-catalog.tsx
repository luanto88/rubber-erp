"use client"

// Định mức KTKT GĐ2 — "Danh mục": đồng hồ điện / nước (ký hiệu, hệ số, khu vực, tick "Dùng báo cáo định mức"
// + chỉ tiêu + dây chuyền + hiệu lực) và vị trí kiểm kê tồn xưởng. In tem QR đồng hồ (dán tại đồng hồ → quét mở
// trang nhập nhanh). Ghi cần norms.manage_config. Rule 30.

import { useCallback, useEffect, useMemo, useState } from "react"
import { Gauge, Layers, MapPin, Pencil, Plus, Printer, QrCode, Trash2 } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { hasPermission, type SessionUser } from "@/lib/auth"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { GRADE_DAY_CHUYEN } from "@/lib/product-grade"
import { loadNormFloorLocations, loadNormItems, loadNormMeters } from "@/lib/norms/client"
import {
  NORM_METER_LOAI_LABEL,
  fmtQty,
  type NormFloorLocation,
  type NormItem,
  type NormMeter,
  type NormMeterLoai,
} from "@/lib/norms/types"
import { buildNormMeterPath, buildNormMeterUrl } from "@/lib/norms/meters"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { ModalShell } from "@/app/dashboard/_components/modal-shell"
import { NormsReportCategories } from "./norms-report-categories"
import { btnCls, btnDangerCls, btnPrimaryCls, errText, Field, fmtDate, inputCls, parseQtyInput } from "./norms-ui"

type MeterForm = {
  id: string | null
  code: string
  name: string
  khu_vuc: string
  loai: NormMeterLoai
  he_so: string
  dung_dinh_muc: boolean
  norm_item_id: string
  day_chuyen: string
  hieu_luc_tu: string
  hieu_luc_den: string
  sort_order: string
  is_active: boolean
  ghi_chu: string
}

type LocationForm = { id: string | null; code: string; name: string; sort_order: string; is_active: boolean }

export function NormsEntryCatalog({
  factoryId,
  user,
  showToast,
}: {
  factoryId: string
  user: SessionUser | null
  showToast: (kind: "ok" | "err", text: string) => void
}) {
  const canManage = hasPermission(user, "norms.manage_config")
  const [sub, setSub] = useState<"meters" | "locations" | "categories">("meters")
  const [meters, setMeters] = useState<NormMeter[]>([])
  const [items, setItems] = useState<NormItem[]>([])
  const [locations, setLocations] = useState<NormFloorLocation[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [meterForm, setMeterForm] = useState<MeterForm | null>(null)
  const [locForm, setLocForm] = useState<LocationForm | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const [m, it, loc] = await Promise.all([loadNormMeters(factoryId), loadNormItems(factoryId), loadNormFloorLocations(factoryId)])
      setMeters(m)
      setItems(it)
      setLocations(loc)
    } catch (e) {
      setLoadError(errText(e, "Không tải được danh mục. Kiểm tra đã chạy migration 20261122 chưa."))
    } finally {
      setLoading(false)
    }
  }, [factoryId])

  useEffect(() => {
    void load()
  }, [load])

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const meterItems = useMemo(() => items.filter((i) => i.actual_source === "dong_ho"), [items])
  const khuVucOptions = useMemo(() => [...new Set(meters.map((m) => m.khu_vuc).filter(Boolean))], [meters])

  const openMeter = (m: NormMeter | null) =>
    setMeterForm(
      m
        ? {
            id: m.id, code: m.code, name: m.name, khu_vuc: m.khu_vuc, loai: m.loai, he_so: String(m.he_so),
            dung_dinh_muc: m.dung_dinh_muc, norm_item_id: m.norm_item_id || "", day_chuyen: m.day_chuyen || "",
            hieu_luc_tu: m.hieu_luc_tu || "", hieu_luc_den: m.hieu_luc_den || "", sort_order: String(m.sort_order),
            is_active: m.is_active, ghi_chu: m.ghi_chu || "",
          }
        : {
            id: null, code: "", name: "", khu_vuc: "", loai: "dien", he_so: "1", dung_dinh_muc: false, norm_item_id: "",
            day_chuyen: "", hieu_luc_tu: getFactoryTodayISO(), hieu_luc_den: "",
            sort_order: String((meters.reduce((mx, x) => Math.max(mx, x.sort_order), 0) || 0) + 10), is_active: true, ghi_chu: "",
          },
    )

  const saveMeter = async () => {
    if (!meterForm) return
    const f = meterForm
    const heSo = parseQtyInput(f.he_so)
    if (!f.code.trim() || !f.name.trim()) return showToast("err", "Cần Ký hiệu và Tên đồng hồ.")
    if (heSo === null || Number.isNaN(heSo) || heSo <= 0) return showToast("err", "Hệ số phải là số > 0.")
    if (f.dung_dinh_muc && !f.norm_item_id) return showToast("err", 'Tick "Dùng báo cáo định mức" thì phải chọn chỉ tiêu định mức.')
    if (f.hieu_luc_tu && f.hieu_luc_den && f.hieu_luc_den < f.hieu_luc_tu) return showToast("err", "Hiệu lực đến phải sau hiệu lực từ.")
    const original = f.id ? meters.find((m) => m.id === f.id) : null
    if (original && Number(original.he_so) !== heSo &&
      !window.confirm("Đổi hệ số chỉ áp cho các lần ghi MỚI; lần ghi cũ giữ hệ số đã chụp. Tiếp tục?")) return
    const payload = {
      code: f.code.trim().toUpperCase(),
      name: f.name.trim(),
      khu_vuc: f.khu_vuc.trim(),
      loai: f.loai,
      he_so: heSo,
      dung_dinh_muc: f.dung_dinh_muc,
      norm_item_id: f.norm_item_id || null,
      day_chuyen: f.day_chuyen || null,
      hieu_luc_tu: f.hieu_luc_tu || null,
      hieu_luc_den: f.hieu_luc_den || null,
      sort_order: Number(f.sort_order) || 100,
      is_active: f.is_active,
      ghi_chu: f.ghi_chu.trim() || null,
    }
    setBusy(true)
    try {
      if (f.id) {
        const { error } = await supabase.from("tech_norm_meters").update(payload).eq("id", f.id).eq("factory_id", factoryId)
        if (error) throw error
      } else {
        const { error } = await supabase.from("tech_norm_meters").insert({ ...payload, factory_id: factoryId })
        if (error) throw error
      }
      setMeterForm(null)
      showToast("ok", "Đã lưu đồng hồ.")
      void load()
    } catch (e) {
      const msg = errText(e, "Không lưu được đồng hồ.")
      showToast("err", msg.includes("duplicate key") ? "Ký hiệu đồng hồ đã tồn tại." : msg)
    } finally {
      setBusy(false)
    }
  }

  const deleteMeter = async (m: NormMeter) => {
    const { count, error: cErr } = await supabase
      .from("tech_norm_meter_readings")
      .select("id", { count: "exact", head: true })
      .eq("factory_id", factoryId)
      .eq("meter_id", m.id)
    if (cErr) return showToast("err", errText(cErr, "Không kiểm tra được lần ghi."))
    if ((count || 0) > 0) return showToast("err", `Đồng hồ ${m.code} đã có ${count} lần ghi — chỉ được bỏ tick "Đang dùng", không xoá.`)
    if (!window.confirm(`Xoá đồng hồ ${m.code}?`)) return
    const { error } = await supabase.from("tech_norm_meters").delete().eq("id", m.id).eq("factory_id", factoryId)
    if (error) return showToast("err", errText(error, "Không xoá được."))
    showToast("ok", "Đã xoá đồng hồ.")
    void load()
  }

  const saveLocation = async () => {
    if (!locForm) return
    if (!locForm.code.trim() || !locForm.name.trim()) return showToast("err", "Cần Mã và Tên vị trí.")
    const payload = {
      code: locForm.code.trim().toUpperCase(),
      name: locForm.name.trim(),
      sort_order: Number(locForm.sort_order) || 100,
      is_active: locForm.is_active,
    }
    setBusy(true)
    try {
      if (locForm.id) {
        const { error } = await supabase.from("tech_norm_floor_locations").update(payload).eq("id", locForm.id).eq("factory_id", factoryId)
        if (error) throw error
      } else {
        const { error } = await supabase.from("tech_norm_floor_locations").insert({ ...payload, factory_id: factoryId })
        if (error) throw error
      }
      setLocForm(null)
      showToast("ok", "Đã lưu vị trí.")
      void load()
    } catch (e) {
      const msg = errText(e, "Không lưu được vị trí.")
      showToast("err", msg.includes("duplicate key") ? "Mã vị trí đã tồn tại." : msg)
    } finally {
      setBusy(false)
    }
  }

  const deleteLocation = async (l: NormFloorLocation) => {
    if (!window.confirm(`Xoá vị trí ${l.name}? (Vị trí đã có số kiểm kê sẽ không xoá được — hãy bỏ tick "Đang dùng".)`)) return
    const { error } = await supabase.from("tech_norm_floor_locations").delete().eq("id", l.id).eq("factory_id", factoryId)
    if (error) return showToast("err", error.message.includes("foreign key") ? "Vị trí đã có số kiểm kê — chỉ được ngừng dùng." : errText(error, "Không xoá được."))
    showToast("ok", "Đã xoá vị trí.")
    void load()
  }

  const printQr = async () => {
    const list = meters.filter((m) => selected.has(m.id))
    if (!list.length) return
    try {
      const { buildQrLabelsPdf } = await import("@/lib/equipment-qr-pdf")
      const doc = await buildQrLabelsPdf(
        list.map((m) => ({ code: m.code, name: m.name, url: buildNormMeterUrl(m.id) })),
        "Tem QR đồng hồ điện nước — cắt theo đường viền",
      )
      doc.save(`tem-qr-dong-ho-${list.length}-${getFactoryTodayISO()}.pdf`)
    } catch (e) {
      showToast("err", errText(e, "Không tạo được PDF tem QR."))
    }
  }

  if (loading) return <ListState kind="loading" />
  if (loadError) return <ListState kind="error" message={loadError} onRetry={() => void load()} />

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedTabs
          size="sm"
          ariaLabel="Danh mục nhập liệu"
          value={sub}
          onChange={setSub}
          items={[
            { key: "meters", label: "Đồng hồ điện nước", icon: Gauge, count: meters.length },
            { key: "locations", label: "Vị trí kiểm kê", icon: MapPin, count: locations.length },
            { key: "categories", label: "Nhóm vật tư báo cáo", icon: Layers },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          {sub === "meters" && (
            <button type="button" className={btnCls} disabled={!selected.size} onClick={() => void printQr()}>
              <Printer size={15} /> In tem QR ({selected.size})
            </button>
          )}
          {canManage && sub !== "categories" && (
            <button
              type="button"
              className={btnPrimaryCls}
              onClick={() =>
                sub === "meters"
                  ? openMeter(null)
                  : setLocForm({ id: null, code: "", name: "", sort_order: String(locations.length * 10 + 10), is_active: true })
              }
            >
              <Plus size={15} /> {sub === "meters" ? "Thêm đồng hồ" : "Thêm vị trí"}
            </button>
          )}
        </div>
      </div>

      {sub === "categories" ? (
        <NormsReportCategories factoryId={factoryId} user={user} showToast={showToast} />
      ) : sub === "meters" ? (
        <ResponsiveTableWrapper>
          <table className="enterprise-table dense min-w-[980px]">
            <thead>
              <tr>
                <th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Chọn tất cả"
                    checked={meters.length > 0 && meters.every((m) => selected.has(m.id))}
                    onChange={(e) => setSelected(e.target.checked ? new Set(meters.map((m) => m.id)) : new Set())}
                  />
                </th>
                <th>Ký hiệu</th>
                <th>Tên đồng hồ</th>
                <th>Khu vực</th>
                <th>Loại</th>
                <th className="text-right">Hệ số</th>
                <th>Dùng báo cáo định mức</th>
                <th>Trạng thái</th>
                <th className="text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {meters.map((m) => {
                const item = m.norm_item_id ? itemById.get(m.norm_item_id) : null
                return (
                  <tr key={m.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected.has(m.id)}
                        onChange={() =>
                          setSelected((prev) => {
                            const next = new Set(prev)
                            if (next.has(m.id)) next.delete(m.id)
                            else next.add(m.id)
                            return next
                          })
                        }
                      />
                    </td>
                    <td className="whitespace-nowrap font-code text-xs font-bold">{m.code}</td>
                    <td className="text-sm">{m.name}</td>
                    <td className="text-xs text-slate-600">{m.khu_vuc}</td>
                    <td className="text-xs">{NORM_METER_LOAI_LABEL[m.loai]}</td>
                    <td className="text-right tabular-nums">{fmtQty(m.he_so, 4)}</td>
                    <td className="text-xs">
                      {m.dung_dinh_muc ? (
                        <>
                          <div className="font-semibold text-slate-800">
                            {item?.name || "?"}
                            {m.day_chuyen ? ` · ${m.day_chuyen}` : ""}
                          </div>
                          <div className="text-slate-500">
                            {m.hieu_luc_tu ? `Từ ${fmtDate(m.hieu_luc_tu)}` : "Từ đầu"}
                            {m.hieu_luc_den ? ` đến ${fmtDate(m.hieu_luc_den)}` : ""}
                          </div>
                        </>
                      ) : (
                        <span className="text-slate-400">Không</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge tone={m.is_active ? "valid" : "draft"} label={m.is_active ? "Đang dùng" : "Ngừng dùng"} />
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <a
                        href={buildNormMeterPath(m.id)}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100"
                        title="Trang nhập nhanh (QR)"
                      >
                        <QrCode size={15} />
                      </a>
                      {canManage && (
                        <>
                          <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-amber-600 hover:bg-amber-50" title="Sửa" onClick={() => openMeter(m)}>
                            <Pencil size={15} />
                          </button>
                          <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-red-600 hover:bg-red-50" title="Xoá" onClick={() => void deleteMeter(m)}>
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
              {!meters.length && <ListState kind="empty" asRow colSpan={9} message="Chưa có đồng hồ." />}
            </tbody>
          </table>
        </ResponsiveTableWrapper>
      ) : (
        <ResponsiveTableWrapper>
          <table className="enterprise-table dense min-w-[560px]">
            <thead>
              <tr>
                <th>Mã</th>
                <th>Tên vị trí</th>
                <th className="text-right">Thứ tự</th>
                <th>Trạng thái</th>
                <th className="text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {locations.map((l) => (
                <tr key={l.id}>
                  <td className="font-code text-xs font-bold">{l.code}</td>
                  <td className="text-sm">{l.name}</td>
                  <td className="text-right tabular-nums">{l.sort_order}</td>
                  <td>
                    <StatusBadge tone={l.is_active ? "valid" : "draft"} label={l.is_active ? "Đang dùng" : "Ngừng dùng"} />
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {canManage && (
                      <>
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-amber-600 hover:bg-amber-50"
                          title="Sửa"
                          onClick={() => setLocForm({ id: l.id, code: l.code, name: l.name, sort_order: String(l.sort_order), is_active: l.is_active })}
                        >
                          <Pencil size={15} />
                        </button>
                        <button type="button" className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-red-600 hover:bg-red-50" title="Xoá" onClick={() => void deleteLocation(l)}>
                          <Trash2 size={15} />
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!locations.length && <ListState kind="empty" asRow colSpan={5} message="Chưa có vị trí kiểm kê (vd Bồn Formic, Kho xưởng mủ tạp)." />}
            </tbody>
          </table>
        </ResponsiveTableWrapper>
      )}

      {meterForm && (
        <ModalShell
          title={meterForm.id ? `Sửa đồng hồ ${meterForm.code}` : "Thêm đồng hồ"}
          onClose={() => setMeterForm(null)}
          maxWidth="xl"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" className={btnCls} onClick={() => setMeterForm(null)}>
                Huỷ
              </button>
              <button type="button" className={btnPrimaryCls} disabled={busy} onClick={() => void saveMeter()}>
                {busy ? "Đang lưu…" : "Lưu"}
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Ký hiệu *">
              <input className={inputCls} value={meterForm.code} onChange={(e) => setMeterForm({ ...meterForm, code: e.target.value })} placeholder="ĐH-01" />
            </Field>
            <Field label="Tên đồng hồ *">
              <input className={inputCls} value={meterForm.name} onChange={(e) => setMeterForm({ ...meterForm, name: e.target.value })} placeholder="Điện khu vực DCMT" />
            </Field>
            <Field label="Khu vực (nhóm in báo cáo)">
              <input
                className={inputCls}
                list="norm-meter-khu-vuc"
                value={meterForm.khu_vuc}
                onChange={(e) => setMeterForm({ ...meterForm, khu_vuc: e.target.value })}
                placeholder="Dây chuyền sản xuất CSR10,20"
              />
              <datalist id="norm-meter-khu-vuc">
                {khuVucOptions.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Loại">
                <select className={inputCls} value={meterForm.loai} onChange={(e) => setMeterForm({ ...meterForm, loai: e.target.value as NormMeterLoai })}>
                  {(Object.keys(NORM_METER_LOAI_LABEL) as NormMeterLoai[]).map((k) => (
                    <option key={k} value={k}>
                      {NORM_METER_LOAI_LABEL[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Hệ số nhân *" hint="vd 200 cho đồng hồ qua biến dòng">
                <input className={inputCls} inputMode="decimal" value={meterForm.he_so} onChange={(e) => setMeterForm({ ...meterForm, he_so: e.target.value })} />
              </Field>
            </div>
            <label className="col-span-full flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={meterForm.dung_dinh_muc}
                onChange={(e) => setMeterForm({ ...meterForm, dung_dinh_muc: e.target.checked })}
              />
              <span>
                <span className="font-semibold">Dùng báo cáo định mức</span>
                <span className="block text-xs text-slate-500">
                  Tiêu thụ đồng hồ này cộng vào số thực tế của chỉ tiêu + dây chuyền bên dưới, trong khoảng hiệu lực.
                </span>
              </span>
            </label>
            {meterForm.dung_dinh_muc && (
              <>
                <Field label="Chỉ tiêu định mức *">
                  <select className={inputCls} value={meterForm.norm_item_id} onChange={(e) => setMeterForm({ ...meterForm, norm_item_id: e.target.value })}>
                    <option value="">— Chọn —</option>
                    {meterItems.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} ({i.code})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Dây chuyền" hint="Để trống nếu chỉ tiêu không theo dây chuyền">
                  <select className={inputCls} value={meterForm.day_chuyen} onChange={(e) => setMeterForm({ ...meterForm, day_chuyen: e.target.value })}>
                    <option value="">— Không —</option>
                    {GRADE_DAY_CHUYEN.map((dc) => (
                      <option key={dc} value={dc}>
                        {dc}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Hiệu lực từ">
                  <input type="date" className={inputCls} value={meterForm.hieu_luc_tu} onChange={(e) => setMeterForm({ ...meterForm, hieu_luc_tu: e.target.value })} />
                </Field>
                <Field label="Hiệu lực đến" hint="Để trống = còn hiệu lực">
                  <input type="date" className={inputCls} value={meterForm.hieu_luc_den} onChange={(e) => setMeterForm({ ...meterForm, hieu_luc_den: e.target.value })} />
                </Field>
              </>
            )}
            <Field label="Thứ tự">
              <input className={inputCls} inputMode="numeric" value={meterForm.sort_order} onChange={(e) => setMeterForm({ ...meterForm, sort_order: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 pt-6 text-sm">
              <input type="checkbox" checked={meterForm.is_active} onChange={(e) => setMeterForm({ ...meterForm, is_active: e.target.checked })} />
              Đang dùng
            </label>
            <div className="col-span-full">
              <Field label="Ghi chú">
                <input className={inputCls} value={meterForm.ghi_chu} onChange={(e) => setMeterForm({ ...meterForm, ghi_chu: e.target.value })} />
              </Field>
            </div>
          </div>
        </ModalShell>
      )}

      {locForm && (
        <ModalShell
          title={locForm.id ? "Sửa vị trí kiểm kê" : "Thêm vị trí kiểm kê"}
          onClose={() => setLocForm(null)}
          maxWidth="md"
          footer={
            <div className="flex justify-end gap-2">
              <button type="button" className={btnCls} onClick={() => setLocForm(null)}>
                Huỷ
              </button>
              <button type="button" className={btnPrimaryCls} disabled={busy} onClick={() => void saveLocation()}>
                {busy ? "Đang lưu…" : "Lưu"}
              </button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Mã *">
              <input className={inputCls} value={locForm.code} onChange={(e) => setLocForm({ ...locForm, code: e.target.value })} placeholder="BON_FORMIC" />
            </Field>
            <Field label="Tên vị trí *">
              <input className={inputCls} value={locForm.name} onChange={(e) => setLocForm({ ...locForm, name: e.target.value })} placeholder="Bồn Formic xưởng mủ nước" />
            </Field>
            <Field label="Thứ tự">
              <input className={inputCls} inputMode="numeric" value={locForm.sort_order} onChange={(e) => setLocForm({ ...locForm, sort_order: e.target.value })} />
            </Field>
            <label className="flex items-center gap-2 pt-6 text-sm">
              <input type="checkbox" checked={locForm.is_active} onChange={(e) => setLocForm({ ...locForm, is_active: e.target.checked })} />
              Đang dùng
            </label>
          </div>
        </ModalShell>
      )}
      {!canManage && <p className="text-xs text-slate-500">Chỉ xem — sửa danh mục cần quyền cấu hình định mức.</p>}
      {canManage && sub === "meters" && <DeleteHint />}
    </div>
  )
}

function DeleteHint() {
  return (
    <p className="flex items-center gap-1 text-xs text-slate-500">
      <span className={`${btnDangerCls} pointer-events-none px-1.5 py-0.5`}>
        <Trash2 size={11} />
      </span>
      chỉ xoá được đồng hồ chưa có lần ghi; đồng hồ đã dùng hãy bỏ tick &quot;Đang dùng&quot;.
    </p>
  )
}

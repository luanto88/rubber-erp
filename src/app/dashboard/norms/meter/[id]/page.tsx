"use client"

// Định mức KTKT GĐ2 — trang nhập nhanh chỉ số 1 đồng hồ (mở từ tem QR dán tại đồng hồ, tối ưu điện thoại).
// Chưa đăng nhập ⇒ layout dashboard đưa về /login?next=. Ghi cần norms.periodic_entry. Rule 30.
// GĐ2b (chưa làm): ghi khi mất mạng bằng hàng đợi IndexedDB + client_id.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { AlertTriangle, ArrowLeft, CheckCircle2, Gauge, Save } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hasPermission, type SessionUser } from "@/lib/auth"
import { getFactoryTodayISO } from "@/lib/date-utils"
import { loadNormMeterReadings } from "@/lib/norms/client"
import { NORM_METER_LOAI_LABEL, NORM_METER_UNIT, fmtQty, type NormMeter, type NormMeterReading } from "@/lib/norms/types"
import { previousReading, readingWarnings, stepConsumption } from "@/lib/norms/meters"
import { moduleThemeClass } from "@/app/dashboard/_components/doc-ui/module-theme"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { ImageLightbox, PurchaseImagePicker } from "@/app/dashboard/purchase/_components/purchase-image-picker"
import { btnPrimaryCls, errText, Field, fmtDate, inputCls, parseQtyInput } from "../../_components/norms-ui"

function readCachedUser(): SessionUser | null {
  try {
    return JSON.parse(localStorage.getItem("erp_user") || "null") as SessionUser | null
  } catch {
    return null
  }
}

export default function NormMeterQuickPage() {
  const params = useParams<{ id: string }>()
  const meterId = params?.id
  const [user, setUser] = useState<SessionUser | null>(null)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [meter, setMeter] = useState<NormMeter | null>(null)
  const [readings, setReadings] = useState<NormMeterReading[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [date, setDate] = useState(() => getFactoryTodayISO())
  const [chiSo, setChiSo] = useState("")
  const [thay, setThay] = useState(false)
  const [chot, setChot] = useState("")
  const [images, setImages] = useState<string[]>([])
  const [ghiChu, setGhiChu] = useState("")
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const load = useCallback(async (fid: string, id: string) => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: mErr } = await supabase
        .from("tech_norm_meters")
        .select("id,factory_id,code,name,khu_vuc,loai,he_so,dung_dinh_muc,norm_item_id,day_chuyen,hieu_luc_tu,hieu_luc_den,sort_order,is_active,ghi_chu")
        .eq("factory_id", fid)
        .eq("id", id)
        .maybeSingle()
      if (mErr) throw mErr
      if (!data) {
        setError("Không tìm thấy đồng hồ này (tem sai hoặc khác nhà máy).")
        return
      }
      setMeter({ ...(data as NormMeter), he_so: Number((data as NormMeter).he_so) })
      setReadings(await loadNormMeterReadings(fid, id))
    } catch (e) {
      setError(errText(e, "Không tải được đồng hồ."))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const bootstrap = async () => {
      const cached = readCachedUser()
      if (!hasPermission(cached, "norms.view")) {
        setLoading(false)
        window.location.replace("/dashboard")
        return
      }
      setUser(cached)
      const fid = await getActiveFactoryId()
      if (!fid || !meterId) {
        setLoading(false)
        setError("Không xác định được nhà máy.")
        return
      }
      setFactoryId(fid)
      await load(fid, meterId)
    }
    void bootstrap()
  }, [meterId, load])

  const existing = useMemo(() => readings.find((r) => r.ngay === date), [readings, date])
  useEffect(() => {
    setChiSo(existing ? String(existing.chi_so) : "")
    setThay(existing?.thay_dong_ho || false)
    setChot(existing?.chi_so_chot_cu === null || existing?.chi_so_chot_cu === undefined ? "" : String(existing.chi_so_chot_cu))
    setImages(existing?.image_urls || [])
    setGhiChu(existing?.ghi_chu || "")
  }, [existing])

  const canEdit = hasPermission(user, "norms.periodic_entry")
  const prev = previousReading(readings, date)
  const parsed = parseQtyInput(chiSo)
  const parsedChot = parseQtyInput(chot)
  const nextLike =
    meter && parsed !== null && !Number.isNaN(parsed) && (!thay || (parsedChot !== null && !Number.isNaN(parsedChot)))
      ? { ngay: date, chi_so: parsed, he_so: existing?.he_so ?? meter.he_so, thay_dong_ho: thay, chi_so_chot_cu: thay ? parsedChot : null }
      : null
  const value = nextLike && prev ? stepConsumption(prev, nextLike) : null
  const warnings = nextLike ? readingWarnings(readings, nextLike) : []

  const save = async () => {
    if (!meter || !factoryId || !canEdit) return
    if (parsed === null || Number.isNaN(parsed) || parsed < 0) return setMessage({ kind: "err", text: "Nhập chỉ số mới hợp lệ." })
    if (thay && (parsedChot === null || Number.isNaN(parsedChot) || parsedChot < 0))
      return setMessage({ kind: "err", text: "Đã tick Thay đồng hồ thì phải nhập chỉ số chốt đồng hồ cũ." })
    setSaving(true)
    setMessage(null)
    try {
      const { error: uErr } = await supabase.from("tech_norm_meter_readings").upsert(
        {
          factory_id: factoryId,
          meter_id: meter.id,
          ngay: date,
          chi_so: parsed,
          he_so: existing?.he_so ?? meter.he_so,
          thay_dong_ho: thay,
          chi_so_chot_cu: thay ? parsedChot : null,
          image_urls: images,
          ghi_chu: ghiChu.trim() || null,
          nhap_qua: existing?.nhap_qua ?? "qr",
        },
        { onConflict: "meter_id,ngay" },
      )
      if (uErr) throw uErr
      setMessage({ kind: "ok", text: `Đã lưu chỉ số ${meter.code} ngày ${fmtDate(date)}.` })
      setReadings(await loadNormMeterReadings(factoryId, meter.id))
    } catch (e) {
      setMessage({ kind: "err", text: errText(e, "Không lưu được chỉ số.") })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${moduleThemeClass("moss")} mx-auto max-w-lg space-y-4`}>
      <Link href="/dashboard/norms?tab=entry" className="inline-flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900">
        <ArrowLeft size={16} /> Nhập liệu định mức
      </Link>
      {loading ? (
        <ListState kind="loading" />
      ) : error || !meter ? (
        <ListState kind="error" message={error || "Không tải được đồng hồ."} />
      ) : (
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-mod-50 text-mod-800">
              <Gauge size={22} />
            </span>
            <div className="min-w-0">
              <div className="font-code text-lg font-extrabold text-slate-900">{meter.code}</div>
              <div className="text-sm text-slate-700">{meter.name}</div>
              <div className="text-xs text-slate-500">
                {meter.khu_vuc} · {NORM_METER_LOAI_LABEL[meter.loai]} · Hệ số {fmtQty(meter.he_so, 4)}
                {!meter.is_active && <span className="ml-1 font-semibold text-red-600">· Ngừng dùng</span>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-sm">
            <div>
              <div className="text-xs text-slate-500">Chỉ số cũ</div>
              <div className="font-bold tabular-nums">{prev ? fmtQty(prev.chi_so) : "—"}</div>
              <div className="text-[11px] text-slate-400">{prev ? fmtDate(prev.ngay) : "Lần ghi đầu"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500">Tiêu thụ</div>
              <div className="font-bold tabular-nums text-mod-800">
                {value === null ? "—" : `${fmtQty(value, 1)} ${NORM_METER_UNIT[meter.loai]}`}
              </div>
            </div>
          </div>

          <Field label="Ngày ghi">
            <input type="date" className={inputCls} value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </Field>
          <Field label="Chỉ số mới *" hint={existing ? "Ngày này đã có chỉ số — lưu sẽ ghi đè." : undefined}>
            <input
              className={`${inputCls} h-12 text-right text-lg font-bold tabular-nums`}
              inputMode="decimal"
              disabled={!canEdit}
              value={chiSo}
              onChange={(e) => setChiSo(e.target.value)}
              autoFocus
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!canEdit} checked={thay} onChange={(e) => setThay(e.target.checked)} />
            Đã thay / reset đồng hồ
          </label>
          {thay && (
            <Field label="Chỉ số chốt đồng hồ cũ *" hint="Ô Chỉ số mới = chỉ số đầu của đồng hồ mới.">
              <input className={`${inputCls} text-right tabular-nums`} inputMode="decimal" disabled={!canEdit} value={chot} onChange={(e) => setChot(e.target.value)} />
            </Field>
          )}
          {warnings.map((w, i) => (
            <div key={i} className={`flex items-start gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold ${w.level === "danger" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {w.text}
            </div>
          ))}
          {factoryId && canEdit && (
            <PurchaseImagePicker
              factoryId={factoryId}
              documentType="norms-meters"
              images={images}
              onChange={setImages}
              max={4}
              variant="inline"
              label="Ảnh mặt đồng hồ"
              onPreview={setPreview}
            />
          )}
          <Field label="Ghi chú">
            <input className={inputCls} disabled={!canEdit} value={ghiChu} onChange={(e) => setGhiChu(e.target.value)} />
          </Field>
          {message && (
            <div className={`flex items-start gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold ${message.kind === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
              {message.kind === "ok" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
              {message.text}
            </div>
          )}
          {canEdit ? (
            <button type="button" className={`${btnPrimaryCls} h-12 w-full justify-center text-base`} disabled={saving} onClick={() => void save()}>
              <Save size={18} /> {saving ? "Đang lưu…" : "Lưu chỉ số"}
            </button>
          ) : (
            <p className="text-center text-xs text-slate-500">Chỉ xem — cần quyền nhập liệu định mức.</p>
          )}

          {readings.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-bold text-slate-600">Lần ghi gần đây</div>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
                {[...readings]
                  .reverse()
                  .slice(0, 6)
                  .map((r) => {
                    const idx = readings.findIndex((x) => x.id === r.id)
                    const v = idx > 0 ? stepConsumption(readings[idx - 1], r) : null
                    return (
                      <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <span className="text-slate-600">{fmtDate(r.ngay)}</span>
                        <span className="tabular-nums">{fmtQty(r.chi_so)}</span>
                        <span className="tabular-nums text-xs text-slate-500">{v === null ? "" : `+${fmtQty(v, 1)} ${NORM_METER_UNIT[meter.loai]}`}</span>
                      </li>
                    )
                  })}
              </ul>
            </div>
          )}
        </div>
      )}
      <ImageLightbox url={preview} onClose={() => setPreview(null)} />
    </div>
  )
}

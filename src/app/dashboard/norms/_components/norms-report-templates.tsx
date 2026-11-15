"use client"

// Định mức KTKT GĐ4 — "Mẫu báo cáo": bật/tắt, đổi tên; Mẫu 8A: thành phần nhà máy (in đầu báo cáo) + mã chỉ tiêu in
// ở mục 7 (xử lý nước thải). Đổi cấu hình ⇒ phiên bản +1, báo cáo đã lập giữ cấu hình cũ. Rule 30.

import { useEffect, useState } from "react"
import { Save } from "lucide-react"
import { loadReportTemplates, saveReportTemplate } from "@/lib/norms/report-client"
import type { NormReportTemplate, Thang8aConfig } from "@/lib/norms/report-types"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { btnPrimaryCls, errText, inputCls, useToast } from "./norms-ui"

const KIEU_LABEL = { thang_8a: "Báo cáo kết quả sản xuất tháng (mẫu 54-BC)", dong_ho: "Tổng hợp điện nước theo đồng hồ (mẫu 51-BC)" } as const
const splitCodes = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean)

function TemplateCard({ t, onSaved }: { t: NormReportTemplate; onSaved: (msg: string) => void }) {
  const cfg = (t.config || {}) as Thang8aConfig
  const [name, setName] = useState(t.name)
  const [active, setActive] = useState(t.is_active)
  const [thanhPhan, setThanhPhan] = useState(cfg.thanhPhan || "")
  const [xlnt, setXlnt] = useState((cfg.xlntItemCodes || []).join(", "))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    setBusy(true)
    setErr(null)
    try {
      const config = t.kieu === "thang_8a" ? { ...(t.config || {}), thanhPhan: thanhPhan.trim(), xlntItemCodes: splitCodes(xlnt) } : t.config || {}
      await saveReportTemplate(t.id, { name: name.trim() || t.name, is_active: active, config })
      onSaved(`Đã lưu ${t.code}`)
    } catch (e) {
      setErr(errText(e, "Không lưu được mẫu."))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-code text-sm font-bold text-slate-800">{t.code}</div>
          <div className="text-xs text-slate-500">
            {KIEU_LABEL[t.kieu]} · phiên bản {t.phien_ban} · {t.khoa_ngay ? "khoá ngày nhập liệu khi ký" : "không khoá ngày"}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Đang dùng
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-slate-600">Tên báo cáo</span>
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {t.kieu === "thang_8a" && (
        <>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-600">Thành phần nhà máy (mỗi dòng 1 người — in đầu báo cáo)</span>
            <textarea
              className={`${inputCls} h-32 py-2`}
              value={thanhPhan}
              onChange={(e) => setThanhPhan(e.target.value)}
              placeholder={"Ông: Tô Thành Luân — Chức vụ: Phó giám đốc phụ trách Nhà máy\nÔng: Nguyễn Hữu Thọ — Chức vụ: Nhân viên Kỹ thuật"}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-slate-600">Mã chỉ tiêu in ở mục 7 (xử lý nước thải) — ngoài các chỉ tiêu tên có “nước thải”</span>
            <input className={inputCls} value={xlnt} onChange={(e) => setXlnt(e.target.value)} placeholder="vd PAC, POLY_A" />
          </label>
        </>
      )}
      {err && <div className="text-sm font-semibold text-red-700">{err}</div>}
      <div className="flex justify-end">
        <button type="button" className={btnPrimaryCls} disabled={busy} onClick={() => void save()}>
          <Save size={15} /> {busy ? "Đang lưu…" : "Lưu mẫu"}
        </button>
      </div>
    </div>
  )
}

export function NormsReportTemplatesConfig({ factoryId }: { factoryId: string }) {
  const [list, setList] = useState<NormReportTemplate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { showToast, toastNode } = useToast()
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    void (async () => {
      try {
        setList(await loadReportTemplates(factoryId))
      } catch (e) {
        setError(errText(e, "Không tải được mẫu báo cáo. Kiểm tra đã chạy migration 20261124 chưa."))
      }
    })()
  }, [factoryId, nonce])

  if (error) return <ListState kind="error" message={error} />
  if (!list) return <ListState kind="loading" />
  if (!list.length) return <ListState kind="empty" message="Chưa có mẫu báo cáo (migration 20261124 chỉ seed cho nhà máy phuochoa_kt)." />
  return (
    <div className="space-y-3">
      {toastNode}
      <p className="text-xs text-slate-500">
        Báo cáo sử dụng vật tư hóa chất / dầu theo ngày (mẫu 55-BC, 46-BC) sẽ làm ở tab Báo cáo của module Kho vật tư.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        {list.map((t) => (
          <TemplateCard
            key={`${t.id}-${t.phien_ban}`}
            t={t}
            onSaved={(m) => {
              showToast("ok", m)
              setNonce((n) => n + 1)
            }}
          />
        ))}
      </div>
    </div>
  )
}

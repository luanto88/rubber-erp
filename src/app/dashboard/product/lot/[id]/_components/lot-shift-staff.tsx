"use client"

// C2b Truy vết — khối "Nhân sự ca" ở trang chi tiết lô thành phẩm (rule 31). Chỉ hiển thị; dữ liệu từ
// loadLotShiftStaff (server action, đã lọc xếp loại / người vắng theo quyền chấm công của người xem).

import { formatStorageDate } from "@/lib/storage-detail"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import type { LotShiftBlock, LotShiftStaffResult } from "../shift-staff-actions"

const fmtKg = (v: number) => `${Math.round(v || 0).toLocaleString("vi-VN")} kg`

export function lotShiftTitle(b: LotShiftBlock): string {
  return `${formatStorageDate(b.ngay)} · ${b.caTen}${b.kien.length ? ` — Kiện ${b.kien.join(", ")}` : ""}`
}

function ShiftStatus({ b }: { b: LotShiftBlock }) {
  if (!b.section) return <StatusBadge tone="draft" label="Chưa có phiếu" size="xs" />
  return (
    <StatusBadge
      domain="attendance_sheet"
      status={b.section.trangThai}
      size="xs"
      title={b.section.trangThai === "da_duyet" ? "Phiếu điểm danh đã duyệt" : "Chưa duyệt — có thể còn thay đổi"}
    />
  )
}

type Props = { data: LotShiftStaffResult | null; loading: boolean; error: string | null }

export function LotShiftStaffView({ data, loading, error, onRetry }: Props & { onRetry: () => void }) {
  if (loading && !data) return <ListState kind="loading" message="Đang tải nhân sự ca…" />
  if (error) return <ListState kind="error" message={error} onRetry={onRetry} />
  const blocks = data?.blocks || []
  if (blocks.length === 0) return <ListState kind="empty" message="Lô chưa có giao dịch nhập thành phẩm" />
  const showXepLoai = !!data?.canSeeAttendance

  return (
    <div className="space-y-3">
      {blocks.map((b) => (
        <section key={b.key} className="rounded-2xl border border-slate-200 bg-white">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
            <div className="min-w-0">
              <div className="text-[13.5px] font-extrabold text-slate-800">{lotShiftTitle(b)}</div>
              <div className="text-[12px] text-slate-500">
                {b.soBanh.toLocaleString("vi-VN")} bành · {fmtKg(b.soKg)}
                {b.section ? ` · ${b.section.maPhieu}` : ""}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ShiftStatus b={b} />
              {b.section && showXepLoai && (
                <a href={`/dashboard/attendance/sheet/${b.section.sheetId}`} className="text-[12px] font-semibold text-brand-700 hover:underline">
                  Mở phiếu
                </a>
              )}
            </div>
          </header>
          {!b.section ? (
            <p className="px-4 py-4 text-[13px] text-slate-500">Chưa có phiếu điểm danh cho ca này.</p>
          ) : (
            <div className="space-y-2 px-4 py-3">
              {b.section.trangThai !== "da_duyet" && (
                <p className="rounded-lg bg-amber-50 px-3 py-1.5 text-[12px] text-amber-800">
                  Phiếu điểm danh chưa duyệt — danh sách có thể còn thay đổi.
                </p>
              )}
              <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-[12.5px] text-slate-600 sm:grid-cols-3">
                <div><span className="text-slate-400">Ca trưởng: </span>{b.section.caTruong || "—"}</div>
                <div><span className="text-slate-400">Ca phó: </span>{b.section.caPho || "—"}</div>
                <div><span className="text-slate-400">Giờ ca: </span>{b.section.gioBatDau || "—"} – {b.section.gioKetThuc || "—"}</div>
              </div>
              <ResponsiveTableWrapper className="rounded-none border-0 shadow-none">
                <table className="enterprise-table dense min-w-[560px]">
                  <thead>
                    <tr>
                      <th>Công việc</th>
                      <th>Người thực hiện</th>
                      <th>Xe</th>
                      {showXepLoai && <th>Xếp loại</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {b.section.rows.length === 0 ? (
                      <ListState kind="empty" message="Phiếu chưa giao việc cho ai" asRow colSpan={showXepLoai ? 4 : 3} />
                    ) : b.section.rows.map((r) => (
                      <tr key={r.ten}>
                        <td className="whitespace-nowrap font-semibold">{r.ten}</td>
                        <td>
                          {r.people.map((p, i) => (
                            <span key={`${p.ten}-${i}`}>
                              {i > 0 ? ", " : ""}
                              <span className={p.thayCho || p.tam ? "italic" : ""}>{p.ten}</span>
                              {p.thayCho ? <span className="text-slate-400"> (thay {p.thayCho})</span> : null}
                            </span>
                          ))}
                        </td>
                        <td className="whitespace-nowrap">
                          {Array.from(new Set(r.people.map((p) => p.xe).filter(Boolean))).join(", ") || "—"}
                        </td>
                        {showXepLoai && <td className="whitespace-nowrap">{r.people.map((p) => p.xepLoai || "—").join("-")}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ResponsiveTableWrapper>
              {showXepLoai && b.section.vang.length > 0 && (
                <div className="text-[12.5px] text-slate-600">
                  <span className="font-semibold text-slate-700">Vắng: </span>
                  {b.section.vang
                    .map(
                      (v) =>
                        `${v.ten} (${v.loai === "khong_phep" ? "không phép" : "có phép"}${v.lyDo ? `: ${v.lyDo}` : ""}${v.nguoiThay ? ` — ${v.nguoiThay} thay` : ""})`,
                    )
                    .join("; ")}
                </div>
              )}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}

export function LotShiftSummary({ data, loading, error, onOpen }: Props & { onOpen: () => void }) {
  if (loading && !data) return <p className="text-[12.5px] text-slate-500">Đang tải…</p>
  if (error) return <p className="text-[12.5px] text-red-700">{error}</p>
  const blocks = data?.blocks || []
  if (blocks.length === 0) return <p className="text-[12.5px] text-slate-500">Lô chưa có giao dịch nhập.</p>
  return (
    <div className="space-y-1.5">
      {blocks.map((b) => (
        <button
          key={b.key}
          type="button"
          onClick={onOpen}
          className="flex w-full items-start justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-left hover:border-mod-200 hover:bg-mod-50"
        >
          <span className="min-w-0 text-[12.5px] text-slate-700">
            <span className="font-bold">{lotShiftTitle(b)}</span>
            {b.section && (
              <span className="block text-[11.5px] text-slate-500">
                Ca trưởng {b.section.caTruong || "—"} · {b.section.gioBatDau || "—"}–{b.section.gioKetThuc || "—"} · {b.section.soNguoi} người
              </span>
            )}
          </span>
          <span className="shrink-0">
            <ShiftStatus b={b} />
          </span>
        </button>
      ))}
    </div>
  )
}

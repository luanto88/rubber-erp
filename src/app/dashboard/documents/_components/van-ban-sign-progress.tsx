"use client"

import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { stepDisplayLabel, type VanBanDocument } from "./documents-types"

/**
 * Dòng xổ của 1 văn bản ở danh sách (rule 29 mục A.3): tiến trình ký
 * Soạn thảo → các bước ký → Phê duyệt. Chỉ hiển thị, không có thao tác.
 */
export function VanBanSignProgress({ doc }: { doc: VanBanDocument }) {
  const steps = Array.isArray(doc.thu_tu_ky_json) ? doc.thu_tu_ky_json : []
  const nguoiKy = (doc.nguoi_ky || {}) as Record<string, { ten?: string; ky_at?: string }>
  const fmtTs = (v?: string | null) =>
    v ? new Date(v).toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" }) : ""

  type Row = { key: string; step: string; who: string; state: "done" | "current" | "waiting"; at?: string | null }
  const rows: Row[] = [
    {
      key: "st",
      step: "Soạn thảo",
      who: doc.nguoi_soan_thao_display || "—",
      state: doc.trang_thai === "draft" || doc.trang_thai === "tra_ve" ? "current" : "done",
    },
    ...steps.map((st, i): Row => {
      const signed = nguoiKy[String(i + 1)]
      const isCurrent = doc.trang_thai === "cho_ky_phong_ban" && doc.buoc_hien_tai === i
      return {
        key: `b${i}`,
        step: `Bước ${i + 1}`,
        who: signed?.ten
          ? `${signed.ten}${st.phong_ban_code ? ` · ${st.phong_ban_code}` : ""}`
          : stepDisplayLabel(st) || "—",
        state: signed ? "done" : isCurrent ? "current" : "waiting",
        at: signed?.ky_at,
      }
    }),
    {
      key: "pd",
      step: "Phê duyệt",
      who: doc.phe_duyet || "—",
      state: doc.trang_thai === "da_phe_duyet" ? "done" : doc.trang_thai === "cho_phe_duyet" ? "current" : "waiting",
      at: doc.ky_phe_duyet_at || doc.ngay_phe_duyet,
    },
  ]

  return (
    <table className="enterprise-table dense">
      <thead>
        <tr>
          <th>Bước</th>
          <th>Người ký</th>
          <th>Trạng thái</th>
          <th>Thời điểm ký</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className="whitespace-nowrap font-semibold text-slate-700">{r.step}</td>
            <td className="text-slate-700">{r.who}</td>
            <td>
              {r.state === "done" ? (
                <StatusBadge tone="valid" label={r.key === "st" ? "Đã gửi" : "Đã ký"} size="xs" />
              ) : r.state === "current" ? (
                <StatusBadge tone="pending" label={r.key === "st" ? "Đang soạn" : "Đang chờ ký"} size="xs" />
              ) : (
                <StatusBadge tone="draft" label="Chưa tới lượt" size="xs" />
              )}
            </td>
            <td className="whitespace-nowrap text-xs text-slate-500">
              {r.state === "done" && r.key !== "st" ? fmtTs(r.at) || "—" : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

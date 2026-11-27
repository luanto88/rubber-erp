"use client"

// A3 — 19 icon nét mảnh của Sơ đồ dây chuyền (chép từ bản mẫu cung_cap_dl/so_sanh_bo_cuc_diem_danh_mobile.html).
// Chuỗi SVG cố định do chính ta viết (không phải dữ liệu người dùng) ⇒ an toàn khi chèn bằng dangerouslySetInnerHTML.

import type { StationKey } from "@/lib/attendance/diagram"

type IconDef = { vb: string; svg: string }
const ICONS: Record<string, IconDef> = {
  truc_ca: { vb: "0 0 48 48", svg: "<path d=\"M11 41c0-6.5 5-10.5 13-10.5S37 34.5 37 41\" fill=\"#f1f5f9\"/><path d=\"M18 31l6 10 6-10M15 33l3 8M33 33l-3 8\" fill=\"none\" stroke=\"#f59e0b\" stroke-width=\"1.4\"/><circle cx=\"24\" cy=\"19\" r=\"6.5\" fill=\"#fef3c7\"/><path d=\"M16.5 17.5c0-4.5 3.3-7.5 7.5-7.5s7.5 3 7.5 7.5h-15z\" fill=\"#f59e0b\"/><rect x=\"33\" y=\"25\" width=\"9.5\" height=\"12\" rx=\"1.5\" fill=\"#fff\"/><path d=\"M35 29h5.5M35 32h4\" stroke=\"#64748b\" stroke-width=\"1.1\"/><circle cx=\"37.5\" cy=\"17.5\" r=\"3.8\" fill=\"#fff\"/><path d=\"M37.5 15.5v2.2l1.5 1\" stroke=\"#3b6e78\" fill=\"none\"/>" },
  lo_say: { vb: "0 0 48 48", svg: "<path d=\"M11 41c0-6.5 5-10.5 13-10.5S37 34.5 37 41\" fill=\"#3b6e78\"/><circle cx=\"24\" cy=\"19\" r=\"6.5\" fill=\"#fef3c7\"/><path d=\"M16.5 17.5c0-4.5 3.3-7.5 7.5-7.5s7.5 3 7.5 7.5h-15z\" fill=\"#64748b\"/><circle cx=\"33\" cy=\"34.5\" r=\"5\" fill=\"#fff\"/><path d=\"M33 34.5l2.2-2.2\" stroke=\"#ef4444\" stroke-width=\"1.4\"/><path d=\"M40 31.5c1.8 1.8 2.5 4.5 0 7.2-1.8-1-1.8-3.5 0-7.2z\" fill=\"#f59e0b\"/><path d=\"M34 19c0-1.5 1-2.5 0-4M37 19c0-1.5 1-2.5 0-4\" fill=\"none\" stroke=\"#94a3b8\" stroke-width=\"1.1\"/>" },
  bao_tri: { vb: "0 0 48 48", svg: "<path d=\"M11 41c0-6.5 5-10.5 13-10.5S37 34.5 37 41\" fill=\"#475569\"/><circle cx=\"24\" cy=\"19\" r=\"6.5\" fill=\"#fef3c7\"/><path d=\"M16.5 17.5c0-4.5 3.3-7.5 7.5-7.5s7.5 3 7.5 7.5h-15z\" fill=\"#3b6e78\"/><path d=\"M27 37l7.5-7.5 2.5 2.5-7.5 7.5-2.5-2.5z\" fill=\"#cbd5e1\"/><circle cx=\"39\" cy=\"35\" r=\"3.5\" fill=\"#fde68a\"/><circle cx=\"39\" cy=\"35\" r=\"1.3\" fill=\"#fff\"/>" },
  xlnt: { vb: "0 0 48 48", svg: "<path d=\"M9 41c0-6 4.5-10 12-10s12 4 12 10\" fill=\"#475569\"/><circle cx=\"21\" cy=\"19\" r=\"6.2\" fill=\"#fef3c7\"/><path d=\"M14 17.5c0-4.2 3-7 7-7s7 2.8 7 7H14z\" fill=\"#64748b\"/><ellipse cx=\"35.5\" cy=\"34\" rx=\"7.5\" ry=\"3\" fill=\"#7dd3fc\"/><path d=\"M28 34v5.5c0 1.8 3.4 3 7.5 3s7.5-1.2 7.5-3V34\" fill=\"#3b6e78\"/><path d=\"M33 25h5v3h-5z\" fill=\"#cbd5e1\"/>" },
  co_khi: { vb: "0 0 48 48", svg: "<path d=\"M7 41c0-5.8 4.2-9.5 11.5-9.5S30 35.2 30 41\" fill=\"#475569\"/><circle cx=\"18.5\" cy=\"19\" r=\"6.2\" fill=\"#fef3c7\"/><path d=\"M11.5 17.5c0-4.2 3-7 7-7s7 2.8 7 7h-14z\" fill=\"#64748b\"/><rect x=\"28\" y=\"31.5\" width=\"10.5\" height=\"6.5\" rx=\"1\" fill=\"#3b6e78\"/><rect x=\"38.5\" y=\"33\" width=\"5.5\" height=\"5\" rx=\"1\" fill=\"#fde68a\"/><circle cx=\"31.5\" cy=\"39.5\" r=\"2.2\" fill=\"#475569\"/><circle cx=\"41.5\" cy=\"39.5\" r=\"2.2\" fill=\"#475569\"/>" },
  xe_nang: { vb: "0 0 48 48", svg: "<path d=\"M7 41c0-5.8 4.2-9.5 11.5-9.5S30 35.2 30 41\" fill=\"#475569\"/><circle cx=\"18.5\" cy=\"19\" r=\"6.2\" fill=\"#fef3c7\"/><path d=\"M11.5 17.5c0-4.2 3-7 7-7s7 2.8 7 7h-14z\" fill=\"#64748b\"/><rect x=\"32\" y=\"29.5\" width=\"10.5\" height=\"8.5\" rx=\"1.5\" fill=\"#f59e0b\"/><path d=\"M30 23.5v15M25 36.5h5\" stroke=\"#3b6e78\" stroke-width=\"1.6\"/><rect x=\"24.5\" y=\"30.5\" width=\"4.8\" height=\"4.8\" fill=\"#fde68a\"/><circle cx=\"34.5\" cy=\"39.5\" r=\"2.2\" fill=\"#475569\"/><circle cx=\"40.5\" cy=\"39.5\" r=\"2.2\" fill=\"#475569\"/>" },
  xe_xuc: { vb: "0 0 56 44", svg: "<rect x=\"10\" y=\"17\" width=\"21\" height=\"12.5\" rx=\"2\" fill=\"#fde68a\"/><rect x=\"14.5\" y=\"8\" width=\"12.5\" height=\"9.5\" rx=\"1.5\" fill=\"#e0f2fe\"/><path d=\"M31 22l9.5-5.5v11L31 25.5z\" fill=\"#d9eaed\"/><path d=\"M40.5 15.5l9.5 12.5-6.5 2.8-3-4z\" fill=\"#3b6e78\"/><circle cx=\"16\" cy=\"32.5\" r=\"5.5\" fill=\"#e2e8f0\"/><circle cx=\"16\" cy=\"32.5\" r=\"2.2\" fill=\"#f59e0b\"/><circle cx=\"29.5\" cy=\"32.5\" r=\"5.5\" fill=\"#e2e8f0\"/><circle cx=\"29.5\" cy=\"32.5\" r=\"2.2\" fill=\"#f59e0b\"/>" },
  may_xe: { vb: "0 0 48 48", svg: "<circle cx=\"24\" cy=\"24\" r=\"16.5\" fill=\"#f1f5f9\" stroke=\"#3b6e78\" stroke-dasharray=\"4.5 2.5\"/><circle cx=\"24\" cy=\"24\" r=\"11\" fill=\"#d9eaed\"/><path d=\"M28 20a5.5 5.5 0 100 8\" fill=\"none\" stroke=\"#3b6e78\" stroke-width=\"1.6\"/><circle cx=\"24\" cy=\"24\" r=\"3.5\" fill=\"#fde68a\"/>" },
  vs_kho: { vb: "0 0 52 44", svg: "<path d=\"M6 20L24 9.5 42 20v16.5H6V20z\" fill=\"#f8fafc\"/><path d=\"M4 21L24 8.5 44 21\" fill=\"none\" stroke=\"#3b6e78\" stroke-width=\"1.5\"/><path d=\"M11 26v10.5M16.5 26v10.5M22 26v10.5M27.5 26v10.5\" stroke=\"#94a3b8\"/><path d=\"M41.5 11L31 28.5\" stroke=\"#b45309\" stroke-width=\"1.7\"/><path d=\"M26.5 27.5l8.5 3.8-2.8 6.5-9.5-3.8 3.8-6.5z\" fill=\"#fde68a\"/><rect x=\"36.5\" y=\"28.5\" width=\"8.5\" height=\"9\" rx=\"1.5\" fill=\"#d9eaed\"/>" },
  may_can_3: { vb: "0 0 88 44", svg: "<circle cx=\"17\" cy=\"13.5\" r=\"7\" fill=\"#d9eaed\"/><circle cx=\"17\" cy=\"13.5\" r=\"2.8\" fill=\"#fde68a\"/><circle cx=\"10\" cy=\"28\" r=\"7\" fill=\"#f1f5f9\"/><circle cx=\"10\" cy=\"28\" r=\"2.8\" fill=\"#cbd5e1\"/><circle cx=\"24\" cy=\"28\" r=\"7\" fill=\"#f1f5f9\"/><circle cx=\"24\" cy=\"28\" r=\"2.8\" fill=\"#cbd5e1\"/><circle cx=\"45\" cy=\"23\" r=\"7\" fill=\"#d9eaed\"/><circle cx=\"45\" cy=\"23\" r=\"2.8\" fill=\"#fff\"/><circle cx=\"59\" cy=\"23\" r=\"7\" fill=\"#f1f5f9\"/><circle cx=\"59\" cy=\"23\" r=\"2.8\" fill=\"#fff\"/><circle cx=\"77\" cy=\"23\" r=\"7.5\" fill=\"#d9eaed\" stroke-dasharray=\"3 2\"/><circle cx=\"77\" cy=\"23\" r=\"3.2\" fill=\"#fde68a\"/><rect x=\"79\" y=\"29\" width=\"7\" height=\"2.2\" fill=\"#cbd5e1\"/>" },
  bam_tinh: { vb: "0 0 48 44", svg: "<circle cx=\"21\" cy=\"22\" r=\"13.5\" fill=\"#d9eaed\" stroke=\"#3b6e78\" stroke-dasharray=\"3.5 2\"/><circle cx=\"21\" cy=\"22\" r=\"7.5\" fill=\"#fde68a\"/><rect x=\"27\" y=\"32\" width=\"14\" height=\"3.5\" rx=\"1\" fill=\"#e2e8f0\"/>" },
  pha_mu: { vb: "0 0 54 44", svg: "<rect x=\"6\" y=\"13\" width=\"42\" height=\"20\" rx=\"2\" fill=\"#d9eaed\"/><rect x=\"9\" y=\"16\" width=\"36\" height=\"14\" fill=\"#fff\"/><path d=\"M14 16v14M19 16v14M24 16v14M29 16v14M34 16v14M39 16v14\" stroke=\"#3b6e78\" stroke-width=\"1.1\"/><rect x=\"16\" y=\"8\" width=\"22\" height=\"5\" rx=\"1\" fill=\"#fde68a\"/>" },
  ra_lo: { vb: "0 0 56 44", svg: "<ellipse cx=\"28\" cy=\"23\" rx=\"21\" ry=\"12\" fill=\"#fde68a\"/><ellipse cx=\"28\" cy=\"23\" rx=\"15\" ry=\"7.5\" fill=\"#fff\"/><path d=\"M28 11v4.5M28 30.5V35M7 23h6M43 23h6M13 14.5l4 3M39 28.5l4 3M43 14.5l-4 3M17 28.5l-4 3\" stroke=\"#3b6e78\" stroke-width=\"1.2\"/>" },
  can_ep: { vb: "0 0 48 48", svg: "<path d=\"M12 11h24a2 2 0 012 2v28H10V13a2 2 0 012-2z\" fill=\"#d9eaed\"/><rect x=\"15.5\" y=\"17\" width=\"17\" height=\"19\" rx=\"1\" fill=\"#fff\"/><path d=\"M19 18h10v5.5H19z\" fill=\"#fde68a\"/><path d=\"M18 28.5h12v6.5H18z\" fill=\"#3b6e78\"/><rect x=\"19\" y=\"6\" width=\"3.5\" height=\"5\" fill=\"#e2e8f0\"/><rect x=\"25.5\" y=\"6\" width=\"3.5\" height=\"5\" fill=\"#e2e8f0\"/>" },
  bao_goi: { vb: "0 0 52 44", svg: "<rect x=\"10\" y=\"7.5\" width=\"14.5\" height=\"21\" rx=\"1.5\" fill=\"#f8fafc\"/><rect x=\"10\" y=\"13\" width=\"14.5\" height=\"5\" fill=\"#fde68a\"/><text x=\"12\" y=\"17\" font-size=\"4.5\" fill=\"#1e293b\" stroke=\"none\" font-weight=\"600\">CSR</text><rect x=\"6\" y=\"31\" width=\"40\" height=\"6.5\" rx=\"3.2\" fill=\"#d9eaed\"/><circle cx=\"11.5\" cy=\"34.2\" r=\"1.4\" fill=\"#fff\"/><circle cx=\"20\" cy=\"34.2\" r=\"1.4\" fill=\"#fff\"/><circle cx=\"28.5\" cy=\"34.2\" r=\"1.4\" fill=\"#fff\"/><circle cx=\"37\" cy=\"34.2\" r=\"1.4\" fill=\"#fff\"/><circle cx=\"30\" cy=\"21\" r=\"4.2\" fill=\"#e0f2fe\"/><path d=\"M33 24l3.8 4.5\" stroke-width=\"1.6\"/>" },
  vo_kien: { vb: "0 0 48 44", svg: "<rect x=\"8\" y=\"8.5\" width=\"32\" height=\"23\" fill=\"#fef3c7\"/><path d=\"M14 8.5v23M20 8.5v23M28 8.5v23M34 8.5v23M8 14l32 13\" stroke=\"#b45309\" stroke-width=\"1\"/><rect x=\"6.5\" y=\"31.5\" width=\"35\" height=\"4.5\" rx=\"1\" fill=\"#d9eaed\"/>" },
  vs_dc: { vb: "0 0 48 44", svg: "<path d=\"M28.5 7.5L17 26.5\" stroke=\"#b45309\" stroke-width=\"1.8\"/><path d=\"M11.5 25l10.5 4.5-3.8 7.5-11.5-4.5 4.8-7.5z\" fill=\"#fde68a\"/><rect x=\"26\" y=\"25.5\" width=\"11.5\" height=\"12\" rx=\"2\" fill=\"#d9eaed\"/><path d=\"M26 29h11.5\" stroke=\"#3b6e78\"/><path d=\"M14 11l1.2 2.5 2.5 1.2-2.5 1.2-1.2 2.5-1.2-2.5-2.5-1.2 2.5-1.2z\" fill=\"#f59e0b\" stroke=\"none\"/>" },
}

const ICON_OF: Record<StationKey, string> = {
  truc_ca: "truc_ca", lo_say: "lo_say", bao_tri: "bao_tri", xlnt: "xlnt", co_khi: "co_khi", xe_nang: "xe_nang",
  tn_xuc: "xe_xuc", tn_xe: "may_xe", tn_vs: "vs_kho",
  ca_xuc: "xe_xuc", ca_xe: "may_xe", ca_can: "may_can_3", ca_bam: "bam_tinh", ca_pha: "pha_mu", ca_ralo: "ra_lo",
  ca_ep: "can_ep", ca_bao: "bao_goi", ca_kien: "vo_kien", ca_vs: "vs_dc",
}

/** Icon ô sơ đồ; height = chiều cao px, bề ngang theo tỷ lệ viewBox. */
export function StationIcon({ station, height = 34, className }: { station: StationKey; height?: number; className?: string }) {
  const def = ICONS[ICON_OF[station]]
  if (!def) return null
  const [, , w, h] = def.vb.split(" ").map(Number)
  const width = Math.round((height * w) / h)
  return (
    <svg
      viewBox={def.vb}
      width={width}
      height={height}
      className={className}
      fill="none"
      stroke="#334155"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      dangerouslySetInnerHTML={{ __html: def.svg }}
    />
  )
}

import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import type { FeatureCollection } from "geojson"

// ─── Types ────────────────────────────────────────────────────────────────────
export type FactoryProfile = {
  id: string
  full_name_en: string
  address_en: string
  contact_person: string
  contact_email: string
  website: string
  country_en: string
}

export type LotDetail = {
  id: string
  ma_lo: string
  ngay_sx: string
  loai_banh: number
  kien_a: number
  kien_b: number
  kien_c: number
  kien_d: number
  ngan_id: string
}

type OrderForDDS = {
  ma_don: string
  ngay: string
  chung_loai: string
  tong_banh: number
  loai_banh: number
  loai_pallet: string
  so_thong_bao: string
  so_hoa_don: string
  so_hop_dong: string
  assignments: {
    lot_id: string; ma_lo: string
    kien_a: number; kien_b: number; kien_c: number; kien_d: number
  }[]
  customers?: {
    ten_kh_en: string; dia_chi: string; nguoi_lien_he: string
    email: string; quoc_gia: string
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d?: string | null): string {
  if (!d) return "—"
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return d
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`
}

function polygonCentroid(geometry: any): { lat: number; lon: number } {
  try {
    let coords: number[][]
    if (geometry.type === "MultiPolygon") {
      coords = geometry.coordinates[0][0]
    } else {
      coords = geometry.coordinates[0]
    }
    const lon = coords.reduce((s: number, c: number[]) => s + c[0], 0) / coords.length
    const lat = coords.reduce((s: number, c: number[]) => s + c[1], 0) / coords.length
    return { lat, lon }
  } catch {
    return { lat: 0, lon: 0 }
  }
}

function computeOrderCert(
  assignments: OrderForDDS["assignments"],
  lotCertMap: Record<string, string>
): string {
  const values = assignments.map(a => lotCertMap[a.lot_id]).filter(Boolean)
  if (!values.length) return "—"
  const freq: Record<string, number> = {}
  values.forEach(v => { freq[v] = (freq[v] || 0) + 1 })
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
}

// ─── Header builder (dùng chung DDS1 và DDS2) ────────────────────────────────
function buildDDSHeader(
  doc: jsPDF,
  title: string,
  order: OrderForDDS,
  factory: FactoryProfile
): number {
  const cust = order.customers
  const pageW = doc.internal.pageSize.getWidth()
  let y = 14

  // Title
  doc.setFont("helvetica", "bold")
  doc.setFontSize(13)
  doc.text("DUE DILIGENCE STATEMENT (DDS)", pageW / 2, y, { align: "center" })
  y += 6
  doc.setFontSize(10)
  doc.text(title, pageW / 2, y, { align: "center" })
  y += 8

  // Seller / Buyer side-by-side table
  autoTable(doc, {
    startY: y,
    head: [["SELLER INFORMATION", "BUYER INFORMATION"]],
    body: [
      [factory.full_name_en || "—", cust?.ten_kh_en || "—"],
      [factory.address_en || "—", cust?.dia_chi || "—"],
      [`Contact: ${factory.contact_person || "—"}`, `Contact: ${cust?.nguoi_lien_he || "—"}`],
      [`Email: ${factory.contact_email || "—"}`, `Email: ${cust?.email || "—"}`],
      [`Website: ${factory.website || "—"}`, `Country: ${cust?.quoc_gia || "—"}`],
      [`Country: ${factory.country_en || "—"}`, ""],
    ],
    theme: "grid",
    headStyles: { fillColor: [30, 80, 50], textColor: 255, fontStyle: "bold", fontSize: 8 },
    bodyStyles: { fontSize: 7.5, cellPadding: 2 },
    columnStyles: { 0: { cellWidth: (pageW - 28) / 2 }, 1: { cellWidth: (pageW - 28) / 2 } },
    margin: { left: 14, right: 14 },
  })
  y = (doc as any).lastAutoTable.finalY + 4

  // Contract details
  const quantityTon = ((order.tong_banh * (order.loai_banh || 35)) / 1000).toFixed(3)
  autoTable(doc, {
    startY: y,
    head: [["Date", "Contract No.", "Invoice No.", "Delivery Notice", "Product", "Quantity (tons)"]],
    body: [[
      fmtDate(order.ngay),
      order.so_hop_dong || "—",
      order.so_hoa_don || "—",
      order.so_thong_bao || "—",
      order.chung_loai || "—",
      quantityTon,
    ]],
    theme: "grid",
    headStyles: { fillColor: [30, 80, 50], textColor: 255, fontStyle: "bold", fontSize: 8 },
    bodyStyles: { fontSize: 8, cellPadding: 2 },
    margin: { left: 14, right: 14 },
  })
  y = (doc as any).lastAutoTable.finalY + 6

  return y
}

// ─── DDS 1: Plantation Location Declaration ───────────────────────────────────
export async function generateDDS1(
  order: OrderForDDS,
  geoData: FeatureCollection | null,
  factory: FactoryProfile,
  lotCertMap: Record<string, string>
): Promise<Blob> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })

  const startY = buildDDSHeader(
    doc,
    "RUBBER PLANTATION LOCATION DECLARATION",
    order,
    factory
  )

  const orderCert = computeOrderCert(order.assignments, lotCertMap)

  const rows = (geoData?.features || []).map(f => {
    const c = polygonCentroid(f.geometry)
    const p = f.properties || {}
    return [
      p.Ma_lo_2026 || p.Ma_lo || "—",
      c.lat !== 0 ? c.lat.toFixed(6) : "—",
      c.lon !== 0 ? c.lon.toFixed(6) : "—",
      p.Dtich2026_ha ?? "—",
      p.Nam_trong ?? "—",
      p.Giong ?? "—",
      orderCert,
    ]
  })

  autoTable(doc, {
    startY,
    head: [["Plot ID", "Latitude", "Longitude", "Area (ha)", "Year of Planting", "Clone / Variety", "Certification"]],
    body: rows.length ? rows : [["No plantation data found", "", "", "", "", "", ""]],
    theme: "striped",
    headStyles: { fillColor: [16, 100, 60], textColor: 255, fontStyle: "bold", fontSize: 8 },
    bodyStyles: { fontSize: 7.5, cellPadding: 1.8 },
    alternateRowStyles: { fillColor: [240, 255, 245] },
    margin: { left: 14, right: 14 },
  })

  // Footer
  const doc2 = doc as any
  const finalY = doc2.lastAutoTable.finalY + 8
  const pageH = doc.internal.pageSize.getHeight()
  const pageW = doc.internal.pageSize.getWidth()
  if (finalY < pageH - 30) {
    doc.setFontSize(8)
    doc.setTextColor(100)
    doc.text(
      `Total plots: ${rows.length}     Generated: ${fmtDate(new Date().toISOString())}     Order: ${order.ma_don}`,
      pageW / 2, finalY, { align: "center" }
    )
  }

  return new Blob([doc.output("arraybuffer")], { type: "application/pdf" })
}

// ─── DDS 2: Shipment Lot Declaration ──────────────────────────────────────────
export async function generateDDS2(
  order: OrderForDDS,
  lotDetails: LotDetail[],
  extractionDates: Record<string, string>,
  factory: FactoryProfile
): Promise<Blob> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })

  const startY = buildDDSHeader(
    doc,
    "SHIPMENT LOT DECLARATION",
    order,
    factory
  )

  const rows = order.assignments.map((a, i) => {
    const lot = lotDetails.find(l => l.id === a.lot_id)
    const banh = a.kien_a + a.kien_b + a.kien_c + a.kien_d
    const loaiBanh = lot?.loai_banh ?? order.loai_banh ?? 35
    const weightTon = ((banh * loaiBanh) / 1000).toFixed(4)
    return [
      String(i + 1),
      a.ma_lo,
      weightTon,
      order.loai_pallet || "—",
      fmtDate(extractionDates[a.lot_id]),
      fmtDate(lot?.ngay_sx),
      factory.full_name_en || "—",
    ]
  })

  autoTable(doc, {
    startY,
    head: [["No.", "Lot Number", "Weight (tons)", "Pallet Code", "Extraction Date", "Production Date", "Factory Name"]],
    body: rows.length ? rows : [["No lot data", "", "", "", "", "", ""]],
    theme: "striped",
    headStyles: { fillColor: [16, 100, 60], textColor: 255, fontStyle: "bold", fontSize: 8 },
    bodyStyles: { fontSize: 8, cellPadding: 2 },
    alternateRowStyles: { fillColor: [240, 255, 245] },
    columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 28 }, 2: { cellWidth: 26 } },
    margin: { left: 14, right: 14 },
  })

  // Footer
  const doc2 = doc as any
  const finalY = doc2.lastAutoTable.finalY + 8
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  if (finalY < pageH - 30) {
    doc.setFontSize(8)
    doc.setTextColor(100)
    doc.text(
      `Total lots: ${rows.length}     Generated: ${fmtDate(new Date().toISOString())}     Order: ${order.ma_don}`,
      pageW / 2, finalY, { align: "center" }
    )
  }

  return new Blob([doc.output("arraybuffer")], { type: "application/pdf" })
}

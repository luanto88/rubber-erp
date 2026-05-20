import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import type { FeatureCollection, Geometry, MultiPolygon, Polygon } from "geojson"

const PDF_FONT_FILE = "Geist-Regular.ttf"
const PDF_FONT_NAME = "GeistRegular"
let fontLoadPromise: Promise<void> | null = null

type PdfWithTable = jsPDF & {
  lastAutoTable?: {
    finalY: number
  }
}

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
    lot_id: string
    ma_lo: string
    kien_a: number
    kien_b: number
    kien_c: number
    kien_d: number
  }[]
  customers?: {
    ten_kh_en: string
    dia_chi: string
    nguoi_lien_he: string
    email: string
    quoc_gia: string
  }
}

function fallbackText(value?: string | null): string {
  return value && value.trim() ? value : "-"
}

function normalizePdfText(value?: string | null): string {
  const text = fallbackText(value).normalize("NFC")
  const replacements: Record<string, string> = {
    "Rá»i": "Rời",
    "R Ý i": "Rời",
    "PE Ä‘áº¿ gá»—": "PE đế gỗ",
    "PE Ä‘áº¿ nhá»±a": "PE đế nhựa",
    "Pallet sáº¯t Ä‘áº¿ gá»—": "Pallet sắt đế gỗ",
    "Pallet sáº¯t má»ng": "Pallet sắt mỏng",
    "Pallet gá»—": "Pallet gỗ",
  }
  return replacements[text] || text
}

function fmtDate(d?: string | null): string {
  if (!d) return "-"
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return d
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}/${dt.getFullYear()}`
}

async function ensurePdfFont(doc: jsPDF) {
  if (!fontLoadPromise) {
    fontLoadPromise = fetch(`/fonts/${PDF_FONT_FILE}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Khong tai duoc font PDF: ${PDF_FONT_FILE}`)
        const buffer = await res.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let binary = ""
        const chunkSize = 0x8000
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
        }
        const base64 = btoa(binary)
        doc.addFileToVFS(PDF_FONT_FILE, base64)
        doc.addFont(PDF_FONT_FILE, PDF_FONT_NAME, "normal")
        doc.addFont(PDF_FONT_FILE, PDF_FONT_NAME, "bold")
      })
      .catch((error) => {
        fontLoadPromise = null
        throw error
      })
  }

  await fontLoadPromise
  doc.setFont(PDF_FONT_NAME, "normal")
}

function polygonCentroid(geometry: Geometry): { lat: number; lon: number } {
  try {
    let coords: number[][]
    if (geometry.type === "MultiPolygon") {
      coords = (geometry as MultiPolygon).coordinates[0][0]
    } else if (geometry.type === "Polygon") {
      coords = (geometry as Polygon).coordinates[0]
    } else {
      return { lat: 0, lon: 0 }
    }
    const lon = coords.reduce((sum: number, c: number[]) => sum + c[0], 0) / coords.length
    const lat = coords.reduce((sum: number, c: number[]) => sum + c[1], 0) / coords.length
    return { lat, lon }
  } catch {
    return { lat: 0, lon: 0 }
  }
}

function computeOrderCert(
  assignments: OrderForDDS["assignments"],
  lotCertMap: Record<string, string>,
): string {
  const values = assignments.map((a) => lotCertMap[a.lot_id]).filter(Boolean)
  if (!values.length) return "-"
  const freq: Record<string, number> = {}
  values.forEach((value) => {
    freq[value] = (freq[value] || 0) + 1
  })
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]
}

function buildDDSHeader(
  doc: jsPDF,
  title: string,
  order: OrderForDDS,
  factory: FactoryProfile,
): number {
  const cust = order.customers
  const pdf = doc as PdfWithTable
  const pageW = doc.internal.pageSize.getWidth()
  let y = 14

  doc.setFont(PDF_FONT_NAME, "bold")
  doc.setFontSize(13)
  doc.text("DUE DILIGENCE STATEMENT (DDS)", pageW / 2, y, { align: "center" })
  y += 6
  doc.setFontSize(10)
  doc.text(title, pageW / 2, y, { align: "center" })
  y += 8

  autoTable(doc, {
    startY: y,
    head: [["SELLER INFORMATION", "BUYER INFORMATION"]],
    body: [
      [normalizePdfText(factory.full_name_en), normalizePdfText(cust?.ten_kh_en)],
      [normalizePdfText(factory.address_en), normalizePdfText(cust?.dia_chi)],
      [`Contact: ${normalizePdfText(factory.contact_person)}`, `Contact: ${normalizePdfText(cust?.nguoi_lien_he)}`],
      [`Email: ${normalizePdfText(factory.contact_email)}`, `Email: ${normalizePdfText(cust?.email)}`],
      [`Website: ${normalizePdfText(factory.website)}`, `Country: ${normalizePdfText(cust?.quoc_gia)}`],
      [`Country: ${normalizePdfText(factory.country_en)}`, ""],
    ],
    theme: "grid",
    headStyles: { fillColor: [30, 80, 50], textColor: 255, fontStyle: "bold", fontSize: 8, font: PDF_FONT_NAME },
    bodyStyles: { fontSize: 7.5, cellPadding: 2, font: PDF_FONT_NAME },
    columnStyles: { 0: { cellWidth: (pageW - 28) / 2 }, 1: { cellWidth: (pageW - 28) / 2 } },
    margin: { left: 14, right: 14 },
  })
  y = (pdf.lastAutoTable?.finalY ?? y) + 4

  const quantityTon = ((order.tong_banh * (order.loai_banh || 35)) / 1000).toFixed(3)
  autoTable(doc, {
    startY: y,
    head: [["Date", "Contract No.", "Invoice No.", "Delivery Notice", "Product", "Quantity (tons)"]],
    body: [[
      fmtDate(order.ngay),
      normalizePdfText(order.so_hop_dong),
      normalizePdfText(order.so_hoa_don),
      normalizePdfText(order.so_thong_bao),
      normalizePdfText(order.chung_loai),
      quantityTon,
    ]],
    theme: "grid",
    headStyles: { fillColor: [30, 80, 50], textColor: 255, fontStyle: "bold", fontSize: 8, font: PDF_FONT_NAME },
    bodyStyles: { fontSize: 8, cellPadding: 2, font: PDF_FONT_NAME },
    margin: { left: 14, right: 14 },
  })

  return (pdf.lastAutoTable?.finalY ?? y) + 6
}

export async function generateDDS1(
  order: OrderForDDS,
  geoData: FeatureCollection | null,
  factory: FactoryProfile,
  lotCertMap: Record<string, string>,
): Promise<Blob> {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)

  const startY = buildDDSHeader(doc, "RUBBER PLANTATION LOCATION DECLARATION", order, factory)
  const orderCert = normalizePdfText(computeOrderCert(order.assignments, lotCertMap))

  const rows = (geoData?.features || []).map((feature) => {
    const centroid = polygonCentroid(feature.geometry)
    const props = feature.properties || {}
    return [
      normalizePdfText(props.Ten || props.Ma_lo_2026 || props.Ma_lo),
      centroid.lat !== 0 ? centroid.lat.toFixed(6) : "-",
      centroid.lon !== 0 ? centroid.lon.toFixed(6) : "-",
      props.Dtich2026_ha ?? "-",
      props.Nam_trong ?? "-",
      normalizePdfText(props.Giong),
      orderCert,
    ]
  })

  autoTable(doc, {
    startY,
    head: [["Plot ID", "Latitude", "Longitude", "Area (ha)", "Year of Planting", "Clone / Variety", "Certification"]],
    body: rows.length ? rows : [["No plantation data found", "", "", "", "", "", ""]],
    theme: "striped",
    headStyles: { fillColor: [16, 100, 60], textColor: 255, fontStyle: "bold", fontSize: 8, font: PDF_FONT_NAME },
    bodyStyles: { fontSize: 7.5, cellPadding: 1.8, font: PDF_FONT_NAME },
    alternateRowStyles: { fillColor: [240, 255, 245] },
    margin: { left: 14, right: 14 },
  })

  const pdf = doc as PdfWithTable
  const finalY = (pdf.lastAutoTable?.finalY ?? startY) + 8
  const pageH = doc.internal.pageSize.getHeight()
  const pageW = doc.internal.pageSize.getWidth()
  if (finalY < pageH - 30) {
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.setFontSize(8)
    doc.setTextColor(100)
    doc.text(
      `Total plots: ${rows.length}     Generated: ${fmtDate(new Date().toISOString())}     Order: ${order.ma_don}`,
      pageW / 2,
      finalY,
      { align: "center" },
    )
  }

  return new Blob([doc.output("arraybuffer")], { type: "application/pdf" })
}

export async function generateDDS2(
  order: OrderForDDS,
  lotDetails: LotDetail[],
  extractionDates: Record<string, string>,
  factory: FactoryProfile,
): Promise<Blob> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" })
  await ensurePdfFont(doc)

  const startY = buildDDSHeader(doc, "SHIPMENT LOT DECLARATION", order, factory)

  const rows = order.assignments.map((assignment, index) => {
    const lot = lotDetails.find((item) => item.id === assignment.lot_id)
    const banh = assignment.kien_a + assignment.kien_b + assignment.kien_c + assignment.kien_d
    const loaiBanh = lot?.loai_banh ?? order.loai_banh ?? 35
    const weightTon = ((banh * loaiBanh) / 1000).toFixed(4)

    return [
      String(index + 1),
      normalizePdfText(assignment.ma_lo),
      weightTon,
      normalizePdfText(order.loai_pallet),
      fmtDate(extractionDates[assignment.lot_id]),
      fmtDate(lot?.ngay_sx),
      normalizePdfText(factory.full_name_en),
    ]
  })

  autoTable(doc, {
    startY,
    head: [["No.", "Lot Number", "Weight (tons)", "Pallet", "Extraction Date", "Production Date", "Factory Name"]],
    body: rows.length ? rows : [["No lot data", "", "", "", "", "", ""]],
    theme: "striped",
    headStyles: { fillColor: [16, 100, 60], textColor: 255, fontStyle: "bold", fontSize: 8, font: PDF_FONT_NAME },
    bodyStyles: { fontSize: 8, cellPadding: 2, font: PDF_FONT_NAME },
    alternateRowStyles: { fillColor: [240, 255, 245] },
    columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 28 }, 2: { cellWidth: 26 } },
    margin: { left: 14, right: 14 },
  })

  const pdf = doc as PdfWithTable
  const finalY = (pdf.lastAutoTable?.finalY ?? startY) + 8
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  if (finalY < pageH - 30) {
    doc.setFont(PDF_FONT_NAME, "normal")
    doc.setFontSize(8)
    doc.setTextColor(100)
    doc.text(
      `Total lots: ${rows.length}     Generated: ${fmtDate(new Date().toISOString())}     Order: ${order.ma_don}`,
      pageW / 2,
      finalY,
      { align: "center" },
    )
  }

  return new Blob([doc.output("arraybuffer")], { type: "application/pdf" })
}

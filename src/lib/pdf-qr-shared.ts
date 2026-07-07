import jsPDF from "jspdf"
import QRCode from "qrcode"

export const PDF_FONT_FILE = "NotoSans-Regular.ttf"
export const PDF_FONT_NAME = "NotoSans"

let fontBase64Promise: Promise<string> | null = null

async function loadPdfFontBase64() {
  if (!fontBase64Promise) {
    fontBase64Promise = fetch(`/fonts/${PDF_FONT_FILE}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Không tải được font PDF: ${PDF_FONT_FILE}`)
        const buffer = await res.arrayBuffer()
        const bytes = new Uint8Array(buffer)
        let binary = ""
        const chunkSize = 0x8000
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
        }
        return btoa(binary)
      })
      .catch((error) => {
        fontBase64Promise = null
        throw error
      })
  }

  return fontBase64Promise
}

export async function ensurePdfFont(doc: jsPDF) {
  const base64 = await loadPdfFontBase64()
  doc.addFileToVFS(PDF_FONT_FILE, base64)
  doc.addFont(PDF_FONT_FILE, PDF_FONT_NAME, "normal")
  doc.addFont(PDF_FONT_FILE, PDF_FONT_NAME, "bold")
  doc.setFont(PDF_FONT_NAME, "normal")
}

export async function addQrImage(doc: jsPDF, qrUrl: string, x: number, y: number, size: number) {
  const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 240, margin: 1 })
  doc.addImage(qrDataUrl, "PNG", x, y, size, size)
}

const COMBINING_DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g")

export function safeName(value: string) {
  return value
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS_RE, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

// Icon nét đen cho nhãn lô lớn (xem product-label-pdf.ts) — vẽ tay bám mẫu nhãn in,
// chuyển SVG → PNG qua canvas để nhúng vào jsPDF (jsPDF không vẽ trực tiếp SVG). Chỉ chạy
// trong trình duyệt (nơi hàm in nhãn vốn đang chạy). Lỗi → null, nhãn vẫn in bình thường.

const STROKE = `fill="none" stroke="#000" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"`

// Quả cân có chữ KG
export const ICON_KG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<circle cx="32" cy="10" r="5" ${STROKE}/>
<path d="M17 20 H47 Q52 20 53 25 L58 50 Q59 57 52 57 H12 Q5 57 6 50 L11 25 Q12 20 17 20 Z" ${STROKE}/>
<text x="32" y="46" font-family="Arial, Helvetica, sans-serif" font-weight="900" font-size="17" text-anchor="middle" fill="#000">KG</text>
</svg>`

// 3 lá xoay vòng (bọc tái chế)
// Mỗi lá nằm tiếp tuyến vòng tròn tâm (32,34), đuôi lá có mũi tên nhỏ nối sang lá kế tiếp
const LEAF = `<path d="M17 21 C20 9 34 5 44 10 C41 21 28 27 17 21 Z" ${STROKE}/><path d="M17 21 C26 17 34 13 44 10" ${STROKE}/><path d="M46 14 C51 17 54 22 55 27" ${STROKE}/><path d="M51 25 L55 28 L58 23" ${STROKE}/>`
export const ICON_BOC = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<g transform="translate(0 2)">
<g>${LEAF}</g>
<g transform="rotate(120 32 34)">${LEAF}</g>
<g transform="rotate(240 32 34)">${LEAF}</g>
</g>
</svg>`

// Lịch lưới + dấu tick tròn
export const ICON_CALENDAR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect x="4" y="11" width="46" height="44" rx="5" ${STROKE}/>
<path d="M4 21 H50" ${STROKE}/>
<path d="M14 6 V15 M26 6 V15 M38 6 V15" ${STROKE}/>
<g fill="none" stroke="#000" stroke-width="2.4">
<rect x="10" y="27" width="6" height="5"/><rect x="20" y="27" width="6" height="5"/><rect x="30" y="27" width="6" height="5"/><rect x="40" y="27" width="6" height="5"/>
<rect x="10" y="37" width="6" height="5"/><rect x="20" y="37" width="6" height="5"/><rect x="30" y="37" width="6" height="5"/>
<rect x="10" y="46" width="6" height="5"/><rect x="20" y="46" width="6" height="5"/>
</g>
<circle cx="48" cy="48" r="12" fill="#fff" stroke="#000" stroke-width="3.2"/>
<path d="M42 48 L46.5 52.5 L54 44" ${STROKE}/>
</svg>`

// Nhà máy mái răng cưa + ống khói
export const ICON_FACTORY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<path d="M4 58 V36 L14 30 V36 L24 30 V36 L34 30 V36 L44 30 V58 Z" ${STROKE}/>
<path d="M44 58 V16 H52 V58 H60 V40 H52" ${STROKE}/>
<path d="M46 16 V10 H50 V16" ${STROKE}/>
<path d="M49 7 Q52 4 54 6 Q56 8 59 5" ${STROKE}/>
<g fill="none" stroke="#000" stroke-width="2.4"><rect x="9" y="44" width="5" height="5"/><rect x="18" y="44" width="5" height="5"/><rect x="27" y="44" width="5" height="5"/></g>
<rect x="34" y="46" width="6" height="12" ${STROKE}/>
</svg>`

// Công nhân + bánh răng
export const ICON_WORKER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<path d="M18 22 Q18 8 30 8 Q42 8 42 22" ${STROKE}/>
<path d="M15 22 H45" ${STROKE}/>
<path d="M20 22 Q20 36 30 36 Q40 36 40 22" ${STROKE}/>
<path d="M6 58 Q6 42 20 40 L30 46 L40 40 Q46 41 49 44" ${STROKE}/>
<path d="M6 58 H36" ${STROKE}/>
<path d="M22 40 V58 M38 40 V47" ${STROKE}/>
<g transform="translate(50 52)">
<circle r="5" ${STROKE}/>
<path d="M0 -12 V-8 M0 8 V12 M-12 0 H-8 M8 0 H12 M-8.5 -8.5 L-5.7 -5.7 M5.7 5.7 L8.5 8.5 M-8.5 8.5 L-5.7 5.7 M5.7 -5.7 L8.5 -8.5" ${STROKE}/>
<circle r="9" fill="none" stroke="#000" stroke-width="2.6"/>
</g>
</svg>`

const iconCache = new Map<string, Promise<string | null>>()

export function loadIconPng(svg: string, px = 192): Promise<string | null> {
  const key = `${px}:${svg}`
  let promise = iconCache.get(key)
  if (!promise) {
    promise = new Promise<string | null>((resolve) => {
      try {
        const img = new Image()
        img.onload = () => {
          try {
            const canvas = document.createElement("canvas")
            canvas.width = px
            canvas.height = px
            const ctx = canvas.getContext("2d")
            if (!ctx) return resolve(null)
            ctx.drawImage(img, 0, 0, px, px)
            resolve(canvas.toDataURL("image/png"))
          } catch {
            resolve(null)
          }
        }
        img.onerror = () => resolve(null)
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
      } catch {
        resolve(null)
      }
    }).then((result) => {
      if (!result) iconCache.delete(key)
      return result
    })
    iconCache.set(key, promise)
  }
  return promise
}

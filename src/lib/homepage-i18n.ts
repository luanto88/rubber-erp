// Từ điển đa ngôn ngữ cho trang chủ (src/app/page.tsx).
// Bản dịch tiếng Khmer là bản dịch kỹ thuật cơ bản, chưa được người bản ngữ rà soát —
// nên kiểm tra lại thuật ngữ chuyên ngành trước khi coi là chính thức lâu dài.
// Sơ đồ tổ chức (ORG trong page.tsx) cố ý KHÔNG dịch — các chức danh nội bộ giữ nguyên
// tiếng Việt ở mọi ngôn ngữ (đã chốt với người dùng), chỉ tiêu đề/chú thích của mục đó
// nằm trong orgSection bên dưới mới được dịch.

export type Lang = "vi" | "en" | "km"

export const LANG_OPTIONS: { code: Lang; label: string }[] = [
  { code: "vi", label: "VI" },
  { code: "en", label: "EN" },
  { code: "km", label: "KM" },
]

export const DEFAULT_LANG: Lang = "vi"
export const HOMEPAGE_LANG_STORAGE_KEY = "homepage_lang"

export function loadStoredHomepageLang(): Lang {
  if (typeof window === "undefined") return DEFAULT_LANG
  try {
    const stored = window.localStorage.getItem(HOMEPAGE_LANG_STORAGE_KEY)
    if (stored === "vi" || stored === "en" || stored === "km") return stored
  } catch {
    // localStorage không khả dụng (chế độ riêng tư...) — giữ mặc định
  }
  return DEFAULT_LANG
}

export function storeHomepageLang(lang: Lang) {
  try {
    window.localStorage.setItem(HOMEPAGE_LANG_STORAGE_KEY, lang)
  } catch {
    // bỏ qua nếu không lưu được
  }
}

export type LStr = Record<Lang, string>

export const HOME_STRINGS = {
  companyName: {
    vi: "CTY TNHH PTCS PHƯỚC HÒA KAMPONG THOM-NHÀ MÁY CHẾ BIẾN",
    en: "PTCS PHUOC HOA KAMPONG THOM CO., LTD. — PROCESSING FACTORY",
    km: "PTCS PHUOC HOA KAMPONG THOM CO., LTD. — រោងចក្រកែច្នៃ",
  },
  companyNameShort: {
    vi: "PTCS Phước Hòa Kampong Thom",
    en: "PTCS Phuoc Hoa Kampong Thom",
    km: "PTCS Phuoc Hoa Kampong Thom",
  },
  nav: {
    gioiThieu: { vi: "Giới thiệu", en: "About", km: "អំពីយើង" },
    toChuc: { vi: "Tổ chức", en: "Organization", km: "រចនាសម្ព័ន្ធ" },
    tieuChuan: { vi: "Tiêu chuẩn", en: "Standards", km: "ស្តង់ដារ" },
    sanPham: { vi: "Sản phẩm", en: "Products", km: "ផលិតផល" },
    quyTrinh: { vi: "Quy trình", en: "Process", km: "ដំណើរការផលិត" },
    login: { vi: "Đăng nhập", en: "Login", km: "ចូលប្រើប្រាស់" },
  },
  hero: {
    eyebrow: { vi: "Phước Hòa Kampong Thom", en: "Phuoc Hoa Kampong Thom", km: "ភូក ហូវ៉ា កំពង់ធំ" },
    titleLine1: { vi: "Nhà máy chế biến", en: "Rubber Processing Factory", km: "រោងចក្រកែច្នៃកៅស៊ូ" },
    titleLine2: { vi: "cao su tiêu chuẩn quốc tế", en: "to international standards", km: "តាមស្តង់ដារអន្តរជាតិ" },
    subtitle: {
      vi: "Sản xuất CSR10, CSR20, CSR3L đạt chứng nhận PEFC CS — Vương Quốc Campuchia",
      en: "Producing CSR10, CSR20, CSR3L certified PEFC CS — Kingdom of Cambodia",
      km: "ផលិត CSR10, CSR20, CSR3L ទទួលបានវិញ្ញាបនបត្រ PEFC CS — ព្រះរាជាណាចក្រកម្ពុជា",
    },
    ctaTitle: { vi: "Vào quy trình sản xuất", en: "Enter Production System", km: "ចូលប្រព័ន្ធផលិតកម្ម" },
    ctaDesc: {
      vi: "Quản lý toàn bộ quy trình sản xuất — từ tiếp nhận mủ đến xuất hàng",
      en: "Manage the entire production process — from latex intake to shipment",
      km: "គ្រប់គ្រងដំណើរការផលិតកម្មទាំងមូល — ចាប់ពីទទួលទឹកកៅស៊ូរហូតដល់នាំចេញទំនិញ",
    },
    ctaButton: { vi: "Dashboard & ERP", en: "Dashboard & ERP", km: "ផ្ទាំងគ្រប់គ្រង & ERP" },
  },
  intro: {
    eyebrow: { vi: "Giới thiệu", en: "About Us", km: "អំពីយើង" },
    title: { vi: "Tổng quan nhà máy", en: "Factory Overview", km: "ទិដ្ឋភាពទូទៅរោងចក្រ" },
    subtitleLine1: {
      vi: "Nhà máy chế biến cao su Phước Hòa Kampong Thom — Xã Kroyea, huyện Santuk,",
      en: "Phuoc Hoa Kampong Thom Rubber Processing Factory — Kroyea Commune, Santuk District,",
      km: "រោងចក្រកែច្នៃកៅស៊ូភូក ហូវ៉ា កំពង់ធំ — ឃុំគ្រយា ស្រុកសន្ទុក",
    },
    subtitleLine2: {
      vi: "tỉnh Kampong Thom, Vương Quốc Campuchia",
      en: "Kampong Thom Province, Kingdom of Cambodia",
      km: "ខេត្តកំពង់ធំ ព្រះរាជាណាចក្រកម្ពុជា",
    },
    contactTitle: { vi: "📧 Liên hệ", en: "📧 Contact", km: "📧 ទំនាក់ទំនង" },
    websiteLabel: { vi: "Website: ", en: "Website: ", km: "គេហទំព័រ: " },
    addressLine: {
      vi: "Xã Kroyea, huyện Santuk, tỉnh Kampong Thom, Campuchia",
      en: "Kroyea Commune, Santuk District, Kampong Thom Province, Cambodia",
      km: "ឃុំគ្រយា ស្រុកសន្ទុក ខេត្តកំពង់ធំ កម្ពុជា",
    },
    systemTitle: { vi: "🏗️ Hệ thống sản xuất", en: "🏗️ Production System", km: "🏗️ ប្រព័ន្ធផលិតកម្ម" },
    systemLine1: { vi: "01 Dây chuyền mủ tạp", en: "01 Cup lump rubber line", km: "០១ ខ្សែសង្វាក់កៅស៊ូដុំ" },
    systemLine2: { vi: "01 Dây chuyền mủ nước", en: "01 Field latex rubber line", km: "០១ ខ្សែសង្វាក់ទឹកកៅស៊ូ" },
  },
  timelineSection: {
    eyebrow: { vi: "Hành trình", en: "Journey", km: "ដំណើររឿង" },
    title: { vi: "Phát triển qua năm tháng", en: "Growth Through the Years", km: "ការអភិវឌ្ឍតាមកាលបរិច្ឆេទ" },
  },
  orgSection: {
    eyebrow: { vi: "Tổ chức", en: "Organization", km: "រចនាសម្ព័ន្ធ" },
    title: { vi: "Sơ đồ tổ chức", en: "Organization Chart", km: "ដ្យាក្រាមរចនាសម្ព័ន្ធអង្គភាព" },
    subtitle: {
      vi: "Nhà máy chế biến cao su Phước Hòa Kampong Thom",
      en: "Phuoc Hoa Kampong Thom Rubber Processing Factory",
      km: "រោងចក្រកែច្នៃកៅស៊ូភូក ហូវ៉ា កំពង់ធំ",
    },
    hint: {
      vi: "Nhấn vào từng thẻ để mở/đóng cấp dưới",
      en: "Tap each card to expand/collapse its team",
      km: "ចុចលើកាតនីមួយៗដើម្បីបើក/បិទក្រុមរង",
    },
    legend1: { vi: "Điều hành", en: "Executive", km: "អ្នកគ្រប់គ្រង" },
    legend2: {
      vi: "PQĐ Vận hành (Đội xe · Cơ điện · Kế toán)",
      en: "Deputy Supervisor – Operations (Fleet · Electromechanical · Accounting)",
      km: "អនុប្រធានរោងចក្រ – ប្រតិបត្តិការ (កងឡាន · អគ្គិសនីមេកានិច · គណនេយ្យ)",
    },
    legend3: {
      vi: "PQĐ Chất lượng · ISO (Kỹ thuật chế biến)",
      en: "Deputy Supervisor – Quality · ISO (Processing Engineering)",
      km: "អនុប្រធានរោងចក្រ – គុណភាព · ISO (បច្ចេកទេសកែច្នៃ)",
    },
    legend4: {
      vi: "— Trực tiếp    - - Gián tiếp/Hỗ trợ",
      en: "— Direct    - - Indirect / Support",
      km: "— ផ្ទាល់    - - ប្រយោល/គាំទ្រ",
    },
  },
  certsSection: {
    eyebrow: { vi: "Chứng nhận", en: "Certifications", km: "វិញ្ញាបនបត្រ" },
    title: { vi: "Tiêu chuẩn quốc tế", en: "International Standards", km: "ស្តង់ដារអន្តរជាតិ" },
    subtitle: {
      vi: "Đảm bảo chất lượng sản phẩm đạt tiêu chuẩn quốc tế",
      en: "Ensuring product quality meets international standards",
      km: "ធានាគុណភាពផលិតផលឱ្យសមស្របតាមស្តង់ដារអន្តរជាតិ",
    },
  },
  productsSection: {
    eyebrow: { vi: "Sản phẩm", en: "Products", km: "ផលិតផល" },
    title: { vi: "Dòng sản phẩm CSR", en: "CSR Product Line", km: "ជួរផលិតផល CSR" },
    subtitle: {
      vi: "Cao su thiên nhiên tiêu chuẩn — Standard Cambodia Rubber (CSR)",
      en: "Standard natural rubber — Standard Cambodia Rubber (CSR)",
      km: "កៅស៊ូធម្មជាតិស្តង់ដារ — Standard Cambodia Rubber (CSR)",
    },
    banner1Badge: { vi: "★ Sản phẩm chủ lực", en: "★ Flagship Product", km: "★ ផលិតផលចម្បង" },
    banner1Desc: {
      vi: "Standard Cambodia Rubber 10 — Cao su tiêu chuẩn chất lượng cao",
      en: "Standard Cambodia Rubber 10 — High-quality standard rubber",
      km: "Standard Cambodia Rubber 10 — កៅស៊ូស្តង់ដារគុណភាពខ្ពស់",
    },
    banner2Title: { vi: "Dây chuyền hiện đại", en: "Modern Production Line", km: "ខ្សែសង្វាក់ផលិតកម្មទំនើប" },
    banner2Desc: {
      vi: "Quy trình sản xuất khép kín, kiểm soát chất lượng nghiêm ngặt",
      en: "Closed-loop production process with strict quality control",
      km: "ដំណើរការផលិតកម្មបិទជិត ត្រួតពិនិត្យគុណភាពយ៉ាងម៉ត់ចត់",
    },
    starBadge: { vi: "★ Chủ lực", en: "★ Flagship", km: "★ ចម្បង" },
  },
  processSection: {
    eyebrow: { vi: "15 bước", en: "15 Steps", km: "១៥ជំហាន" },
    title: { vi: "Quy trình sản xuất", en: "Production Process", km: "ដំណើរការផលិតកម្ម" },
    subtitle: {
      vi: "Từ vườn cây đến thành phẩm — quy trình chế biến cao su CSR tiêu chuẩn quốc tế",
      en: "From plantation to finished product — CSR rubber processing to international standards",
      km: "ចាប់ពីចម្ការដល់ផលិតផលសម្រេច — ដំណើរការកែច្នៃកៅស៊ូ CSR តាមស្តង់ដារអន្តរជាតិ",
    },
    cta: {
      vi: "Vào hệ thống quản lý sản xuất",
      en: "Enter Production Management System",
      km: "ចូលប្រព័ន្ធគ្រប់គ្រងផលិតកម្ម",
    },
  },
  footer: {
    about: {
      vi: "Nhà máy chế biến cao su Phước Hòa Kampong Thom — Sản xuất cao su thiên nhiên tiêu chuẩn kỹ thuật (CSR) đạt chứng nhận quốc tế.",
      en: "Phuoc Hoa Kampong Thom Rubber Processing Factory — Producing internationally certified technically specified natural rubber (CSR).",
      km: "រោងចក្រកែច្នៃកៅស៊ូភូក ហូវ៉ា កំពង់ធំ — ផលិតកៅស៊ូធម្មជាតិកំណត់លក្ខណៈបច្ចេកទេស (CSR) ដែលទទួលបានវិញ្ញាបនបត្រអន្តរជាតិ។",
    },
    infoTitle: { vi: "Thông tin", en: "Information", km: "ព័ត៌មាន" },
    info1: {
      vi: "📍 Xã Kroyea, Santuk, Kampong Thom, Campuchia",
      en: "📍 Kroyea, Santuk, Kampong Thom, Cambodia",
      km: "📍 គ្រយា សន្ទុក កំពង់ធំ កម្ពុជា",
    },
    info4: { vi: "🏗️ Diện tích: 16 Ha", en: "🏗️ Area: 16 Ha", km: "🏗️ ផ្ទៃដី: ១៦ ហិកតា" },
    info5: { vi: "📅 Thành lập: 2018", en: "📅 Established: 2018", km: "📅 បង្កើតឆ្នាំ: ២០១៨" },
    info6: {
      vi: "🌿 Tuân thủ EUDR — Truy xuất nguồn gốc minh bạch",
      en: "🌿 EUDR Compliant — Transparent Traceability",
      km: "🌿 អនុលោមតាម EUDR — តាមដានប្រភពដើមយ៉ាងច្បាស់លាស់",
    },
    linksTitle: { vi: "Liên kết", en: "Quick Links", km: "តំណភ្ជាប់" },
    loginErp: { vi: "Đăng nhập ERP", en: "Login to ERP", km: "ចូលប្រើ ERP" },
    bottom: {
      vi: "v2.0 · PTCS Phước Hòa Kampong Thom © 2018–2026 · Powered by Next.js",
      en: "v2.0 · PTCS Phuoc Hoa Kampong Thom © 2018–2026 · Powered by Next.js",
      km: "v2.0 · PTCS Phuoc Hoa Kampong Thom © 2018–2026 · Powered by Next.js",
    },
  },
} as const

export const STATS_I18N: { value: string; label: LStr; icon: string }[] = [
  { value: "16 Ha", icon: "🏭", label: { vi: "Diện tích nhà máy", en: "Factory Area", km: "ផ្ទៃដីរោងចក្រ" } },
  { value: "2018", icon: "📅", label: { vi: "Năm thành lập", en: "Year Established", km: "ឆ្នាំបង្កើត" } },
  { value: "2", icon: "⚙️", label: { vi: "Dây chuyền sản xuất", en: "Production Lines", km: "ខ្សែសង្វាក់ផលិតកម្ម" } },
  { value: "CSR", icon: "📦", label: { vi: "Sản phẩm chính", en: "Main Product", km: "ផលិតផលចម្បង" } },
]

export const TIMELINE_I18N: { year: string; title: LStr; desc: LStr }[] = [
  {
    year: "2018",
    title: { vi: "Thành lập nhà máy", en: "Factory Established", km: "បង្កើតរោងចក្រ" },
    desc: {
      vi: "Thành lập nhà máy PTCS Phước Hòa Kampong Thom",
      en: "PTCS Phuoc Hoa Kampong Thom factory was established",
      km: "បង្កើតរោងចក្រ PTCS ភូក ហូវ៉ា កំពង់ធំ",
    },
  },
  {
    year: "6/2019",
    title: { vi: "Dây chuyền Mủ tạp", en: "Cup Lump Line", km: "ខ្សែសង្វាក់កៅស៊ូដុំ" },
    desc: {
      vi: "Đưa vào hoạt động dây chuyền chế biến Mủ tạp công suất 3 tấn/giờ",
      en: "Commissioned the cup lump rubber processing line with a capacity of 3 tons/hour",
      km: "ដាក់ឱ្យប្រើប្រាស់ខ្សែសង្វាក់កែច្នៃកៅស៊ូដុំ សមត្ថភាព ៣តោន/ម៉ោង",
    },
  },
  {
    year: "12/2022",
    title: { vi: "Dây chuyền Mủ nước", en: "Field Latex Line", km: "ខ្សែសង្វាក់ទឹកកៅស៊ូ" },
    desc: {
      vi: "Đưa vào hoạt động dây chuyền chế biến mủ nước 2 tấn/giờ",
      en: "Commissioned the field latex processing line with a capacity of 2 tons/hour",
      km: "ដាក់ឱ្យប្រើប្រាស់ខ្សែសង្វាក់កែច្នៃទឹកកៅស៊ូ សមត្ថភាព ២តោន/ម៉ោង",
    },
  },
  {
    year: "2023",
    title: { vi: "ISO 9001:2015", en: "ISO 9001:2015", km: "ISO 9001:2015" },
    desc: {
      vi: "Đạt chứng nhận ISO 9001:2015",
      en: "Achieved ISO 9001:2015 certification",
      km: "ទទួលបានវិញ្ញាបនបត្រ ISO 9001:2015",
    },
  },
  {
    year: "2024",
    title: { vi: "ISO 14001:2015", en: "ISO 14001:2015", km: "ISO 14001:2015" },
    desc: {
      vi: "Đạt chứng nhận ISO 14001:2015",
      en: "Achieved ISO 14001:2015 certification",
      km: "ទទួលបានវិញ្ញាបនបត្រ ISO 14001:2015",
    },
  },
  {
    year: "7/2025",
    title: { vi: "PEFC EUDR DDS", en: "PEFC EUDR DDS", km: "PEFC EUDR DDS" },
    desc: {
      vi: "Đạt chứng nhận chuỗi hành trình sản phẩm PEFC EUDR DDS tuân thủ quy định chống phá rừng của Liên minh Châu Âu, triển khai hệ thống truy xuất nguồn gốc nội bộ",
      en: "Achieved PEFC EUDR DDS chain-of-custody certification in compliance with the EU Deforestation Regulation, and deployed an internal traceability system",
      km: "ទទួលបានវិញ្ញាបនបត្រខ្សែសង្វាក់ផលិតផល PEFC EUDR DDS អនុលោមតាមបទបញ្ញត្តិប្រឆាំងការកាប់ព្រៃរបស់សហភាពអឺរ៉ុប និងដាក់ឱ្យប្រើប្រព័ន្ធតាមដានប្រភពដើមផ្ទៃក្នុង",
    },
  },
  {
    year: "2026",
    title: { vi: "Số hóa mở rộng", en: "Digital Expansion", km: "ពង្រីកឌីជីថល" },
    desc: {
      vi: "Đạt chứng nhận ISO 14067:2018 — Kiểm kê khí nhà kính sản phẩm, tiếp tục số hóa mở rộng và triển khai ERP quản lý sản xuất",
      en: "Achieved ISO 14067:2018 product carbon footprint certification — continuing digital expansion and rollout of the production management ERP",
      km: "ទទួលបានវិញ្ញាបនបត្រ ISO 14067:2018 — សារពើភ័ណ្ឌឧស្ម័នផ្ទះកញ្ចក់ផលិតផល បន្តពង្រីកឌីជីថល និងអនុវត្តប្រព័ន្ធ ERP គ្រប់គ្រងផលិតកម្ម",
    },
  },
]

export const CERTS_I18N: { name: string; desc: LStr; img: string; bg: string }[] = [
  {
    name: "PEFC EUDR DDS",
    desc: {
      vi: "Chuỗi hành trình sản phẩm — tuân thủ quy định chống phá rừng của Liên minh Châu Âu",
      en: "Chain of custody — compliant with the EU Deforestation Regulation",
      km: "ខ្សែសង្វាក់ផលិតផល — អនុលោមតាមបទបញ្ញត្តិប្រឆាំងការកាប់ព្រៃរបស់សហភាពអឺរ៉ុប",
    },
    img: "/images/cert_pefc_eudr.jpg",
    bg: "bg-white",
  },
  {
    name: "TCCS 112:2022",
    desc: {
      vi: "Tiêu chuẩn cơ sở Tập đoàn Công nghiệp Cao su Việt Nam — TĐCNCSVN",
      en: "Base standard of the Vietnam Rubber Group — VRG",
      km: "ស្តង់ដារមូលដ្ឋានក្រុមហ៊ុនឧស្សាហកម្មកៅស៊ូវៀតណាម — VRG",
    },
    img: "/images/cert_tccs112.png",
    bg: "bg-white",
  },
  {
    name: "ISO 9001:2015",
    desc: {
      vi: "Hệ thống quản lý chất lượng theo tiêu chuẩn quốc tế",
      en: "Quality management system to international standards",
      km: "ប្រព័ន្ធគ្រប់គ្រងគុណភាពតាមស្តង់ដារអន្តរជាតិ",
    },
    img: "/images/cert_iso9001.jpg",
    bg: "bg-white",
  },
  {
    name: "ISO 14001:2015",
    desc: {
      vi: "Hệ thống quản lý môi trường theo tiêu chuẩn quốc tế",
      en: "Environmental management system to international standards",
      km: "ប្រព័ន្ធគ្រប់គ្រងបរិស្ថានតាមស្តង់ដារអន្តរជាតិ",
    },
    img: "/images/cert_iso14001.jpg",
    bg: "bg-white",
  },
  {
    name: "VILAS 1472",
    desc: {
      vi: "Phòng kiểm nghiệm được công nhận — ISO/IEC 17025 · ilac-MRA · BoA Vietnam",
      en: "Accredited testing laboratory — ISO/IEC 17025 · ilac-MRA · BoA Vietnam",
      km: "មន្ទីរពិសោធន៍ដែលបានទទួលស្គាល់ — ISO/IEC 17025 · ilac-MRA · BoA វៀតណាម",
    },
    img: "/images/cert_vilas1472.jpg",
    bg: "bg-slate-50",
  },
  {
    name: "ISO 14067:2018",
    desc: {
      vi: "Kiểm kê khí nhà kính sản phẩm — đã đạt chứng nhận dấu vết carbon VRG CSR10",
      en: "Product carbon footprint verification — certified for VRG CSR10 (Carbon Footprint Verification Statement)",
      km: "សារពើភ័ណ្ឌឧស្ម័នផ្ទះកញ្ចក់ផលិតផល — បានទទួលវិញ្ញាបនបត្របាតុកម្មកាបូន VRG CSR10",
    },
    img: "/images/cert_iso14067.jpg",
    bg: "bg-white",
  },
]

export const PRODUCTS_I18N: { code: string; name: string; desc: LStr; star?: boolean }[] = [
  {
    code: "CSR10",
    name: "Standard Cambodia Rubber 10",
    star: true,
    desc: {
      vi: "Cao su tiêu chuẩn, độ dẻo cao, phù hợp cho sản xuất lốp xe và các sản phẩm công nghiệp",
      en: "Standard rubber with high plasticity, suitable for tire manufacturing and industrial products",
      km: "កៅស៊ូស្តង់ដារ ភាពបត់បែនខ្ពស់ សមស្របសម្រាប់ផលិតកង់រថយន្ត និងផលិតផលឧស្សាហកម្ម",
    },
  },
  {
    code: "CSR20",
    name: "Standard Cambodia Rubber 20",
    desc: {
      vi: "Cao su cấp 2, sử dụng rộng rãi trong ngành công nghiệp đa dạng",
      en: "Grade 2 rubber, widely used across diverse industries",
      km: "កៅស៊ូថ្នាក់ទី២ ប្រើប្រាស់យ៉ាងទូលំទូលាយក្នុងឧស្សាហកម្មចម្រុះ",
    },
  },
  {
    code: "CSR3L",
    name: "Standard Cambodia Rubber 3L",
    desc: {
      vi: "Cao su chất lượng cao, màu sáng, dùng cho sản phẩm y tế và tiêu dùng",
      en: "High-quality, light-colored rubber used for medical and consumer products",
      km: "កៅស៊ូគុណភាពខ្ពស់ ពណ៌ភ្លឺ ប្រើសម្រាប់ផលិតផលវេជ្ជសាស្ត្រ និងទំនិញប្រើប្រាស់",
    },
  },
  {
    code: "CSRL",
    name: "Standard Cambodia Rubber L",
    desc: {
      vi: "Cao su tiêu chuẩn L, đa dụng cho nhiều ngành công nghiệp",
      en: "Standard L-grade rubber, versatile for many industries",
      km: "កៅស៊ូស្តង់ដារ L សម្រាប់ប្រើប្រាស់ចម្រុះក្នុងឧស្សាហកម្មជាច្រើន",
    },
  },
  {
    code: "CSRCV50",
    name: "CSR CV50",
    desc: {
      vi: "Cao su xử lý đặc biệt, độ nhớt ổn định CV50",
      en: "Specially processed rubber with stabilized viscosity CV50",
      km: "កៅស៊ូកែច្នៃពិសេស ភាពស្អិតជាប់ស្ថិរភាព CV50",
    },
  },
  {
    code: "CSRCV60",
    name: "CSR CV60",
    desc: {
      vi: "Cao su xử lý đặc biệt, độ nhớt ổn định CV60",
      en: "Specially processed rubber with stabilized viscosity CV60",
      km: "កៅស៊ូកែច្នៃពិសេស ភាពស្អិតជាប់ស្ថិរភាព CV60",
    },
  },
]

export const PROCESS_STEPS_I18N: { num: number; icon: string; name: LStr; desc: LStr }[] = [
  {
    num: 1,
    icon: "🚛",
    name: { vi: "Điều xe", en: "Vehicle Dispatch", km: "រៀបចំរថយន្ត" },
    desc: {
      vi: "Điều xe qua phần mềm ra các điểm giao nhận thu gom mủ theo danh sách chỉ định",
      en: "Dispatch trucks via software to designated collection points to gather latex",
      km: "រៀបចំរថយន្តតាមកម្មវិធីទៅកាន់ចំណុចប្រមូលទឹកកៅស៊ូតាមបញ្ជីកំណត់",
    },
  },
  {
    num: 2,
    icon: "⚖️",
    name: { vi: "Tiếp nhận & Cân", en: "Intake & Weighing", km: "ទទួល & ថ្លឹង" },
    desc: {
      vi: "Xe vận chuyển về trạm cân — tiếp nhận và ghi nhận khối lượng nguyên liệu đầu vào",
      en: "Trucks arrive at the weighing station — raw material intake weight is recorded",
      km: "រថយន្តដឹកមកដល់ស្ថានីយថ្លឹង — ទទួល និងកត់ត្រាទម្ងន់វត្ថុធាតុដើម",
    },
  },
  {
    num: 3,
    icon: "✂️",
    name: { vi: "Hồ rửa 1 + Xé 1", en: "Wash Pit 1 + Shredder 1", km: "អាងលាងទី១ + ម៉ាស៊ីនកាត់ទី១" },
    desc: {
      vi: "Cho vào hồ rửa lần 1, qua máy xé 1 — xé nhỏ và rửa tạp chất ban đầu",
      en: "Placed into wash pit 1, then through shredder 1 — initial shredding and impurity removal",
      km: "ដាក់ចូលអាងលាងទី១ ហើយឆ្លងកាត់ម៉ាស៊ីនកាត់ទី១ — កាត់តូច និងលាងសម្អាតកខ្វក់ដំបូង",
    },
  },
  {
    num: 4,
    icon: "🏗️",
    name: { vi: "Hồ rửa 2 + Vào kho", en: "Wash Pit 2 + To Storage", km: "អាងលាងទី២ + ចូលឃ្លាំង" },
    desc: {
      vi: "Xuống hồ rửa lần 2, xe vận chuyển nội bộ đưa nguyên liệu đã xé vào kho lưu ủ",
      en: "Moved to wash pit 2, then internal transport moves the shredded material into the aging warehouse",
      km: "ចុះទៅអាងលាងទី២ រថយន្តដឹកជញ្ជូនក្នុងតំបន់នាំវត្ថុធាតុដើមដែលបានកាត់ចូលឃ្លាំងផ្ទុកកកកុញ",
    },
  },
  {
    num: 5,
    icon: "⏳",
    name: { vi: "Lưu ủ 21 ngày", en: "21-Day Aging", km: "ផ្ទុកកកកុញ ២១ថ្ងៃ" },
    desc: {
      vi: "Lưu ủ tối thiểu 21 ngày để ổn định các chỉ tiêu hóa lý trước khi gia công",
      en: "Aged for at least 21 days to stabilize physico-chemical properties before processing",
      km: "ផ្ទុកកកកុញយ៉ាងតិច ២១ថ្ងៃ ដើម្បីធ្វើឱ្យសូចនាករគីមីរូបវិទ្យាមានស្ថិរភាពមុនកែច្នៃ",
    },
  },
  {
    num: 6,
    icon: "🔄",
    name: { vi: "Xé 2 + Hồ rửa 3", en: "Shredder 2 + Wash Pit 3", km: "ម៉ាស៊ីនកាត់ទី២ + អាងលាងទី៣" },
    desc: {
      vi: "Xe xúc đưa nguyên liệu đã ủ vào hồ rửa lần 3, lên máy xé 2 xé nhỏ lần hai",
      en: "A loader moves the aged material into wash pit 3, then through shredder 2 for a second shredding",
      km: "រថយន្តលើកដឹកវត្ថុធាតុដើមដែលបានកកកុញចូលអាងលាងទី៣ រួចឡើងម៉ាស៊ីនកាត់ទី២ម្តងទៀត",
    },
  },
  {
    num: 7,
    icon: "⚙️",
    name: { vi: "Cán + Băm thô", en: "Rolling + Coarse Crumbling", km: "កិន + កិនគ្រើម" },
    desc: {
      vi: "Qua hồ rửa lần 4 — máy cán 3 trục 1, máy cán 1/2 và máy băm thô tạo hạt cốm thô",
      en: "Through wash pit 4 — 3-roll mill 1, mills 1/2 and the coarse crumbler produce coarse crumb",
      km: "ឆ្លងកាត់អាងលាងទី៤ — ម៉ាស៊ីនកិន៣ស្នាដៃទី១ ម៉ាស៊ីនកិន១/២ និងម៉ាស៊ីនកិនគ្រើមបង្កើតគ្រាប់គ្រើម",
    },
  },
  {
    num: 8,
    icon: "🔧",
    name: { vi: "Sàn rung + Băm tinh", en: "Vibrating Screen + Fine Crumbling", km: "ក្រឡាញ័រ + កិនម្សៅ" },
    desc: {
      vi: "Bơm hút lên sàn rung thô — qua máy cán 3 trục 2, cán 3/4/5 và máy băm tinh tạo cốm mịn",
      en: "Pumped onto the vibrating screen — through 3-roll mill 2, mills 3/4/5 and the fine crumbler to produce fine crumb",
      km: "បូមឡើងលើក្រឡាញ័រគ្រើម — ឆ្លងកាត់ម៉ាស៊ីនកិន៣ស្នាដៃទី២ ម៉ាស៊ីនកិន៣/៤/៥ និងម៉ាស៊ីនកិនម្សៅបង្កើតគ្រាប់ម្សៅ",
    },
  },
  {
    num: 9,
    icon: "🔥",
    name: { vi: "Phả thùng + Lò sấy", en: "Loading Trays + Drying Oven", km: "ចាក់ធុង + ឡសម្ងួត" },
    desc: {
      vi: "Công nhân phả cốm tinh vào thùng sấy — đẩy vào lò sấy gia nhiệt đến khi mủ cốm chín vàng",
      en: "Workers load fine crumb into drying trays — pushed into the drying oven and heated until golden ripe",
      km: "កម្មករចាក់គ្រាប់ម្សៅចូលធុងសម្ងួត — រុញចូលឡសម្ងួតកំដៅរហូតដល់កៅស៊ូឆាបពណ៌លឿង",
    },
  },
  {
    num: 10,
    icon: "📦",
    name: { vi: "Ra lò + Cân bành", en: "Unloading + Bale Weighing", km: "ចេញឡ + ថ្លឹងកញ្ចប់" },
    desc: {
      vi: "Mủ chín ra lò — cân từng bành chính xác theo yêu cầu khách hàng",
      en: "Ripe rubber comes out of the oven — each bale is weighed precisely per customer requirements",
      km: "កៅស៊ូឆាបចេញពីឡ — ថ្លឹងកញ្ចប់នីមួយៗឱ្យបានត្រឹមត្រូវតាមតម្រូវការអតិថិជន",
    },
  },
  {
    num: 11,
    icon: "🏋️",
    name: { vi: "Ép bành 150 tấn", en: "150-Ton Baling Press", km: "ចុចកញ្ចប់ ១៥០តោន" },
    desc: {
      vi: "Ép tạo hình bành bằng máy ép thủy lực 150 tấn — đạt chuẩn kích thước và khối lượng",
      en: "Bales are pressed and shaped using a 150-ton hydraulic press — meeting standard size and weight",
      km: "ចុចធ្វើរូបរាងកញ្ចប់ដោយម៉ាស៊ីនចុចធារាសាស្ត្រ ១៥០តោន — ត្រូវតាមស្តង់ដារទំហំ និងទម្ងន់",
    },
  },
  {
    num: 12,
    icon: "🔍",
    name: { vi: "Dò kim loại 100%", en: "100% Metal Detection", km: "រកលោហៈ ១០០%" },
    desc: {
      vi: "Toàn bộ bành đi qua máy dò kim loại kiểm tra 100% — đảm bảo không có tạp chất kim loại",
      en: "Every bale passes through a metal detector for 100% inspection — ensuring no metal contamination",
      km: "កញ្ចប់ទាំងអស់ឆ្លងកាត់ម៉ាស៊ីនរកលោហៈត្រួតពិនិត្យ ១០០% — ធានាមិនមានកខ្វក់លោហៈ",
    },
  },
  {
    num: 13,
    icon: "🧫",
    name: { vi: "Kiểm tạp chất", en: "Impurity Testing", km: "ត្រួតពិនិត្យកខ្វក់" },
    desc: {
      vi: "Công nhân cắt mẫu kiểm tra tạp chất tỷ lệ 10% theo TCCS 112:2022 và TCVN 3769:2016",
      en: "Workers cut samples to check impurity content at a 10% rate per TCCS 112:2022 and TCVN 3769:2016",
      km: "កម្មករកាត់គំរូត្រួតពិនិត្យកខ្វក់អត្រា ១០% តាមស្តង់ដារ TCCS 112:2022 និង TCVN 3769:2016",
    },
  },
  {
    num: 14,
    icon: "🎁",
    name: { vi: "Bao gói + Vào kiện", en: "Packaging + Palletizing", km: "វេចខ្ចប់ + ដាក់លើប៉ាឡែត" },
    desc: {
      vi: "Bọc PE dán nhãn theo tiêu chuẩn — xếp bành vào kiện pallet, xe nâng vào kho thành phẩm",
      en: "Wrapped in labeled PE film per standard — bales stacked onto pallets, forklifted into the finished-goods warehouse",
      km: "រុំដោយផ្ទាំង PE បិទស្លាកតាមស្តង់ដារ — រៀបកញ្ចប់លើប៉ាឡែត រថយន្តលើកនាំចូលឃ្លាំងផលិតផលសម្រេច",
    },
  },
  {
    num: 15,
    icon: "🚢",
    name: { vi: "Kiểm nghiệm & Xuất", en: "Testing & Shipment", km: "ត្រួតពិនិត្យគុណភាព & នាំចេញ" },
    desc: {
      vi: "Phòng KN (ISO/IEC 17025 · Vilas 1472) xếp hạng — lô đạt chuẩn xuất hàng, truy xuất nguồn gốc EUDR đầy đủ",
      en: "The lab (ISO/IEC 17025 · Vilas 1472) grades each lot — qualified batches are shipped with full EUDR traceability",
      km: "មន្ទីរពិសោធន៍ (ISO/IEC 17025 · Vilas 1472) ដាក់ចំណាត់ថ្នាក់ — បាច់ដែលមានលក្ខណៈគ្រប់គ្រាន់នាំចេញ ដោយមានការតាមដានប្រភពដើម EUDR ពេញលេញ",
    },
  },
]

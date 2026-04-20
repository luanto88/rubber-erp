"use client"
import { useEffect, useRef } from "react"
import Link from "next/link"
import Image from "next/image"

// ─── Scroll Reveal Hook ──────────────────────────────────────────────────────
function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const items = el.querySelectorAll(".sr")
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("sr-visible"); obs.unobserve(e.target) } })
    }, { threshold: 0.1, rootMargin: "0px 0px -40px 0px" })
    items.forEach(i => obs.observe(i))
    return () => obs.disconnect()
  }, [])
  return ref
}

// ─── Data ────────────────────────────────────────────────────────────────────
const STATS = [
  { value: "16 Ha", label: "Diện tích nhà máy", icon: "🏭" },
  { value: "2019", label: "Năm thành lập", icon: "📅" },
  { value: "2", label: "Dây chuyền sản xuất", icon: "⚙️" },
  { value: "CSR", label: "Sản phẩm chính", icon: "📦" },
]

const TIMELINE = [
  { year: "2019", title: "Thành lập", desc: "Khởi công xây dựng nhà máy tại Xã Kroyea, huyện Santuk, tỉnh Kampong Thom" },
  { year: "2020", title: "Đi vào hoạt động", desc: "Hoàn thành xây dựng cổng nhà máy và dây chuyền mủ nước đầu tiên" },
  { year: "2022", title: "Mở rộng", desc: "Bổ sung dây chuyền mủ tạp, nâng công suất sản xuất" },
  { year: "2024", title: "Chứng nhận PEFC", desc: "Đạt chứng nhận PEFC CS về chuỗi hành trình sản phẩm" },
  { year: "2026", title: "Số hóa & Mở rộng", desc: "Triển khai ERP quản lý sản xuất + nâng cấp cổng nhà máy và dây chuyền mủ nước" },
]

const CERTS = [
  { name: "PEFC CS", desc: "Chứng nhận chuỗi hành trình sản phẩm — đảm bảo nguồn nguyên liệu bền vững", color: "from-emerald-500 to-green-600" },
  { name: "VRG", desc: "Tiêu chuẩn Tập đoàn Công nghiệp Cao su Việt Nam", color: "from-blue-500 to-indigo-600" },
  { name: "ISO 9001", desc: "Hệ thống quản lý chất lượng theo tiêu chuẩn quốc tế", color: "from-amber-500 to-orange-600" },
  { name: "ISO/IEC 17025", desc: "Chứng nhận năng lực phòng thí nghiệm kiểm nghiệm chất lượng cao su", color: "from-purple-500 to-violet-600" },
  { name: "Vilas 1472", desc: "Chứng nhận phòng kiểm nghiệm được công nhận bởi Văn phòng Công nhận Chất lượng Việt Nam", color: "from-rose-500 to-pink-600" },
]

const PRODUCTS = [
  { code: "CSR10", name: "Constant Shear Rate 10", desc: "Cao su tiêu chuẩn, độ dẻo cao, phù hợp cho sản xuất lốp xe và các sản phẩm công nghiệp", star: true },
  { code: "CSR20", name: "Constant Shear Rate 20", desc: "Cao su cấp 2, sử dụng rộng rãi trong ngành công nghiệp đa dạng" },
  { code: "CSR3L", name: "Constant Shear Rate 3L", desc: "Cao su chất lượng cao, màu sáng, dùng cho sản phẩm y tế và tiêu dùng" },
  { code: "CSRL", name: "Constant Shear Rate L", desc: "Cao su tiêu chuẩn L, đa dụng cho nhiều ngành công nghiệp" },
  { code: "CSRCV50", name: "CSR CV50", desc: "Cao su xử lý đặc biệt, độ nhớt ổn định CV50" },
  { code: "CSRCV60", name: "CSR CV60", desc: "Cao su xử lý đặc biệt, độ nhớt ổn định CV60" },
]

const ORG = {
  top: "QUẢN ĐỐC",
  branches: [
    {
      title: "PQĐ",
      subtitle: "Phụ trách đội xe · Cơ khí · Phiên dịch - Nhân sự",
      color: "from-blue-500 to-indigo-600",
      shadow: "shadow-blue-200",
      border: "hover:border-blue-300",
      departments: [
        { icon: "🚛", name: "Đội xe - Thủ kho",       roles: ["Đội xe cơ khí", "Tổ trưởng", "Nhà bếp"] },
        { icon: "⚡", name: "Cơ điện",                 roles: ["Cơ điện viên"] },
        { icon: "📊", name: "Kế toán - Tổ chức",       roles: ["Tổ trưởng KT", "Xuất hàng"] },
        { icon: "⚙️", name: "Kỹ thuật - Môi trường",   roles: ["Cự trưởng", "Tổ vận hành"] },
      ],
    },
    {
      title: "PQĐ",
      subtitle: "Phụ trách chất lượng ISO",
      color: "from-amber-500 to-orange-600",
      shadow: "shadow-amber-200",
      border: "hover:border-amber-300",
      departments: [
        { icon: "🔬", name: "Kiểm nghiệm (KCS/QC)", roles: ["Cán bộ KCS", "Nhân viên lab"] },
        { icon: "📋", name: "ISO & Tài liệu",         roles: ["ISO coordinator"] },
      ],
    },
  ],
}

const PROCESS_STEPS = [
  { num: 1,  name: "Điều xe",          icon: "🚛", desc: "Điều xe qua phần mềm ra các điểm giao nhận thu gom mủ theo danh sách chỉ định" },
  { num: 2,  name: "Tiếp nhận & Cân",  icon: "⚖️", desc: "Xe vận chuyển về trạm cân — tiếp nhận và ghi nhận khối lượng nguyên liệu đầu vào" },
  { num: 3,  name: "Hồ rửa 1 + Xé 1", icon: "✂️", desc: "Cho vào hồ rửa lần 1, qua máy xé 1 — xé nhỏ và rửa tạp chất ban đầu" },
  { num: 4,  name: "Hồ rửa 2 + Vào kho", icon: "🏗️", desc: "Xuống hồ rửa lần 2, xe vận chuyển nội bộ đưa nguyên liệu đã xé vào kho lưu ủ" },
  { num: 5,  name: "Lưu ủ 21 ngày",    icon: "⏳", desc: "Lưu ủ tối thiểu 21 ngày để ổn định các chỉ tiêu hóa lý trước khi gia công" },
  { num: 6,  name: "Xé 2 + Hồ rửa 3", icon: "🔄", desc: "Xe xúc đưa nguyên liệu đã ủ vào hồ rửa lần 3, lên máy xé 2 xé nhỏ lần hai" },
  { num: 7,  name: "Cán + Băm thô",    icon: "⚙️", desc: "Qua hồ rửa lần 4 — máy cán 3 trục 1, máy cán 1/2 và máy băm thô tạo hạt cốm thô" },
  { num: 8,  name: "Sàn rung + Băm tinh", icon: "🔧", desc: "Bơm hút lên sàn rung thô — qua máy cán 3 trục 2, cán 3/4/5 và máy băm tinh tạo cốm mịn" },
  { num: 9,  name: "Phả thùng + Lò sấy", icon: "🔥", desc: "Công nhân phả cốm tinh vào thùng sấy — đẩy vào lò sấy gia nhiệt đến khi mủ cốm chín vàng" },
  { num: 10, name: "Ra lò + Cân bành", icon: "📦", desc: "Mủ chín ra lò — cân từng bành chính xác theo yêu cầu khách hàng" },
  { num: 11, name: "Ép bành 150 tấn",  icon: "🏋️", desc: "Ép tạo hình bành bằng máy ép thủy lực 150 tấn — đạt chuẩn kích thước và khối lượng" },
  { num: 12, name: "Dò kim loại 100%", icon: "🔍", desc: "Toàn bộ bành đi qua máy dò kim loại kiểm tra 100% — đảm bảo không có tạp chất kim loại" },
  { num: 13, name: "Kiểm tạp chất",    icon: "🧫", desc: "Công nhân cắt mẫu kiểm tra tạp chất tỷ lệ 10% theo TCCS 112:2022 và TCVN 3769:2016" },
  { num: 14, name: "Bao gói + Vào kiện", icon: "🎁", desc: "Bọc PE dán nhãn theo tiêu chuẩn — xếp bành vào kiện pallet, xe nâng vào kho thành phẩm" },
  { num: 15, name: "Kiểm nghiệm & Xuất", icon: "🚢", desc: "Phòng KN (ISO/IEC 17025 · Vilas 1472) xếp hạng — lô đạt chuẩn xuất hàng, truy xuất nguồn gốc EUDR đầy đủ" },
]

// ─── Component ───────────────────────────────────────────────────────────────
export default function LandingPage() {
  const containerRef = useScrollReveal()

  return (
    <div ref={containerRef} className="min-h-screen bg-slate-50">
      {/* ═══ NAVBAR ═══ */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-200/60" style={{ transition: "all 0.3s" }}>
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏭</span>
            <span className="font-bold text-slate-800 text-lg tracking-tight">PTCS Phước Hòa</span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#gioi-thieu" className="text-sm font-medium text-slate-600 hover:text-emerald-600 transition-colors">Giới thiệu</a>
            <a href="#to-chuc" className="text-sm font-medium text-slate-600 hover:text-emerald-600 transition-colors">Tổ chức</a>
            <a href="#tieu-chuan" className="text-sm font-medium text-slate-600 hover:text-emerald-600 transition-colors">Tiêu chuẩn</a>
            <a href="#san-pham" className="text-sm font-medium text-slate-600 hover:text-emerald-600 transition-colors">Sản phẩm</a>
            <a href="#quy-trinh" className="text-sm font-medium text-slate-600 hover:text-emerald-600 transition-colors">Quy trình</a>
            <Link href="/login" className="px-5 py-2.5 bg-emerald-600 text-white text-sm font-semibold rounded-full hover:bg-emerald-700 transition-all hover:shadow-lg hover:shadow-emerald-200 hover:-translate-y-0.5">
              Đăng nhập
            </Link>
          </div>
          {/* Mobile menu button */}
          <Link href="/login" className="md:hidden px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-full">
            Đăng nhập
          </Link>
        </div>
      </nav>

      {/* ═══ SECTION 1: HERO + CTA (IKEA-style bento) ═══ */}
      <section className="pt-20 px-4 md:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-[75vh]">
            {/* Hero Left (2/3) */}
            <div className="lg:col-span-2 relative rounded-3xl overflow-hidden group">
              <Image src="/images/hero_factory.png" alt="Nhà máy chế biến cao su Phước Hòa Kampong Thom" fill className="object-cover group-hover:scale-105 transition-transform duration-700" priority />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-8 md:p-12">
                <div className="sr" style={{ animationDelay: "0.1s" }}>
                  <p className="text-emerald-300 text-sm font-semibold tracking-widest uppercase mb-3">Phước Hòa Kampong Thom</p>
                  <h1 className="text-3xl md:text-5xl lg:text-6xl font-black text-white leading-tight mb-4">
                    Nhà máy chế biến<br/>cao su tiêu chuẩn quốc tế
                  </h1>
                  <p className="text-white/80 text-lg max-w-xl">
                    Sản xuất CSR10, CSR20, CSR3L đạt chứng nhận PEFC CS — Vương Quốc Campuchia
                  </p>
                </div>
              </div>
            </div>

            {/* CTA Right (1/3) — IKEA "Go Shopping" style */}
            <Link href="/login" className="relative rounded-3xl overflow-hidden flex flex-col justify-between p-8 md:p-10 group cursor-pointer" style={{ backgroundColor: "#fbbf24" }}>
              <div className="sr">
                <div className="w-14 h-14 bg-black/10 rounded-2xl flex items-center justify-center mb-6">
                  <span className="text-3xl">⚙️</span>
                </div>
                <h2 className="text-3xl md:text-4xl font-black text-slate-900 leading-tight mb-4">
                  Vào quy trình sản xuất
                </h2>
                <p className="text-slate-700/80 text-base mb-8">
                  Quản lý toàn bộ quy trình sản xuất — từ tiếp nhận mủ đến xuất hàng
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-12 h-12 bg-black rounded-full flex items-center justify-center group-hover:scale-110 group-hover:bg-slate-800 transition-all duration-300">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                </span>
                <span className="text-sm font-bold text-slate-900">Dashboard & ERP</span>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 2: GIỚI THIỆU (Stats) ═══ */}
      <section id="gioi-thieu" className="py-24 px-4 md:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 sr">
            <p className="text-emerald-600 font-semibold text-sm tracking-widest uppercase mb-3">Giới thiệu</p>
            <h2 className="text-4xl md:text-5xl font-black text-slate-900 mb-6">Tổng quan nhà máy</h2>
            <p className="text-slate-500 text-lg max-w-2xl mx-auto">
              Nhà máy chế biến cao su Phước Hòa Kampong Thom — Xã Kroyea, huyện Santuk,<br />tỉnh Kampong Thom, Vương Quốc Campuchia
            </p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {STATS.map((s, i) => (
              <div key={i} className="sr bg-white rounded-2xl p-6 md:p-8 border border-slate-200/60 hover:border-emerald-300 hover:shadow-xl hover:shadow-emerald-50 hover:-translate-y-1 transition-all duration-300 group" style={{ animationDelay: `${i * 0.1}s` }}>
                <span className="text-3xl mb-4 block group-hover:scale-125 transition-transform duration-300">{s.icon}</span>
                <div className="text-3xl md:text-4xl font-black text-slate-900 mb-1">{s.value}</div>
                <div className="text-sm text-slate-500 font-medium">{s.label}</div>
              </div>
            ))}
          </div>
          {/* Extra info row */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="sr bg-gradient-to-br from-emerald-50 to-green-50 rounded-2xl p-8 border border-emerald-100">
              <h3 className="font-bold text-slate-800 text-xl mb-3">📧 Liên hệ</h3>
              <p className="text-slate-600">nhamaychebien.phk@gmail.com</p>
              <p className="text-slate-500 text-sm mt-2">Xã Kroyea, huyện Santuk, tỉnh Kampong Thom, Campuchia</p>
            </div>
            <div className="sr bg-gradient-to-br from-amber-50 to-yellow-50 rounded-2xl p-8 border border-amber-100">
              <h3 className="font-bold text-slate-800 text-xl mb-3">🏗️ Hệ thống sản xuất</h3>
              <p className="text-slate-600">01 Dây chuyền mủ tạp</p>
              <p className="text-slate-600">01 Dây chuyền mủ nước</p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 3: TIMELINE ═══ */}
      <section className="py-24 px-4 md:px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 sr">
            <p className="text-emerald-600 font-semibold text-sm tracking-widest uppercase mb-3">Hành trình</p>
            <h2 className="text-4xl md:text-5xl font-black text-slate-900 mb-6">Phát triển qua năm tháng</h2>
          </div>
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-200 hidden md:block" />
            <div className="space-y-8 md:space-y-0">
              {TIMELINE.map((t, i) => (
                <div key={i} className={`sr relative md:flex items-center ${i % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"} md:mb-12`} style={{ animationDelay: `${i * 0.15}s` }}>
                  <div className={`md:w-1/2 ${i % 2 === 0 ? "md:pr-12 md:text-right" : "md:pl-12"}`}>
                    <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200/60 hover:border-emerald-300 hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
                      <span className="inline-block px-3 py-1 bg-emerald-100 text-emerald-700 text-sm font-bold rounded-full mb-3">{t.year}</span>
                      <h3 className="text-xl font-bold text-slate-800 mb-2">{t.title}</h3>
                      <p className="text-slate-500 text-sm">{t.desc}</p>
                    </div>
                  </div>
                  {/* Dot */}
                  <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 w-5 h-5 bg-emerald-500 rounded-full border-4 border-white shadow-md z-10" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 4: ORG CHART ═══ */}
      <section id="to-chuc" className="py-24 px-4 md:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 sr">
            <p className="text-emerald-600 font-semibold text-sm tracking-widest uppercase mb-3">Tổ chức</p>
            <h2 className="text-4xl md:text-5xl font-black text-slate-900 mb-6">Sơ đồ tổ chức</h2>
            <p className="text-slate-500 text-lg max-w-2xl mx-auto">Cơ cấu quản lý và vận hành nhà máy chế biến cao su Phước Hòa Kampong Thom</p>
          </div>

          <div className="sr flex flex-col items-center">
            {/* Level 1 — Quản đốc */}
            <div className="bg-emerald-600 text-white rounded-2xl px-10 py-4 font-black text-xl shadow-xl shadow-emerald-200">
              {ORG.top}
            </div>
            <div className="w-px h-8 bg-slate-300" />

            {/* Level 2 — Two PQĐ branches */}
            <div className="w-full flex flex-col lg:flex-row justify-center gap-6 lg:gap-16 items-start">
              {ORG.branches.map((branch, bi) => (
                <div key={bi} className="flex-1 max-w-xl mx-auto lg:mx-0 flex flex-col items-center">
                  {/* PQĐ header */}
                  <div className={`w-full bg-gradient-to-br ${branch.color} text-white rounded-2xl px-6 py-4 shadow-lg ${branch.shadow} text-center`}>
                    <div className="font-black text-lg">{branch.title}</div>
                    <div className="text-xs opacity-90 mt-1 leading-snug">{branch.subtitle}</div>
                  </div>
                  <div className="w-px h-6 bg-slate-300" />

                  {/* Level 3 — Departments */}
                  <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {branch.departments.map((dept, di) => (
                      <div key={di} className={`bg-white border border-slate-200 ${branch.border} rounded-xl p-4 hover:shadow-md transition-all duration-200`}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xl">{dept.icon}</span>
                          <span className="text-sm font-bold text-slate-700">{dept.name}</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {dept.roles.map((r, ri) => (
                            <span key={ri} className="text-[10px] bg-slate-50 border border-slate-200 text-slate-500 rounded px-2 py-0.5">{r}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-10 text-xs text-slate-400">Cập nhật 2026</p>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 5: CERTIFICATIONS ═══ */}

      <section id="tieu-chuan" className="py-24 px-4 md:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 sr">
            <p className="text-emerald-600 font-semibold text-sm tracking-widest uppercase mb-3">Chứng nhận</p>
            <h2 className="text-4xl md:text-5xl font-black text-slate-900 mb-6">Tiêu chuẩn quốc tế</h2>
            <p className="text-slate-500 text-lg max-w-2xl mx-auto">Đảm bảo chất lượng sản phẩm đạt tiêu chuẩn quốc tế</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-6">
            {CERTS.map((c, i) => (
              <div key={i} className="sr group" style={{ animationDelay: `${i * 0.15}s` }}>
                <div className="relative rounded-2xl overflow-hidden border border-slate-200/60 hover:shadow-2xl transition-all duration-500 hover:-translate-y-2">
                  <div className={`h-2 bg-gradient-to-r ${c.color}`} />
                  <div className="p-8">
                    <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${c.color} flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300`}>
                      <span className="text-white text-2xl font-black">{c.name.charAt(0)}</span>
                    </div>
                    <h3 className="text-2xl font-bold text-slate-800 mb-3">{c.name}</h3>
                    <p className="text-slate-500 leading-relaxed">{c.desc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SECTION 5: PRODUCTS ═══ */}
      <section id="san-pham" className="py-24 px-4 md:px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 sr">
            <p className="text-emerald-600 font-semibold text-sm tracking-widest uppercase mb-3">Sản phẩm</p>
            <h2 className="text-4xl md:text-5xl font-black text-slate-900 mb-6">Dòng sản phẩm CSR</h2>
            <p className="text-slate-500 text-lg max-w-2xl mx-auto">Cao su thiên nhiên tiêu chuẩn kỹ thuật — Constant Specified Rubber</p>
          </div>
          {/* Product hero */}
          <div className="sr grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div className="relative rounded-3xl overflow-hidden h-80 group">
              <Image src="/images/csr10_product.png" alt="CSR10 Natural Rubber" fill className="object-cover group-hover:scale-105 transition-transform duration-700" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-8">
                <span className="inline-block px-3 py-1 bg-emerald-500 text-white text-xs font-bold rounded-full mb-3">★ Sản phẩm chủ lực</span>
                <h3 className="text-3xl font-black text-white mb-1">CSR 10</h3>
                <p className="text-white/80 text-sm">Constant Shear Rate 10 — Cao su tiêu chuẩn chất lượng cao</p>
              </div>
            </div>
            <div className="relative rounded-3xl overflow-hidden h-80 group">
              <Image src="/images/production_line.png" alt="Dây chuyền sản xuất" fill className="object-cover group-hover:scale-105 transition-transform duration-700" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-8">
                <h3 className="text-3xl font-black text-white mb-1">Dây chuyền hiện đại</h3>
                <p className="text-white/80 text-sm">Quy trình sản xuất khép kín, kiểm soát chất lượng nghiêm ngặt</p>
              </div>
            </div>
          </div>
          {/* Product grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {PRODUCTS.map((p, i) => (
              <div key={i} className="sr bg-slate-50 rounded-2xl p-6 border border-slate-200/60 hover:border-emerald-300 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 group" style={{ animationDelay: `${i * 0.1}s` }}>
                {p.star && <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-bold rounded-full mb-3">★ Chủ lực</span>}
                <h3 className="text-xl font-black text-slate-800 mb-1 group-hover:text-emerald-600 transition-colors">{p.code}</h3>
                <p className="text-xs text-slate-400 mb-3">{p.name}</p>
                <p className="text-sm text-slate-500 leading-relaxed">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ SECTION 6: PRODUCTION PROCESS (15 steps) ═══ */}
      <section id="quy-trinh" className="py-24 px-4 md:px-6 bg-gradient-to-b from-slate-900 to-slate-800">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 sr">
            <p className="text-emerald-400 font-semibold text-sm tracking-widest uppercase mb-3">15 bước</p>
            <h2 className="text-4xl md:text-5xl font-black text-white mb-6">Quy trình sản xuất</h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">Từ vườn cây đến thành phẩm — quy trình chế biến cao su CSR tiêu chuẩn quốc tế</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {PROCESS_STEPS.map((s, i) => (
              <div key={i} className="sr group" style={{ animationDelay: `${i * 0.05}s` }}>
                <div className="bg-slate-800/80 backdrop-blur rounded-2xl p-5 border border-slate-700/50 hover:border-emerald-500/50 hover:bg-slate-700/80 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-emerald-900/20 h-full">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="w-8 h-8 bg-emerald-500/20 text-emerald-400 rounded-lg flex items-center justify-center text-xs font-black">{s.num}</span>
                    <span className="text-2xl group-hover:scale-125 transition-transform duration-300">{s.icon}</span>
                  </div>
                  <h3 className="text-base font-bold text-white mb-1.5">{s.name}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
          {/* CTA */}
          <div className="text-center mt-16 sr">
            <Link href="/login" className="inline-flex items-center gap-3 px-8 py-4 bg-emerald-500 text-white font-bold text-lg rounded-full hover:bg-emerald-400 hover:shadow-xl hover:shadow-emerald-900/30 hover:-translate-y-1 transition-all duration-300">
              Vào hệ thống quản lý sản xuất
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
            </Link>
          </div>
        </div>
      </section>

      {/* ═══ SECTION 7: FOOTER ═══ */}
      <footer className="py-16 px-4 md:px-6 bg-slate-950 text-slate-400">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-2xl">🏭</span>
                <span className="font-bold text-white text-lg">PTCS Phước Hòa</span>
              </div>
              <p className="text-sm leading-relaxed">Nhà máy chế biến cao su Phước Hòa Kampong Thom — Sản xuất cao su thiên nhiên tiêu chuẩn kỹ thuật (CSR) đạt chứng nhận quốc tế.</p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Thông tin</h4>
              <ul className="space-y-2 text-sm">
                <li>📍 Xã Kroyea, Santuk, Kampong Thom, Campuchia</li>
                <li>📧 nhamaychebien.phk@gmail.com</li>
                <li>🏗️ Diện tích: 16 Ha</li>
                <li>📅 Thành lập: 2019</li>
                <li>🌿 Tuân thủ EUDR — Truy xuất nguồn gốc minh bạch</li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Liên kết</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#gioi-thieu" className="hover:text-emerald-400 transition-colors">Giới thiệu</a></li>
                <li><a href="#tieu-chuan" className="hover:text-emerald-400 transition-colors">Tiêu chuẩn</a></li>
                <li><a href="#san-pham" className="hover:text-emerald-400 transition-colors">Sản phẩm</a></li>
                <li><a href="#quy-trinh" className="hover:text-emerald-400 transition-colors">Quy trình</a></li>
                <li><Link href="/login" className="hover:text-emerald-400 transition-colors">Đăng nhập ERP</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 pt-8 text-center text-xs text-slate-500">
            <p>v2.0 · PTCS Phước Hòa Kampong Thom © 2019–2026 · Powered by Next.js</p>
          </div>
        </div>
      </footer>

      {/* ═══ CSS for scroll reveal ═══ */}
      <style jsx global>{`
        .sr {
          opacity: 0;
          transform: translateY(24px);
          transition: opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1), transform 0.7s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .sr-visible {
          opacity: 1;
          transform: translateY(0);
        }
        html { scroll-behavior: smooth; }
      `}</style>
    </div>
  )
}
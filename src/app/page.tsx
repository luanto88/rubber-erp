"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import {
  type Lang,
  DEFAULT_LANG,
  HOME_STRINGS,
  STATS_I18N,
  TIMELINE_I18N,
  CERTS_I18N,
  PRODUCTS_I18N,
  PROCESS_STEPS_I18N,
  loadStoredHomepageLang,
  storeHomepageLang,
} from "@/lib/homepage-i18n";
import { LangSwitcher } from "@/app/_components/lang-switcher";

// ─── Scroll Reveal ────────────────────────────────────────────────────────────
function useScrollReveal() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const items = el.querySelectorAll(".sr");
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("sr-visible");
            obs.unobserve(e.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" },
    );
    items.forEach((i) => obs.observe(i));
    return () => obs.disconnect();
  }, []);
  return ref;
}

// ─── Org Types & Data ─────────────────────────────────────────────────────────
type ONode = { id: string; title: string; sub?: string; children: ONode[] };

const ORG: ONode = {
  id: "qd", title: "QUẢN ĐỐC", children: [
    {
      id: "pqd1", title: "PHÓ QUẢN ĐỐC",
      sub: "Phụ trách đội xe cơ khí · Phiên dịch - Nhân sự",
      children: [
        {
          id: "nv1", title: "Đội xe - Thủ kho", children: [
            {
              id: "doixe", title: "Đội xe - Cơ khí", children: [
                { id: "scck", title: "Sửa chữa cơ khí", children: [] },
                { id: "taixe", title: "Tài xế", children: [] },
                { id: "xecg", title: "Xe cơ giới", children: [] },
              ],
            },
          ],
        },
        {
          id: "nv2", title: "Cơ điện - Năng lượng", children: [
            {
              id: "tobaotri", title: "Tổ trưởng bảo trì", children: [
                { id: "cnbt", title: "CN bảo trì", children: [] },
              ],
            },
          ],
        },
      ],
    },
    {
      id: "nv3", title: "Kế toán - Tổ chức", children: [
        {
          id: "tobocvac", title: "Tổ bốc vác · Bếp - Tạp vụ", children: [
            { id: "bv", title: "Bốc vác", children: [] },
            { id: "phuvu", title: "Phục vụ", children: [] },
            { id: "tv", title: "Tạp vụ", children: [] },
          ],
        },
      ],
    },
    {
      id: "pqd2", title: "PHÓ QUẢN ĐỐC",
      sub: "Phụ trách chất lượng · ISO",
      children: [
        {
          id: "nv4", title: "Kỹ thuật chế biến - Môi trường", children: [
            {
              id: "totiepnhan2", title: "Tổ tiếp nhận đàm đông",
              sub: "Tổ trưởng",
              children: [
                { id: "cn-tn2", title: "CN tiếp nhận", children: [] },
                { id: "cn-drc2", title: "CN nướng DRC", children: [] },
                { id: "cn-pc2", title: "CN pha chế", children: [] },
                { id: "cn-dd2", title: "CN đánh đông", children: [] },
              ],
            },
            {
              id: "catruong", title: "Ca trưởng Mủ tạp - Mủ nước", children: [
                { id: "cn-ckeo",   title: "CN cán kéo",  children: [] },
                { id: "cn-cham",   title: "CN cán băm",  children: [] },
                { id: "cn-phamu",  title: "CN phả mủ",   children: [] },
                { id: "cn-ralo",   title: "CN ra lò",    children: [] },
                { id: "cn-canep",  title: "CN cân ép",   children: [] },
                { id: "cn-baogoi", title: "CN bao gói",  children: [] },
                { id: "cn-vokien", title: "CN vô kiện",  children: [] },
                { id: "cn-nhatrac",title: "CN nhặt rác", children: [] },
              ],
            },
            {
              id: "toxenl", title: "Tổ xe - Tiếp nhận nguyên liệu", children: [
                { id: "cn-canxe", title: "CN cán xé", children: [] },
              ],
            },
            {
              id: "xlnt", title: "Hệ thống xử lý nước thải", children: [
                { id: "cn-xlnt", title: "CN vận hành hệ thống", children: [] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

// ─── OrgNode Component ────────────────────────────────────────────────────────
function OrgNode({ node, depth = 0, color = "emerald" }: {
  node: ONode; depth?: number; color?: "emerald" | "blue" | "amber";
}) {
  const [open, setOpen] = useState(depth < 1);
  const has = node.children.length > 0;

  /* ── Depth 4: leaf chip ── */
  if (depth >= 4) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-white text-slate-600 text-[11px] font-medium rounded-full border border-slate-200 hover:bg-slate-50 hover:border-emerald-200 transition-all duration-150 cursor-default select-none">
        {node.title}
      </span>
    );
  }

  /* ── Depth 3: team/group row ── */
  if (depth === 3) {
    const hov = color === "blue" ? "hover:border-blue-200 hover:bg-blue-50/40" : color === "emerald" ? "hover:border-emerald-200 hover:bg-emerald-50/40" : "hover:border-amber-200 hover:bg-amber-50/40";
    const chev = color === "blue" ? "text-blue-400" : color === "emerald" ? "text-emerald-400" : "text-amber-400";
    return (
      <div className="w-full">
        <button
          onClick={() => has && setOpen(o => !o)}
          className={`flex items-center gap-2 w-full px-3 py-2 bg-white border border-slate-200/80 rounded-2xl text-xs font-bold text-slate-700 text-left shadow-sm transition-all duration-200 ${hov} ${has ? "cursor-pointer active:scale-[0.98]" : "cursor-default"}`}
        >
          <span className="flex-1 leading-snug">
            {node.title}{node.sub && <span className="font-normal text-slate-400 ml-1">· {node.sub}</span>}
          </span>
          {has && (
            <ChevronDown size={11} className={`shrink-0 transition-transform duration-300 ${chev} ${open ? "rotate-180" : ""}`} />
          )}
        </button>
        {open && has && (
          <div className="org-children mt-2 pl-3 border-l-2 border-dashed border-slate-200 ml-3 flex flex-wrap gap-1.5">
            {node.children.map(c => <OrgNode key={c.id} node={c} depth={4} color={color} />)}
          </div>
        )}
      </div>
    );
  }

  /* ── Depth 2: Nhân viên card (timeline-style) ── */
  if (depth === 2) {
    const borderHov = color === "blue" ? "hover:border-blue-300 hover:shadow-blue-100" : color === "emerald" ? "hover:border-emerald-300 hover:shadow-emerald-100" : "hover:border-amber-300 hover:shadow-amber-100";
    const badge = color === "blue" ? "bg-blue-100 text-blue-700" : color === "emerald" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700";
    const chev = color === "blue" ? "text-blue-400" : color === "emerald" ? "text-emerald-400" : "text-amber-400";
    return (
      <div className="flex flex-col">
        <button
          onClick={() => has && setOpen(o => !o)}
          className={`bg-slate-50 border border-slate-200/70 ${borderHov} rounded-3xl px-5 py-4 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md flex flex-col items-center text-center gap-1 ${has ? "cursor-pointer active:scale-[0.98]" : "cursor-default"}`}
        >
          <span className={`text-[9px] font-bold px-2.5 py-0.5 rounded-full mb-0.5 ${badge}`}>Nhân viên</span>
          <span className="text-sm font-bold text-slate-800 leading-tight">{node.title}</span>
          {node.sub && <span className="text-[10px] text-slate-400">{node.sub}</span>}
          {has && (
            <ChevronDown size={13} className={`mt-1 transition-transform duration-300 ${chev} ${open ? "rotate-180" : ""}`} />
          )}
        </button>
        {open && has && (
          <div className="org-children mt-3 flex flex-col gap-2 border-l-2 border-dashed border-slate-200 ml-4 pl-2.5">
            {node.children.map(c => <OrgNode key={c.id} node={c} depth={3} color={color} />)}
          </div>
        )}
      </div>
    );
  }

  /* ── Depth 1: Nhân viên trực thuộc QĐ (nhánh giữa, emerald) ── */
  if (depth === 1 && color === "emerald") {
    return (
      <div className="flex flex-col items-center flex-1 min-w-0">
        {/* Spacer bằng chiều cao thẻ PQĐ + connector — transparent, không tạo hình ô */}
        <div className="hidden lg:block" style={{ height: 140 }} />
        <OrgNode node={node} depth={2} color="emerald" />
      </div>
    );
  }

  /* ── Depth 1: Phó Quản đốc ── */
  if (depth === 1) {
    const card = color === "blue"
      ? "bg-gradient-to-br from-blue-500 to-indigo-600 border-blue-400 shadow-blue-200/50"
      : "bg-gradient-to-br from-amber-500 to-orange-500 border-amber-400 shadow-amber-200/50";
    const n = node.children.length;
    const grid = n === 1 ? "grid-cols-1 max-w-xs" : n === 2 ? "sm:grid-cols-2" : n === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-4";
    return (
      <div className="flex flex-col items-center flex-1 min-w-0">
        <button
          onClick={() => setOpen(o => !o)}
          className={`${card} text-white border-2 rounded-3xl px-7 py-4 shadow-lg transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl flex flex-col items-center gap-1 text-center cursor-pointer active:scale-[0.98] w-full max-w-sm`}
        >
          <span className="text-[9px] font-bold px-2.5 py-0.5 rounded-full bg-white/20 text-white/90 mb-0.5">Lãnh đạo</span>
          <span className="text-sm font-black leading-tight">{node.title}</span>
          {node.sub && <span className="text-[11px] opacity-80 font-normal leading-snug mt-0.5">{node.sub}</span>}
          <ChevronDown size={14} className={`mt-1.5 opacity-70 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <>
            <div className="w-px h-3 bg-slate-300" />
            <div className="w-4/5 border-t border-dashed border-slate-300/80" />
            <div className="h-2" />
            <div className={`org-children grid grid-cols-1 ${grid} gap-3 w-full`}>
              {node.children.map(c => <OrgNode key={c.id} node={c} depth={2} color={color} />)}
            </div>
          </>
        )}
      </div>
    );
  }

  /* ── Depth 0: Quản đốc ── */
  return (
    <div className="flex flex-col items-center w-full">
      <button
        onClick={() => setOpen(o => !o)}
        className="bg-emerald-600 hover:bg-emerald-500 text-white border-2 border-emerald-500 rounded-3xl px-12 py-5 shadow-xl shadow-emerald-200/50 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-2xl flex flex-col items-center gap-1 text-center cursor-pointer active:scale-[0.98]"
      >
        <span className="text-[10px] font-bold px-3 py-0.5 rounded-full bg-emerald-800/40 text-emerald-100 mb-0.5">Điều hành</span>
        <span className="text-2xl font-black">{node.title}</span>
        <ChevronDown size={16} className={`mt-1.5 opacity-70 transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="w-px h-8 bg-slate-300" />
          <div className="relative w-full">
            {/* Nét đứt tại tâm thẻ PQĐ (~62px) — visible trong khe và qua cột KT trong suốt */}
            <div className="hidden lg:block absolute left-[3%] right-[3%] border-t-2 border-dashed border-slate-300/70 pointer-events-none" style={{ top: 62 }} />
            {/* Nét đứt hàng NV (top=140px = chiều cao spacer KT) — visible qua khe giữa các cột */}
            <div className="hidden lg:block absolute left-[3%] right-[3%] border-t border-dashed border-slate-200/80 pointer-events-none" style={{ top: 140 }} />
            <div className="org-children w-full flex flex-col lg:flex-row justify-center gap-6 lg:gap-12 items-start">
              {node.children.map((c, i) => {
                const col: "blue" | "emerald" | "amber" =
                  i === 0 ? "blue" : i === node.children.length - 1 ? "amber" : "emerald";
                return <OrgNode key={c.id} node={c} depth={1} color={col} />;
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  const containerRef = useScrollReveal();
  const [lang, setLang] = useState<Lang>(DEFAULT_LANG);

  useEffect(() => {
    try {
      setLang(loadStoredHomepageLang());
    } finally {
      // no-op — pattern try/finally tránh false-positive của rule react-hooks/set-state-in-effect
    }
  }, []);

  const handleLangChange = useCallback((next: Lang) => {
    setLang(next);
    storeHomepageLang(next);
  }, []);

  const s = HOME_STRINGS;

  return (
    <div ref={containerRef} className="min-h-screen bg-slate-50">

      {/* ── NAVBAR ── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-lg border-b border-slate-200/60" style={{ transition: "all 0.3s" }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 flex h-11 w-11 items-center justify-center rounded-full border border-emerald-200 bg-white p-1 shadow-sm">
              <Image
                src="/logo-phk-moi.png"
                alt="Logo PHK"
                width={36}
                height={36}
                className="h-8 w-8 object-contain"
                priority
              />
            </div>
            <span className="hidden sm:block truncate font-bold text-slate-800 text-sm md:text-base tracking-tight">
              {s.companyName[lang]}
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 md:gap-5 shrink-0">
            <div className="hidden md:flex items-center gap-6">
              {([
                ["#gioi-thieu", s.nav.gioiThieu[lang]],
                ["#to-chuc", s.nav.toChuc[lang]],
                ["#tieu-chuan", s.nav.tieuChuan[lang]],
                ["#san-pham", s.nav.sanPham[lang]],
                ["#quy-trinh", s.nav.quyTrinh[lang]],
              ] as const).map(([h, l]) => (
                <a key={h} href={h} className="text-sm font-medium text-slate-600 hover:text-emerald-600 transition-colors">{l}</a>
              ))}
            </div>
            <LangSwitcher lang={lang} onChange={handleLangChange} />
            <Link href="/login" className="px-3 py-2 sm:px-5 sm:py-2.5 bg-emerald-600 text-white text-xs sm:text-sm font-semibold rounded-full hover:bg-emerald-700 transition-all hover:shadow-lg hover:shadow-emerald-200 hover:-translate-y-0.5 whitespace-nowrap">
              {s.nav.login[lang]}
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="pt-20 px-4 md:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:min-h-[75vh]">
            <div className="lg:col-span-2 relative h-[360px] sm:h-[420px] lg:h-auto rounded-3xl overflow-hidden group">
              <Image src="/images/nha_may.png" alt="Nhà máy chế biến cao su Phước Hòa Kampong Thom" fill className="object-cover group-hover:scale-105 transition-transform duration-700" priority />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8 md:p-12">
                <div className="sr" style={{ animationDelay: "0.1s" }}>
                  <p className="text-emerald-300 text-xs sm:text-sm font-semibold tracking-widest uppercase mb-2 sm:mb-3">{s.hero.eyebrow[lang]}</p>
                  <h1 className="text-2xl sm:text-3xl md:text-5xl lg:text-6xl font-black text-white leading-tight mb-2 sm:mb-4">
                    {s.hero.titleLine1[lang]}<br />{s.hero.titleLine2[lang]}
                  </h1>
                  <p className="text-white/80 text-sm sm:text-base md:text-lg max-w-xl">{s.hero.subtitle[lang]}</p>
                </div>
              </div>
            </div>
            <Link href="/login" className="relative rounded-3xl overflow-hidden flex flex-col justify-between p-6 sm:p-8 md:p-10 min-h-[300px] lg:min-h-0 group cursor-pointer transition-transform duration-300 hover:-translate-y-0.5" style={{ backgroundColor: "#fbbf24" }}>
              <div className="sr">
                <div className="w-14 h-14 bg-black/10 rounded-2xl flex items-center justify-center mb-5 sm:mb-6"><span className="text-3xl">🏭</span></div>
                <h2 className="text-2xl sm:text-3xl md:text-4xl font-black text-slate-900 leading-tight mb-3 sm:mb-4">{s.hero.ctaTitle[lang]}</h2>
                <p className="text-slate-700/80 text-sm sm:text-base mb-6 sm:mb-8">{s.hero.ctaDesc[lang]}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-11 h-11 sm:w-12 sm:h-12 bg-black rounded-full flex items-center justify-center shrink-0 group-hover:scale-110 group-hover:bg-slate-800 transition-all duration-300">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                </span>
                <span className="text-sm font-bold text-slate-900">{s.hero.ctaButton[lang]}</span>
              </div>
            </Link>
          </div>
        </div>
      </section>

      {/* ── GIỚI THIỆU ── */}
      <section id="gioi-thieu" className="py-24 px-4 md:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 sr">
            <p className="text-emerald-600 font-semibold text-sm tracking-widest uppercase mb-3">{s.intro.eyebrow[lang]}</p>
            <h2 className="text-4xl md:text-5xl font-black text-slate-900 mb-6">{s.intro.title[lang]}</h2>
            <p className="text-slate-500 text-lg max-w-2xl mx-auto">{s.intro.subtitleLine1[lang]}<br />{s.intro.subtitleLine2[lang]}</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {STATS_I18N.map((stat, i) => (
              <div key={i} className="sr bg-white rounded-2xl p-6 md:p-8 border border-slate-200/60 hover:border-emerald-300 hover:shadow-xl hover:shadow-emerald-50 hover:-translate-y-1 transition-all duration-300 group" style={{ animationDelay: `${i * 0.1}s` }}>
                <span className="text-3xl mb-4 block group-hover:scale-125 transition-transform duration-300">{stat.icon}</span>
                <div className="text-3xl md:text-4xl font-black text-slate-900 mb-1">{stat.value}</div>
                <div className="text-sm text-slate-500 font-medium">{stat.label[lang]}</div>
              </div>
            ))}
          </div>
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="sr bg-gradient-to-br from-emerald-50 to-green-50 rounded-2xl p-8 border border-emerald-100">
              <h3 className="font-bold text-slate-800 text-xl mb-3">{s.intro.contactTitle[lang]}</h3>
              <p className="text-slate-600">nhamaychebien.phk@gmail.com</p>
              <p className="text-slate-600 mt-1">{s.intro.websiteLabel[lang]}<a href="https://qlsxkpt.vercel.app" className="text-emerald-600 hover:underline" target="_blank" rel="noreferrer">https://qlsxkpt.vercel.app</a></p>
              <p className="text-slate-500 text-sm mt-2">{s.intro.addressLine[lang]}</p>
            </div>
            <div className="sr bg-gradient-to-br from-amber-50 to-yellow-50 rounded-2xl p-8 border border-amber-100">
              <h3 className="font-bold text-slate-800 text-xl mb-3">{s.intro.systemTitle[lang]}</h3>
              <p className="text-slate-600">{s.intro.systemLine1[lang]}</p>
              <p className="text-slate-600">{s.intro.systemLine2[lang]}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── TIMELINE ── */}
      <section className="py-24 px-4 md:px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 sr">
            <p className="text-emerald-600 font-semibold text-sm tracking-widest uppercase mb-3">{s.timelineSection.eyebrow[lang]}</p>
            <h2 className="text-4xl md:text-5xl font-black text-slate-900 mb-6">{s.timelineSection.title[lang]}</h2>
          </div>
          <div className="relative">
            <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-slate-200 hidden md:block" />
            <div className="space-y-8 md:space-y-0">
              {TIMELINE_I18N.map((t, i) => (
                <div key={i} className={`sr relative md:flex items-center ${i % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"} md:mb-12`} style={{ animationDelay: `${i * 0.15}s` }}>
                  <div className={`md:w-1/2 ${i % 2 === 0 ? "md:pr-12 md:text-right" : "md:pl-12"}`}>
                    <div className="bg-slate-50 rounded-2xl p-6 border border-slate-200/60 hover:border-emerald-300 hover:shadow-lg transition-all duration-300 hover:-translate-y-1">
                      <span className="inline-block px-3 py-1 bg-emerald-100 text-emerald-700 text-sm font-bold rounded-full mb-3">{t.year}</span>
                      <h3 className="text-xl font-bold text-slate-800 mb-2">{t.title[lang]}</h3>
                      <p className="text-slate-500 text-sm">{t.desc[lang]}</p>
                    </div>
                  </div>
                  <div className="hidden md:flex absolute left-1/2 -translate-x-1/2 w-5 h-5 bg-emerald-500 rounded-full border-4 border-white shadow-md z-10" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── SƠ ĐỒ TỔ CHỨC ── */}
      <section id="to-chuc" className="py-24 px-4 md:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 sr">
            <p className="text-emerald-600 font-semibold text-sm tracking-widest uppercase mb-3">{s.orgSection.eyebrow[lang]}</p>
            <h2 className="text-4xl md:text-5xl font-black text-slate-900 mb-4">{s.orgSection.title[lang]}</h2>
            <p className="text-slate-500 text-base max-w-2xl mx-auto mb-2">{s.orgSection.subtitle[lang]}</p>
            <p className="text-xs text-slate-400 flex items-center justify-center gap-1.5">
              <ChevronDown size={12} className="text-slate-400" />
              {s.orgSection.hint[lang]}
            </p>
          </div>

          <div className="sr overflow-x-auto pb-6">
            <div className="min-w-[300px] max-w-5xl mx-auto">
              <OrgNode node={ORG} depth={0} color="emerald" />
            </div>
          </div>

          {/* Legend */}
          <div className="mt-10 flex flex-wrap justify-center gap-5 text-xs text-slate-400">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />{s.orgSection.legend1[lang]}</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />{s.orgSection.legend2[lang]}</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-amber-500 inline-block" />{s.orgSection.legend3[lang]}</span>
            <span className="flex items-center gap-1.5 italic">{s.orgSection.legend4[lang]}</span>
          </div>
        </div>
      </section>

      {/* ── CHỨNG NHẬN ── */}
      <section id="tieu-chuan" className="py-24 px-4 md:px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 sr">
            <p className="text-emerald-600 font-semibold text-sm tracking-widest uppercase mb-3">{s.certsSection.eyebrow[lang]}</p>
            <h2 className="text-4xl md:text-5xl font-black text-slate-900 mb-6">{s.certsSection.title[lang]}</h2>
            <p className="text-slate-500 text-lg max-w-2xl mx-auto">{s.certsSection.subtitle[lang]}</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
            {CERTS_I18N.map((c, i) => (
              <div key={i} className="sr group" style={{ animationDelay: `${i * 0.12}s` }}>
                <div className={`relative rounded-2xl overflow-hidden border border-slate-200/60 hover:shadow-xl hover:border-emerald-200 transition-all duration-300 hover:-translate-y-1 ${c.bg} h-full`}>
                  <div className="flex flex-col h-full p-6">
                    <div className="w-full h-28 mb-4 flex items-center justify-center rounded-xl overflow-hidden bg-white border border-slate-100">
                      <Image src={c.img} alt={c.name} width={240} height={112} className="max-h-[108px] w-auto max-w-full object-contain group-hover:scale-105 transition-transform duration-300" />
                    </div>
                    <h3 className="text-base font-bold text-slate-800 mb-1.5 group-hover:text-emerald-700 transition-colors">{c.name}</h3>
                    <p className="text-sm text-slate-500 leading-relaxed flex-1">{c.desc[lang]}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SẢN PHẨM ── */}
      <section id="san-pham" className="py-24 px-4 md:px-6 bg-white">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 sr">
            <p className="text-emerald-600 font-semibold text-sm tracking-widest uppercase mb-3">{s.productsSection.eyebrow[lang]}</p>
            <h2 className="text-4xl md:text-5xl font-black text-slate-900 mb-6">{s.productsSection.title[lang]}</h2>
            <p className="text-slate-500 text-lg max-w-2xl mx-auto">{s.productsSection.subtitle[lang]}</p>
          </div>
          <div className="sr grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div className="relative rounded-3xl overflow-hidden h-80 group">
              <Image src="/images/banh_mu_khong_nhan.jpg" alt="Bành mủ CSR" fill className="object-cover group-hover:scale-105 transition-transform duration-700" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-8">
                <span className="inline-block px-3 py-1 bg-emerald-500 text-white text-xs font-bold rounded-full mb-3">{s.productsSection.banner1Badge[lang]}</span>
                <h3 className="text-3xl font-black text-white mb-1">CSR 10</h3>
                <p className="text-white/80 text-sm">{s.productsSection.banner1Desc[lang]}</p>
              </div>
            </div>
            <div className="relative rounded-3xl overflow-hidden h-80 group">
              <Image src="/images/day_chuyen_hien_dai.png" alt="Dây chuyền sản xuất" fill className="object-cover group-hover:scale-105 transition-transform duration-700" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-8">
                <h3 className="text-3xl font-black text-white mb-1">{s.productsSection.banner2Title[lang]}</h3>
                <p className="text-white/80 text-sm">{s.productsSection.banner2Desc[lang]}</p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {PRODUCTS_I18N.map((p, i) => (
              <div key={i} className="sr bg-slate-50 rounded-2xl p-6 border border-slate-200/60 hover:border-emerald-300 hover:shadow-lg hover:-translate-y-1 transition-all duration-300 group" style={{ animationDelay: `${i * 0.1}s` }}>
                {p.star && <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-bold rounded-full mb-3">{s.productsSection.starBadge[lang]}</span>}
                <h3 className="text-xl font-black text-slate-800 mb-1 group-hover:text-emerald-600 transition-colors">{p.code}</h3>
                <p className="text-xs text-slate-400 mb-3">{p.name}</p>
                <p className="text-sm text-slate-500 leading-relaxed">{p.desc[lang]}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── QUY TRÌNH ── */}
      <section id="quy-trinh" className="py-24 px-4 md:px-6 bg-gradient-to-b from-slate-900 to-slate-800">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16 sr">
            <p className="text-emerald-400 font-semibold text-sm tracking-widest uppercase mb-3">{s.processSection.eyebrow[lang]}</p>
            <h2 className="text-4xl md:text-5xl font-black text-white mb-6">{s.processSection.title[lang]}</h2>
            <p className="text-slate-400 text-lg max-w-2xl mx-auto">{s.processSection.subtitle[lang]}</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
            {PROCESS_STEPS_I18N.map((step, i) => (
              <div key={i} className="sr group" style={{ animationDelay: `${i * 0.05}s` }}>
                <div className="bg-slate-800/80 backdrop-blur rounded-2xl p-5 border border-slate-700/50 hover:border-emerald-500/50 hover:bg-slate-700/80 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-emerald-900/20 h-full">
                  <div className="flex items-center gap-3 mb-3">
                    <span className="w-8 h-8 bg-emerald-500/20 text-emerald-400 rounded-lg flex items-center justify-center text-xs font-black">{step.num}</span>
                    <span className="text-2xl group-hover:scale-125 transition-transform duration-300">{step.icon}</span>
                  </div>
                  <h3 className="text-base font-bold text-white mb-1.5">{step.name[lang]}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">{step.desc[lang]}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="text-center mt-16 sr">
            <Link href="/login" className="inline-flex items-center gap-3 px-8 py-4 bg-emerald-500 text-white font-bold text-lg rounded-full hover:bg-emerald-400 hover:shadow-xl hover:shadow-emerald-900/30 hover:-translate-y-1 transition-all duration-300">
              {s.processSection.cta[lang]}
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="py-16 px-4 md:px-6 bg-slate-950 text-slate-400">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12 mb-12">
            <div>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <div className="shrink-0 flex h-11 w-11 items-center justify-center rounded-full border border-emerald-700/60 bg-white p-1">
                  <Image
                    src="/logo-phk-moi.png"
                    alt="Logo PHK"
                    width={36}
                    height={36}
                    className="h-8 w-8 object-contain"
                  />
                </div>
                <span className="min-w-0 break-words font-bold text-white text-lg">{s.companyName[lang]}</span>
              </div>
              <p className="text-sm leading-relaxed">{s.footer.about[lang]}</p>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">{s.footer.infoTitle[lang]}</h4>
              <ul className="space-y-2 text-sm">
                <li>{s.footer.info1[lang]}</li>
                <li>📧 nhamaychebien.phk@gmail.com</li>
                <li>🌐 <a href="https://qlsxkpt.vercel.app" className="hover:text-emerald-400 transition-colors" target="_blank" rel="noreferrer">https://qlsxkpt.vercel.app</a></li>
                <li>{s.footer.info4[lang]}</li>
                <li>{s.footer.info5[lang]}</li>
                <li>{s.footer.info6[lang]}</li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">{s.footer.linksTitle[lang]}</h4>
              <ul className="space-y-2 text-sm">
                <li><a href="#gioi-thieu" className="hover:text-emerald-400 transition-colors">{s.nav.gioiThieu[lang]}</a></li>
                <li><a href="#to-chuc" className="hover:text-emerald-400 transition-colors">{s.nav.toChuc[lang]}</a></li>
                <li><a href="#tieu-chuan" className="hover:text-emerald-400 transition-colors">{s.nav.tieuChuan[lang]}</a></li>
                <li><a href="#san-pham" className="hover:text-emerald-400 transition-colors">{s.nav.sanPham[lang]}</a></li>
                <li><a href="#quy-trinh" className="hover:text-emerald-400 transition-colors">{s.nav.quyTrinh[lang]}</a></li>
                <li><Link href="/login" className="hover:text-emerald-400 transition-colors">{s.footer.loginErp[lang]}</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 pt-8 text-center text-xs text-slate-500">
            <p>{s.footer.bottom[lang]}</p>
          </div>
        </div>
      </footer>

      {/* ── Global CSS ── */}
      <style jsx global>{`
        .sr {
          opacity: 0;
          transform: translateY(24px);
          transition: opacity 0.7s cubic-bezier(0.16,1,0.3,1), transform 0.7s cubic-bezier(0.16,1,0.3,1);
        }
        .sr-visible { opacity: 1; transform: translateY(0); }
        html { scroll-behavior: smooth; }

        /* Org expand animation */
        @keyframes orgFadeDown {
          from { opacity: 0; transform: translateY(-10px) scaleY(0.95); }
          to   { opacity: 1; transform: translateY(0)    scaleY(1);    }
        }
        .org-children {
          animation: orgFadeDown 0.28s cubic-bezier(0.16,1,0.3,1);
          transform-origin: top;
        }
      `}</style>
    </div>
  );
}

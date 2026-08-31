"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ChevronDown, ChevronUp, Loader2, X } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { hydrateActiveSession, type SessionUser } from "@/lib/auth"

// Màn hình ký dùng chung cho MỌI module (Giai đoạn 3 — Hệ thống ký số dùng chung).
// Bám sát mockup đã duyệt cung_cap_dl/thiet_ke_man_hinh_ky.html, thu gọn 1 điểm so
// với mockup: mỗi người ký có thể có NHIỀU truong_ky (nhiều trang/vị trí) nhưng CHỈ
// ký 1 LẦN duy nhất cho TOÀN BỘ các khung của mình (khớp thiết kế backend
// src/lib/signing/requests.ts's signField() — stamp hết 1 lượt, không ký từng khung
// riêng lẻ) — nút "Bắt đầu/Tiếp theo" dùng để CUỘN XEM TRƯỚC từng khung, không phải
// từng bước ký riêng; PIN chỉ xác thực 1 lần cho cả lượt ký.

type YeuCauKy = {
  id: string
  factory_id: string
  ma_ho_so: string | null
  modun: string
  loai_tai_lieu: string
  file_hien_tai: string | null
  trang_thai: "dang_luan_chuyen" | "hoan_tat" | "tu_choi" | "huy"
  nguoi_tao: string
  tao_luc: string
  hoan_tat_luc: string | null
  tra_ve_ly_do: string | null
  tra_ve_boi: string | null
  tra_ve_luc: string | null
}
type NguoiKy = {
  id: string
  yeu_cau_id: string
  user_id: string
  thu_tu: number
  vai_tro: "ky" | "phe_duyet" | "nhan_ban_sao"
  trang_thai: "cho" | "dang_mo" | "da_ky" | "tu_choi"
  ky_luc: string | null
}
type TruongKy = {
  id: string
  nguoi_ky_id: string
  trang: number
  x_pt: number
  y_pt: number
  w_pt: number
  h_pt: number
  loai: string
  nhan: string | null
}
type ProfileLite = { id: string; full_name: string | null; username: string | null }

const MODUN_LABEL: Record<string, string> = {
  quality: "Chất lượng",
  export: "Xuất hàng",
  maintenance: "Bảo trì",
  dispatch: "Điều xe",
  output: "Sản lượng",
  storage: "Kho nguyên liệu",
}

function roleLabelOf(vaiTro: NguoiKy["vai_tro"]): string {
  if (vaiTro === "phe_duyet") return "Phê duyệt"
  if (vaiTro === "nhan_ban_sao") return "Nhận bản sao"
  return "Ký"
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const dd = String(d.getDate()).padStart(2, "0")
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const hh = String(d.getHours()).padStart(2, "0")
  const mi = String(d.getMinutes()).padStart(2, "0")
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`
}

export default function SignScreenPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const yeuCauId = params.id

  const [me, setMe] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  const [yeuCau, setYeuCau] = useState<YeuCauKy | null>(null)
  const [nguoiKyList, setNguoiKyList] = useState<NguoiKy[]>([])
  const [truongKyList, setTruongKyList] = useState<TruongKy[]>([])
  const [profiles, setProfiles] = useState<Record<string, ProfileLite>>({})

  const [numPages, setNumPages] = useState(0)
  const [pageDims, setPageDims] = useState<Record<number, { w: number; h: number }>>({})
  const [pageImages, setPageImages] = useState<Record<number, string>>({})
  const [pdfLoadError, setPdfLoadError] = useState("")
  const pageWrapRefs = useRef<Record<number, HTMLDivElement | null>>({})

  const [previewPage, setPreviewPage] = useState(-1)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pin, setPin] = useState("")
  const [pinError, setPinError] = useState("")
  const [signing, setSigning] = useState(false)
  const [mobileFlowOpen, setMobileFlowOpen] = useState(false)
  const [toast, setToast] = useState("")

  // "Trả về" — chỉ có ý nghĩa khi có (các) người ký TRƯỚC mình đã ký xong; nếu mình là người
  // đầu tiên thì không có gì để trả về (dùng "Hủy yêu cầu" ở màn danh sách module thay thế).
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnReason, setReturnReason] = useState("")
  const [returnError, setReturnError] = useState("")
  const [returning, setReturning] = useState(false)

  const loadData = useCallback(async (uid: string) => {
    void uid
    const { data: ycData, error: ycErr } = await supabase
      .from("yeu_cau_ky")
      .select("*")
      .eq("id", yeuCauId)
      .single()
    if (ycErr || !ycData) {
      setError("Không tìm thấy hồ sơ ký này, hoặc bạn không có quyền xem.")
      setLoading(false)
      return
    }
    setYeuCau(ycData as YeuCauKy)

    const { data: nkData } = await supabase
      .from("nguoi_ky")
      .select("*")
      .eq("yeu_cau_id", yeuCauId)
      .order("thu_tu", { ascending: true })
    const signers = (nkData || []) as NguoiKy[]
    setNguoiKyList(signers)

    if (signers.length) {
      const { data: tkData } = await supabase
        .from("truong_ky")
        .select("*")
        .in("nguoi_ky_id", signers.map((s) => s.id))
        .order("trang", { ascending: true })
      setTruongKyList((tkData || []) as TruongKy[])

      // `profiles` RLS chỉ cho đọc đúng dòng của chính mình — không query trực tiếp
      // được tên của những người ký KHÁC, phải qua route service-role riêng (đã xác
      // thực người gọi thật sự liên quan tới đúng yeu_cau_id).
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const accessToken = sessionData.session?.access_token
        if (accessToken) {
          const res = await fetch(`/api/signing/participants?yeuCauId=${yeuCauId}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          })
          const list = (await res.json()) as ProfileLite[]
          if (res.ok && Array.isArray(list)) {
            const map: Record<string, ProfileLite> = {}
            for (const p of list) map[p.id] = p
            setProfiles(map)
          }
        }
      } catch { /* tên hiển thị "—" nếu route lỗi — không chặn xem/ký */ }
    }
    setLoading(false)
  }, [yeuCauId])

  useEffect(() => {
    let cancelled = false
    const bootstrap = async () => {
      const { user } = await hydrateActiveSession()
      if (cancelled) return
      if (!user) {
        setError("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.")
        setLoading(false)
        return
      }
      setMe(user)
      await loadData(user.id)
    }
    void bootstrap()
    return () => { cancelled = true }
  }, [loadData])

  const myNguoiKy = useMemo(
    () => (me ? nguoiKyList.find((n) => n.user_id === me.id) ?? null : null),
    [nguoiKyList, me],
  )
  const myFields = useMemo(
    () => (myNguoiKy ? truongKyList.filter((f) => f.nguoi_ky_id === myNguoiKy.id) : []),
    [truongKyList, myNguoiKy],
  )
  const otherFields = useMemo(
    () => (myNguoiKy ? truongKyList.filter((f) => f.nguoi_ky_id !== myNguoiKy.id) : truongKyList),
    [truongKyList, myNguoiKy],
  )
  // Tra trạng thái đã ký hay chưa của CHỦ mỗi khung trong otherFields — khung 'chu_ky' của
  // người ĐÃ ký không được vẽ đè khung/nhãn giả nữa, vì ảnh trang PDF lúc đó đã được tải lại
  // với chữ ký thật của họ đã stamp sẵn (bug đã báo 2026-09-04: nhãn "Lập biểu" hiện chồng lên
  // đúng chữ ký thật của Lập biểu khi Trưởng phòng QLCL xem để ký phê duyệt).
  const nguoiKyStatusById = useMemo(
    () => new Map(nguoiKyList.map((n) => [n.id, n.trang_thai])),
    [nguoiKyList],
  )
  const iAlreadySigned = myNguoiKy?.trang_thai === "da_ky"
  const roleLabelForMe = myFields[0]?.nhan || (myNguoiKy ? roleLabelOf(myNguoiKy.vai_tro) : "")
  // Chỉ tới lượt tôi khi TẤT CẢ người có thu_tu nhỏ hơn đã ký xong — mirror đúng chặn cứng
  // phía server trong signField() (src/lib/signing/requests.ts). Không có gate này, sau khi
  // mình vừa "Trả về" (predecessor bị reset về 'cho'), UI vẫn hiện nút "Ký xác nhận" cho
  // chính mình dù predecessor chưa sửa & ký lại — phi logic (bug đã báo 2026-09-08).
  const myTurn = useMemo(
    () => !myNguoiKy || nguoiKyList.every((n) => n.thu_tu >= myNguoiKy.thu_tu || n.trang_thai === "da_ky"),
    [nguoiKyList, myNguoiKy],
  )
  const canReturn = useMemo(
    () =>
      !!myNguoiKy &&
      !iAlreadySigned &&
      nguoiKyList.some((n) => n.thu_tu < myNguoiKy.thu_tu && n.trang_thai === "da_ky"),
    [myNguoiKy, iAlreadySigned, nguoiKyList],
  )
  const traVeByName = useMemo(() => {
    if (!yeuCau?.tra_ve_boi) return ""
    const p = profiles[yeuCau.tra_ve_boi]
    return p?.full_name || p?.username || ""
  }, [yeuCau?.tra_ve_boi, profiles])
  // Danh sách TRANG (không phải từng khung riêng lẻ) có khung của tôi — "Khung tiếp
  // theo" nhảy theo trang, vì trên 1 trang khung chu_ky/ten của cùng 1 người luôn
  // nằm sát nhau (không có giá trị điều hướng khi nhảy giữa 2 khung đó).
  const myPages = useMemo(
    () => [...new Set(myFields.map((f) => f.trang))].sort((a, b) => a - b),
    [myFields],
  )

  // ── Render toàn bộ trang PDF thành ẢNH (data URL) — 1 lần khi có file_hien_tai ──
  // Cố ý KHÔNG dùng <canvas> sống gắn ref React: bản đầu (2026-08-29) render trực
  // tiếp vào <canvas> qua ref bị lỗi race — canvas mount cùng lúc setNumPages nên
  // page.render() nhiều khả năng chạy trước khi canvas kịp có trong DOM (hoặc bị
  // React Strict Mode chạy effect 2 lần đè lẫn nhau), kết quả là trang trắng hoàn
  // toàn dù khung ký vẫn định vị đúng. Vẽ vào canvas TẠM (không gắn DOM, tự tạo
  // bằng document.createElement) rồi xuất `toDataURL()` để render bằng thẻ `<img>`
  // loại bỏ hẳn race này — ảnh chỉ set vào DOM sau khi đã vẽ xong hoàn toàn.
  useEffect(() => {
    if (!yeuCau?.file_hien_tai) return
    let cancelled = false

    const run = async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist")
        if ((globalThis as Record<string, unknown>).pdfjsWorker) {
          pdfjsLib.GlobalWorkerOptions.workerSrc = ""
        } else {
          pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
            "pdfjs-dist/build/pdf.worker.mjs",
            import.meta.url,
          ).toString()
        }
        const pdf = await pdfjsLib.getDocument(yeuCau.file_hien_tai as string).promise
        if (cancelled) return
        setNumPages(pdf.numPages)

        const dims: Record<number, { w: number; h: number }> = {}
        const images: Record<number, string> = {}
        const renderScale = 2 // độ phân giải cao để chữ sắc nét khi ảnh bị co lại vừa khung hiển thị
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p)
          const dimVp = page.getViewport({ scale: 1 })
          dims[p] = { w: dimVp.width, h: dimVp.height }
          const viewport = page.getViewport({ scale: renderScale })
          const canvas = document.createElement("canvas")
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          const ctx = canvas.getContext("2d")
          if (!ctx) continue
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await page.render({ canvasContext: ctx, viewport } as any).promise
          images[p] = canvas.toDataURL("image/png")
        }
        if (cancelled) return
        setPageDims(dims)
        setPageImages(images)
      } catch {
        if (!cancelled) setPdfLoadError("Không hiển thị được nội dung file — vẫn có thể ký bình thường.")
      }
    }
    void run()
    return () => { cancelled = true }
  }, [yeuCau?.file_hien_tai])

  // Quy đổi toạ độ pdf-lib (point, gốc dưới-trái) sang % trong khung trang — dùng %
  // (không phải pixel cố định) để khung luôn khớp đúng vị trí trên ảnh trang bất kể
  // ảnh hiển thị to/nhỏ thế nào (ảnh + khung luôn cùng kích thước hiển thị, vì cùng
  // nằm trong `.page` và ảnh luôn `w-full`).
  const pxBoxFor = (f: TruongKy) => {
    const dim = pageDims[f.trang]
    if (!dim) return null
    return {
      left: `${(f.x_pt / dim.w) * 100}%`,
      top: `${((dim.h - f.y_pt - f.h_pt) / dim.h) * 100}%`,
      width: `${(f.w_pt / dim.w) * 100}%`,
      height: `${(f.h_pt / dim.h) * 100}%`,
    }
  }

  const scrollToPage = (p: number) => {
    pageWrapRefs.current[p]?.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(""), 2500)
  }

  const onPreviewNext = () => {
    if (!myPages.length) return
    const curIdx = myPages.indexOf(previewPage)
    const next = curIdx === -1 || curIdx + 1 >= myPages.length ? myPages[0] : myPages[curIdx + 1]
    setPreviewPage(next)
    scrollToPage(next)
  }

  const openConfirm = () => {
    setPin("")
    setPinError("")
    setConfirmOpen(true)
  }

  const handleConfirmSign = async () => {
    if (!me || !yeuCau || !myNguoiKy) return
    if (!pin || pin.length < 4) {
      setPinError("Vui lòng nhập PIN ký duyệt")
      return
    }
    setSigning(true)
    setPinError("")
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) {
        setPinError("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại")
        return
      }
      const verifyRes = await fetch("/api/sign/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ userId: me.id, pin, docId: yeuCau.id, docType: "yeu_cau_ky" }),
      })
      const verifyJson = (await verifyRes.json()) as { token?: string; error?: string }
      if (!verifyRes.ok || !verifyJson.token) {
        setPinError(verifyJson.error || "PIN không đúng")
        return
      }

      const signRes = await fetch("/api/signing/sign-field", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: verifyJson.token, yeuCauId: yeuCau.id }),
      })
      const signJson = (await signRes.json()) as { error?: string; trangThaiYeuCau?: string }
      if (!signRes.ok) {
        setPinError(signJson.error || "Ký thất bại, vui lòng thử lại")
        return
      }

      setConfirmOpen(false)
      showToast("Đã ký thành công.")
      await loadData(me.id)
    } catch {
      setPinError("Không thể kết nối máy chủ, vui lòng thử lại")
    } finally {
      setSigning(false)
    }
  }

  const openReturn = () => {
    setReturnReason("")
    setReturnError("")
    setReturnOpen(true)
  }

  const handleConfirmReturn = async () => {
    if (!me || !yeuCau) return
    if (!returnReason.trim()) {
      setReturnError("Vui lòng nhập lý do trả về")
      return
    }
    setReturning(true)
    setReturnError("")
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      if (!accessToken) {
        setReturnError("Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại")
        return
      }
      const res = await fetch("/api/signing/return-request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ yeuCauId: yeuCau.id, lyDo: returnReason.trim() }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) {
        setReturnError(json.error || "Không trả về được yêu cầu ký, vui lòng thử lại")
        return
      }
      setReturnOpen(false)
      showToast("Đã trả về — người ký trước cần sửa & ký lại.")
      await loadData(me.id)
    } catch {
      setReturnError("Không thể kết nối máy chủ, vui lòng thử lại")
    } finally {
      setReturning(false)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-emerald-600" size={32} />
      </div>
    )
  }
  if (error || !yeuCau) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
        <p className="text-slate-600">{error || "Không tìm thấy hồ sơ."}</p>
        <button
          onClick={() => router.push("/dashboard")}
          className="rounded-xl bg-slate-800 px-5 py-2 text-sm font-bold text-white"
        >
          Về Dashboard
        </button>
      </div>
    )
  }

  const statusBadge =
    yeuCau.trang_thai === "hoan_tat"
      ? "Đã hoàn tất"
      : iAlreadySigned
        ? "Đã ký phần của bạn — chờ người khác"
        : myNguoiKy
          ? (myTurn ? "Đang chờ bạn ký" : "Chưa tới lượt bạn")
          : "Xem hồ sơ"

  return (
    <div className="flex h-screen flex-col bg-[#f2f8f5]">
      {/* Topbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-gradient-to-br from-[#2f5d52] to-[#1c3a32] px-5 py-3.5 text-white">
        <div className="flex min-w-[220px] flex-col gap-1">
          <div className="text-[11px] opacity-75">
            Hệ thống ký số dùng chung · {MODUN_LABEL[yeuCau.modun] || yeuCau.modun}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-base font-bold">
            {yeuCau.loai_tai_lieu}
            {yeuCau.ma_ho_so && (
              <span className="rounded-md bg-white/15 px-2 py-0.5 font-mono text-xs font-semibold">
                {yeuCau.ma_ho_so}
              </span>
            )}
            <span className="rounded-full border border-white/30 bg-white/15 px-2.5 py-1 text-[11px] font-bold">
              {statusBadge}
            </span>
          </div>
        </div>
        <button
          onClick={() => router.back()}
          className="rounded-xl border border-white/35 bg-white/10 px-4 py-2 text-sm font-bold hover:bg-white/20"
        >
          Đóng
        </button>
      </div>

      {pdfLoadError && (
        <div className="bg-amber-50 px-5 py-2 text-xs text-amber-700">{pdfLoadError}</div>
      )}

      {/* Lý do trả về — hiển thị rõ ràng ngay khi mở màn hình, không chỉ nằm trong tooltip
          ở badge danh sách (bug đã báo 2026-09-08: người Lập bảng không thấy nội dung trả
          về là gì). Chỉ hiện khi hồ sơ còn đang xử lý và đang thực sự có 1 lượt trả về chưa
          xử lý xong (tra_ve_ly_do bị xoá ngay khi ký lại thành công — xem signField()). */}
      {yeuCau.trang_thai === "dang_luan_chuyen" && yeuCau.tra_ve_ly_do && (
        <div className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-800">
          <p className="font-bold">
            Hồ sơ đã bị trả về{traVeByName ? ` bởi ${traVeByName}` : ""}
            {yeuCau.tra_ve_luc ? ` lúc ${fmtDateTime(yeuCau.tra_ve_luc)}` : ""}:
          </p>
          <p className="mt-0.5">{yeuCau.tra_ve_ly_do}</p>
        </div>
      )}

      {/* Workspace */}
      <div className="relative flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto px-4 pb-32 pt-6">
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-5">
            {Array.from({ length: numPages }, (_, i) => i + 1).map((p) => (
              <div
                key={p}
                ref={(el) => { pageWrapRefs.current[p] = el }}
                className="relative w-full rounded border border-slate-200 bg-white shadow-sm"
              >
                {pageImages[p] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={pageImages[p]} alt={`Trang ${p}`} className="block w-full rounded" />
                ) : (
                  <div className="flex aspect-[210/297] w-full items-center justify-center rounded bg-slate-50">
                    <Loader2 className="animate-spin text-slate-300" size={24} />
                  </div>
                )}
                {/* Chỉ hiện nhãn trên khung 'chu_ky' (khung to hơn, đủ chỗ chữ) — khung
                    'ten' đi kèm ngay dưới không lặp lại nhãn để tránh chồng/vỡ dòng.
                    Viền/nền cũng CHỈ vẽ cho khung 'chu_ky' — khung 'ten' không có viền/nền
                    riêng (chỉ giữ vùng click/tọa độ) để tránh hiện thành 1 khung trống dư
                    thừa bên dưới khung 'chu_ky' đã có nhãn (bug đã báo 2026-09-03).
                    Nếu chủ khung ĐÃ ký (trang_thai='da_ky'), KHÔNG vẽ viền/nhãn giả nữa —
                    ảnh trang lúc này đã là bản PDF mới nhất, chữ ký thật của họ đã nằm sẵn
                    trong ảnh, vẽ đè lên sẽ che/chồng lên đúng chữ ký thật (bug đã báo
                    2026-09-04). */}
                {otherFields.filter((f) => f.trang === p).map((f) => {
                  const box = pxBoxFor(f)
                  if (!box) return null
                  const ownerSigned = nguoiKyStatusById.get(f.nguoi_ky_id) === "da_ky"
                  return (
                    <div
                      key={f.id}
                      title={f.nhan || f.loai}
                      className={`absolute overflow-hidden rounded-md opacity-70 ${
                        f.loai === "chu_ky" && !ownerSigned ? "border border-slate-300 bg-slate-100/70" : ""
                      }`}
                      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                    >
                      {f.loai === "chu_ky" && !ownerSigned && (
                        <span className="block truncate px-1 text-center text-[9px] font-bold leading-tight text-slate-500">
                          {f.nhan || f.loai}
                        </span>
                      )}
                    </div>
                  )
                })}
                {myFields.filter((f) => f.trang === p).map((f) => {
                  const box = pxBoxFor(f)
                  if (!box) return null
                  const isActivePreview = previewPage === p
                  // Sau khi đã ký, ảnh trang đã được tải lại từ file MỚI (đã có chữ ký thật
                  // stamp sẵn) — không được vẽ khối nền đặc màu đè lên, chỉ viền mảnh + 1
                  // badge nhỏ góc trên-phải để không che chữ ký thật (bug đã báo 2026-09-08:
                  // trước đây "✓ Đã ký" phủ kín cả khung, người ký không thấy chữ ký thật).
                  return (
                    <div
                      key={f.id}
                      title={f.nhan || f.loai}
                      className={`absolute cursor-pointer rounded-md transition-shadow ${
                        f.loai !== "chu_ky"
                          ? ""
                          : iAlreadySigned
                            ? "border-[1.5px] border-emerald-400"
                            : isActivePreview
                              ? "overflow-hidden border-[1.5px] border-emerald-600 bg-emerald-100/80 shadow-[0_0_0_3px_rgba(16,185,129,0.3)]"
                              : "overflow-hidden border-[1.5px] border-dashed border-sky-400 bg-sky-50/80"
                      }`}
                      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                      onClick={() => { setPreviewPage(p); scrollToPage(p) }}
                    >
                      {f.loai === "chu_ky" && (
                        iAlreadySigned ? (
                          <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-white shadow">
                            ✓
                          </span>
                        ) : (
                          <span className="block truncate px-1 text-center text-[9px] font-bold leading-tight text-sky-700">
                            {f.nhan || f.loai}
                          </span>
                        )
                      )}
                    </div>
                  )
                })}
                <div className="absolute right-2 top-1.5 text-[10px] font-bold text-slate-300">
                  Trang {p}/{numPages}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Side panel desktop */}
        <div className="hidden w-64 shrink-0 overflow-y-auto border-l border-slate-200 bg-white p-4 pb-32 lg:block">
          <FlowList nguoiKyList={nguoiKyList} profiles={profiles} me={me} />
        </div>

        {/* Action bar */}
        <div className="absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3.5 shadow-[0_-4px_12px_rgba(15,23,42,0.06)] lg:right-64">
          <div className="text-[12.5px] font-semibold text-slate-500">
            {!myNguoiKy
              ? "Bạn không có phần ký trên hồ sơ này — chỉ xem."
              : iAlreadySigned
                ? <>Bạn đã ký đủ <b className="text-slate-800">{myFields.length}</b> khung trên hồ sơ này.</>
                : !myTurn
                  ? "Chưa tới lượt bạn — đang chờ người ký trước hoàn tất."
                  : <>Có <b className="text-slate-800">{myFields.length}</b> khung cần ký — không cần đọc hết tài liệu.</>}
          </div>
          {myNguoiKy && !iAlreadySigned && myTurn && (
            <div className="flex gap-2.5">
              {canReturn && (
                <button
                  onClick={openReturn}
                  className="rounded-xl border border-rose-300 bg-white px-4 py-2 text-[13px] font-bold text-rose-600 hover:bg-rose-50"
                >
                  Trả về
                </button>
              )}
              <button
                onClick={onPreviewNext}
                disabled={!myFields.length}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-[13px] font-bold text-slate-700 hover:bg-slate-50"
              >
                {previewPage === -1 ? "Xem khung của tôi" : "Khung tiếp theo"}
              </button>
              <button
                onClick={openConfirm}
                className="rounded-xl bg-[#2f5d52] px-4 py-2 text-[13px] font-bold text-white hover:bg-[#1c3a32]"
              >
                Ký xác nhận
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Mobile flow bar */}
      <button
        onClick={() => setMobileFlowOpen((v) => !v)}
        className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 lg:hidden"
      >
        <span>{nguoiKyList.length} người tham gia</span>
        {mobileFlowOpen ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronUp size={14} className="text-slate-400" />}
      </button>

      {(mobileFlowOpen || confirmOpen || returnOpen) && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/35"
          onClick={() => {
            setMobileFlowOpen(false)
            if (!signing) setConfirmOpen(false)
            if (!returning) setReturnOpen(false)
          }}
        />
      )}

      {mobileFlowOpen && (
        <div className="fixed inset-x-0 bottom-0 z-50 max-h-[60vh] overflow-y-auto rounded-t-2xl bg-white p-4 shadow-[0_-12px_32px_rgba(15,23,42,0.25)] lg:hidden">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-400">Luồng ký hồ sơ</h3>
            <button
              onClick={() => setMobileFlowOpen(false)}
              className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-bold text-slate-500"
            >
              Đóng
            </button>
          </div>
          <FlowList nguoiKyList={nguoiKyList} profiles={profiles} me={me} />
        </div>
      )}

      {/* Confirm-sign sheet */}
      {confirmOpen && (
        <div className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-[420px] rounded-t-2xl bg-white p-5 shadow-[0_-12px_32px_rgba(15,23,42,0.25)] left-1/2 -translate-x-1/2">
          <div className="mx-auto mb-3.5 h-1 w-10 rounded-full bg-slate-200" />
          <div className="mb-1 flex items-start justify-between">
            <h4 className="text-[15px] font-extrabold text-slate-800">
              Xác nhận ký {myFields.length} khung
            </h4>
            <button onClick={() => !signing && setConfirmOpen(false)} className="text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            Chữ ký lấy từ hồ sơ của bạn — chỉ cần nhập PIN để xác nhận, không vẽ tay.
          </p>
          <div className="mb-3.5 flex h-[74px] items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-3">
            {me && yeuCau && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/iso-documents/signatures/${yeuCau.factory_id}/${me.id}/chu_ky.png`}
                alt="Chữ ký"
                className="max-h-full max-w-full object-contain"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none" }}
              />
            )}
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2.5">
            <ReadonlyField label="Họ tên" value={me?.full_name || me?.username || ""} />
            <ReadonlyField label="Vai trò" value={roleLabelForMe} />
            <ReadonlyField label="Ngày ký" value={fmtDateTime(new Date().toISOString())} full />
            <div className="col-span-2">
              <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-slate-400">
                PIN ký duyệt
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold tracking-widest outline-none focus:border-emerald-500"
                placeholder="••••"
                autoFocus
              />
              {pinError && <p className="mt-1 text-xs font-semibold text-red-600">{pinError}</p>}
            </div>
          </div>
          <div className="flex gap-2.5">
            <button
              onClick={() => setConfirmOpen(false)}
              disabled={signing}
              className="flex-1 rounded-xl border border-slate-300 bg-white py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50"
            >
              Để sau
            </button>
            <button
              onClick={handleConfirmSign}
              disabled={signing}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#2f5d52] py-2.5 text-sm font-bold text-white disabled:opacity-60"
            >
              {signing && <Loader2 size={14} className="animate-spin" />}
              Xác nhận ký
            </button>
          </div>
        </div>
      )}

      {/* Return-request sheet */}
      {returnOpen && (
        <div className="fixed inset-x-0 bottom-0 z-50 mx-auto w-full max-w-[420px] rounded-t-2xl bg-white p-5 shadow-[0_-12px_32px_rgba(15,23,42,0.25)] left-1/2 -translate-x-1/2">
          <div className="mx-auto mb-3.5 h-1 w-10 rounded-full bg-slate-200" />
          <div className="mb-1 flex items-start justify-between">
            <h4 className="text-[15px] font-extrabold text-slate-800">Trả về hồ sơ</h4>
            <button onClick={() => !returning && setReturnOpen(false)} className="text-slate-400 hover:text-slate-600">
              <X size={18} />
            </button>
          </div>
          <p className="mb-4 text-xs text-slate-500">
            Khung ký của người ký trước sẽ được đặt lại về &quot;chưa ký&quot; để họ sửa & ký lại.
            Chỉ dùng khi cần sửa vị trí ký/chọn nhầm người — nếu cần sửa nội dung/số liệu trên
            file, hãy dùng &quot;Hủy yêu cầu&quot; ở màn danh sách rồi tạo lại từ đầu.
          </p>
          <div className="mb-4">
            <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-slate-400">
              Lý do trả về <span className="text-rose-500">*</span>
            </label>
            <textarea
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-rose-500"
              placeholder="Vd: đặt sai vị trí ký, cần đổi người phê duyệt..."
              autoFocus
            />
            {returnError && <p className="mt-1 text-xs font-semibold text-red-600">{returnError}</p>}
          </div>
          <div className="flex gap-2.5">
            <button
              onClick={() => setReturnOpen(false)}
              disabled={returning}
              className="flex-1 rounded-xl border border-slate-300 bg-white py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50"
            >
              Để sau
            </button>
            <button
              onClick={handleConfirmReturn}
              disabled={returning}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-rose-600 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-60"
            >
              {returning && <Loader2 size={14} className="animate-spin" />}
              Trả về
            </button>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}

function ReadonlyField({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <label className="mb-1 block text-[10.5px] font-bold uppercase tracking-wide text-slate-400">{label}</label>
      <div className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-[13px] font-semibold text-slate-700">
        {value || "—"}
      </div>
    </div>
  )
}

function FlowList({
  nguoiKyList,
  profiles,
  me,
}: {
  nguoiKyList: NguoiKy[]
  profiles: Record<string, ProfileLite>
  me: SessionUser | null
}) {
  return (
    <div className="flex flex-col gap-0">
      {nguoiKyList.map((n) => {
        const prof = profiles[n.user_id]
        const name = prof?.full_name || prof?.username || (n.user_id === me?.id ? "Bạn" : "—")
        const isMe = n.user_id === me?.id
        const dotClass =
          n.trang_thai === "da_ky"
            ? "bg-emerald-100 text-emerald-600"
            : isMe
              ? "bg-sky-100 text-sky-600"
              : "bg-slate-100 text-slate-400"
        return (
          <div key={n.id} className="flex gap-2.5 border-b border-dashed border-slate-200 py-2.5 last:border-none">
            <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold ${dotClass}`}>
              {n.trang_thai === "da_ky" ? "✓" : "·"}
            </div>
            <div>
              <div className="text-[12.5px] font-bold text-slate-800">
                {roleLabelOf(n.vai_tro)}
              </div>
              <div className="mt-0.5 text-xs text-slate-600">{name}{isMe ? " (bạn)" : ""}</div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                {n.trang_thai === "da_ky" ? `Đã ký · ${fmtDateTime(n.ky_luc)}` : "Đang chờ"}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

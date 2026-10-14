"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { ClipboardCheck, Download, Eye, FileText, FlaskConical, Loader2, PenTool, RotateCcw } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { getDateParts } from "@/lib/date-utils"
import { buildQualityKqknDraftPdfBytes, downloadQualityKqknPdf, type QualityKqknResult } from "@/lib/quality-pdf"
import type { QualitySigningStatus } from "@/app/dashboard/quality/_components/quality-sign-status"
import { QualitySignModal } from "@/app/dashboard/quality/_components/quality-sign-modal"
import { fetchSigningStatusList } from "@/app/dashboard/_components/signing-status-fetch"
import { SignStatusBadge } from "@/app/dashboard/_components/sign-status-badge"
import { openSecureFile } from "@/app/dashboard/_components/secure-file-open"
import { computeMyTurn } from "@/app/dashboard/_components/signing-my-turn"
import { ResponsiveTableWrapper } from "@/app/dashboard/_components/responsive-table-wrapper"
import { moduleThemeClass } from "@/app/dashboard/_components/doc-ui/module-theme"
import { DetailSplitLayout } from "@/app/dashboard/_components/doc-ui/detail-split-layout"
import { DetailPageHeader, HeaderButton } from "@/app/dashboard/_components/doc-ui/detail-page-header"
import { DocViewer } from "@/app/dashboard/_components/doc-ui/doc-viewer"
import { useIsDesktop } from "@/app/dashboard/_components/doc-ui/use-is-desktop"
import { InspectorCard, MetaList, MetaRow, StatusSummaryBar } from "@/app/dashboard/_components/doc-ui/inspector-card"
import { SignActionBox, type SignAction } from "@/app/dashboard/_components/doc-ui/sign-action-box"
import { TimelineProgress, TimelineSteps, type TimelineStepItem } from "@/app/dashboard/_components/doc-ui/timeline-steps"
import { SegmentedTabs } from "@/app/dashboard/_components/doc-ui/segmented-tabs"
import { StatusBadge } from "@/app/dashboard/_components/doc-ui/status-badge"
import { ListState } from "@/app/dashboard/_components/doc-ui/list-state"

/**
 * Trang chi tiết Phiếu KQKN theo NGÀY kiểm nghiệm (rule 29 mục C, U3 2026-10-14).
 * "Biên bản" của Kiểm nghiệm = toàn bộ phiếu KN trong 1 ngày (ma_ho_so ký số = ngày).
 * Thêm/Sửa/Xoá phiếu vẫn làm ở danh sách — trang này chỉ xem + ký duyệt.
 */

type QcRow = QualityKqknResult & {
  factory_id: string
  loai_kn: string | null
  tieu_chuan: string | null
  parent_id: string | null
  created_by: string | null
  created_at: string | null
  lan: number | null
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function formatPKN(pkn: number, ngayKN: string, fCode: string): string {
  const parts = getDateParts(ngayKN)
  if (!parts) return `PKN-${fCode}-000000/${pkn}`
  return `PKN-${fCode}-${parts.day}${parts.month}${parts.year.slice(2)}/${pkn}`
}

function gradeCell(g: { dat: boolean; tb?: number } | undefined, digits: number) {
  if (!g) return <span className="text-slate-300">—</span>
  return (
    <span className="whitespace-nowrap">
      {g.tb != null ? g.tb.toFixed(digits) : "—"}
      <span className={`ml-1 ${g.dat ? "text-emerald-500" : "text-red-500"}`}>{g.dat ? "✓" : "✗"}</span>
    </span>
  )
}

export default function QualityDateDetailPage() {
  const router = useRouter()
  const params = useParams<{ date: string }>()
  const date = typeof params?.date === "string" ? params.date : ""
  const isDesktop = useIsDesktop()

  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [factoryCode, setFactoryCode] = useState("NM")
  const [user, setUser] = useState<SessionUser | null>(null)
  const [rows, setRows] = useState<QcRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [st, setSt] = useState<QualitySigningStatus | undefined>(undefined)
  const [stLoaded, setStLoaded] = useState(false)
  const [stError, setStError] = useState(false)
  const stSeq = useRef(0)
  const [mobileTab, setMobileTab] = useState<"doc" | "info">("info")
  const [docTab, setDocTab] = useState<"file" | "content">("file")
  const [signModal, setSignModal] = useState<QualityKqknResult[] | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const showToast = useCallback((msg: string, ok = true) => setToast({ msg, ok }), [])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    const bootstrap = async () => {
      try {
        const { user: sessionUser } = await hydrateActiveSession()
        if (!hasPermission(sessionUser, "quality.view")) {
          setLoading(false)
          window.location.replace("/dashboard")
          return
        }
        setUser(sessionUser)
        const fid = sessionUser?.factory_id || (await getActiveFactoryId())
        if (!fid) { setLoading(false); return }
        setFactoryId(fid)
        const { data } = await supabase.from("factories").select("*").eq("id", fid).limit(1)
        const f = data?.[0]
        if (f) {
          // Mirror cách quality/page.tsx suy mã nhà máy cho số PKN.
          const allVals = Object.values(f).filter(Boolean).join(" ").toLowerCase()
          setFactoryCode(allVals.includes("phuoc") || allVals.includes("kampong") ? "PHK"
            : allVals.includes("cua") || allVals.includes("paris") ? "CP" : "NM")
        }
      } catch {
        setLoading(false)
      }
    }
    void bootstrap()
  }, [])

  // Phiếu KN của ngày (bỏ phiếu KN lại "kl_rot_hang" như danh sách), thay bằng kết quả KN lại mới
  // nhất qua parent_id nhưng giữ lo_kn/ma_lo bản gốc — đúng dữ liệu dựng PDF ở danh sách.
  const loadRows = useCallback(async (fid: string) => {
    setLoading(true)
    setLoadError(null)
    try {
      const { data, error } = await supabase
        .from("qc_results")
        .select("*")
        .eq("factory_id", fid)
        .eq("ngay_kn", date)
        .order("pkn", { ascending: true })
        .order("lo_kn", { ascending: true })
      if (error) { setLoadError(error.message); return }
      const base = ((data || []) as QcRow[]).filter((r) => r.loai_kn !== "kl_rot_hang")
      const ids = base.map((r) => r.id)
      const retestMap = new Map<string, QcRow>()
      if (ids.length) {
        const { data: retests } = await supabase
          .from("qc_results")
          .select("*")
          .in("parent_id", ids)
          .order("created_at", { ascending: false })
        for (const r of (retests || []) as QcRow[]) {
          if (r.parent_id && !retestMap.has(r.parent_id)) retestMap.set(r.parent_id, r)
        }
      }
      setRows(base.map((r) => {
        const rt = retestMap.get(r.id)
        return rt ? { ...rt, lo_kn: r.lo_kn, ma_lo: r.ma_lo, created_by: r.created_by } : r
      }))
    } finally {
      setLoading(false)
    }
  }, [date])

  const loadSign = useCallback(async (fid: string) => {
    const seq = ++stSeq.current
    try {
      const list = await fetchSigningStatusList<QualitySigningStatus>("/api/quality/signing-status", { factoryId: fid, dates: [date] })
      if (seq !== stSeq.current) return
      setSt(list.find((s) => s.date === date))
      setStError(false)
    } catch {
      if (seq !== stSeq.current) return
      setStError(true)
    } finally {
      if (seq === stSeq.current) setStLoaded(true)
    }
  }, [date])

  useEffect(() => {
    if (!factoryId || !DATE_RE.test(date)) return
    void loadRows(factoryId)
    void loadSign(factoryId)
  }, [factoryId, date, loadRows, loadSign])

  const batches = useMemo(() => {
    const m = new Map<string, { pkn: number; ngay_kn: string }>()
    for (const r of rows) {
      const k = r.batch_id || String(r.pkn)
      if (!m.has(k)) m.set(k, { pkn: r.pkn, ngay_kn: r.ngay_kn })
    }
    return Array.from(m.values())
  }, [rows])

  const toastNode = toast && (
    <div className={`fixed top-4 left-1/2 z-[70] -translate-x-1/2 rounded-2xl px-5 py-3 text-sm font-bold text-white shadow-2xl ${toast.ok ? "bg-emerald-600" : "bg-red-600"}`}>
      {toast.msg}
    </div>
  )

  if (!DATE_RE.test(date)) {
    return <div className="rounded-xl border border-slate-200 bg-white"><ListState kind="error" message="Ngày kiểm nghiệm không hợp lệ" /></div>
  }
  if (loading && rows.length === 0) {
    return <div className="rounded-xl border border-slate-200 bg-white"><ListState kind="loading" /></div>
  }
  if (loadError) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white">
        <ListState kind="error" message={loadError} onRetry={() => factoryId && void loadRows(factoryId)} />
      </div>
    )
  }

  const ngayLabel = new Date(date).toLocaleDateString("vi-VN")
  const fileName = `Phiếu KQKN ${factoryCode} ${date}`
  const hasFile = !!st?.fileHienTai
  const statusReady = stLoaded && !stError
  const hasDraft = !hasFile && statusReady && !st && rows.length > 0
  const activeDocTab: "file" | "content" = hasFile || hasDraft ? docTab : "content"
  const datCount = rows.filter((r) => !r.dat_hang?.endsWith("RH")).length
  const canOwnerAct = !!user && (user.role === "admin" || rows.some((r) => r.created_by === user.id))
  const canCreateSign = !!user && hasPermission(user, "quality.edit") && canOwnerAct

  const openFile = (download: boolean) => {
    if (!st?.yeuCauId) return
    const q = download ? "download=1" : "view=1"
    void openSecureFile(`/api/signing/requests/${st.yeuCauId}/file-url?${q}&name=${encodeURIComponent(fileName)}`)
      .then((r) => { if (!r.ok) showToast(r.error, false) })
  }
  const exportDraft = async () => {
    try {
      await downloadQualityKqknPdf(rows, date, factoryCode)
    } catch {
      showToast("Không tạo được PDF phiếu KQKN.", false)
    }
  }
  const reloadSign = () => { if (factoryId) void loadSign(factoryId) }

  // Tiến trình ký: Lập biểu → Trưởng phòng QLCL (thứ tự của quality-sign-modal).
  const signTimeline: TimelineStepItem[] = st
    ? (() => {
        let currentSet = false
        return [...st.signers].sort((a, b) => a.thuTu - b.thuTu).map((sg, i) => {
          const done = sg.trangThai === "da_ky" || st.trangThai === "hoan_tat"
          let state: TimelineStepItem["state"] = done ? "done" : "waiting"
          if (!done && !currentSet) { currentSet = true; state = "current" }
          const role = sg.userId === st.pheDuyetUserId ? "Trưởng phòng QLCL" : "Lập biểu"
          return {
            key: `${sg.userId}-${i}`,
            stepNo: i + 1,
            role,
            title: done ? "Đã ký" : state === "current" ? "Đang chờ ký" : "Chưa tới lượt",
            state,
            isMine: state === "current" && sg.userId === user?.id,
          }
        })
      })()
    : [
        { key: "lap", stepNo: 1, role: "Lập biểu", title: "Chưa gửi ký", state: "waiting" as const },
        { key: "tp", stepNo: 2, role: "Trưởng phòng QLCL", title: "Chưa gửi ký", state: "waiting" as const },
      ]
  const signDone = signTimeline.filter((t) => t.state === "done").length

  const goSign = () => { if (st) router.push(`/dashboard/ky/${st.yeuCauId}`) }
  let primary: SignAction | null = null
  if (st?.trangThai === "dang_luan_chuyen") {
    if (st.traVeLyDo && (user?.role === "admin" || user?.id === st.nguoiTao)) {
      primary = { key: "resign", label: "Sửa & ký lại", icon: <RotateCcw size={16} />, onClick: goSign }
    } else if (computeMyTurn(st.signers, user?.id)) {
      primary = { key: "sign", label: "Ký ngay", icon: <PenTool size={16} />, onClick: goSign }
    }
  } else if (!st && statusReady && canCreateSign && rows.length > 0) {
    primary = { key: "send", label: "Gửi ký duyệt", icon: <PenTool size={16} />, onClick: () => setSignModal(rows) }
  }
  const secondary: SignAction[] = []
  if (!hasFile && statusReady && rows.length > 0) {
    secondary.push({ key: "draft", label: "Xuất PDF chưa ký", icon: <FileText size={14} />, onClick: () => void exportDraft() })
  }
  secondary.push({ key: "list", label: "Về danh sách (thêm/sửa/xoá phiếu)", icon: <ClipboardCheck size={14} />, onClick: () => router.push("/dashboard/quality") })

  const chip = "rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11.5px] font-medium text-slate-600"

  const lotTable = rows.length === 0 ? (
    <div className="rounded-xl border border-slate-200 bg-white"><ListState kind="empty" message="Ngày này chưa có phiếu kiểm nghiệm" /></div>
  ) : (
    <ResponsiveTableWrapper>
      <table className="enterprise-table dense">
        <thead>
          <tr>
            <th>Phiếu</th>
            <th>Lô KN</th>
            <th>Mã lô</th>
            <th>Loại</th>
            <th>Tiêu chuẩn</th>
            <th>Tạp chất</th>
            <th>Tro</th>
            <th>PRI</th>
            <th>Kết quả</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const passed = !r.dat_hang?.endsWith("RH")
            return (
              <tr key={r.id}>
                <td className="whitespace-nowrap font-code text-[11.5px] text-violet-700">{formatPKN(r.pkn, r.ngay_kn, factoryCode)}</td>
                <td className="whitespace-nowrap font-code text-xs">
                  {r.lo_kn || "—"}
                  {r.parent_id && <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-700">KN lại</span>}
                </td>
                <td className="whitespace-nowrap font-semibold text-slate-800">{r.ma_lo}</td>
                <td className="whitespace-nowrap">{r.loai_csr}</td>
                <td className="text-xs text-slate-500">{r.tieu_chuan || "—"}</td>
                <td className="text-xs">{gradeCell(r.grade?.tap_chat, 3)}</td>
                <td className="text-xs">{gradeCell(r.grade?.tro, 3)}</td>
                <td className="text-xs">{gradeCell(r.grade?.pri, 1)}</td>
                <td>
                  <StatusBadge tone={passed ? "valid" : "danger"} label={passed ? `Đạt ${r.dat_hang || ""}`.trim() : (r.dat_hang || "Rớt hạng")} size="xs" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </ResponsiveTableWrapper>
  )

  return (
    <div className={moduleThemeClass("mint")}>
      {toastNode}
      <DetailSplitLayout
        mobileTab={mobileTab}
        onMobileTabChange={setMobileTab}
        header={
          <DetailPageHeader
            backHref="/dashboard/quality"
            backLabel="Quay lại danh sách kiểm nghiệm"
            eyebrow="Phiếu kết quả kiểm nghiệm"
            title={`Ngày KN ${ngayLabel}`}
            code={batches.length === 1 ? formatPKN(batches[0].pkn, batches[0].ngay_kn, factoryCode) : undefined}
            tags={
              <>
                <span className={chip}>{rows.length} lô</span>
                <span className={chip}>{batches.length} phiếu</span>
                {batches.length > 1 && batches.map((b) => (
                  <span key={b.pkn} className={chip}>{formatPKN(b.pkn, b.ngay_kn, factoryCode)}</span>
                ))}
              </>
            }
            actions={
              hasFile ? (
                <>
                  <HeaderButton icon={<Eye size={15} />} label="Xem file ký" onClick={() => openFile(false)} />
                  <HeaderButton icon={<Download size={15} />} label="Tải file ký" onClick={() => openFile(true)} />
                </>
              ) : statusReady && rows.length > 0 ? (
                <HeaderButton icon={<FileText size={15} />} label="Xuất PDF (chưa ký)" onClick={() => void exportDraft()} />
              ) : null
            }
          />
        }
        document={
          <>
            {(hasFile || hasDraft) && (
              <SegmentedTabs
                ariaLabel="Chọn nội dung cột tài liệu"
                value={activeDocTab}
                onChange={setDocTab}
                items={[
                  { key: "file", label: hasFile ? "File đã ký" : "Bản xem trước (chưa ký)", icon: FileText },
                  { key: "content", label: "Danh sách lô", icon: FlaskConical },
                ]}
              />
            )}
            {activeDocTab === "file" && st?.fileHienTai ? (
              <DocViewer
                key={st.fileHienTai}
                active={(isDesktop || mobileTab === "doc") && !signModal}
                endpoint={`/api/signing/requests/${st.yeuCauId}/file-url`}
                kind="pdf"
                fileExt="pdf"
                label={`${st.trangThai === "hoan_tat" ? "Bản đã ký duyệt" : "Bản đang ký"} · PDF`}
              />
            ) : activeDocTab === "file" && hasDraft ? (
              <DocViewer
                key={`draft-${date}`}
                active={(isDesktop || mobileTab === "doc") && !signModal}
                loadBytes={() => buildQualityKqknDraftPdfBytes(rows, factoryCode)}
                sourceKey={`draft-${date}-${factoryCode}-${rows.map((r) => r.id).join(",")}`}
                kind="pdf"
                fileExt="pdf"
                label="Bản chưa ký · PDF"
              />
            ) : lotTable}
          </>
        }
        inspector={
          <>
            <StatusSummaryBar
              domain="quality"
              status={rows.length > 0 && datCount === rows.length ? "dat" : "khong_dat"}
              headline={`${datCount}/${rows.length} lô đạt hạng`}
              meta={user ? (
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <span>Ký duyệt:</span>
                  {!stLoaded ? <Loader2 size={14} className="animate-spin text-slate-300" /> : stError && !st ? (
                    <button type="button" onClick={reloadSign} className="font-bold text-amber-700 hover:underline">Thử lại</button>
                  ) : (
                    <SignStatusBadge
                      status={st}
                      currentUser={user}
                      canCreate={canCreateSign}
                      continueRule="approver"
                      chipOnly
                      onOpenSignPrompt={() => setSignModal(rows)}
                      onCancelled={reloadSign}
                      showToast={showToast}
                      cancelMessage={`Hủy yêu cầu ký ngày ${date} đang chờ Trưởng phòng QLCL phê duyệt? Sau khi hủy, có thể bấm “Gửi ký duyệt” để tạo yêu cầu mới từ đầu.`}
                      dataChangedTitle="Có phiếu kiểm nghiệm đã được thêm/sửa cho ngày này SAU khi đã ký duyệt — file đã ký không còn khớp dữ liệu hiện tại."
                    />
                  )}
                </span>
              ) : undefined}
            />
            <SignActionBox primary={primary} secondary={secondary} danger={[]} />
            <InspectorCard
              title="Tiến trình ký"
              icon={FileText}
              actions={<span className="text-[11.5px] font-semibold text-slate-400">{signDone}/{signTimeline.length} bước</span>}
            >
              <div className="space-y-3">
                <TimelineSteps steps={signTimeline} compact />
                <TimelineProgress done={signDone} total={signTimeline.length} />
              </div>
            </InspectorCard>
            <InspectorCard title="Tổng hợp" icon={FlaskConical}>
              <MetaList>
                <MetaRow label="Số lô" value={`${rows.length} lô · ${batches.length} phiếu`} />
                <MetaRow label="Đạt hạng" value={`${datCount} lô`} />
                <MetaRow label="Rớt hạng" value={`${rows.length - datCount} lô`} />
                <MetaRow label="Loại CSR" value={Array.from(new Set(rows.map((r) => r.loai_csr).filter(Boolean))).join(", ") || "—"} />
              </MetaList>
            </InspectorCard>
          </>
        }
      />
      {signModal && factoryId && user && (
        <QualitySignModal
          open
          onClose={() => { setSignModal(null); reloadSign() }}
          factoryId={factoryId}
          currentUser={user}
          dateResults={signModal}
          maHoSo={date}
          factoryCode={factoryCode}
        />
      )}
    </div>
  )
}

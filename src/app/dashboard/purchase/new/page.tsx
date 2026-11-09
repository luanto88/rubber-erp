"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, ShoppingCart } from "lucide-react"
import { GiaCongIcon } from "../_components/gia-cong-icon"
import { getActiveFactoryId, hasPermission, hydrateActiveSession, type SessionUser } from "@/lib/auth"
import { PageHeaderBanner } from "@/app/dashboard/_components/page-header-banner"
import { PurchaseForm } from "../_components/purchase-form"
import { submitPurchaseForSigning } from "../_components/purchase-client"

function NewPurchaseInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // ?mode=gia_cong (nút "Lập phiếu gia công" ở tab Gia công ngoài): cùng 1 loại phiếu ĐNMVT, chỉ đổi
  // tiêu đề + ô chọn lọc sẵn dịch vụ. Loại phiếu thật vẫn suy từ các dòng.
  const isGiaCong = searchParams.get("mode") === "gia_cong"
  const listHref = isGiaCong ? "/dashboard/purchase?tab=gia_cong" : "/dashboard/purchase"
  const [user, setUser] = useState<SessionUser | null>(null)
  const [factoryId, setFactoryId] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    const bootstrap = async () => {
      const { user: u } = await hydrateActiveSession()
      if (!u) return
      if (!hasPermission(u, "purchase.create")) {
        window.location.replace("/dashboard/purchase")
        return
      }
      const fid = await getActiveFactoryId()
      setUser(u)
      setFactoryId(fid)
    }
    void bootstrap()
  }, [])

  const handleSaved = async (id: string, submitAfter: boolean) => {
    if (!submitAfter || !factoryId) {
      router.replace(`/dashboard/purchase/${id}`)
      return
    }
    try {
      const yeuCauId = await submitPurchaseForSigning(id, factoryId)
      router.replace(`/dashboard/ky/${yeuCauId}`)
    } catch (err) {
      // Phiếu đã lưu — mở trang chi tiết kèm thông báo lỗi gửi ký.
      setSubmitError(err instanceof Error ? err.message : "Không gửi ký được")
      router.replace(`/dashboard/purchase/${id}?submitError=${encodeURIComponent(err instanceof Error ? err.message : "Không gửi ký được")}`)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeaderBanner
        title={isGiaCong ? "Lập phiếu gia công ngoài" : "Lập phiếu đề nghị mua vật tư"}
        subtitle={
          isGiaCong
            ? "Dùng chung dãy số ĐNMVT · ký 3 bước như đề nghị mua · không qua kho, xác nhận hoàn thành sau khi duyệt"
            : "Số phiếu được cấp khi lưu lần đầu (quay về 01 mỗi năm)"
        }
        theme="teal"
        icon={isGiaCong ? GiaCongIcon : ShoppingCart}
        action={
          <button onClick={() => router.push(listHref)} className="flex items-center gap-2 px-4 py-2 bg-white/15 hover:bg-white/25 border border-white/40 text-white font-bold rounded-xl">
            <ArrowLeft size={16} /> Danh sách
          </button>
        }
      />
      {submitError && <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm font-semibold text-red-700">{submitError}</div>}
      {user && factoryId ? (
        <PurchaseForm
          factoryId={factoryId}
          userId={user.id}
          mode={isGiaCong ? "gia_cong" : undefined}
          onSaved={handleSaved}
          onCancel={() => router.push(listHref)}
        />
      ) : (
        <div className="p-12 text-center text-slate-400">Đang tải...</div>
      )}
    </div>
  )
}

export default function NewPurchasePage() {
  // useSearchParams cần Suspense (App Router).
  return (
    <Suspense fallback={<div className="p-12 text-center text-slate-400">Đang tải...</div>}>
      <NewPurchaseInner />
    </Suspense>
  )
}

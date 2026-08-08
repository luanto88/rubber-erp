"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authBlockReason, hasPermission, hydrateActiveSession, signOutEverywhere } from "@/lib/auth";
import { FileOutput, Package } from "lucide-react";
import {
  getStoredCustomerPortalLang,
  onCustomerPortalLangChange,
  tCustomerPortal,
  type CustomerPortalLang,
} from "@/lib/customer-portal-i18n";

type PortalOrder = {
  id: string;
  ma_don: string;
  ngay: string;
  chung_loai: string;
  tong_banh: number;
  trang_thai: string | null;
  customer_name: string | null;
};

function formatDate(value: string) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export default function CustomerPortalPage() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<PortalOrder[]>([]);
  const [error, setError] = useState(false);
  const [lang, setLang] = useState<CustomerPortalLang>("en");
  const t = (key: Parameters<typeof tCustomerPortal>[1]) => tCustomerPortal(lang, key);

  useEffect(() => {
    setLang(getStoredCustomerPortalLang());
    return onCustomerPortalLangChange(setLang);
  }, []);

  // Nhận thẳng token đã lấy được từ bootstrap (qua hydrateActiveSession()) — không đọc
  // lại session lần 2 bằng supabase.auth.getSession() riêng, tránh khoảng hở không cần thiết.
  const loadOrders = useCallback(async (token: string) => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/customer-portal/orders", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json().catch(() => null)) as { orders?: PortalOrder[]; error?: string } | null;
      if (!res.ok) throw new Error(json?.error || "load_failed");
      setOrders(json?.orders || []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      const { session, user } = await hydrateActiveSession().catch(() => ({ session: null, user: null }));
      const blocked = authBlockReason(user);
      if (!session?.user || blocked) {
        setLoading(false);
        await signOutEverywhere();
        window.location.replace(`/login${blocked ? `?reason=${blocked}` : ""}`);
        return;
      }
      if (!hasPermission(user, "export.view_own")) {
        setLoading(false);
        window.location.replace("/dashboard");
        return;
      }
      void loadOrders(session.access_token);
    };
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-slate-800">{t("myOrders")}</h1>
        <p className="text-sm text-slate-500 mt-0.5">{t("myOrdersSubtitle")}</p>
      </div>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
          {t("errorLoadOrders")}
        </div>
      )}

      {loading ? (
        <div className="p-12 text-center text-slate-400">{t("loading")}</div>
      ) : orders.length === 0 ? (
        <div className="p-12 text-center text-slate-400 bg-white rounded-xl border border-slate-200 shadow-sm">
          <Package size={40} className="mx-auto mb-3 opacity-30" />
          <p>{t("noOrders")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {orders.map((order) => (
            <Link
              key={order.id}
              href={`/dashboard/customer-portal/${order.id}`}
              className="block bg-white rounded-xl border border-slate-200 shadow-sm p-4 hover:shadow-md hover:border-emerald-300 transition-all"
            >
              <div className="flex items-center gap-2 text-emerald-600 mb-2">
                <FileOutput size={16} />
                <span className="font-extrabold text-slate-800">{order.ma_don}</span>
              </div>
              <div className="text-xs text-slate-500 space-y-1">
                <div>{t("dateLabel")}: {formatDate(order.ngay)}</div>
                <div>{t("productTypeLabel")}: {order.chung_loai || "-"}</div>
                <div>{t("totalBalesLabel")}: {order.tong_banh?.toLocaleString("vi-VN") ?? "-"}</div>
                {order.customer_name && <div>{t("customerLabel")}: {order.customer_name}</div>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

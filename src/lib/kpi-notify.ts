"use client"

// Helper gửi thông báo Telegram cho module KPI — xem đầy đủ lý do thiết kế (chỉ Telegram, không
// in-app/email, gửi tới 1 nhóm chat chung nên không cần resolve danh sách người nhận) tại
// src/app/api/kpi/notify/route.ts. Gọi fire-and-forget — lỗi mạng/chưa cấu hình bot không được
// chặn hành động nghiệp vụ đã thực hiện xong.

export type KpiNotifyPayload = { factoryId?: string; title: string; lines: string[]; link?: string }

export function sendKpiNotify(payload: KpiNotifyPayload): void {
  void fetch("/api/kpi/notify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {})
}

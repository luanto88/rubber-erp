// Helper thuần (KHÔNG "use server") tách riêng khỏi actions.ts — mọi export ở module "use server"
// bắt buộc phải là async function (ràng buộc build-time của Next.js Server Actions), nên hàm đồng
// bộ này phải sống ở file riêng để dùng được trực tiếp trong page.tsx (render/useMemo) mà không
// tốn 1 round-trip server action cho một phép tính thuần client-side.

import type { PendingCarryLot } from "@/app/dashboard/product/predict/actions";

type KienLetterLower = "a" | "b" | "c" | "d";

// Đếm số kiện của 1 lô "chờ tiếp tục" sẽ thực sự được RPC gán cho ngăn tiêu thụ đầu tiên khi
// người dùng chọn "Tiếp tục lô dở dang" — mirror đúng điều kiện trong nhánh v_continue của
// create_lot_prediction_batch (kien_X_ngan_id IS NULL AND kien X không nằm trong unassignable_kien).
// Dùng để cộng đúng KL này vào preview % TRƯỚC khi tạo thật, tránh bug % hiển thị sai lúc chọn
// ngăn rồi mới nhảy vọt đúng sau khi tạo xong (chỉ lúc đó mới đọc lại trạng thái ngăn thật). Xem
// .claude/rules/06-module-production.md mục "Cập nhật 2026-07-21".
export function countPendingCarryOpenKien(pending: PendingCarryLot): number {
  const unassignable = new Set(pending.unassignable_kien || []);
  const letters: KienLetterLower[] = ["a", "b", "c", "d"];
  return letters.reduce((count, letter) => {
    const nganId = (pending as unknown as Record<string, string | null>)[`kien_${letter}_ngan_id`];
    if (!nganId && !unassignable.has(letter)) return count + 1;
    return count;
  }, 0);
}

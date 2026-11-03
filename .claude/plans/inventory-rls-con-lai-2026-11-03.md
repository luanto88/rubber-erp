# Kế hoạch: vá RLS "Allow all" các bảng kho vật tư còn lại (lập 2026-11-03)

## Bối cảnh
- `20261106_inventory_documents_rls.sql` (ĐÃ CHẠY 2026-11-03) đã khoá 3 bảng phiếu: `inventory_documents`,
  `inventory_document_lines`, `inventory_document_attachments` (theo nhà máy + nháp chỉ người lập/admin).
- Còn **13 bảng** vẫn `"Allow all" USING (true)` (anon key chưa đăng nhập cũng đọc/ghi được, mọi nhà máy):
  `inventory_warehouses`, `inventory_item_categories`, `inventory_items`, `inventory_item_warehouse_rules`,
  `inventory_stock_balances`, `inventory_lot_balances`, `inventory_stock_movements`, `inventory_oil_stock_pools`,
  `inventory_alert_thresholds`, `inventory_consumption_norms`, `inventory_consumption_norm_lines`,
  `inventory_monthly_norm_reports`, `inventory_monthly_norm_report_lines`.
- Đã rà 2026-11-03: KHÔNG có trang công khai (ngoài `src/app/dashboard`, `src/app/api`, `src/lib`) đọc các bảng này.
  4 bảng `*norm*` có 0 chỗ dùng trong `src/`.

## Bẫy bắt buộc nhớ
- RPC `inventory_post_import/export/transfer_document`, `inventory_cancel_document` là **SECURITY INVOKER** ⇒ ghi
  `stock_balances`, `lot_balances`, `stock_movements`, `oil_stock_pools` bằng quyền người gọi. Siết ghi 4 bảng này mà
  không đổi RPC ⇒ **hỏng Ghi sổ / Hủy toàn module**.
- Trigger `inventory_prevent_negative_stock` (20260725) chạy trên `stock_movements`.
- Luồng service role không bị ảnh hưởng: `maintenance-stock-issuance.ts`, `maintenance-kt.ts`, `maintenance-ext-price.ts`,
  `api/purchase/*` (tạo vật tư, `purchase_receive`), `api/maintenance/external-items`, `api/inventory/notify`.
- Ghi từ trình duyệt hiện có: Cài đặt (`settings/page.tsx` — kho, nhóm, vật tư, rule kho, nhập Excel), quick-add trong
  `receipts/page.tsx`, ngưỡng cảnh báo ở `analytics/page.tsx`, `inventory/settings/page.tsx` (không có link). Phải grep lại
  `from("inventory_` toàn `src` trước khi viết.
- `20261105_inventory_shared_oil_flag_guard.sql` có trigger SECURITY DEFINER trên `inventory_items` — giữ nguyên.

## Các bước (phiên sau)
1. **Kiểm hiện trạng production** (SQL Editor):
   `select tablename, policyname, cmd, roles, qual from pg_policies where tablename like 'inventory_%' order by 1;`
   + xác nhận mọi bảng có cột `factory_id` (`select table_name from information_schema.columns where column_name='factory_id' and table_name like 'inventory_%';`).
   Bảng dòng con không có `factory_id` (nếu có) ⇒ policy qua bảng cha bằng hàm SECURITY DEFINER.
2. **GĐ A — migration `2026111x_inventory_rls_factory_scope.sql`** (an toàn, mirror 20260821): drop "Allow all" 13 bảng,
   4 policy `TO authenticated` theo `current_profile_factory_id()` cho SELECT/INSERT/UPDATE/DELETE. Không chặn theo role
   (vẫn do app). Chặn được: chưa đăng nhập + chéo nhà máy. Không đụng RPC.
3. **GĐ B — tuỳ chọn, hỏi người dùng trước** (chặn sửa tồn trực tiếp từ trình duyệt):
   đổi 4 RPC sang SECURITY DEFINER + kiểm bên trong (`p_factory_id = current_profile_factory_id()`, phiếu nháp của
   `auth.uid()` hoặc admin; cancel cần quyền `inventory.cancel` qua `current_profile_has_permission`), rồi bỏ policy
   INSERT/UPDATE/DELETE cho `authenticated` trên balances/lot_balances/movements/oil_pools (chỉ SELECT).
   ⚠️ CREATE OR REPLACE phải chép từ bản RPC MỚI NHẤT của từng hàm (grep cả `20260725`, `20260511`, `20260522`...).
   Danh mục (items/warehouses/categories/rules/thresholds): cân nhắc ghi chỉ `settings.manage_config` | admin | `inventory.create`
   (quick-add) — liệt kê đúng permission app đang dùng trước khi quyết.
4. Không xoá 4 bảng `*norm*` (hỏi người dùng nếu muốn khoá hẳn = RLS 0 policy).

## Kiểm thử sau mỗi GĐ
Nhập / Xuất (1 kho + nhiều kho) / Chuyển: lưu nháp, ghi sổ, hủy, duyệt; Tồn + Thẻ kho + Sổ chi tiết + Tổng quan tải đủ;
dầu dùng chung bồn (tồn bồn đúng); Cài đặt: thêm/sửa vật tư, kho, nhóm, nhập Excel vật tư, ngưỡng cảnh báo;
quick-add vật tư ở phiếu nhập; Bảo trì ký biên bản (tự xuất kho); Đề nghị mua ghi nhận nhập kho; chuông "Việc cần làm"
Kho vật tư; mở trang khi chưa đăng nhập ⇒ không đọc được dữ liệu (thử supabase-js anon trong script tạm).
Chỉ `npx tsc --noEmit` + `npx eslint`. Cập nhật rule 13 + memory `security_rls_allow_all_gap`.

## Prompt mở đầu phiên sau
```
Đọc CLAUDE.md, rule 13 và .claude/plans/inventory-rls-con-lai-2026-11-03.md. Làm bước 1 (đưa tôi câu SQL kiểm hiện trạng,
chờ tôi dán kết quả), rồi GĐ A. GĐ B hỏi tôi trước. Không npm run build. Hỏi trước khi commit/push.
```

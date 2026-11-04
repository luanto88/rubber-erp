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

## Trạng thái 2026-11-04
- GĐ A ĐÃ XONG: `20261107_inventory_rls_factory_scope.sql` đã chạy, test 43/43 PASS, commit `5661962` đã lên main.
- Người dùng ĐÃ ĐỒNG Ý làm GĐ B phần **khoá ghi thẳng tồn / phát sinh** (balances, lot_balances, movements, oil_stock_pools).
  Khoá ghi danh mục: CHƯA quyết — hỏi lại, không tự làm.

- GĐ B (phần khoá ghi tồn) ĐÃ XONG 2026-11-04: `20261108_inventory_rls_stock_lock.sql` đã chạy, test 63/63 PASS.
  Cách làm khác dự kiến: KHÔNG chép thân RPC — đổi tên hàm thật thành `*_core`, vỏ DEFINER gọi lại (xem rule 13).
  Còn lại: khoá ghi danh mục (chưa quyết).

## GĐ B — chi tiết đã rà (2026-11-04)
- Bản RPC mới nhất trong repo: post_import/export/transfer = `20260522_fix_inventory_rpc_document_id_ambiguity.sql`;
  cancel = `20260511_shared_oil_stock_pools.sql` (sau đó có `20260504_add_audit_columns`, `inventory_combined_migration.sql`
  — đối chiếu). **Bắt buộc lấy định nghĩa THẬT trên production trước**:
  `select pg_get_functiondef('public.inventory_post_import_document'::regproc);` (×4 hàm) — người dùng dán, chép nguyên thân.
- ⚠️ Người gọi bằng **service role** (không có `auth.uid()`, `current_profile_factory_id()` = NULL): `purchase_receive`
  (gọi `inventory_post_import_document`), `src/lib/maintenance-stock-issuance.ts` (post_export + cancel). Kiểm bên trong RPC
  phải cho qua khi `auth.role() = 'service_role'` (hoặc `auth.uid() is null` từ service role), nếu không vỡ Bảo trì ký + Đề
  nghị mua nhập kho.
- Kiểm cho người gọi authenticated: `p_factory_id = current_profile_factory_id()`; `p_posted_by`/`p_cancelled_by` = `auth.uid()`
  (không tin tham số); ghi sổ: phiếu nháp của `auth.uid()` hoặc admin (khớp RLS 20261106); huỷ: `inventory.cancel` hoặc admin,
  HOẶC phiếu `X-BT-%` + `maintenance.approve` (trình duyệt Bảo trì gọi cancel ở `maintenance/records/[id]/page.tsx` ~1172,
  ~1279 khi huỷ phê duyệt). Rà lại mọi chỗ gọi: `grep -rn 'rpc("inventory_' src`.
- `SECURITY DEFINER` + `SET search_path = public`; `REVOKE EXECUTE ... FROM anon, public; GRANT ... TO authenticated, service_role`.
- Sau đó drop policy insert/update/delete của 4 bảng tồn (giữ select). Trigger `trg_inventory_prevent_negative_stock` vẫn chạy.
- Kiểm thêm có trigger/hàm khác ghi 4 bảng này từ trình duyệt không (`20261103_purchase_actual_price.sql`,
  `20260504_init_stock_from_opening.sql`, chuông, Cài đặt "tồn đầu").
- Test: `node --env-file=.env.local scripts/test-inventory-rls.mjs` (cwd = gốc repo, đã chạy GĐ A 43/43); thêm ca: user ghi thẳng `inventory_stock_balances` ⇒ bị chặn; user ghi sổ phiếu nháp
  người khác ⇒ bị chặn; user không `inventory.cancel` huỷ ⇒ bị chặn; p_factory_id nhà máy khác ⇒ bị chặn. Tài khoản test:
  htho2000@auth.rubber-erp.local / 123456 (user), admin@auth.rubber-erp.local / nmphk123. Dọn dòng `stock_balances` on_hand=0
  do Chuyển kho test tạo ra.

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

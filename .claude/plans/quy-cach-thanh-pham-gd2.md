# Quy cách thành phẩm theo nhà máy — Bàn giao GĐ1 → GĐ2 (2026-11-08)

## GĐ1 đã làm (Bọc / Pallet sản xuất / Thảm) — chờ chạy migration + test tay
- Migration `supabase/migrations/20261108_product_packaging_types.sql` (**chạy tay TRƯỚC deploy**; chưa chạy thì
  mọi màn tự dùng danh sách mặc định = hành vi cũ). Bảng `product_packaging_types`
  (`kind` boc|pallet_sx|tham, `ten` có token `{CSR}`, `day_chuyen[]`, `loai_csr[]`, `inventory_item_ids[]`,
  `thanh_phan[]`, `is_default`, `sort_order`, `is_active`). Seed = đúng danh sách cũ (MB4 seed ở trạng thái TẮT).
- Thuần `src/lib/product-packaging.ts`: `DEFAULT_PACKAGING` (phải khớp seed), `buildPackagingConfig`,
  `resolveBoc/Pallet/ThamOptions`, `defaultBoc/Pallet/Tham`, `mergeWithLegacy`, `isConfiguredOption`,
  `normalizeTham`, `palletComponentsFromConfig`. Loader: `product-packaging-client.ts` (trình duyệt),
  `product-packaging-server.ts` (service role, chỉ server action).
- `getBocsForLoaiCSR(dc, csr, cfg?)` (`product-lot-config.ts`) nay đọc cấu hình; không truyền `cfg` ⇒ mặc định.
  `dayChuyenForCsr` chuyển từ `confirm/kien-lookup.ts` sang `product-lot-config.ts` (kien-lookup re-export).
- Đã nối: `product/page.tsx` (bỏ bản sao, PALLET/THAM từ cấu hình, default bọc theo `is_default` thay vì
  `bocOptions[1]`, thảm lưu chuẩn "Cũ"), `confirm/page.tsx` (+ hook `confirm/use-packaging.ts`, gói offline có
  trường `packaging`), `predict/page.tsx`, `product/actions.ts` (Thay bọc kiểm theo cấu hình),
  `export/page.tsx` (`getBocOpts(csr, cfg)`), `inventory/pallet-flow-actions.ts` (quy đổi pallet theo `thanh_phan`).
- Cài đặt → Cấu hình nhà máy → **"Quy cách đóng gói TP"** (`settings/_components/product-packaging-tab.tsx`):
  3 tab Bọc/Pallet SX/Thảm, multi-select Dây chuyền / Chủng loại / Mã vật tư kho / Thành phần pallet; chặn trùng
  tên chuẩn hoá + cảnh báo gần giống; đã có lô dùng (lots + lot_transactions) ⇒ không đổi tên, không xoá, chỉ tắt.
- Kiểm chứng: script gọi thẳng code thật 68/68 PASS (mặc định khớp 100% `getBocsForLoaiCSR` cũ cho mọi DC × CSR
  của CSR/SVR; lọc theo CSR, token, khử trùng, legacy, fallback lỗi/rỗng). tsc + eslint sạch.

## Hướng dẫn test tay GĐ1
1. Chạy migration trên Supabase SQL Editor → câu kiểm chứng cuối file ra 12 dòng/nhà máy.
2. Cài đặt → Cấu hình nhà máy → Quy cách đóng gói TP: thấy 4 bọc, 6 pallet (MB4 mờ "Đã tắt"), 2 thảm.
3. Thêm bọc "Bọc PE 0,04 VRG Green CSR10", Chủng loại = CSR10, Mã vật tư kho = mã bọc tương ứng (nếu có).
4. Thành phẩm → Thêm phiếu, Mủ tạp, CSR10 ⇒ ô Bọc có bọc Green; đổi CSR20 ⇒ KHÔNG có.
5. Sửa 1 giao dịch CSR10 ⇒ có Green; sửa giao dịch đang mang bọc đã tắt ⇒ vẫn hiện bọc cũ (đứng đầu), không mất.
6. Quét QR (`/dashboard/product/confirm`) 1 kiện CSR10 ⇒ ô Bọc có Green. Tải gói offline (mở màn khi có mạng), tắt
   mạng, quét lại ⇒ vẫn có Green.
7. Dự đoán số lô: chọn ngăn Mủ tạp, CSR10 ⇒ có Green.
8. Sang kiện/Thay bọc: lô CSR10, chọn bọc mới = Green ⇒ lưu được (server không báo "không dùng được").
9. Xuất hàng: tạo đơn CSR10 ⇒ ô Loại bọc có Green; mở sửa đơn cũ có bọc lạ ⇒ bọc đó vẫn hiện.
10. Thêm pallet SX mới (vd "Pallet nhựa", thành phần Đế nhựa), nhập 1 kiện dùng nó ⇒ Kho vật tư → Tồn (chọn phân
    loại Pallet) không báo "Không xác định" cho kiện đó.
11. Sửa tên 1 bọc đã dùng ⇒ báo không đổi tên được; Xoá ⇒ báo đã dùng ở N lô. Tắt ⇒ biến khỏi phiếu mới.
12. F11 / F12 / Kho thành phẩm lọc bọc: lô cũ in đúng tên cũ; lô mới in tên mới.
13. Hỏi người dùng: MB4 có dùng làm pallet sản xuất không (đang tắt).

## GĐ1 — người dùng xác nhận test PASS (2026-11-08)

## GĐ2 — PLAN (người dùng DUYỆT 2026-11-08; mục 5 pallet → để GĐ3)

### Khảo sát thực tế (đọc DB, chỉ đọc)
- `phuochoa_kt`: 2.030 lô, TẤT CẢ là `CSR10 × 35kg` (Xuất hàng 1.624 · Hoàn thành 405 · Dở dang 1); 991 lô dự đoán
  cũng CSR10×35; 73 đơn xuất CSR10×35. `cuaparis`: 0 lô. ⇒ Rủi ro làm sai trạng thái lô cũ rất thấp.
- `factories.prefix` ĐÃ CÓ sẵn (`phuochoa_kt`=CSR, `cuaparis`=SVR) ⇒ KHÔNG cần cột `csr_prefix` mới; chỉ thay
  việc so tên "cuaparis" (product, predict, export, settings packaging tab) + bỏ "CSR" cứng ở confirm/page.
- 3 bản sao logic bành: `product/page.tsx` (getLoaiBanhConfig/Options/getLoaiCSRByDayChuyen riêng),
  `export/page.tsx` (getLoaiBanhOptions + CSR_OPTS/SVR_OPTS), `warehouse-types.ts getMaxBanh` (chỉ theo kg).
- SQL tự tính lô tròn ở 2 chỗ: `sync_lot_master_snapshot` (bản mới nhất 20260929_shift_lock_gaps.sql, dòng 65)
  và trigger `update_lot_master_totals` (20260708_fix_lot_status_trigger.sql, dòng 33). Các RPC khác nhận
  `max_per_kien` từ JS.

### Thiết kế đề xuất
1. Bảng `product_grade_types` — MỖI DÒNG = 1 (chủng loại × loại bành): `factory_id, day_chuyen, loai_csr,
   loai_banh NUMERIC, max_per_kien INT, is_default, sort_order, is_active`; unique (factory, loai_csr, loai_banh).
   (Khác JSONB trong bàn giao: dòng phẳng thì SQL tra được bằng 1 SELECT, chặn trùng bằng index, khoá "đã dùng" theo
   từng dòng.) **Lô tròn = 4 × bành/kiện** (luôn 4 kiện) — không lưu riêng để không bao giờ lệch.
   Seed: CSR/SVR theo `factories.prefix`: 10/20 → 35kg·36; L/3L → 35 & 33,33·36; CV50/CV60 → 35·36 và 20·60.
2. Thuần `src/lib/product-grade.ts` (DEFAULT theo prefix, khớp 100% hàm cũ) + loader client/server như GĐ1.
   `getLoaiBanhConfig(csr, banh?, cfg?)`, `getLoaiBanhOptions(csr, cfg?)`, `getLoaiCSRByDayChuyen(dc, prefix, cfg?)`
   trong `product-lot-config.ts` — không truyền cfg ⇒ y hệt cũ. Tra dòng KỂ CẢ đã tắt (lô cũ vẫn đúng); không có
   dòng ⇒ quy tắc cũ (CSR lạ / "Ngoại lệ" = 35·36·144).
3. Xoá 3 bản sao; mọi màn đọc qua product-lot-config với cfg (product, confirm + gói offline, predict, export,
   warehouse, lot/[id], settings packaging tab). Server: product/actions, confirm/actions (p_recomputed),
   predict/actions (kien_weight_kg), product-label, storage-detail, kien-lookup (nhận cfg).
4. SQL: hàm `product_grade_lo_tron(factory, csr, banh)` = 4×max_per_kien, không có ⇒ CASE cũ (20→240, khác 144).
   `sync_lot_master_snapshot` chép NGUYÊN bản 20260929 chỉ đổi dòng tính lô tròn; trigger `update_lot_master_totals`
   chép nguyên bản 20260708 chỉ đổi dòng tính lô tròn (giữ nhánh không hạ "Xuất hàng").
5. Chặn đổi số đã dùng: trigger DB từ chối UPDATE `loai_csr/loai_banh/max_per_kien` và DELETE khi đã có lô/dự đoán
   cùng (factory, csr, bành) — chỉ được tắt/bật, đổi thứ tự, đổi dây chuyền/mặc định. UI cũng khoá.
6. Cài đặt → Cấu hình nhà máy → tab **"Quy cách chủng loại"**: nhóm theo chủng loại, mỗi dòng 1 loại bành
   (kg, bành/kiện, lô tròn tự tính), mặc định, đang dùng. Ghi: admin / `settings.manage_config` (RLS như GĐ1).
7. Ánh xạ thành phần pallet → mã vật tư (PALLET_COMPONENT_ITEMS): ĐỀ XUẤT để GĐ3 (chờ người dùng quyết).

### Rủi ro + cách chặn
| Rủi ro | Chặn |
|---|---|
| Đổi bành/kiện làm lô cũ đổi Hoàn thành ↔ Dở dang ở lần sync sau | Trigger DB + UI khoá dòng đã dùng; lô tròn suy từ bành/kiện |
| `CREATE OR REPLACE` SQL làm mất nhánh cũ (bài học 20260828) | Chép nguyên bản mới nhất, diff chỉ 1 dòng, script so trước/sau |
| Bảng chưa có / lỗi ⇒ màn trắng | Loader trả DEFAULT; hàm SQL dùng `to_regclass` ⇒ CASE cũ |
| Offline màn quét lệch cấu hình | Gói offline mang grade config; hàm thuần dùng chung |
| Số 33,33 so khớp float | So khớp theo `round(x,2)` ở cả JS lẫn SQL |
| Lô CSR lạ ("CSR5", "Ngoại lệ") | Không có dòng ⇒ quy tắc cũ |

### Kiểm chứng sẽ làm
Script gọi code thật: DEFAULT khớp 100% hàm cũ mọi (prefix × DC × CSR × bành); cấu hình thêm dòng mới; dòng tắt vẫn
tra được. SQL: chạy hàm `product_grade_lo_tron` + `sync_lot_master_snapshot` trên vài lô thật (đọc kết quả, so
trước/sau = 0 thay đổi). `npx tsc --noEmit` + `npx eslint`.

## GĐ2 đã làm (2026-11-08) — chờ chạy migration + test tay
- Migration `supabase/migrations/20261116_product_grade_types.sql` (**chạy tay TRƯỚC deploy**): bảng
  `product_grade_types` + RLS (admin / `settings.manage_config`), `product_grade_usage_count`, trigger
  `trg_product_grade_types_guard`, `product_grade_lo_tron`, `sync_lot_master_snapshot` + `update_lot_master_totals`
  (chép nguyên bản mới nhất, chỉ đổi dòng lô tròn), seed theo `factories.prefix`.
- Thuần `src/lib/product-grade.ts` (legacy* = nguyên văn hàm cũ, `grade*`, `buildGradeConfig`,
  `loadGradeConfigWith`), loader `product-grade-client.ts` / `product-grade-server.ts`; `product-lot-config.ts` nhận
  `cfg` cho cả 4 hàm.
- Đã nối: `product/page.tsx` (bỏ bản sao, lớp bọc `pageGradeConfig`, prefix theo `factories.prefix`),
  `confirm/page.tsx` + hook `confirm/use-grade.ts` + gói offline `grade` + `kien-lookup.ts` (`ctx.grade`,
  `offlineUnknownLookup(..., grade)`; bỏ "CSR" cứng), `confirm/actions.ts` (6 chỗ + gói offline),
  `product/actions.ts` (admin sửa giao dịch), `predict/actions.ts` + `predict/page.tsx`, `export/page.tsx`
  (danh sách CSR + loại bành, giữ loại bành cũ khi sửa đơn), `warehouse` (`getMaxBanh(kg, csr)` +
  `setWarehouseGradeConfig`), `lot/[id]`, `lib/product-label.ts`, `lib/storage-detail.ts` (tham số tuỳ chọn) +
  `storage/page.tsx` (báo cáo kỳ) + `storage-detail-dashboard.tsx`, tab đóng gói (bỏ so tên "cuaparis").
- Cài đặt → Cấu hình nhà máy → **"Quy cách chủng loại"** (`settings/_components/product-grade-tab.tsx`).
- Kiểm chứng: script gọi code thật 380/380 PASS (không cfg / cfg mặc định / cfg = seed khớp 100% hàm cũ mọi CSR/SVR ×
  dây chuyền × loại bành; CSR lạ; thêm dòng; dòng tắt; giữ giá trị cũ; lỗi / rỗng). Khác biệt duy nhất đã biết: lô
  L/3L không có loại bành ⇒ kg 35 thay 33,33 (bành/kiện, lô tròn giữ nguyên). Dữ liệu thật: 2.030 lô ⇒ 0 lô đổi lô
  tròn, 0 lô lệch trạng thái. tsc sạch, eslint 0 lỗi (warning còn lại có sẵn).

## Hướng dẫn test tay GĐ2
1. Chạy `20261116_product_grade_types.sql` → câu kiểm chứng cuối file: 10 dòng/nhà máy; `product_grade_lo_tron` ra
   144 | 240; câu "lô cũ không đổi trạng thái" ra 0 dòng.
2. Cài đặt → Cấu hình nhà máy → Quy cách chủng loại: 10 dòng (CSR10/20 Mủ tạp; L, 3L, CV50, CV60 Mủ nước), CSR10×35
   có khoá + số ~2.030 ở cột "Đã dùng"; nút xoá mờ.
3. Sửa CSR10×35: 3 ô chủng loại / loại bành / bành-kiện bị khoá; đổi Thứ tự lưu được.
4. Thêm CSR10 × 33,33 kg × 36 ⇒ Thành phẩm → Thêm phiếu, Mủ tạp, CSR10 ⇒ ô loại bành có 35 và 33,33. Dự đoán số lô và
   màn quét QR (mã ngoài gói khi offline) cũng có 33,33. Xoá dòng vừa thêm (chưa dùng) ⇒ xoá được.
5. Thêm chủng loại mới (vd CSR5, Mủ tạp, 35kg, 40 bành/kiện) ⇒ có trong ô chủng loại của Thành phẩm, Dự đoán, Xuất
   hàng, bộ lọc Thành phẩm, tab Quy cách đóng gói. Nhập 1 lô thử 4 kiện × 40 ⇒ lô "Hoàn thành" ở 160 bành (không phải
   144). Sau đó TẮT dòng (không xoá được vì đã dùng) ⇒ biến khỏi phiếu mới, lô thử vẫn hiện đúng 40/kiện ở chi tiết lô.
   Xoá lô thử bằng UI nếu cần.
6. Thử sửa bành/kiện của dòng đã dùng bằng SQL Editor (`UPDATE product_grade_types SET max_per_kien=40 WHERE ...`) ⇒
   lỗi `PRODUCT_GRADE_IN_USE`.
7. Quét QR 1 kiện CSR10: số bành tối đa 36; Gửi tất cả bình thường; ngăn tự sang "Đang sản xuất" (không hồi quy
   vòng `v_touched_ngans`).
8. Admin sửa 1 giao dịch (trang Thành phẩm) ⇒ chặn >36 bành/kiện như cũ.
9. Xuất hàng: tạo đơn ⇒ danh sách CSR đúng; mở sửa đơn cũ ⇒ loại bành cũ vẫn hiện.
10. Kho thành phẩm: kiện đủ 36 bành hiện "đầy" như trước. Chi tiết ngăn + Báo cáo cân đối theo kỳ: số lô tròn / dở dang
    không đổi so với trước.
11. Tắt mạng ở màn quét QR (đã tải gói) ⇒ mã ngoài gói vẫn chọn được CSR / loại bành theo cấu hình.

## Prompt bàn giao cho phiên sau (GĐ3)
```
Đọc CLAUDE.md, rule 11 (mục "GĐ2"), rule 06 mục 4.22–4.23 và .claude/plans/quy-cach-thanh-pham-gd2.md.
GĐ1 (bọc/pallet/thảm) test PASS; GĐ2 (product_grade_types: chủng loại × loại bành, lô tròn = 4 × bành/kiện) đã code —
xác nhận người dùng đã chạy migration 20261116 + test tay bước 1–11 GĐ2 trước; lỗi nào thì sửa trước.
Làm GĐ3:
1. Ánh xạ thành phần pallet → mã vật tư kho: PALLET_COMPONENT_ITEMS (src/lib/pallet-usage.ts, mã DPH / MUBEZ+MCH /
   ĐG / ĐN / PMB5 / PMB4 / PG) đang cứng. Đề xuất bảng theo nhà máy (thành phần → nhiều inventory_item_ids) quản trị
   trong Cài đặt cạnh "Quy cách đóng gói TP"; Kho vật tư → Tồn (pallet-flow-actions.ts) đọc bảng, không có thì dùng
   bảng cứng. Hỏi người dùng có muốn cho tự thêm thành phần mới (ngoài 7 mã) không.
2. quality/page.tsx: tiền tố CSR/SVR đang suy từ FACTORY_CODE ("CP" ⇒ SVR) ⇒ đổi sang factories.prefix
   (resolveFactoryPrefix); ngưỡng TCCS/TCVN theo chủng loại vẫn cứng — hỏi người dùng có cần cấu hình không.
3. Rà các chỗ còn đọc "Mủ tạp"/"Mủ nước" để suy CSR (dayChuyenForCsr không truyền cfg): truyền cfg nếu có sẵn.
Lên plan liệt kê rủi ro + cách chặn để tôi duyệt trước. Kiểm bằng script gọi code thật + npx tsc --noEmit +
npx eslint; không npm run build. Hỏi trước khi commit/push.
```

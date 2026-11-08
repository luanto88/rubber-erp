# GĐ3 Quy cách thành phẩm + Nắp pallet DPH — KẾ HOẠCH (2026-11-08, ĐÃ DUYỆT; mốc 2 nắp/lô cố định, TCCS giữ cứng)

Hiện trạng đã kiểm trên DB: migration GĐ1 (`product_packaging_types`) và GĐ2 (`product_grade_types`, 20 dòng) đã chạy.
Kho đã có mã `NS` Nắp sắt, `NG` Nắp gỗ (phân loại pallet). Pallet DPH = thành phần `sat_day`, có trong "Sắt đế gỗ",
"Sắt đế nhựa". Dự đoán số lô KHÔNG có ô pallet ⇒ "quét QR dự đoán" = màn quét `/dashboard/product/confirm`.

Người dùng đã chốt: nắp tính NHƯ PALLET (chỉ tính ở Kho vật tư → Tồn, không sinh phiếu kho); ghi nắp THEO TỪNG KIỆN;
ô "Xuất kèm nắp" cho mọi loại pallet xuất trừ Rời; CHO thêm thành phần pallet mới (vd đế sắt cho DPH).

## A. Bảng thành phần pallet theo nhà máy (thay `PALLET_COMPONENT_ITEMS` cứng)
Migration `20261117_pallet_components.sql` (chạy tay TRƯỚC deploy; phần B dùng migration riêng):
- `pallet_components`: `factory_id, code (slug, bất biến), ten, group_code (mã nhóm hiển thị ở Tồn: DPH, PM, NS…),
  inventory_item_ids uuid[], la_nap bool (là nắp), co_nap bool (pallet nền cần chọn nắp — sat_day = true),
  sort_order, is_active`. UNIQUE(factory_id, code). RLS: đọc theo nhà máy; ghi admin / `settings.manage_config`.
- Seed mỗi nhà máy 9 dòng: 7 thành phần cũ (giữ đúng code + group_code + mã kho hiện tại) + `nap_sat` (NS) + `nap_go`
  (NG), `inventory_item_ids` tra theo mã kho có sẵn.
- Trigger: không đổi `code`, không xoá khi code đang dùng ở `product_packaging_types.thanh_phan`,
  `export_pallet_types.mat_thanh_phan` hoặc `lot_transactions.nap` — chỉ tắt.
- Code: `src/lib/pallet-components.ts` (thuần, DEFAULT = 9 dòng seed) + loader client/server; bảng lỗi/rỗng ⇒ DEFAULT
  (y hệt hành vi hiện tại). `PalletComponent` đổi thành `string`; `palletComponents()` cứng giữ làm dự phòng.
- Cài đặt → Cấu hình nhà máy → tab mới **"Thành phần pallet"** (cạnh Quy cách đóng gói TP): tên, mã nhóm, mã vật tư kho
  (chọn nhiều), Là nắp / Cần chọn nắp, thứ tự, đang dùng; thêm thành phần mới.
- Quy cách đóng gói TP (thành phần của pallet SX) và Loại pallet xuất (thành phần mất khi bọc màng) lấy danh sách từ
  bảng này (hiện lọc cứng theo 7 mã — thành phần mới bị bỏ âm thầm).
- `pallet-flow-actions.ts` + trang Tồn: nhóm/mã kho/nhãn đọc bảng này.

## B. Nắp theo kiện
Migration riêng của phần B:
- `lot_transactions.nap JSONB NOT NULL DEFAULT '{}'` — `{"a":"nap_sat","c":"nap_go"}` (code thành phần, chỉ kiện có nắp).
- `product_confirm_drafts.nap TEXT NULL` (nháp quét = 1 kiện).
- `export_orders.xuat_nap BOOLEAN NOT NULL DEFAULT false`.
- `submit_confirm_draft_batch`: chép NGUYÊN bản mới nhất `20260928b` (giữ vòng `v_touched_ngans`), chỉ thêm ghi
  `nap = jsonb_build_object(kiện, draft.nap)` khi draft.nap có giá trị.
- `admin_update_lot_transaction`: chép nguyên bản `20261001`, thêm tham số `p_nap JSONB` (DROP chữ ký cũ), ghi vào
  `lot_admin_edits` trước/sau.
- `perform_sang_kien_thay_boc` (chép nguyên `20261004`): khi TÁCH dòng, khoá nắp của kiện được chuyển đi theo dòng mới;
  Sang kiện sang pallet KHÔNG có thành phần `co_nap` ⇒ xoá nắp các kiện đó (nắp trả về kho). Thay bọc không đổi nắp.
- Quy tắc hiện ô Nắp: pallet đã chọn có thành phần `co_nap = true` (Sắt đế gỗ/Sắt đế nhựa). Lựa chọn = các thành
  phần `la_nap` đang dùng + "Không nắp". Đổi sang pallet không cần nắp ⇒ tự xoá nắp.
- Cảnh báo (không chặn): tổng kiện có nắp của LÔ (giao dịch đã gửi + nháp chưa gửi + lần nhập này) > 2 ⇒ hộp xác nhận
  "Lô X sẽ có N nắp — thông thường 4 kiện DPH chỉ 2 nắp (1 nắp giữa kiện dưới và kiện trên). Vẫn lưu?". Ngưỡng 2 là hằng số.

Nơi nhập/sửa nắp:
1. Thành phẩm → Thêm phiếu (mỗi block: ô Nắp theo từng kiện A–D có bành) + `saveLotTransaction`.
2. Thành phẩm → modal Sửa giao dịch (admin) → `adminUpdateLotTransaction`.
3. Màn quét QR: form Lưu tạm, sửa nháp đang chờ, sửa Lịch sử ca (admin) — `saveDraftKien`, `updateDraftKien`,
   `editShiftHistoryEntry`; hàng đợi offline (IndexedDB) mang `nap`; gói offline mang thành phần pallet + nắp của lô để
   tính cảnh báo khi mất mạng. Dòng gộp "Đang chờ gửi" thêm nắp vào khoá gộp. Chữ Khmer do máy soạn.
4. Chỉ hiển thị: chi tiết lô (kiện có nắp), F11 cột Pallet thêm "+ NS"/"+ NG" theo kiện.
Không đụng: Dự đoán số lô, nhãn QR, Kho thành phẩm.

Xuất hàng: ô tick **"Xuất kèm nắp"** khi loại pallet xuất ≠ Rời (form `roi`); lưu `xuat_nap`; hiện ở dòng xổ + chi tiết
đơn + biên bản PDF ("Kèm nắp: Có/Không").

Tính tồn (`pallet-flow-actions.ts`), mỗi kiện có nắp:
- Đang lưu (nắp) khi kiện chưa rời kho; Xuất lưu theo ngày giao dịch đầu của kiện.
- Kiện rời kho: đơn hoàn tất kiện là Rời ⇒ Trả về; khác Rời + `xuat_nap` ⇒ Mất do xuất khẩu; khác Rời + không tick ⇒
  Trả về. Trống = Sổ sách − Mất từ mốc − Đang lưu (như pallet).
- Đơn cũ `xuat_nap = false` ⇒ nắp coi như trả về (lô cũ không có nắp nên không ảnh hưởng).

## C. Kiểm nghiệm + dây chuyền
- `quality/page.tsx`: tiền tố CSR/SVR đọc `factories.prefix` (`resolveFactoryPrefix`), bỏ bảng `FACTORY_CODE`.
  Ngưỡng TCCS/TCVN giữ cứng (đề xuất KHÔNG cấu hình ở GĐ3).
- `export/page.tsx` (3 chỗ `dayChuyenForCsr`) và `product/page.tsx` (`inferDc`) truyền cấu hình chủng loại đã nạp.

## Rủi ro + cách chặn
| Rủi ro | Chặn |
|---|---|
| `CREATE OR REPLACE` 3 RPC làm mất nhánh cũ (bài học 20260828) | Chép nguyên bản mới nhất, script diff chỉ ra đúng các dòng thêm |
| Đổi chữ ký `admin_update_lot_transaction` ⇒ code cũ trên production gãy giữa lúc chạy migration và deploy | Giữ tham số `p_nap` DEFAULT NULL ở CUỐI; code cũ gọi không truyền vẫn chạy |
| Bảng thành phần chưa có / rỗng | DEFAULT = 9 dòng seed ⇒ Tồn pallet ra đúng như hiện tại + 2 nhóm NS/NG |
| Đổi code thành phần làm lô cũ / cấu hình mất quy đổi | Trigger chặn đổi code, chặn xoá khi đang dùng |
| Sang kiện tách dòng làm nhân đôi / mất nắp | Chuyển khoá nắp theo kiện sang dòng mới, xoá khoá ở dòng cũ; script kiểm tổng nắp trước/sau |
| Offline lưu nắp, server từ chối | Server kiểm nắp hợp lệ (code `la_nap`, pallet có `co_nap`), lỗi ⇒ mục "Lỗi" như các lỗi khác |
| Tồn nắp âm do lô cũ chưa ghi nắp | Lô cũ `nap = {}` ⇒ 0 nắp đang lưu; Trống = Sổ sách (đúng thực tế trước khi dùng tính năng) |
| PostgREST cắt 1000 dòng khi đếm nắp lô | Đếm theo `lot_id` (≤ vài chục dòng), phân trang ở pallet-flow như hiện tại |

## Kiểm chứng
Script gọi code thật: DEFAULT thành phần ⇒ `loadPalletFlow` ra đúng số hiện tại cho 7 nhóm; ví dụ nắp (4 kiện DPH, 2 nắp,
xuất Rời / xuất khẩu có-không tick) ⇒ đúng Đang lưu / Trả về / Mất. SQL: chạy RPC trên lô thử trong transaction rồi
ROLLBACK. `npx tsc --noEmit` + `npx eslint`.

## Thứ tự làm
A (bảng + tab + nối pallet-flow) → B (migration nắp + 3 RPC → Thành phẩm → màn quét → Xuất hàng → tồn) → C. Dừng sau mỗi
phần cho người dùng test nếu muốn.

## Phần A — ĐÃ CODE (2026-11-08), chờ chạy migration + test tay
- Migration `supabase/migrations/20261117_pallet_components.sql`: bảng + RLS + `pallet_component_usage_count` +
  trigger `trg_pallet_components_guard` (chặn đổi mã, chặn xoá khi đang dùng) + seed 9 dòng/nhà máy.
- `src/lib/pallet-components.ts` (thuần) + `pallet-components-client.ts` / `-server.ts`. `pallet-usage.ts` chỉ còn quy
  đổi dự phòng + loại pallet xuất; đã xoá PALLET_COMPONENT_ITEMS/LABEL/ORDER/CODES, palletGroupOfItemCode.
- Nối: `pallet-flow-actions.ts`, `inventory/on-hand/page.tsx` (nhóm theo bảng, thành phần tắt chỉ hiện khi còn số liệu),
  `product-packaging.ts` (nhận mã thành phần tự thêm), tab Quy cách đóng gói + Loại pallet xuất (chip từ bảng, bỏ nắp),
  tab mới `settings/_components/pallet-components-tab.tsx`.
- Kiểm: script gọi code thật 478/478 PASS (DEFAULT + bảng dựng như seed ⇒ khớp 100% bảng cứng cũ trên toàn bộ vật tư
  thật; thành phần tự thêm giữ được trong thanh_phan; mã rác bị bỏ). tsc sạch, eslint 0 lỗi.

### Test tay phần A
1. Chạy migration ⇒ câu kiểm chứng cuối file: 9 dòng/nhà máy, phuochoa_kt gắn đúng DPH | MUBEZ, MCH | ĐG | ĐN | PMB5 |
   (PMB4 trống) | PG | NS | NG.
2. Cài đặt → Cấu hình nhà máy → Thành phần pallet: 9 dòng; Pallet sắt dày = "Cần chọn nắp"; Nắp sắt/gỗ = "Nắp".
3. Kho vật tư → Tồn → chọn phân loại "Pallet các loại": số các dòng DPH, PM, ĐG, ĐN, PMB5, PG GIỐNG HỆT trước khi chạy
   migration (chụp màn hình trước để so). Có thêm 2 dòng NS, NG (đang lưu = 0, trống = sổ sách).
4. Thêm thành phần "Đế sắt" (mã nhóm ĐS) ⇒ tab Quy cách đóng gói → sửa "Sắt đế gỗ": thấy chip "Đế sắt"; chip Nắp KHÔNG
   có. Tab Loại pallet xuất → bọc màng: thấy "Đế sắt". Xoá "Đế sắt" khi chưa gắn đâu ⇒ xoá được.
5. Gắn "Đế sắt" vào 1 loại pallet rồi thử xoá ⇒ báo đang dùng, chỉ tắt được. Sửa thành phần: ô Mã nội bộ bị khoá.
6. Sửa "Pallet sắt mỏng" bỏ MCH ⇒ ở Tồn, MCH tách ra thành vật tư thường (theo kho). Gắn lại MCH để trả về như cũ.

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

## Phần B — ĐÃ CODE (2026-11-08), chờ chạy migration + test tay
- Migration `supabase/migrations/20261118_lot_nap.sql` (**chạy tay TRƯỚC deploy**, sau 20261117): cột
  `lot_transactions.nap`, `product_confirm_drafts.nap`, `export_orders.xuat_nap`; hàm `pallet_names_need_nap`,
  `lot_nap_sanitize`; `pallet_component_usage_count` đếm thêm nắp; 3 RPC chép nguyên bản mới nhất (diff chỉ phần nắp):
  `submit_confirm_draft_batch` (giữ v_touched_ngans), `admin_update_lot_transaction` (+ `p_nap JSONB DEFAULT NULL` cuối,
  DROP bản 14 tham số), `perform_sang_kien_thay_boc` (tách dòng chuyển nắp theo kiện; Sang kiện sang pallet không cần
  nắp ⇒ xoá nắp; Thay bọc giữ nắp).
- Thư viện thuần `src/lib/pallet-nap.ts` (palletNeedsNap, sanitizeNapMap, lotNapByKien, lotNapTotalAfter, formatNapSuffix,
  MAX_NAP_PER_LOT = 2). Component `product/_components/nap-kien-picker.tsx` (4 kiện) + `nap-select.tsx` (1 kiện).
- Thành phẩm: block "Thêm phiếu" có ô Nắp A–D (áp mọi lô của block, chỉ kiện có bành nhập lần này); modal Sửa giao dịch
  (admin) có ô Nắp. Cảnh báo `window.confirm` khi lô > 2 nắp (đã gửi + nháp + lần này, qua `loadLotNapStates`).
- Màn quét QR: ô Nắp trong form Lưu tạm, sửa nháp, sửa hàng đợi trên máy, sửa Lịch sử ca (chỉ dòng 1 kiện); hàng đợi
  offline mang `nap`; gói offline có `palletComponents` + `lotNap`; khoá gộp "Đang chờ gửi" có nắp. Chữ Khmer máy soạn.
- Xuất hàng: ô "Xuất kèm nắp" khi loại pallet xuất ≠ Rời (theo `export_pallet_types.hinh_thuc`), lưu `xuat_nap`; hiện
  ở dòng xổ, trang chi tiết, biên bản PDF ("Pallet: … · Kèm nắp: Có/Không").
- Tồn (`pallet-flow-actions.ts`): nắp kiện tính như 1 thành phần (đang lưu / xuất lưu / trả về / mất do xuất khẩu).
- Hiển thị: chi tiết lô (dòng "Nắp" + hậu tố ở bảng giao dịch), F11 cột Pallet "Sắt đế gỗ + NS A, C".
- Kiểm: script gọi code thật 23/23 PASS (nhận diện pallet cần nắp, lọc nắp, nắp theo kiện qua nhiều lần quét, tổng nắp,
  hậu tố F11). tsc sạch, eslint 0 lỗi. CHƯA chạy SQL thật.
- Chưa làm: tự điền sẵn nắp khi quét bổ sung kiện đã có nắp (ô mặc định "Không nắp" — kiện vẫn giữ nắp cũ vì nắp tính
  theo giao dịch có ghi); phần C.

### Test tay phần B
1. Chạy migration ⇒ chạy 4 câu kiểm chứng cuối file (cột có; admin_update chỉ 1 chữ ký kết thúc `p_nap jsonb`;
   Sắt đế gỗ = true, Sắt mỏng = false; sanitize ra `{"a": "nap_sat"}`).
2. Thành phẩm → Thêm phiếu: chọn pallet "Sắt đế gỗ" ⇒ hiện khung "Nắp pallet theo kiện"; đổi sang "Sắt mỏng" ⇒ khung mất.
   Chọn A + C = Nắp sắt, lưu ⇒ không hỏi. Chọn A, B, C = Nắp sắt ⇒ hộp xác nhận "Lô X sẽ có 3 nắp…".
3. Mở chi tiết lô vừa lưu ⇒ dòng "Nắp: A: Nắp sắt, C: Nắp sắt", bảng giao dịch có "+ NS A, C".
4. Admin Sửa giao dịch đó ⇒ ô nắp điền sẵn; bỏ nắp C, lưu ⇒ chi tiết lô còn A.
5. Màn quét QR: quét kiện D lô đã có 2 nắp, pallet Sắt đế gỗ, chọn Nắp gỗ ⇒ hỏi "3 nắp"; Lưu tạm ⇒ dòng "Đang chờ gửi"
   tách riêng; Sửa nháp đổi nắp được; Gửi tất cả ⇒ giao dịch có nắp. Thử tắt mạng: lưu được, có mạng lại tự đồng bộ.
6. Báo cáo ngày (F11) của ngày lô tròn ⇒ cột Pallet "Sắt đế gỗ + NS A, C".
7. Xuất hàng: loại pallet "Rời" ⇒ không có ô; đổi "Pallet sắt đế gỗ" ⇒ ô "Xuất kèm nắp"; tick, lưu ⇒ dòng xổ / chi tiết /
   PDF ghi "Kèm nắp: Có". Đổi lại "Rời" rồi lưu ⇒ xuat_nap = false.
8. Kho vật tư → Tồn, phân loại "Pallet các loại": NS "Đang lưu dưới kiện TP" = số kiện có nắp sắt chưa xuất. Gán đủ bành
   lô đó vào đơn có tick ⇒ chuyển sang "Mất do xuất khẩu"; không tick / Rời ⇒ "Trả về" (khi chọn kỳ).
9. Sang kiện kiện A (đang có nắp) sang "Sắt mỏng" ⇒ nắp A mất; sang "Sắt đế nhựa" ⇒ nắp giữ nguyên. Thay bọc ⇒ nắp giữ.

## Sau test tay phần B (2026-11-09)
- Mục 2, 3, 7, 8 PASS. Mục 6: ô Nắp chỉ hiện với "Sắt đế gỗ/nhựa" — đúng ý người dùng.
- Mục 1 + 4: cảnh báo > 2 nắp đổi từ hộp hỏi trình duyệt sang banner nổi `useNapLimitConfirm`
  (`product/_components/nap-limit-banner.tsx`, portal, Esc = quay lại) ở Thêm phiếu, admin Sửa giao dịch, Lưu tạm màn quét
  (song ngữ, khoá i18n `napOverLimitLine`, `napBannerTitle/Confirm/Back`).
- F09 thêm khối "Lũy kế thành phẩm (tấn)" góc phải dưới bảng Tổng hợp: `loadProductionCumulative` (daily-report-actions.ts)
  = cột Nhập tháng/năm của F12 (computeStock, không tồn đầu kỳ), GỘP MỌI BỌC theo (CSR, bành, nguồn): "Chế biến" (nguồn Công
  ty) rồi Thu mua / Gia công. Chỉ (CSR, bành) có sản xuất trong ngày. Bản cứng F09 đã lưu trước đó không có khối này.

### Đối soát lũy kế hết 08/11/2026 (phuochoa_kt, CSR10 bành 35) — LỆCH NĂM, ĐỂ XỬ LÝ SAU
| | Hệ thống | Người dùng | Lệch |
|---|---|---|---|
| Tháng 11 (chế biến) | 109,130 t | 109,130 t | 0 |
| Năm 2026 (chế biến + thu mua) | 10.140,725 t = chế biến 10.125,605 + thu mua 15,120 | 10.141,495 t (đã gồm thu mua 15,120) | −0,770 t = 22 bành × 35 kg |
- Chế biến năm theo bọc: nhãn VRG 9.636,725 · trơn 483,840 · PE Green 5,040. Thu mua: nhãn VRG 15,120.
- Chưa sửa dữ liệu, chưa nhập Tồn đầu kỳ (tồn đầu kỳ là số TỒN, không chỉnh được lũy kế sản xuất). Hướng điều tra 22 bành
  thiếu: lô mồ côi / giao dịch ngay_nhap ghi sai năm / lô 2025 tròn 2026 — `scripts/reconcile-f12-stock.mjs`.

## Sau test tay phần B (2026-11-09) — đã deploy
- Migration `20261118_lot_nap.sql` ĐÃ CHẠY. Test localhost: mục 1–8 PASS. Mục 6: ô Nắp chỉ hiện với "Sắt đế gỗ/nhựa" — đúng ý.
- Cảnh báo > 2 nắp: banner nổi `useNapLimitConfirm` (`product/_components/nap-limit-banner.tsx`, portal, Esc = quay lại)
  thay `window.confirm` ở Thêm phiếu, admin Sửa giao dịch, Lưu tạm màn quét (song ngữ, i18n `napOverLimitLine`,
  `napBannerTitle/Confirm/Back`). Test PASS.
- F09 (Phiếu báo thành phẩm) thêm khối "Lũy kế thành phẩm" góc phải dưới bảng Tổng hợp, dạng GHI CHÚ không kẻ bảng, dòng
  ngăn bằng nét đứt mờ (mẫu duyệt 2026-11-09): mỗi (CSR, bành) có sản xuất trong ngày ⇒ "– Chế biến" (nguồn Công ty, gộp
  mọi bọc), "– Thu mua"/"– Gia công" nếu có, ≥ 2 dòng thì thêm "Tổng". Nguồn: `loadProductionCumulative`
  (daily-report-actions.ts) = cột Nhập tháng/năm F12 (computeStock, không dùng tồn đầu kỳ). Bản cứng F09 cũ không có khối.

### Đối soát lũy kế hết 08/11/2026 (phuochoa_kt, CSR10 bành 35) — LỆCH NĂM, CHƯA XỬ LÝ
| | Hệ thống | Người dùng | Lệch |
|---|---|---|---|
| Tháng 11 (chế biến) | 109,130 t | 109,130 t | 0 |
| Năm 2026 (chế biến + thu mua) | 10.140,725 t = chế biến 10.125,605 + thu mua 15,120 | 10.141,495 t (gồm thu mua 15,120) | hệ thống thiếu 0,770 t = 22 bành × 35 kg |
- Chế biến năm theo bọc: nhãn VRG 9.636,725 · trơn 483,840 · PE Green 5,040. Thu mua: nhãn VRG 15,120.
- Không sửa dữ liệu, không nhập Tồn đầu kỳ (tồn đầu kỳ là TỒN, không chỉnh được lũy kế sản xuất).

## Prompt phiên sau
```
Đọc CLAUDE.md, rule 11 (mục GĐ2/GĐ3) và .claude/plans/quy-cach-thanh-pham-gd3-nap.md (mục "Sau test tay phần B").
Việc 1 — Điều tra lệch lũy kế năm 2026 CSR10 bành 35: hệ thống 10.140,725 t, người dùng 10.141,495 t (đã gồm thu mua
15,120 t) ⇒ thiếu 0,770 t = 22 bành. Chỉ ĐỌC dữ liệu: chạy scripts/reconcile-f12-stock.mjs --ngay=2026-11-08
--factory=phuochoa_kt; tìm lô mồ côi (tong_banh > 0 không có lot_transactions), giao dịch ngay_nhap ngoài 2026 của lô tròn
2026, lô 2025 tròn 2026, kiện thiếu bành (lô tròn 144 nhưng giao dịch < 144), giao dịch so_kg ≠ so_banh × loai_banh.
Liệt kê lô nghi vấn + đề xuất cách sửa, KHÔNG ghi DB, hỏi tôi trước.
Việc 2 — Test production phần B: Thêm phiếu có nắp, admin sửa nắp, màn quét QR (cả mất mạng) có nắp + banner > 2 nắp,
Gửi tất cả, chi tiết lô + F11 hiện "+ NS A, C", Xuất hàng "Xuất kèm nắp" (dòng xổ/chi tiết/PDF), Kho vật tư → Tồn nhóm
NS/NG, Sang kiện sang Sắt mỏng xoá nắp. F09 ngày có sản xuất: khối Lũy kế ghi chú đúng số với F12.
Việc 3 — GĐ3 phần C (kế hoạch mục C): quality/page.tsx đọc tiền tố CSR/SVR từ factories.prefix (resolveFactoryPrefix),
bỏ FACTORY_CODE; export/page.tsx (3 chỗ dayChuyenForCsr) + product/page.tsx (inferDc) truyền cấu hình chủng loại đã nạp.
Lên plan từng bước cho tôi duyệt trước. Kiểm bằng npx tsc --noEmit + npx eslint, không npm run build. Hỏi trước khi commit.
Việc còn treo nhỏ: khi quét bổ sung kiện đã có nắp, ô Nắp không tự điền sẵn (kiện vẫn giữ nắp cũ) — hỏi có cần làm.
```

## Phiên 2026-11-09 (tiếp) — đã giải thích lệch 22 bành + phần C đã code (chờ test tay)
- Lệch −0,770 t năm 2026 ĐÃ GIẢI THÍCH, không phải lỗi: = dòng `product_opening_stock` chốt 31/12/2025 (CSR10 · Công ty ·
  Bọc nhãn VRG · 35, 770 kg, ghi chú "Sản xuất bù 22 bành lô 54m"). Người dùng xác nhận 22 bành sản xuất NĂM 2025 ⇒ đúng là
  tồn đầu kỳ, không thuộc lũy kế 2026. Dữ liệu sạch: reconcile [1]–[5] = 0; 0 giao dịch sai năm / sai kg / thiếu kiện.
- Phần C đã code: `quality/page.tsx` tiền tố theo `resolveFactoryPrefix` (state `csrPrefix`, bỏ `FACTORY_CODE`; `factoryCode`
  PHK/CP vẫn chỉ cho mã PKN), `export/page.tsx` + `product/page.tsx` (inferDc Thay bọc) truyền cấu hình chủng loại.
- Kèm: điền sẵn nắp kiện khi quét bổ sung; ghi chú "TM" tự điền cho lô thu mua (rule 06 mục 4.25).

# Kế hoạch: Quét QR xác nhận sản xuất khi mất mạng (2026-10-30)

> **2026-10-31: GĐ-A ĐÃ CODE** (chờ test tay) — 4 điểm mục 6 chốt theo khuyến nghị; chi tiết thực tế ở rule 06
> mục 4.20. Còn lại: GĐ-B (service worker cache trang).

Màn hình: `/dashboard/product/confirm` (`page.tsx`, `actions.ts`). Quy tắc liên quan: rule 06 mục
4.6 / 4.11 / 4.4b (khoá ca).

## 1. Hiện trạng (đã khảo sát code)
- Không có hỗ trợ offline nào:
  - Không có `navigator.onLine`, IndexedDB hay hàng đợi.
  - `public/service-worker.js` cố ý KHÔNG cache trang / JS / API (chỉ manifest + icon).
- Bước nào cần mạng:

  | Bước | Hàm / cách chạy | Cần mạng |
  |---|---|---|
  | Đọc QR | `parseScannedQr`, hàm thuần | Không |
  | Tra kiện | `resolveKienForConfirm` (server action, nhiều truy vấn) | Có |
  | Lưu tạm | `saveDraftKien` (ghi `product_confirm_drafts` trên server) | Có |
  | Gửi tất cả | RPC `submit_confirm_draft_batch`, nguyên tử, kiểm khoá ca / 110% ngăn / max bành | Có |
  | Tên ca | `loadFactoryShiftNames` | Có |
  | Lịch sử ca | — | Có |
  | Báo cáo | — | Có |

- Rủi ro hiện tại:
  - Lưu tạm lỗi mạng thì số liệu chỉ nằm trong state React; tải lại trang là mất.
  - Mất mạng thì trang cũng không mở được (không cache).
- Đã vá ở phiên 2026-10-30 (nền móng cho hàng đợi):
  - `saveDraftKien` xác thực bằng access token.
  - Nhận `draftId` do client sinh: gửi lại cùng id thì trả `alreadySaved`, không tạo trùng.

## 2. Mô hình đề xuất: "Hàng đợi trên máy" đứng trước "Lưu tạm"

```
Quét → Form (dữ liệu tra cứu từ bộ nhớ tải sẵn) → [Lưu tạm]
  ├─ Có mạng  → gửi saveDraftKien(draftId) ngay → xong: "Đã lưu tạm" (như hiện nay)
  └─ Mất mạng → ghi mục vào IndexedDB, trạng thái "Chờ đồng bộ"
Có mạng lại (sự kiện `online` / nút "Đồng bộ ngay") → gửi tuần tự từng mục
  ├─ thành công / alreadySaved → xoá khỏi hàng đợi (nháp đã nằm trên server)
  └─ lỗi nghiệp vụ → mục "Lỗi" + lý do; người dùng sửa / xoá
"Gửi tất cả" chỉ bấm được khi CÓ MẠNG và hàng đợi TRỐNG.
```

- **Mục hàng đợi:**
  - `{ id (= draftId, UUID), factoryId, userId, ma_lo, kien, so_banh, boc, pallet[], chi_thi, ngan_id, ngay_sx, ca, ghi_chu, loai_csr, loai_banh, day_chuyen, is_new_lot, tham, scanned_at, status, error? }`
  - Lưu ở IndexedDB, 1 store riêng, khoá theo `factoryId + userId`.
  - Vì sao không dùng localStorage: giới hạn ~5MB, đồng bộ chặn luồng, và WebView có thể chặn.
- **Trạng thái mục:** `tren_may` → `cho_dong_bo` → `dang_gui` → (xoá) | `loi`.
- Server luôn là nơi quyết định cuối. Hàng đợi chỉ giữ dữ liệu, không thay thế các bước kiểm.

## 3. Dữ liệu tải sẵn khi mở ca (lúc có mạng)
- Danh sách lô/kiện dự đoán còn mở của các ngăn đang Chờ/Đang SX:
  - `lot_prediction_lots` + ngăn kế hoạch.
  - Kèm bành đã có thật / đang nháp tại thời điểm tải.
  - Server action mới `loadConfirmOfflinePack(factoryId)` trả 1 gói JSON.
- Ngăn đang hoạt động (`ma_ngan`, `ten_ngan`), tên ca theo ngày, trạng thái khoá ca của hôm nay.
- Hàm thuần đã có trên client: `getLoaiBanhConfig`, `getBocsForLoaiCSR`.
- Lưu gói vào IndexedDB, kèm giờ tải. Gói cũ hơn ~12 giờ thì hiện cảnh báo "Dữ liệu tra cứu đã cũ".
- Quét mã KHÔNG có trong gói lúc mất mạng:
  - Vẫn cho nhập, gắn nhãn "Chưa kiểm tra".
  - Ngăn phải chọn tay từ danh sách ngăn.
  - Server kiểm khi đồng bộ.
- Số bành còn lại hiển thị khi offline chỉ là **ước tính**, vì không thấy nháp của máy khác. Ghi rõ trên form.

## 4. Cache trang (giai đoạn B)
- Service worker kiểu network-first cho `/dashboard/product/confirm` và các chunk `/_next/static/*` mà trang này dùng.
- Tên cache gắn theo build id (`NEXT_PUBLIC_BUILD_ID` / `VERCEL_GIT_COMMIT_SHA`). Có mạng thì luôn lấy bản mới, tránh chạy code cũ sau khi deploy.
- Phiên đăng nhập: `erp_user` / `erp_factory` có sẵn trong localStorage nên mở offline vẫn biết người dùng.
- Khi đồng bộ: `getFreshAuthSession()` hết hạn thì giữ hàng đợi nguyên vẹn và bắt đăng nhập lại.

- **Đã code 2026-10-31 (chờ test tay)** — chi tiết + rủi ro: rule 06 mục 4.21.

## 5. Giao diện (giữ bố cục mobile riêng của màn quét, dùng thành phần chuẩn)
- **Thanh trạng thái mạng** dính đầu trang:
  - Đỏ: "Mất mạng — dữ liệu đang lưu trên máy (N kiện)".
  - Vàng: "Đang đồng bộ k/N".
  - Xanh: "Đã kết nối". Tự ẩn sau 3 giây.
- Thẻ **"Hàng đợi trên máy (N)"** đặt TRÊN thẻ "Đang chờ gửi" ở Hub:
  - Mỗi dòng có `StatusBadge` domain mới `confirm_queue`, thêm vào `doc-ui/status-registry.ts`:

    | Trạng thái | Tông | Nhãn |
    |---|---|---|
    | `tren_may` | draft | Trên máy |
    | `cho_dong_bo` | pending | Chờ đồng bộ |
    | `dang_gui` | info | Đang gửi |
    | `loi` | danger | Lỗi |

  - Dùng `RowAction` sửa / xoá; nút "Đồng bộ ngay".
- "Gửi tất cả" và "Kết thúc ca" bị khoá khi hàng đợi còn mục. Kèm lý do bằng chữ.
- Đăng xuất: cảnh báo nếu còn mục chưa đồng bộ. Thêm key IndexedDB vào danh sách xoá khi đăng xuất trong `src/lib/auth.ts`, chỉ xoá sau khi người dùng xác nhận.
- Song ngữ Việt/Khmer qua `confirm/i18n.ts`. Chữ Khmer cần người bản ngữ duyệt.

## 6. Rủi ro & quyết định cần chốt trước khi code
1. Nhiều máy cùng quét 1 kiện khi offline: server chặn vượt `max_per_kien`, mục thành "Lỗi". Chấp nhận được?
2. Ca bị phê duyệt (khoá) trong lúc máy offline: mục đồng bộ sau sẽ bị RPC Gửi chặn. Hiện `saveDraftKien` KHÔNG kiểm khoá ca — nên thêm kiểm khoá ca ngay khi lưu tạm.
3. Có cho phép nhập mã lô ngoài gói tải sẵn khi offline không? Đề xuất: có, gắn nhãn "Chưa kiểm tra".
4. Báo cáo "Kết thúc ca" khi còn hàng đợi: khoá cứng hay chỉ cảnh báo?

## 7. Lộ trình
- **GĐ-A** (không migration):
  - IndexedDB + hàng đợi + thanh trạng thái mạng + thẻ hàng đợi.
  - Gói tải sẵn `loadConfirmOfflinePack`.
  - Lưu tạm chạy qua hàng đợi.
  - Kiểm khoá ca trong `saveDraftKien`.
- **GĐ-B**: service worker cache trang theo build id; thử trên WebView Telegram / Zalo và Chrome Android.
- Test tay bắt buộc:
  - Bật chế độ máy bay → quét 3 kiện → tắt máy bay → tự đồng bộ.
  - Tải lại trang khi đang offline.
  - 2 máy cùng quét 1 kiện.
  - Ca bị khoá giữa chừng.

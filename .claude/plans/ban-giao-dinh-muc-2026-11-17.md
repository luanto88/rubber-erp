# Prompt bàn giao — Định mức KTKT + Kho vật tư (2026-11-17)

Dán nguyên khối dưới vào phiên mới:

```
Đọc CLAUDE.md, rule 30 (mục cuối "Xuất kho bù — lô ngoài hệ thống", "Chỉ số đồng hồ T1–T10/2026"), rule 13 mục
"Phiếu cũ tháng 1–7/2026", memory project_inventory_daily_reports.
Trạng thái: đã push main (production) 2026-11-17.
ĐÃ XONG (không làm lại):
- Chỉ số đồng hồ T1–T10/2026: đủ 165 lần ghi (script import-norm-meter-readings-m9.mjs chạy thử = "mới 0").
  Mẫu 09 khớp giấy: T5 điện 19.509; T9 điện 217.927; T10 điện 286.821 / nước 17.379 / nước thải 18.607.
  ĐHN-01 27/09 có thay đồng hồ (chốt 358.697, mới 0). Báo cáo test 56/BC-NMCB đã bị người dùng xoá.
- Xuất bù kho chuyển sang Cài đặt → Cấu hình nhà máy → "Thành phẩm" (2 bảng: Tồn thành phẩm đầu kỳ + Xuất bù kho),
  migration 20261128 đã chạy, test tay PASS. 3 dòng cũ (31/01, 28/02, 30/04 CSR10 Công ty) đã điền loại bành 35.
  Vẫn chỉ cộng Mẫu 8A mục 3, KHÔNG trừ tồn F12.
VIỆC CÒN TREO:
1) Kho rà soát tài liệu tháng 7 (Claude Docs https://claude.ai/artifact/PKwCdnC5TvJQzrn4fgWVd9, mục 4, 11 dòng —
   lần kiểm 2026-11-16 vẫn "Chưa xem"). Đọc lại doc; dòng nào kho chọn "Trùng phiếu app — cần loại" ⇒ thêm
   legacy_id vào EXCLUDE trong scripts/import-inventory-legacy-nxt.mjs, HỎI trước khi --apply.
2) Test tay còn lại: mở Mẫu 09 tháng 5 trên giao diện xem có ra 19.509 kWh; lập lại Mẫu 09 T9, T10 trên giao diện
   (số đã khớp bằng script, chưa xem trên UI); 8A các tháng có dòng điện/nước theo định mức.
3) Định mức GĐ2b: ghi chỉ số đồng hồ khi mất mạng (offline) — chưa làm, cần lên kế hoạch + hỏi trước.
4) 55-BC T10: mẫu VT HC có MOCN tick ở 2 cột — nhờ kho sửa mẫu qua UI (code đã chặn lưu mẫu trùng).
Ràng buộc: kiểm bằng npx tsc --noEmit + npx eslint <file> (không npm run build); không ghi/xoá DB khi chưa hỏi;
không sed/cat .env.local; không đụng cung_cap_dl/*.png đã xoá và thư mục chưa theo dõi; hỏi trước khi commit/push;
tiếng Việt có dấu; tóm tắt cuối phiên.
```

# Prompt bàn giao — Kho vật tư: báo cáo theo ngày + phiếu cũ T1–7 + định mức (2026-11-15)

Dán nguyên khối dưới vào phiên mới:

```
Đọc CLAUDE.md, rule 13 (các mục cuối: "Báo cáo sử dụng theo ngày", "Phiếu điều chỉnh tồn", "Tab Nhập / Xuất / Chuyển — lọc
ngày", "Phiếu cũ tháng 1–7/2026 …"), rule 30 (mục "Xuất kho cũ (tháng 1–7/2026) trong đối soát"), memory
project_inventory_daily_reports, plan .claude/plans/kho-du-lieu-cu-thang-1-7.md.
Trạng thái: đã push main (production) 2026-11-15. Migration 20261125 + 20261126 ĐÃ CHẠY; import lịch sử 771 dòng ĐÃ CHẠY
(EXCLUDE 1 dòng DO750K "Lần 24"). Test tay PASS: lọc ngày tab Xuất, nhãn/nút Điều chỉnh tồn, báo cáo theo ngày, mã mẫu
12C trên QR, người lập = mọi NV NMCB, ký 2 bước, Định mức T7 không còn X-…-240726, chặn vật tư trùng 2 cột mẫu.
Việc còn treo:
1) Nhận kết quả test tay phiếu cũ: tab Xuất/Nhập lọc 01/03–31/03 (chỉ phiếu cũ), 20/07–05/08 (trộn), Loại phiếu = Phiếu cũ,
   lọc kho KA/KDDX, vật tư DO750K, tìm mã NX; con mắt mở chi tiết read-only; Định mức tháng 7 có dòng "Phiếu cũ" khoá tick.
2) Tài liệu rà soát cho kho: https://claude.ai/artifact/PKwCdnC5TvJQzrn4fgWVd9 (Claude Docs). Đọc cột "Kết luận" mục 4: dòng
   "Trùng phiếu app — cần loại" ⇒ thêm legacy_id vào EXCLUDE trong scripts/import-inventory-legacy-nxt.mjs, HỎI trước khi
   chạy --apply. Mục 3: phiếu "Là sử dụng thật" ⇒ người dùng tự bỏ nhãn bằng nút cân.
3) Mẫu BC-VTHC: kiểm MOCN chỉ còn ở 1 cột (55-BC T10 phải = 3.801).
4) Sản lượng cho đối soát định mức T1–7: DB thiếu TP T5 (0 giao dịch), T6 (88), NL Sản lượng T3–T4 (0), Km điều xe T3–T4 (0);
   kiểm kê tồn xưởng / đồng hồ gần như chưa có. Hỏi người dùng nguồn bổ sung (nhập ở module Thành phẩm / Sản lượng, hay
   số tổng tháng trên 8A giấy) trước khi làm.
Ràng buộc: kiểm bằng npx tsc --noEmit + npx eslint <file> (không npm run build); không ghi/xoá DB khi chưa hỏi; không
sed/cat .env.local; không đụng cung_cap_dl/*.png đã xoá và thư mục chưa theo dõi; hỏi trước khi commit/push; tiếng Việt có
dấu; tóm tắt cuối phiên.
```

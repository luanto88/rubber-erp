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
1) (XONG) Test tay phiếu cũ tab Nhập/Xuất + Định mức T7: 8/8 PASS 2026-11-15.
2) Tài liệu rà soát cho kho: https://claude.ai/artifact/PKwCdnC5TvJQzrn4fgWVd9 (Claude Docs). Đọc cột "Kết luận" mục 4: dòng
   "Trùng phiếu app — cần loại" ⇒ thêm legacy_id vào EXCLUDE trong scripts/import-inventory-legacy-nxt.mjs, HỎI trước khi
   chạy --apply. Mục 3: phiếu "Là sử dụng thật" ⇒ người dùng tự bỏ nhãn bằng nút cân.
3) (XONG) Mẫu BC-VTHC đã sửa MOCN, test PASS.
4) (XONG) Sản lượng T1–7: TP T5 = 0, T6 ít, NL + km T3–T4 = 0 là ĐÚNG THỰC TẾ (T3–T4 không thu gom nguyên liệu, T5 bắt
   đầu thu gom, T6 mới sản xuất lại) — không cần bổ sung; đối soát định mức T1–7 dùng được ngay.
5) (XONG 2026-11-16, đã push) Xuất kho bù 8A — xem .claude/plans/ban-giao-dinh-muc-2026-11-16.md. Lịch sử: Người dùng chạy migration
   20261127_tech_norm_export_extra.sql ⇒ nhập 3 dòng CSR10 Công ty: T1 1.527,120 / T2 243,600 / T4 114,905 tấn (hỏi trước nếu
   tự chèn) ⇒ 8A T1 mục 3 = 1.527,120, T10 vẫn 814,800. TP chế biến dùng số app (không đối chiếu giấy).
Ràng buộc: kiểm bằng npx tsc --noEmit + npx eslint <file> (không npm run build); không ghi/xoá DB khi chưa hỏi; không
sed/cat .env.local; không đụng cung_cap_dl/*.png đã xoá và thư mục chưa theo dõi; hỏi trước khi commit/push; tiếng Việt có
dấu; tóm tắt cuối phiên.
```

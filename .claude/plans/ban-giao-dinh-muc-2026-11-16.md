# Prompt bàn giao — Định mức KTKT: xuất kho bù 8A + chỉ số đồng hồ T1–T10 (2026-11-16)

Dán nguyên khối dưới vào phiên mới:

```
Đọc CLAUDE.md, rule 30 (các mục cuối: "Xuất kho bù — lô ngoài hệ thống", "Chỉ số đồng hồ T1–T10/2026 nhập từ file M9"),
rule 13 mục cuối, memory project_inventory_daily_reports.
Trạng thái: đã push main (production) 2026-11-16.
- Xuất kho bù 8A (bảng tech_norm_export_extra, migration 20261127 ĐÃ CHẠY): 3 dòng CSR10 Công ty T1 1.527,120 / T2 243,600 /
  T4 114,905 tấn đã nhập, test PASS. Mục 3 8A T1–T10 khớp bảng II cung_cap_dl/du_lieu_cu/tp_xk.png. TP chế biến (mục 2) dùng
  số app, KHÔNG đối chiếu giấy (người dùng chốt).
- Chỉ số đồng hồ: scripts/import-norm-meter-readings-m9.mjs đã --apply: 133 lần ghi (15 đồng hồ, mốc 27/12/2025→27/08/2026
  + ĐH-01 27/09, 27/10). ĐHN-01 thay đồng hồ 27/09/2026 (chốt 358.697, mới 0).
Việc còn treo:
1) 28 lần ghi ngày 27/09 + 27/10/2026 BỊ KHOÁ: báo cáo Mẫu 09 số 56/BC-NMCB (kỳ đồng hồ 27/09→27/10, batch tháng 10, cùng
   batch với 8A 57/BC-NMCB "nhap" có giải trình "Test_…") đang Chờ ký. HỎI người dùng: trả về / huỷ báo cáo 56 (qua UI, không
   tự sửa DB luồng ký) ⇒ chạy `node --env-file=.env.local scripts/import-norm-meter-readings-m9.mjs` (chạy thử phải báo
   "mới 28") ⇒ `--apply` ⇒ chạy thử lại phải "mới 0, giữ nguyên 165" ⇒ lập lại Mẫu 09 T9 (27/08→27/09) và T10 (27/09→27/10),
   so tổng điện T9 217.927 kWh / T10 286.821 kWh, nước T10 17.379 m3, nước thải T10 18.607 m3 (file M9 + PDF T09/T10 trong
   cung_cap_dl/du_lieu_cu).
2) Test tay sau bước 1: Định mức → Nhập liệu → Chỉ số đồng hồ: ĐHN-01 có lần ghi 27/09 tick "Thay đồng hồ"; Mẫu 09 T5
   (27/04→27/05) tổng 19.509 kWh khớp PDF T05-2026; 8A các tháng có dòng điện/nước theo định mức.
3) Kho rà soát tài liệu tháng 7: https://claude.ai/artifact/PKwCdnC5TvJQzrn4fgWVd9 — dòng "Trùng phiếu app — cần loại"
   ⇒ thêm legacy_id vào EXCLUDE trong scripts/import-inventory-legacy-nxt.mjs, HỎI trước khi --apply.
Ràng buộc: kiểm bằng npx tsc --noEmit + npx eslint <file> (không npm run build); không ghi/xoá DB khi chưa hỏi; không
sed/cat .env.local; không đụng cung_cap_dl/*.png đã xoá và thư mục chưa theo dõi; hỏi trước khi commit/push; tiếng Việt có
dấu; tóm tắt cuối phiên.
```

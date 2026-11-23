# Bàn giao Chấm công C2b / C3 (viết 2026-11-20, sau khi code C2)

## Prompt phiên sau
```
Đọc CLAUDE.md, rule 29, rule 31 (mục GĐ C2) và .claude/plans/cham-cong-2026-11-19.md (mục 8, 10).
Trạng thái: C2 "Điểm danh ca" đã code 2026-11-20 — migration 20261205_attendance_c2_shift_sheets.sql
[đã chạy / CHƯA chạy — kiểm], test tay [PASS / còn lỗi gì]. Nếu còn lỗi C2 thì sửa trước.
Bắt đầu C2b "Truy vết":
- "Kết thúc ca" ở /dashboard/product/confirm ghi attendance_sheet_sections.ket_thuc_luc cho phần Ca sản xuất đang
  mở của (ngày SX, ca) — RPC mới, best-effort (lỗi không chặn kết thúc ca); phần đã duyệt vẫn ghi được giờ kết thúc?
  (hỏi tôi).
- Chi tiết lô /dashboard/product/lot/[id]: khối "Nhân sự ca sản xuất" theo lot_transactions.ngay_nhap + ca → phần ca
  (người, công việc, xe, A/B).
- Lịch công: tô / khoá ô đã duyệt từ phiếu ca (sheet_line_id), hộp chấm báo trước thay vì để RPC từ chối.
Sau đó C3 "Có mặt tự động cho nhân viên" (kế hoạch mục 5): gom hoạt động app → nguồn auto_app; chấm D → cham_diem_d;
không đè truc_ca / bo_sung_tay; cờ mâu thuẫn. Lên plan cho tôi duyệt trước khi code.
Chỉ npx tsc --noEmit + npx eslint, không npm run build. Hỏi tôi trước khi commit/push.
Việc treo KHÔNG làm khi tôi chưa nhắc: rà soát Đề nghị mua ↔ Biên bản (rule 28 mục cuối).
```

## Ghi chú kỹ thuật C2 cần biết
- Ghi qua RPC SECURITY DEFINER; bảng phiếu chỉ có policy SELECT.
- `attendance_review_sections` gộp MỌI dòng đã duyệt cùng (người, ngày) qua mọi phiếu / phần ⇒ duyệt phần sau có thể đổi
  ngày công đã ghi từ phần trước (vd thêm B) — đúng quy tắc Q4.
- Màn trực ca chỉ online; lỗi mạng giữ dữ liệu trên màn hình.
- Chữ Khmer màn điểm danh do máy dịch — chờ chuyên gia (file cung_cap_dl/dich_khmer_cham_cong.xlsx, sheet "Màn điểm danh").

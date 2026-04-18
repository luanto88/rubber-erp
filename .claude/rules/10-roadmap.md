---
description: Roadmap phát triển — đọc khi lên kế hoạch tính năng mới hoặc cần biết thứ tự ưu tiên
---

# Roadmap

## Phase A — Fix & Polish (Hiện tại)

- [ ] Redirect đúng route sau khi login
- [ ] Copyright footer
- [ ] Browser compatibility (Chrome, Edge, Safari)
- [ ] Responsive mobile cơ bản
- [ ] Kiểm tra lỗi TypeScript còn sót

## Phase B — Nâng cấp Dashboard

- [ ] Biểu đồ sản lượng theo tháng (line chart)
- [ ] Biểu đồ KL khô theo loại CSR (bar chart)
- [ ] Biểu đồ tỷ lệ đạt kiểm nghiệm (donut chart)
- [ ] Responsive mobile đầy đủ
- [ ] Dark mode

## Phase C — Tính năng mới

- [ ] **Excel import/export** — import lô thành phẩm, xuất báo cáo
- [ ] **GeoJSON map** — hiển thị 416 lô vườn trên bản đồ (12 đội)
  - Fix lô V6T đang ở Đội 0 → sửa thành Đội 11
  - Kiểm 28 lô có tọa độ center nằm ngoài polygon
- [ ] **Báo cáo tổng hợp** — PDF, in ấn
- [ ] **EUDR module** — truy xuất nguồn gốc cho khách hàng
- [ ] **Bảo trì** — module lịch bảo trì máy móc
- [ ] **Quản lý kho** — nhập/xuất vật tư

## Ghi chú kỹ thuật

### GeoJSON
- Coordinate order trong code: `[lat, lon]` (dạng chuỗi trong field `pg`)
- GeoJSON chuẩn dùng `[lon, lat]`
- 416 lô vườn, 12 đội (Đội 1–12), ~7,664 hectares tổng

### Excel schema
- Header row 1: field key
- Header row 2: mô tả tiếng Việt
- Không dùng single-row với description trong ngoặc (breaks JSON key parsing)

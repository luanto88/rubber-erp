# Kế hoạch: Xoá modal đặt vị trí cũ (ISO) + Đồng bộ giao diện toàn app theo chuẩn Văn bản/ISO

## Context
- Màn "Cài đặt vị trí ký" đã vá xong và người dùng đã test ổn (thẻ hồ sơ tải nhanh, có hộp 3 lựa
  chọn khi đổi khung). Người dùng đồng ý **xoá modal đặt vị trí cũ** ở `iso/documents/[id]`.
- Các module ngoài Văn bản/ISO hiển thị rất rối: mỗi trang danh sách một kiểu bảng, một kiểu nút,
  cùng một icon mang nghĩa khác nhau (Bảo trì: con mắt = xem PDF đã ký, icon file = in biên bản;
  Kho vật tư: con mắt = mở form SỬA phiếu nháp…). Ảnh tham khảo: `cung_cap_dl/UIUX/module_con_lai/*`.
- Mục tiêu: một bộ quy chuẩn duy nhất (màu, font, bảng, icon, trạng thái, tab, bộ lọc, thẻ số liệu)
  lấy từ bộ `doc-ui` của Văn bản/ISO, áp dần cho từng module qua nhiều phiên.
- Người dùng không thấy kế hoạch cũ ⇒ **bước đầu tiên của phiên thực thi là chép kế hoạch này vào
  repo**: `.claude/plans/ke-hoach-dong-bo-ui-toan-app.md` + 1 dòng trỏ tới trong `CLAUDE.md`.

Quyết định đã chốt với người dùng:
1. Con mắt = **xem chi tiết**. File đã ký và PDF chưa ký dùng icon riêng.
2. Thứ tự: nhóm có ký số trước — Bảo trì → Điều xe → Kiểm nghiệm → Đề nghị mua → Kho vật tư →
   Xuất hàng → Thành phẩm / Sản lượng / Kho nguyên liệu.
3. ~~Giữ màu banner, còn lại brand~~ → **đổi 2026-10-14 sang phương án C "lai"**: banner giữ màu +
   hoa văn module; ĐIỀU HƯỚNG (tab, focus, icon thẻ số liệu, viền nhóm ngày) theo màu module qua
   `mod-*`; HÀNH ĐỘNG (nút chính, Ký ngay, link mã) luôn brand; trạng thái theo tông nghĩa.
4. Font **Plus Jakarta Sans cho toàn app một lần** ở giai đoạn nền tảng; mã số dùng JetBrains Mono.

---

## VIỆC 1 — Xoá modal đặt vị trí cũ ở `src/app/dashboard/iso/documents/[id]/page.tsx` — ✅ ĐÃ XONG 2026-10-13 (chờ test tay)

Đã xác minh là code chết: `openSignStep()` (dòng ~2371) và nút "Ký & Gửi xem xét" (dòng ~4213) đều
mở `IsoBatchSignModal` khi `buildSignFileQueue()` có file PDF; chỉ khi KHÔNG có PDF mới mở hộp PIN
⇒ trong `handlePinConfirm` (dòng ~2827) nhánh `signQueue.length > 0` và `fallbackTask` (file gốc là
PDF) không bao giờ đúng (file gốc PDF luôn nằm trong hàng đợi).

Xoá:
- Trong `handlePinConfirm`: 2 nhánh mở placement → gọi thẳng `doTransition(action, token, null)`.
- State `placementModal` (~536) và mọi `setPlacementModal`; effect nạp PDF/thumbnail của modal
  (~978-1060); `placementDocIsCon` (~1146); `openPlacementForTask` (~2556); `handlePlacementConfirm`
  (~2887); `handlePageChange` (~3050); khối JSX `{placementModal?.show && (…)}` (~5582-6240).
- Import/type/helper chỉ còn modal dùng (vd `SignWorkspaceShell`, `SignRail`, `Draggable`,
  `Resizable`, `computeSnugBoxSize`, `SignFileTask` nếu không còn ai dùng) — kiểm bằng `tsc`/`eslint`
  sau khi xoá, không đoán.
- Giữ nguyên: `buildSignFileQueue`, `IsoBatchSignModal`, `PinDialog`, `doTransition`, `signAs`.
- Cập nhật `.claude/rules/05-ui-components.md` + `16-iso-vanban-module.md`: modal cũ đã xoá.

Kiểm tra: `npx tsc --noEmit` + `npx eslint` file (so `git stash` trước/sau, không thêm lỗi). Test tay:
soạn thảo / xem xét / phê duyệt 1 bộ có PDF (màn ký tập trung), 1 bộ chỉ DOCX (hộp PIN), Trả về.

---

## VIỆC 2 — Bộ quy chuẩn giao diện (Design system) — nguồn: `doc-ui` của Văn bản/ISO

### 2.1 Màu
| Mục | Quy chuẩn |
|---|---|
| Màu chính (nút chính, tab đang chọn, link, focus, viền chọn) | thang `brand-50…900` (`globals.css`, 600 = `#2f5d52`, 800 = `#1c3a32`). Thay dần `emerald-*` dùng làm màu chính |
| Banner đầu trang | `PageHeaderBanner` giữ **theme riêng từng module** (ocean, mint, slate, amber, teal, forest…) |
| Trạng thái | CHỈ qua `StatusBadge` + `status-registry.ts`: valid xanh lá · pending amber (chấm nhấp nháy) · draft xám · danger đỏ · returned hồng · info xanh dương |
| Hành động nguy hiểm | tone `danger` của `IconAction` (một sắc đỏ duy nhất, bỏ `red-400/red-600` lẻ tẻ) |
| Nền trang / thẻ | `bg-app-bg`; thẻ `bg-white rounded-xl border border-slate-200 shadow-sm` |

### 2.2 Font
- `font-doc` (Plus Jakarta Sans) cho toàn bộ dashboard — chuyển từ `documents-shell`/`iso-shell` lên
  `src/app/dashboard/layout.tsx` (vùng nội dung) một lần.
- `font-code` (JetBrains Mono) cho mọi mã: mã phiếu, mã lô, mã biên bản, mã đơn — qua `DocCodePill`.
- Cỡ chữ bảng 13.5px (`enterprise-table`); tiêu đề trang theo `PageHeaderBanner`; số liệu thẻ
  `text-2xl font-bold`.

### 2.3 Bảng danh sách
- Mọi bảng: `ResponsiveTableWrapper` + `<table className="enterprise-table">` (header chữ hoa nhỏ,
  hover `#eef5f2`). Cột thao tác luôn ở **cuối, canh phải**, dùng `IconActionGroup`.
- Bấm vào mã (hoặc cả dòng) mở chi tiết; không gắn `onClick` lên từng ô riêng lẻ.
- Danh sách nhóm theo ngày (Kiểm nghiệm, Thành phẩm, Sản lượng): component mới `DateGroupCard`
  (header ngày + số liệu tóm tắt + `IconActionGroup`, thân là `enterprise-table`).
- Trạng thái rỗng / đang tải / lỗi thống nhất: "Đang tải…" · "Không có dữ liệu phù hợp" ·
  "Không tải được dữ liệu — Thử lại".

### 2.4 Từ điển icon thao tác (một icon = một nghĩa, toàn app)
| Hành động | Icon (lucide) | Tone | Quy tắc |
|---|---|---|---|
| Xem chi tiết | `Eye` | neutral | Luôn mở trang/khung chi tiết |
| Xem file đã ký | `FileCheck2` | brand | Mở tab mới; ẩn khi chưa có file ký |
| Tải file đã ký | `Download` | sky | Qua `buildStorageDownloadUrl`/`openSecureFile`; không có file ⇒ ẩn |
| PDF chưa ký / bản nháp | `FileText` | neutral | Tải hoặc mở bản dựng chưa ký |
| In (mở trang `/print`) | `Printer` | neutral | Không gọi là "Tải" |
| Sửa | `Pencil` | amber | Bỏ `Edit2` |
| Xoá | `Trash2` | danger | Xoá hàng loạt: nút có chữ "Chọn để xoá" |
| Nhân bản | `Copy` | neutral | |
| Duyệt / Huỷ phiếu | `CircleCheck` / `Ban` | brand / danger | Là hành động chính ⇒ nút có chữ |
| Thêm vào nhóm | `Plus` | brand | |
| Ký ngay (tới lượt mình) | nút CTA gradient "Ký ngay" | — | Đứng đầu nhóm, như Văn bản |
| Mở rộng / thu gọn | `ChevronDown/Right` | — | Chỉ là chỉ báo, không mở chi tiết |
| Riêng module | `QrCode` tra cứu · `Map` GeoJSON · `Image` ảnh gửi tài xế · `RefreshCw` đồng bộ · `Lock/ShieldCheck` khoá ca · `Share2` phân phối | neutral | |

Thứ tự cố định: [Ký ngay] → Xem chi tiết → File đã ký → Tải → PDF nháp/In → riêng module → Sửa →
Nhân bản → Xoá. Mọi nút: ô 32px, icon 16px, xám khi nghỉ, đổi màu theo tone khi rê chuột, luôn có
`aria-label` + `title` (đã sẵn trong `IconAction`).

### 2.5 Thành phần dùng chung khác
- Tab: chỉ dùng `SegmentedTabs` (thay 7 kiểu tab tự chế, kể cả `MaintenanceShell`, tab 2 cấp kho).
- Bộ lọc: `FilterBar layout="grid"` + `FilterMultiSelect fullWidth`; ngày mặc định đầu tháng → hôm nay
  (`getFactoryTodayISO`); nút "Xoá lọc" + đếm bộ lọc đang bật.
- Thẻ số liệu: component mới `StatCard` / `StatGrid` (icon trái + nhãn chữ hoa nhỏ + số `text-2xl`,
  lưới 2 → 3 → 4/5 cột, thay 2 kiểu đang có và `grid-cols-5` không responsive).
- Badge ký số: gộp `QualitySignStatusBadge`, `DispatchSignStatusBadge`, `MaintenanceSignStatusBadge`
  thành `SignStatusBadge` dùng chung (chip bằng `StatusBadge`; giữ nguyên `computeMyTurn`,
  `hasAnySigned`, luồng huỷ/trả về).
- Trang chi tiết (khi module có): `DetailPageHeader`, `InspectorCard`, `MetaRow`, `TimelineSteps`.

---

## VIỆC 3 — Lộ trình giai đoạn (mỗi giai đoạn 1 phiên, dừng cho người dùng test)

**U0 — Nền tảng (không đổi bố cục module nào)** — ✅ ĐÃ XONG 2026-10-14 (chờ test tay). Chi tiết:
`.claude/rules/05-ui-components.md` mục "Quy chuẩn giao diện toàn app — U0". Thêm ngoài kế hoạch:
`ModuleThemeScope` (phương án C), tông `warn`, `ListState`, `enterprise-table dense`.
- `doc-ui/action-registry.ts` + `RowAction kind="view|signed|download|draft|print|edit|delete|copy|approve|cancel"` bọc `IconAction` theo từ điển 2.4.
- `status-registry.ts`: thêm domain `maintenance`, `dispatch`, `quality`, `purchase`, `inventory`,
  `export`, `lot`, `storage` — map từ `PURCHASE_STATUS_CLASS`, `getExportOrderStatusClasses`,
  `getLotStatusBadgeClass`, `STATUS_BADGE` (kho), `ENTRY_PROGRESS_UI`, `badgeClass()` (kho NL).
- `StatCard`/`StatGrid`, `DateGroupCard`, `SignStatusBadge` dùng chung.
- Font `font-doc` toàn dashboard; kiểm tra nhanh bảng dày (Thành phẩm, Điều xe) không vỡ cột.
- Trang mẫu tĩnh `cung_cap_dl/UIUX/chuan-ui.html` minh hoạ bảng + từ điển icon để duyệt trước.

**U1 — Bảo trì** — ✅ ĐÃ XONG 2026-10-14 (chờ test tay; thêm quy tắc "dòng có chi tiết con", xem rule 05) (Tổng quan, Biên bản, Lý lịch): bọc `ModuleThemeScope theme="slate"`; mã → chi tiết; `Eye` chi tiết, `FileCheck2` file
ký, `FileText` in chưa ký; thêm cột trạng thái biên bản (`StatusBadge`); `MaintenanceShell` →
`SegmentedTabs`; trang Biên bản thêm `PageHeaderBanner`; KPI → `StatGrid`.

**U1 (bổ sung 2026-10-14, sau test)** — ✅ code xong, chờ test tay: trang Lý lịch có banner slate +
2 nút "Báo cáo theo kỳ (F07)" (ghost, quyền `maintenance.print`) và "In lý lịch" (solid);
`BannerAction` dùng chung (`maintenance/_components/banner-action.tsx`, cũng áp cho trang Biên bản);
bộ lọc Lý lịch `FilterBar layout="grid"`, mọi ô cao 40px, ô "Tìm nội dung, mã biên bản" lên đầu +
nút **Quét QR** biên bản đã in (chọn đúng thiết bị/xe của biên bản, lọc theo mã, xoá Từ/Đến ngày;
biên bản chưa duyệt ⇒ báo vàng + link "Mở biên bản"); chip thiết bị đã chọn ra ngoài bộ lọc.
Sau test: bỏ F07 ở trang Biên bản; vá màn lỗi khi Quét QR (`qr-scanner.tsx`, xem rule 05).

**U1b — Trang chi tiết biên bản — ✅ CODE XONG 2026-10-14 (chờ test tay, xem rule 05). Mockup: `cung_cap_dl/UIUX/u1b-chi-tiet-bien-ban.html/.png`**: trang mà con mắt
mở ra phải cùng ngôn ngữ với Văn bản/ISO.
- Chế độ XEM (biên bản đã lưu, không sửa): `DetailPageHeader` (mã `DocCodePill`, nút Xem/Tải file ký,
  `HeaderQr` thay QR compact hiện có) + `DetailSplitLayout` 70/30: cột trái = khung xem PDF nhúng
  (`DocViewer`, file ký nếu có, chưa có ⇒ bản dựng chưa ký) hoặc nội dung biên bản; cột phải =
  `StatusSummaryBar` (trạng thái biên bản + ký) → `SignActionBox` (Gửi ký duyệt / Phê duyệt / Hủy phê
  duyệt / In) → `TimelineSteps` người ký (NV phụ trách → BGĐ phụ trách → Giám đốc).
- Ô ký: `MaintenanceSignStatusBadge` → `SignStatusBadge` (giữ `blockedReason` kho tạm KT); sau đó XOÁ
  `maintenance-sign-status.tsx` cũ (chỉ còn trang này dùng).
- Chế độ TẠO/SỬA giữ bố cục form hiện tại, chỉ đổi màu điều hướng `mod-*`, nút chính brand, `Edit2` → `Pencil`.
- Giữ nguyên: dirty-tracking nút Lưu, `effectiveIsNew/effectiveId`, banner KPI, khối KT, quyền
  `isCreator/isAdmin/isReadOnly`, luồng phê duyệt + xuất kho.
- Cần duyệt ảnh trước–sau như U1 trước khi code.

**U2 — Điều xe (danh sách)** — ✅ CODE XONG 2026-10-14 (chờ test tay): bỏ `onClick` từng ô; `ChevronRight` → `Eye`; `Edit2` → `Pencil`; tiến độ →
`StatusBadge`; tab → `SegmentedTabs`; cột ký → `SignStatusBadge`.

**U3 — Kiểm nghiệm**: `DateGroupCard`; header ngày: Plus, Pencil, "Chọn để xoá", FileCheck2, Download,
FileText; tab "Giám sát KN" đổi icon `Activity` (không trùng `Eye`).

**U4 — Đề nghị mua**: chuẩn cột thao tác, `StatusBadge` domain `purchase`, tab → `SegmentedTabs`.

**U5 — Kho vật tư**: `Eye` = xem chi tiết; phiếu nháp thêm `Pencil` "Sửa phiếu" riêng; nút tròn
trong dòng → `IconAction`; tab 2 cấp → `SegmentedTabs`; giữ banner amber.

**U6 — Xuất hàng**: Duyệt/Sửa/Xoá theo bộ chuẩn; "Tải PDF biên bản" dùng `FileText` (bỏ `Printer`);
dòng mở rộng giữ, thêm `Eye`.

**U7 — Thành phẩm, Sản lượng, Kho nguyên liệu**: `DateGroupCard`; `FileDown` → `FileText`; KPI →
`StatGrid`; thẻ ngăn giữ dạng card nhưng hàng icon theo chuẩn và **luôn hiện** (bỏ ẩn khi không rê chuột).

**U8 — Dọn dẹp & tài liệu**: xoá class/hàm màu cũ không còn dùng; mục "Quy chuẩn giao diện" trong
`.claude/rules/05-ui-components.md`; script `scripts/ui-lint.mjs` (grep) báo `Edit2`, `text-red-400`,
`<button title=` thiếu `aria-label`, pill trạng thái tự viết trong `src/app/dashboard`.

### Backlog (người dùng ghi nhận 2026-10-14)
- Danh sách Bảo trì: khoá/báo thiếu kho tạm KT theo TỪNG DÒNG (hiện chỉ banner đầu trang + trang chi tiết).
- Thẻ "Biên bản gần đây" (Tổng quan Bảo trì) luôn = 8 → đổi thành chỉ số hữu ích (vd "Từ chối / Cần chỉnh sửa" trong tháng).
- ✅ `DateGroupCard` → `DateGroupRow` (2026-10-14); ISO/Văn bản đưa mũi tên về cuối dòng.
- Trang Biên bản: cân nhắc thêm Quét QR vào ô tìm (hiện chỉ Lý lịch có).

### Gợi ý thêm (người dùng chọn đưa vào giai đoạn nào)
1. Bấm cả dòng mở chi tiết (trừ khi bấm vào nút), con trỏ tay + hover.
2. Mobile: cột thao tác > 3 nút gập vào menu "⋯" (bottom-sheet).
3. Dòng chip đếm theo trạng thái trên mỗi danh sách (`StatusSummaryBar`), bấm chip để lọc.
4. Mốc thời gian tương đối ("2 giờ trước") kèm tooltip ngày giờ đầy đủ.
5. Nút hành động chính của trang luôn ở banner, góc phải, một nút đặc + các nút phụ viền trong suốt.
6. Thông báo (toast) một kiểu duy nhất góc trên giữa, tự ẩn 4 giây.

---

## Cách làm & kiểm tra mỗi giai đoạn
- Chỉ đổi trình bày; giữ nguyên quyền, truy vấn, hành vi nghiệp vụ.
- Trước khi code: ảnh/HTML tham chiếu trước–sau cho người dùng duyệt (riêng U0 bắt buộc).
- `npx tsc --noEmit` + `npx eslint` các file đã sửa, so `git stash` để không thêm lỗi; không `npm run build`.
- Test tay trên localhost từng module: mọi icon đúng nghĩa trong từ điển, quyền ẩn/hiện như cũ,
  mobile ≤430px không tràn ngang.

### Sửa sau test U1b/U2 (2026-10-14)
Xem file ký đúng tên (route token `/api/files/view`), bỏ "In bản chưa ký" khi đã ký, Điều xe dùng
ExpandableRow. Backlog: Biên bản Bảo trì xổ thiết bị; Văn bản/ISO dùng `?view=1`. Chi tiết rule 05.

### Chuẩn hoá rule 29 (2026-10-14)
Tạo `.claude/rules/29-ui-standard.md` (nguồn duy nhất). Điều xe: trang chi tiết 70/30 + PDF nhúng,
hộp xoá/modal ký dùng chung danh sách + chi tiết. Bảo trì: danh sách Biên bản xổ thiết bị.
Tiếp theo: U3 Kiểm nghiệm theo đủ checklist rule 29.

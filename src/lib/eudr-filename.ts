// Module cực nhẹ (không phụ thuộc jsPDF/jszip) — an toàn để import tĩnh ở bất kỳ đâu mà
// không kéo theo bundle nặng của dashboard/eudr/dds-generator.ts.
//
// Mã đơn (export_orders.ma_don) luôn có dạng "...-ddmmyy/N" (dấu "/" phân cách số thứ tự
// trong ngày, xem export/page.tsx dòng tạo ma_don) và so_thong_bao (nhập tay) cũng có thể
// chứa "/". Nếu dùng thẳng ma_don để đặt tên file (PDF/GeoJSON/ZIP tải về) hoặc tên entry
// bên trong ZIP, trình duyệt/JSZip hiểu "/" là dấu phân cách thư mục — Chrome tự tạo thư
// mục con trong Downloads theo tên file tải về, và JSZip tạo thư mục con bên trong chính
// file .zip khi giải nén. Dùng hàm này ở MỌI nơi ma_don được ghép vào tên file thật —
// KHÔNG áp dụng cho chỗ chỉ hiển thị mã đơn làm nhãn/tiêu đề (đó vẫn phải giữ nguyên).
export function sanitizeOrderCodeForFile(code: string): string {
  return code.replace(/[\\/:*?"<>|]/g, "-")
}

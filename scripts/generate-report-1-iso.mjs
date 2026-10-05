import fs from "fs";
import path from "path";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  PageBreak,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
  ShadingType,
} from "docx";

const FONT_NAME = "Times New Roman";
const SIZE_BODY = 26; // 13pt
const SIZE_H1 = 28; // 14pt bold
const SIZE_H2 = 27; // 13.5pt bold
const SIZE_H3 = 26; // 13pt bold italic
const LINE_SPACING = 276; // 1.15 line spacing (240 * 1.15)
const SPACE_AFTER_PARA = 120; // 6pt after paragraph

function createPara(text, options = {}) {
  const {
    bold = false,
    italics = false,
    alignment = AlignmentType.JUSTIFIED,
    size = SIZE_BODY,
    spaceBefore = 0,
    spaceAfter = SPACE_AFTER_PARA,
    indent = 0,
    underline = false,
    color,
  } = options;

  return new Paragraph({
    alignment,
    spacing: {
      line: LINE_SPACING,
      before: spaceBefore,
      after: spaceAfter,
    },
    indent: indent ? { firstLine: indent } : undefined,
    children: [
      new TextRun({
        text,
        font: FONT_NAME,
        size,
        bold,
        italics,
        underline: underline ? {} : undefined,
        color,
      }),
    ],
  });
}

function createRunsPara(runs, options = {}) {
  const {
    alignment = AlignmentType.JUSTIFIED,
    spaceBefore = 0,
    spaceAfter = SPACE_AFTER_PARA,
    indent = 0,
  } = options;

  return new Paragraph({
    alignment,
    spacing: {
      line: LINE_SPACING,
      before: spaceBefore,
      after: spaceAfter,
    },
    indent: indent ? { firstLine: indent } : undefined,
    children: runs.map(
      (r) =>
        new TextRun({
          text: r.text,
          font: FONT_NAME,
          size: r.size || SIZE_BODY,
          bold: r.bold || false,
          italics: r.italics || false,
          underline: r.underline ? {} : undefined,
          color: r.color,
        })
    ),
  });
}

function createHeading1(text) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: {
      line: LINE_SPACING,
      before: 240,
      after: 120,
    },
    children: [
      new TextRun({
        text,
        font: FONT_NAME,
        size: SIZE_H1,
        bold: true,
      }),
    ],
  });
}

function createHeading2(text) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: {
      line: LINE_SPACING,
      before: 180,
      after: 100,
    },
    children: [
      new TextRun({
        text,
        font: FONT_NAME,
        size: SIZE_H2,
        bold: true,
      }),
    ],
  });
}

function createHeading3(text) {
  return new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: {
      line: LINE_SPACING,
      before: 140,
      after: 80,
    },
    children: [
      new TextRun({
        text,
        font: FONT_NAME,
        size: SIZE_H3,
        bold: true,
        italics: true,
      }),
    ],
  });
}

function createCell(content, options = {}) {
  const {
    bold = false,
    italics = false,
    alignment = AlignmentType.LEFT,
    shadingColor,
    widthPercent,
    size = 24, // 12pt in table
  } = options;

  let paras = [];
  if (Array.isArray(content)) {
    paras = content;
  } else {
    paras = [
      new Paragraph({
        alignment,
        spacing: { line: 240, before: 40, after: 40 },
        children: [
          new TextRun({
            text: String(content),
            font: FONT_NAME,
            size,
            bold,
            italics,
          }),
        ],
      }),
    ];
  }

  return new TableCell({
    width: widthPercent ? { size: widthPercent, type: WidthType.PERCENTAGE } : undefined,
    shading: shadingColor
      ? { fill: shadingColor, type: ShadingType.CLEAR, color: "auto" }
      : undefined,
    margins: {
      top: 100,
      bottom: 100,
      left: 140,
      right: 140,
    },
    children: paras,
  });
}

// Bảng so sánh trước và sau
function buildComparisonTable() {
  const headers = [
    { text: "STT", width: 8 },
    { text: "Tiêu chí so sánh", width: 22 },
    { text: "Trước khi áp dụng sáng kiến\n(Quy trình giấy & ký tay thủ công)", width: 35 },
    { text: "Sau khi áp dụng sáng kiến\n(Hệ thống ISO số hóa & Ký số ERP)", width: 35 },
  ];

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h) =>
      createCell(h.text, {
        bold: true,
        alignment: AlignmentType.CENTER,
        shadingColor: "D9E1F2",
        widthPercent: h.width,
        size: 23,
      })
    ),
  });

  const data = [
    [
      "1",
      "Thời gian luân chuyển và phê duyệt hồ sơ",
      "Mất từ 3 đến 5 ngày/hồ sơ. Khi lãnh đạo đi công tác hoặc nghỉ phép tại Việt Nam, quy trình tắc nghẽn hoàn toàn từ 7 đến 10 ngày.",
      "Chỉ từ 5 đến 15 phút. Lãnh đạo ký số mọi lúc mọi nơi trên điện thoại/máy tính bảng có kết nối Internet.",
    ],
    [
      "2",
      "Chi phí văn phòng phẩm & in ấn biểu mẫu",
      "Tiêu tốn 400 – 600 trang giấy A4/tháng (~25 ram giấy/năm), mực in, chi phí đóng cặp lưu trữ; ước tính 65 – 80 triệu VNĐ/năm.",
      "Giảm hơn 80% chi phí giấy mực và lưu trữ vật lý, tiết kiệm khoảng 55 – 65 triệu VNĐ/năm; hướng tới mô hình nhà máy không giấy tờ (Paperless).",
    ],
    [
      "3",
      "Kiểm soát tính hiệu lực của tài liệu & biểu mẫu",
      "Rất khó kiểm soát bản sửa đổi (Rev); công nhân và kỹ thuật dễ lấy nhầm biểu mẫu cũ hết hiệu lực để ghi chép, gây lỗi Không phù hợp (NC) khi đánh giá ISO.",
      "Kiểm soát tuyệt đối 100%. Biểu mẫu xuất từ hệ thống luôn là bản mới nhất; văn bản in có mã QR quét kiểm tra hiệu lực sống (Active / Inactive) ngay tức thì.",
    ],
    [
      "4",
      "Tính pháp lý & Tính toàn vẹn của chữ ký",
      "Ký tay bằng mực trên giấy; rủi ro ký thay, ký hộ không đúng thẩm quyền; giấy tờ dễ bị sửa chữa số liệu sau khi ký mà không để lại dấu vết.",
      "Ký số PAdES thuật toán RSA-2048 + băm SHA-256; xác thực chứng thư số nội bộ; phân định rõ quyền ký thay (KT., TM., TL., TUQ.); chống giả mạo và chống chối bỏ.",
    ],
    [
      "5",
      "Khả năng tra cứu và chuẩn bị hồ sơ đánh giá",
      "Mất từ 2 đến 4 ngày để lục tìm nhiều tập hồ sơ, sổ sách đóng bìa cồng kềnh; nguy cơ thất lạc tài liệu, mục rách do khí hậu nóng ẩm.",
      "Dưới 10 giây bằng thanh tìm kiếm thông minh theo mã tài liệu, tên quy trình, ngày ban hành hoặc quét mã QR trên hồ sơ; phục vụ đánh giá ISO 9001 tối ưu.",
    ],
    [
      "6",
      "Quy trình luồng duyệt & Nhân bản chữ ký",
      "Chỉ có 1 luồng cứng nhắc; tài liệu nhiều trang hoặc nhiều ô ký phải lật giở từng trang ký tay thủ công, dễ sót chữ ký nháy.",
      "Linh hoạt phân cấp Cấp 1 (3 bước) và Cấp 2 (2 bước); công cụ kéo-thả vị trí ký trực quan, hỗ trợ nhân bản chữ ký đồng loạt cho văn bản nhiều trang.",
    ],
    [
      "7",
      "Bảo mật thông tin & Kiểm soát quyền hạn",
      "Hồ sơ giấy để tại các phòng ban dễ bị tiếp cận trái phép; không có nhật ký ghi nhận ai đã xem, sao chép tài liệu.",
      "Phân quyền RBAC chặt chẽ đến từng mã hành động nghiệp vụ (signing.manage, iso.approve...); nhật ký hệ thống ghi nhận chi tiết IP, người ký, thời gian chính xác.",
    ],
    [
      "8",
      "Chi phí đầu tư phần mềm quản lý",
      "Nếu mua phần mềm ký số thương mại bên ngoài: Chi phí từ 150 – 250 triệu VNĐ đầu tư ban đầu + phí duy trì 30 – 50 triệu VNĐ/năm.",
      "0 VNĐ chi phí bản quyền (do đội ngũ kỹ thuật nội bộ nghiên cứu kết hợp AI phát triển); chi phí vận hành máy chủ Cloud chỉ ~300 USD/năm dùng chung hệ thống.",
    ],
  ];

  const rows = [
    headerRow,
    ...data.map(
      (row, idx) =>
        new TableRow({
          children: [
            createCell(row[0], {
              alignment: AlignmentType.CENTER,
              widthPercent: 8,
              size: 23,
            }),
            createCell(row[1], {
              bold: true,
              widthPercent: 22,
              size: 23,
            }),
            createCell(row[2], {
              widthPercent: 35,
              size: 23,
            }),
            createCell(row[3], {
              widthPercent: 35,
              size: 23,
            }),
          ],
        })
    ),
  ];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "D3D3D3" },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "D3D3D3" },
    },
    rows,
  });
}

// Bảng mã tài liệu mẫu trong phụ lục
function buildDocCodesTable() {
  const headers = [
    { text: "Mã loại", width: 15 },
    { text: "Tên loại tài liệu", width: 30 },
    { text: "Cấp độ", width: 15 },
    { text: "Ví dụ mã hiệu chuẩn", width: 40 },
  ];

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h) =>
      createCell(h.text, {
        bold: true,
        alignment: AlignmentType.CENTER,
        shadingColor: "E2EFDA",
        widthPercent: h.width,
        size: 22,
      })
    ),
  });

  const data = [
    ["QT", "Quy trình", "Tài liệu Cha", "NMCB-QT01 (Quy trình sản xuất mủ SVR)"],
    ["HD", "Hướng dẫn công việc", "Cha / Con", "NMCB-QT01-HD01 (HD vận hành lò sấy)"],
    ["F", "Biểu mẫu ghi chép", "Hồ sơ Con", "NMCB-QT01-F01 (Phiếu theo dõi ngăn lưu)"],
    ["TC", "Tiêu chuẩn kỹ thuật", "Tài liệu Cha", "QLCL-TC01 (Tiêu chuẩn kiểm nghiệm TCVN 3769)"],
    ["PL", "Phụ lục đính kèm", "Cha / Con", "NMCB-QT01-PL01 (Sơ đồ bố trí mặt bằng kho)"],
    ["QĐ", "Quy định nội bộ", "Tài liệu Cha", "PHK-QĐ02 (Quy định an toàn lao động nhà máy)"],
  ];

  const rows = [
    headerRow,
    ...data.map(
      (row) =>
        new TableRow({
          children: [
            createCell(row[0], { alignment: AlignmentType.CENTER, bold: true, widthPercent: 15, size: 22 }),
            createCell(row[1], { widthPercent: 30, size: 22 }),
            createCell(row[2], { alignment: AlignmentType.CENTER, widthPercent: 15, size: 22 }),
            createCell(row[3], { widthPercent: 40, size: 22 }),
          ],
        })
    ),
  ];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "D3D3D3" },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "D3D3D3" },
    },
    rows,
  });
}

export async function generateReport1Docx(outputPath) {
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: FONT_NAME,
            size: SIZE_BODY,
          },
        },
      },
    },
    sections: [
      // ==========================================
      // SECTION 1: TRANG BÌA CHÍNH
      // ==========================================
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4
            margin: { top: 1134, bottom: 1134, left: 1701, right: 1134 }, // Lề trái 3cm, khác 2cm
          },
        },
        children: [
          createPara("TẬP ĐOÀN CÔNG NGHIỆP CAO SU VIỆT NAM", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 26,
            spaceAfter: 40,
          }),
          createPara("CÔNG TY TNHH PHÁT TRIỂN CAO SU PHƯỚC HÒA KAMPONG THOM", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 26,
            spaceAfter: 40,
          }),
          createPara("NHÀ MÁY CHẾ BIẾN CAO SU", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 24,
            spaceAfter: 200,
          }),
          createPara("------------------------***", {
            alignment: AlignmentType.CENTER,
            spaceAfter: 600,
          }),

          createPara("BÁO CÁO KẾT QUẢ NGHIÊN CỨU, ỨNG DỤNG SÁNG KIẾN CẢI TIẾN", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 30, // 15pt
            spaceAfter: 400,
          }),

          createPara("TÊN ĐỀ TÀI SÁNG KIẾN:", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 26,
            spaceAfter: 120,
          }),
          createPara(
            "\"SỐ HÓA TOÀN DIỆN HỆ THỐNG BIỂU MẪU ISO 9001:2015 VÀ ỨNG DỤNG CÔNG NGHỆ KÝ SỐ ĐIỆN TỬ PHÂN CẤP, XÁC THỰC MÃ QR TRÊN NỀN TẢNG RUBBER ERP TẠI NHÀ MÁY CHẾ BIẾN CAO SU PHƯỚC HÒA KAMPONG THOM\"",
            {
              bold: true,
              alignment: AlignmentType.CENTER,
              size: 28, // 14pt
              spaceAfter: 600,
            }
          ),

          createPara("Lĩnh vực áp dụng: Quản trị Hệ thống ISO, Kỹ thuật Công nghệ Thông tin & Điều hành Sản xuất", {
            italics: true,
            alignment: AlignmentType.CENTER,
            size: 25,
            spaceAfter: 500,
          }),

          createPara("NHÓM TÁC GIẢ THỰC HIỆN:", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 26,
            spaceAfter: 160,
          }),

          new Table({
            alignment: AlignmentType.CENTER,
            width: { size: 90, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE },
              bottom: { style: BorderStyle.NONE },
              left: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE },
              insideHorizontal: { style: BorderStyle.NONE },
              insideVertical: { style: BorderStyle.NONE },
            },
            rows: [
              new TableRow({
                children: [
                  createCell("1. Vương Nguyễn Phương Lâm", { bold: true, size: 24, widthPercent: 50 }),
                  createCell("Phó Tổng Giám đốc phụ trách điều hành (Đồng Chủ nhiệm)", { size: 24, widthPercent: 50 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("2. Tô Thành Luân", { bold: true, size: 24, widthPercent: 50 }),
                  createCell("Phó Giám đốc Nhà máy (Đồng Chủ nhiệm)", { size: 24, widthPercent: 50 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("3. Chau Chók", { bold: true, size: 24, widthPercent: 50 }),
                  createCell("Phó Giám đốc Nhà máy (Đồng Chủ nhiệm)", { size: 24, widthPercent: 50 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("4. Néang Ry Ta", { bold: true, size: 24, widthPercent: 50 }),
                  createCell("Nhân viên Kế toán (Thành viên)", { size: 24, widthPercent: 50 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("5. Nguyễn Hữu Thọ", { bold: true, size: 24, widthPercent: 50 }),
                  createCell("Nhân viên Kỹ thuật (Thành viên)", { size: 24, widthPercent: 50 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("6. Chau Nho", { bold: true, size: 24, widthPercent: 50 }),
                  createCell("Nhân viên Phụ trách Đội xe (Thành viên)", { size: 24, widthPercent: 50 }),
                ],
              }),
            ],
          }),

          createPara("", { spaceAfter: 800 }),
          createPara("Kampong Thom, Năm 2026", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 26,
            spaceAfter: 0,
          }),

          new Paragraph({ children: [new PageBreak()] }),

          // ==========================================
          // SECTION 2: TRANG BÌA PHỤ
          // ==========================================
          createPara("CÔNG TY TNHH PHÁT TRIỂN CAO SU PHƯỚC HÒA KAMPONG THOM", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 26,
            spaceAfter: 40,
          }),
          createPara("HỘI ĐỒNG KHOA HỌC CÔNG NGHỆ & SÁNG KIẾN", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 25,
            spaceAfter: 300,
          }),
          createPara("------------------------***", {
            alignment: AlignmentType.CENTER,
            spaceAfter: 400,
          }),

          createPara("BÁO CÁO KẾT QUẢ THỰC HIỆN SÁNG KIẾN CẢI TIẾN CẤP CÔNG TY", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 28,
            spaceAfter: 300,
          }),

          createPara(
            "Đề tài: \"Số hóa toàn diện hệ thống biểu mẫu ISO 9001:2015 và ứng dụng công nghệ ký số điện tử phân cấp, xác thực mã QR trên nền tảng Rubber ERP tại Nhà máy Chế biến Cao su Phước Hòa Kampong Thom\"",
            {
              bold: true,
              italics: true,
              alignment: AlignmentType.CENTER,
              size: 26,
              spaceAfter: 500,
            }
          ),

          createPara("THÔNG TIN CHI TIẾT VỀ TÁC GIẢ VÀ ĐƠN VỊ CÔNG TÁC:", {
            bold: true,
            alignment: AlignmentType.LEFT,
            size: 26,
            spaceAfter: 140,
          }),

          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 2, color: "000000" },
              bottom: { style: BorderStyle.SINGLE, size: 2, color: "000000" },
              left: { style: BorderStyle.SINGLE, size: 2, color: "000000" },
              right: { style: BorderStyle.SINGLE, size: 2, color: "000000" },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC" },
              insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "CCCCCC" },
            },
            rows: [
              new TableRow({
                children: [
                  createCell("STT", { bold: true, alignment: AlignmentType.CENTER, widthPercent: 8, shadingColor: "F2F2F2" }),
                  createCell("Họ và tên", { bold: true, alignment: AlignmentType.CENTER, widthPercent: 28, shadingColor: "F2F2F2" }),
                  createCell("Chức vụ", { bold: true, alignment: AlignmentType.CENTER, widthPercent: 32, shadingColor: "F2F2F2" }),
                  createCell("Đơn vị công tác", { bold: true, alignment: AlignmentType.CENTER, widthPercent: 32, shadingColor: "F2F2F2" }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("1", { alignment: AlignmentType.CENTER, widthPercent: 8 }),
                  createCell("Vương Nguyễn Phương Lâm", { bold: true, widthPercent: 28 }),
                  createCell("Phó Tổng Giám đốc điều hành", { widthPercent: 32 }),
                  createCell("Ban Giám đốc Công ty", { widthPercent: 32 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("2", { alignment: AlignmentType.CENTER, widthPercent: 8 }),
                  createCell("Tô Thành Luân", { bold: true, widthPercent: 28 }),
                  createCell("Phó Giám đốc Nhà máy", { widthPercent: 32 }),
                  createCell("Nhà máy Chế biến", { widthPercent: 32 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("3", { alignment: AlignmentType.CENTER, widthPercent: 8 }),
                  createCell("Chau Chók", { bold: true, widthPercent: 28 }),
                  createCell("Phó Giám đốc Nhà máy", { widthPercent: 32 }),
                  createCell("Nhà máy Chế biến", { widthPercent: 32 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("4", { alignment: AlignmentType.CENTER, widthPercent: 8 }),
                  createCell("Néang Ry Ta", { bold: true, widthPercent: 28 }),
                  createCell("Nhân viên Kế toán", { widthPercent: 32 }),
                  createCell("Bộ phận Kế toán - Thống kê", { widthPercent: 32 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("5", { alignment: AlignmentType.CENTER, widthPercent: 8 }),
                  createCell("Nguyễn Hữu Thọ", { bold: true, widthPercent: 28 }),
                  createCell("Nhân viên Kỹ thuật", { widthPercent: 32 }),
                  createCell("Bộ phận Kỹ thuật - Quản lý chất lượng", { widthPercent: 32 }),
                ],
              }),
              new TableRow({
                children: [
                  createCell("6", { alignment: AlignmentType.CENTER, widthPercent: 8 }),
                  createCell("Chau Nho", { bold: true, widthPercent: 28 }),
                  createCell("Phụ trách Đội xe", { widthPercent: 32 }),
                  createCell("Bộ phận Vận tải - Tiếp nhận mủ", { widthPercent: 32 }),
                ],
              }),
            ],
          }),

          createPara("", { spaceAfter: 400 }),
          createPara("ĐƠN VỊ ÁP DỤNG CHÍNH:", { bold: true, size: 25, spaceAfter: 60 }),
          createPara("Nhà máy Chế biến Cao su – Công ty TNHH Phát triển Cao su Phước Hòa Kampong Thom (Xã Boeng Lvea, Huyện Santuk, Tỉnh Kampong Thom, Vương quốc Campuchia).", { size: 25, spaceAfter: 300 }),

          createPara("THỜI GIAN NGHIÊN CỨU VÀ TRIỂN KHAI:", { bold: true, size: 25, spaceAfter: 60 }),
          createPara("Bắt đầu thử nghiệm từ tháng 01/2026, nghiệm thu và vận hành chính thức trên toàn hệ thống từ tháng 03/2026.", { size: 25, spaceAfter: 500 }),

          new Paragraph({ children: [new PageBreak()] }),

          // ==========================================
          // SECTION 3: MỤC LỤC
          // ==========================================
          createPara("MỤC LỤC BÁO CÁO SÁNG KIẾN", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 28,
            spaceAfter: 300,
          }),

          createRunsPara([
            { text: "PHẦN I: MỞ ĐẦU", bold: true },
            { text: " ................................................................................................................................... Trang 4" },
          ], { spaceAfter: 80 }),
          createPara("  1. Lý do chọn đề tài (Tính cấp thiết) ............................................................................................. Trang 4", { spaceAfter: 60 }),
          createPara("  2. Mục đích và nhiệm vụ của sáng kiến ...................................................................................... Trang 5", { spaceAfter: 60 }),
          createPara("  3. Đối tượng và phạm vi nghiên cứu ........................................................................................... Trang 6", { spaceAfter: 60 }),
          createPara("  4. Phương pháp nghiên cứu ....................................................................................................... Trang 6", { spaceAfter: 60 }),
          createPara("  5. Điểm mới của sáng kiến ......................................................................................................... Trang 7", { spaceAfter: 120 }),

          createRunsPara([
            { text: "PHẦN II: NỘI DUNG SÁNG KIẾN", bold: true },
            { text: " .......................................................................................................... Trang 8" },
          ], { spaceAfter: 80 }),
          createPara("  1. Cơ sở lý luận và cơ sở thực tiễn ............................................................................................. Trang 8", { spaceAfter: 60 }),
          createPara("     1.1. Nền tảng lý thuyết và các văn bản quy định liên quan ..................................................... Trang 8", { spaceAfter: 40 }),
          createPara("     1.2. Thực trạng công tác quản lý biểu mẫu và ký duyệt trước khi áp dụng ............................... Trang 9", { spaceAfter: 60 }),
          createPara("  2. Các giải pháp, biện pháp đã thực hiện ................................................................................... Trang 10", { spaceAfter: 60 }),
          createPara("     2.1. Chuẩn hóa kiến trúc số hóa tài liệu ISO và cấu trúc sinh mã tự động ............................... Trang 10", { spaceAfter: 40 }),
          createPara("     2.2. Xây dựng luồng phê duyệt phân cấp linh hoạt (Cấp 1 và Cấp 2) ........................................ Trang 12", { spaceAfter: 40 }),
          createPara("     2.3. Phát triển phân hệ Ký số điện tử PAdES với mật mã học RSA-2048 & SHA-256 .............. Trang 13", { spaceAfter: 40 }),
          createPara("     2.4. Công nghệ kéo-thả vị trí ký trực quan và cơ chế nhân bản chữ ký độc quyền .................... Trang 15", { spaceAfter: 40 }),
          createPara("     2.5. Cơ chế xác thực hiệu lực văn bản thời gian thực bằng mã QR Code động .......................... Trang 16", { spaceAfter: 40 }),
          createPara("     2.6. Hệ thống phân quyền chi tiết RBAC và Nhật ký kiểm toán bảo mật ................................... Trang 17", { spaceAfter: 60 }),
          createPara("  3. Hiệu quả của sáng kiến ......................................................................................................... Trang 18", { spaceAfter: 60 }),
          createPara("     3.1. Hiệu quả về mặt chuyên môn, kỹ thuật và quản lý ............................................................ Trang 18", { spaceAfter: 40 }),
          createPara("     3.2. Hiệu quả kinh tế và xã hội ................................................................................................. Trang 19", { spaceAfter: 40 }),
          createPara("     3.3. Bảng số liệu minh chứng so sánh kết quả Trước và Sau khi áp dụng .................................. Trang 20", { spaceAfter: 60 }),
          createPara("  4. Khả năng áp dụng và mở rộng của sáng kiến ......................................................................... Trang 22", { spaceAfter: 120 }),

          createRunsPara([
            { text: "PHẦN III: KẾT LUẬN VÀ KIẾN NGHỊ", bold: true },
            { text: " ................................................................................................. Trang 23" },
          ], { spaceAfter: 80 }),
          createPara("  1. Kết luận ................................................................................................................................. Trang 23", { spaceAfter: 60 }),
          createPara("  2. Kiến nghị và đề xuất ............................................................................................................. Trang 24", { spaceAfter: 120 }),

          createRunsPara([
            { text: "PHẦN TÀI LIỆU THAM KHẢO VÀ PHỤ LỤC", bold: true },
            { text: " ........................................................................................ Trang 25" },
          ], { spaceAfter: 80 }),
          createPara("  1. Danh mục tài liệu tham khảo .................................................................................................. Trang 25", { spaceAfter: 60 }),
          createPara("  2. Phụ lục minh họa ................................................................................................................... Trang 26", { spaceAfter: 200 }),

          new Paragraph({ children: [new PageBreak()] }),

          // ==========================================
          // SECTION 4: NỘI DUNG CHÍNH BÁO CÁO
          // ==========================================
          createHeading1("PHẦN I: MỞ ĐẦU"),

          createHeading2("1. Lý do chọn đề tài (Tính cấp thiết của đề tài)"),
          createPara(
            "Công ty TNHH Phát triển Cao su Phước Hòa Kampong Thom là đơn vị thành viên trực thuộc Tập đoàn Công nghiệp Cao su Việt Nam (VRG), thực hiện dự án đầu tư phát triển vườn cây và chế biến mủ cao su thiên nhiên xuất khẩu tại tỉnh Kampong Thom, Vương quốc Campuchia. Nhà máy Chế biến cao su của công ty có công suất thiết kế lớn, vận hành liên tục theo các tiêu chuẩn quốc tế nghiêm ngặt, đặc biệt là Hệ thống quản lý chất lượng ISO 9001:2015, Tiêu chuẩn quản lý môi trường ISO 14001:2015 và Chứng chỉ chuỗi hành trình sản phẩm PEFC/CoC.",
            { indent: 400 }
          ),
          createPara(
            "Trong mô hình vận hành truyền thống, việc tuân thủ các quy trình ISO 9001:2015 đòi hỏi phải duy trì một khối lượng hồ sơ, chứng từ giấy vô cùng đồ sộ. Mỗi tháng, các bộ phận trong nhà máy (tiếp nhận mủ trạm cân, kiểm tra ngăn ủ, vận hành lò xông sấy, đóng bành thành phẩm, kiểm nghiệm phòng thí nghiệm KCS, bảo trì bảo dưỡng máy móc, điều xe vận tải...) phải in ấn, ký tay và lưu trữ từ 400 đến hơn 600 trang biểu mẫu giấy. Khối lượng giấy tờ này không chỉ gây lãng phí chi phí văn phòng phẩm đáng kể mà còn tiềm ẩn rất nhiều rủi ro trong công tác quản trị doanh nghiệp:",
            { indent: 400 }
          ),
          createPara(
            "Thứ nhất, rào cản về khoảng cách địa lý và độ trễ phê duyệt: Ban Giám đốc và các cán bộ phụ trách kỹ thuật, kiểm soát chất lượng thường xuyên phải di chuyển công tác, tham gia các cuộc họp giao ban tại trụ sở hoặc có các đợt nghỉ phép định kỳ tại Việt Nam. Khi lãnh đạo vắng mặt tại nhà máy ở Campuchia, toàn bộ chứng từ giấy (phiếu đề xuất vật tư, biên bản kiểm tra kỹ thuật, phiếu xuất kho, phiếu kết quả kiểm nghiệm...) buộc phải chờ đợi, dẫn đến tình trạng ách tắc kéo dài từ 3 đến 7 ngày, gây chậm trễ trong tiến độ sản xuất và giao hàng cho khách hàng quốc tế.",
            { indent: 400 }
          ),
          createPara(
            "Thứ hai, nguy cơ sử dụng biểu mẫu hết hiệu lực hoặc lỗi thời (Rev cũ): Theo quy định của ISO 9001:2015 (Khoản 7.5 - Thông tin dạng văn bản), khi có sự soát xét, cập nhật quy trình kỹ thuật, các biểu mẫu cũ phải bị thu hồi và thay thế bằng phiên bản mới. Tuy nhiên, trên thực tế, công nhân tại phân xưởng hoặc nhân viên các bộ phận thường photo lưu sẵn nhiều bản biểu mẫu trắng để sử dụng dần. Khi có bản cập nhật mới, việc thu hồi bản giấy rất khó triệt để, dẫn đến tình trạng ghi chép trên biểu mẫu lỗi thời, gây lỗi Không phù hợp (Non-conformity - NC) trong các đợt đánh giá giám sát định kỳ của tổ chức chứng nhận quốc tế.",
            { indent: 400 }
          ),
          createPara(
            "Thứ ba, rủi ro thất lạc, hư hỏng và tốn kém diện tích lưu kho: Khu vực nhà máy chế biến cao su có độ ẩm cao, môi trường nhiệt đới đặc thù tại Campuchia dễ làm giấy tờ bị ẩm mốc, mục rách hoặc mối mọt xâm hại. Việc lưu trữ hàng chục ngàn trang biểu mẫu giấy qua các năm đòi hỏi diện tích kho lưu trữ lớn và mất rất nhiều công sức mỗi khi cần tra cứu hồ sơ lịch sử.",
            { indent: 400 }
          ),
          createPara(
            "Thứ tư, thiếu giải pháp Ký số chuyên dụng phù hợp: Các phần mềm văn phòng điện tử hoặc dịch vụ chứng thư số công cộng thương mại trên thị trường hiện nay có chi phí mua bản quyền rất đắt đỏ (hàng chục ngàn USD), lại không tích hợp trực tiếp vào hệ thống ERP quản trị sản xuất đặc thù của ngành cao su, gây phân mảnh dữ liệu và khó sử dụng đối với người lao động.",
            { indent: 400 }
          ),
          createPara(
            "Xuất phát từ những đòi hỏi thực tiễn cấp bách nêu trên, Nhóm tác giả đã chủ động nghiên cứu, thiết kế và phát triển sáng kiến: \"Số hóa toàn diện hệ thống biểu mẫu ISO 9001:2015 và ứng dụng công nghệ ký số điện tử phân cấp, xác thực mã QR trên nền tảng Rubber ERP tại Nhà máy Chế biến Cao su Phước Hòa Kampong Thom\". Đây là bước đột phá công nghệ quan trọng, giúp chuyển đổi hoàn toàn phương thức quản lý từ thủ công sang tự động hóa số, bảo đảm tính pháp lý nội bộ, loại bỏ giấy tờ in ấn và nâng cao năng suất điều hành của toàn đơn vị.",
            { indent: 400 }
          ),

          createHeading2("2. Mục đích và nhiệm vụ của sáng kiến"),
          createHeading3("2.1. Mục đích tổng quát:"),
          createPara(
            "Xây dựng một phân hệ quản trị ISO và Ký số điện tử toàn diện (Paperless ISO Management System), tích hợp trực tiếp vào phần mềm Quản lý sản xuất Rubber ERP nội bộ của công ty. Giải pháp nhằm số hóa 100% các biểu mẫu, quy trình tác nghiệp; cho phép cán bộ lãnh đạo phê duyệt và ký số mọi lúc, mọi nơi trên máy tính và thiết bị di động với đầy đủ giá trị pháp lý nội bộ; đồng thời áp dụng mã QR Code động để xác thực hiệu lực văn bản trong thời gian thực, loại bỏ triệt để việc sử dụng tài liệu hết hạn.",
            { indent: 400 }
          ),

          createHeading3("2.2. Nhiệm vụ cụ thể của sáng kiến:"),
          createPara("1. Chuẩn hóa lại toàn bộ cây danh mục tài liệu, quy trình và biểu mẫu ISO của công ty theo mô hình quan hệ Cha - Con chặt chẽ; tự động hóa việc sinh mã hiệu tài liệu chuẩn theo từng phòng ban.", { indent: 400 }),
          createPara("2. Xây dựng luồng phê duyệt tài liệu phân cấp linh hoạt: Thiết lập quy trình Cấp 1 (3 bước: Soạn thảo -> Xem xét -> Phê duyệt) cho tài liệu ban hành hệ thống và quy trình Cấp 2 (2 bước: Soạn thảo/Trình ký -> Phê duyệt) cho các biểu mẫu tác nghiệp thường nhật để rút ngắn thời gian xử lý.", { indent: 400 }),
          createPara("3. Nghiên cứu và ứng dụng giải pháp Ký số điện tử chuẩn quốc tế PAdES (PDF Advanced Electronic Signatures) dựa trên nền tảng mật mã học RSA-2048 và thuật toán băm SHA-256; phát hành chứng thư số nội bộ (Self-signed Root CA) gắn liền với định danh từng cá nhân.", { indent: 400 }),
          createPara("4. Phát triển giao diện kéo-thả vị trí ký trực quan (SignPlacementModal) trên màn hình cảm ứng, hỗ trợ đầy đủ các tiền tố thẩm quyền ký thay (KT., TM., TL., TUQ.), chức vụ, tên người ký và phát minh giải pháp nhân bản chữ ký đồng loạt cho các tài liệu nhiều trang.", { indent: 400 }),
          createPara("5. Thiết lập cơ chế tạo mã QR Code động trên từng tài liệu PDF xuất bản, cho phép bất kỳ ai khi quét mã QR trên điện thoại thông minh đều có thể tra cứu tức thì tình trạng hiệu lực (Active/Inactive), phiên bản soát xét và dấu vết chứng thư số của văn bản.", { indent: 400 }),
          createPara("6. Xây dựng cơ chế bảo mật phân quyền đa cấp RBAC (Role-Based Access Control) đến từng hành vi nghiệp vụ và nhật ký kiểm toán (Audit Trail) bất biến, bảo đảm an toàn dữ liệu tuyệt đối.", { indent: 400 }),

          createHeading2("3. Đối tượng và phạm vi nghiên cứu"),
          createPara(
            "• Đối tượng nghiên cứu: Quy trình quản lý thông tin dạng văn bản theo tiêu chuẩn ISO 9001:2015, hệ thống biểu mẫu kỹ thuật - sản xuất - kiểm nghiệm - bảo dưỡng tại nhà máy chế biến cao su; các công nghệ mật mã học khóa công khai (PKI, RSA, SHA-2), cấu trúc tài liệu PDF/PAdES và công nghệ mã phản hồi nhanh (QR Code).",
            { indent: 400 }
          ),
          createPara(
            "• Phạm vi không gian: Áp dụng trực tiếp tại Nhà máy Chế biến Cao su, Văn phòng đại diện Công ty TNHH Phát triển Cao su Phước Hòa Kampong Thom (Campuchia) và các thiết bị di động của cán bộ nhân viên công ty khi công tác tại Việt Nam hoặc nước ngoài.",
            { indent: 400 }
          ),
          createPara(
            "• Phạm vi thời gian: Quá trình khảo sát, lập trình thử nghiệm bắt đầu từ tháng 01/2026, đưa vào ứng dụng chính thức từ tháng 03/2026 và tiếp tục duy trì, hoàn thiện liên tục trong năm 2026.",
            { indent: 400 }
          ),
          createPara(
            "• Nhóm đối tượng thụ hưởng và áp dụng: Toàn thể Ban Giám đốc Công ty, Ban Giám đốc Nhà máy, cán bộ kỹ thuật, thống kê kế toán, KCS, thủ kho, bảo trì và tổ trưởng các tổ sản xuất.",
            { indent: 400 }
          ),

          createHeading2("4. Phương pháp nghiên cứu"),
          createPara(
            "Để đề tài đạt kết quả chính xác, có tính ứng dụng cao và phù hợp với thực tiễn sản xuất, nhóm tác giả đã phối hợp sử dụng các phương pháp nghiên cứu khoa học sau:",
            { indent: 400 }
          ),
          createPara(
            "1. Phương pháp khảo sát, thống kê và phân tích hiện trạng: Rà soát toàn bộ hơn 120 danh mục tài liệu, quy trình và biểu mẫu ISO đang lưu hành tại công ty; đo lường chính xác thời gian luân chuyển chứng từ giấy, chi phí in ấn và các điểm nghẽn trong luồng ký duyệt cũ.",
            { indent: 400 }
          ),
          createPara(
            "2. Phương pháp tư duy dựa trên rủi ro (Risk-based thinking theo ISO 9001:2015): Nhận diện các rủi ro pháp lý, rủi ro làm giả chữ ký, rủi ro can thiệp số liệu hoặc rủi ro sử dụng tài liệu hết hạn để xây dựng các rào cản kỹ thuật kiểm soát trên phần mềm.",
            { indent: 400 }
          ),
          createPara(
            "3. Phương pháp nghiên cứu thực nghiệm và công nghệ phần mềm: Nghiên cứu cấu trúc tệp PDF theo chuẩn ISO 32000-1; tích hợp các thư viện xử lý tài liệu chuyên sâu (@cantoo/pdf-lib, node-forge, crypto); ứng dụng mô hình cập nhật từng phần (Incremental Update) để ký số nhiều cấp mà không làm hỏng chữ ký của người ký trước.",
            { indent: 400 }
          ),
          createPara(
            "4. Phương pháp thử nghiệm tại hiện trường (Field Testing): Triển khai thử nghiệm song song hệ thống số và hồ sơ giấy trong 45 ngày tại phân xưởng sản xuất và phòng KCS để thu thập phản hồi của người dùng, tinh chỉnh giao diện kéo thả chữ ký tối ưu trên điện thoại cảm ứng.",
            { indent: 400 }
          ),

          createHeading2("5. Điểm mới của sáng kiến"),
          createPara(
            "So với các phương pháp quản lý hồ sơ truyền thống hoặc các phần mềm quản lý văn bản thông thường, sáng kiến mang lại những điểm mới mang tính đột phá kỹ thuật như sau:",
            { indent: 400 }
          ),
          createPara(
            "• Tính tự lực và làm chủ công nghệ 100%: Hệ thống được nghiên cứu, kiến trúc và lập trình hoàn toàn bởi đội ngũ kỹ sư nội bộ kết hợp với trợ lý trí tuệ nhân tạo (AI-assisted Software Engineering), không tốn một đồng chi phí thuê ngoài hay mua bản quyền định kỳ, dễ dàng tùy biến linh hoạt theo mọi thay đổi quy trình của nhà máy.",
            { indent: 400 }
          ),
          createPara(
            "• Chuẩn ký số PAdES với cơ chế Incremental Update: Đây là một trong số rất ít các giải pháp nội bộ trong ngành cao su triển khai thành công chuẩn chữ ký điện tử PAdES với khả năng cập nhật từng phần. Khi tài liệu trải qua 2 hoặc 3 cấp ký duyệt (Soạn thảo -> Xem xét -> Phê duyệt), chữ ký của người ký sau không bao giờ làm mất hiệu lực hoặc ghi đè chữ ký của người ký trước, bảo đảm chuỗi bằng chứng pháp lý mật mã học toàn vẹn 100%.",
            { indent: 400 }
          ),
          createPara(
            "• Giải pháp nhân bản chữ ký và tên người ký (Signature Duplication): Khắc phục nhược điểm lớn của các hệ thống ký số hiện có. Đối với các biểu mẫu kỹ thuật kéo dài nhiều trang hoặc có nhiều vị trí cần ký nháy/ký xác nhận, người ký chỉ cần thao tác 1 nút bấm (+) trên ô chữ ký gốc để nhân bản ngay một cặp ô chữ ký - ô tên mới, kéo thả đến các vị trí mong muốn mà không phải tạo lại từ đầu.",
            { indent: 400 }
          ),
          createPara(
            "• Cơ chế xác thực hiệu lực 'Sống' bằng QR Code động: Mỗi văn bản số hóa đều được cấp một mã QR động in tại góc trang. Bất kỳ ai, dù cầm bản in trên giấy hay xem tệp PDF, chỉ cần mở camera điện thoại quét mã QR là ngay lập tức kiểm tra được văn bản này có còn hiệu lực hay đã bị thay thế bởi bản sửa đổi mới hơn, ngăn chặn tận gốc việc lưu hành tài liệu rác.",
            { indent: 400 }
          ),
          createPara(
            "• Tối ưu hóa tối đa cho thiết bị di động: Giao diện ký số và tra cứu biểu mẫu được thiết kế chuẩn Responsive, hoạt động mượt mà trên mọi loại màn hình từ máy tính để bàn đến điện thoại thông minh cá nhân của cán bộ nhân viên.",
            { indent: 400 }
          ),

          createHeading1("PHẦN II: NỘI DUNG SÁNG KIẾN"),

          createHeading2("1. Cơ sở lý luận và cơ sở thực tiễn"),
          createHeading3("1.1. Nền tảng lý thuyết và các văn bản quy định liên quan:"),
          createPara(
            "Sáng kiến được xây dựng dựa trên sự kết hợp chặt chẽ giữa các tiêu chuẩn quản lý quốc tế, quy định pháp luật về giao dịch điện tử và quy chế nội bộ của ngành cao su:",
            { indent: 400 }
          ),
          createPara(
            "• Tiêu chuẩn ISO 9001:2015 - Điều khoản 7.5 'Thông tin dạng văn bản': Quy định rõ tổ chức phải kiểm soát thông tin dạng văn bản nhằm bảo đảm thông tin luôn sẵn có, phù hợp cho việc sử dụng, được bảo vệ thỏa đáng và được kiểm soát về việc phân phối, truy cập, phục hồi, lưu trữ và bảo quản.",
            { indent: 400 }
          ),
          createPara(
            "• Luật Giao dịch điện tử số 20/2023/QH15 và Nghị định số 130/2018/NĐ-CP: Quy định chi tiết về giá trị pháp lý của thông điệp dữ liệu, điều kiện của chữ ký điện tử an toàn và chữ ký số trong hoạt động quản trị nội bộ doanh nghiệp.",
            { indent: 400 }
          ),
          createPara(
            "• Tiêu chuẩn quốc tế ETSI TS 102 778 và ISO 32000-1: Định chuẩn cấu trúc chữ ký số trên tài liệu PDF (PDF Advanced Electronic Signatures - PAdES), quy định cách nhúng chữ ký số, chứng thư số X.509 và thông tin dấu thời gian (Timestamp) vào cấu trúc tệp PDF.",
            { indent: 400 }
          ),
          createPara(
            "• Bộ tiêu chuẩn quản lý kỹ thuật và chất lượng của Tập đoàn Công nghiệp Cao su Việt Nam (VRG) và Sổ tay Quản lý chất lượng của Công ty TNHH Phát triển Cao su Phước Hòa Kampong Thom.",
            { indent: 400 }
          ),

          createHeading3("1.2. Thực trạng công tác quản lý biểu mẫu và ký duyệt trước khi áp dụng sáng kiến:"),
          createPara(
            "Trước năm 2026, toàn bộ công tác điều hành tại Nhà máy Chế biến hoàn toàn phụ thuộc vào việc in ấn hồ sơ giấy thủ công. Chuỗi luân chuyển của một chứng từ thường phải trải qua các bước: Người thực hiện soạn thảo trên máy vi tính -> In ra giấy A4 -> Trực tiếp mang đến bàn làm việc của người xem xét -> Người xem xét ký tay -> Mang sang phòng Ban Giám đốc để trình ký phê duyệt -> Bộ phận văn thư/thống kê đóng dấu, photo nhân bản -> Phát hành bản giấy đến các tổ và đóng tập lưu trữ vật lý vào tủ hồ sơ.",
            { indent: 400 }
          ),
          createPara(
            "Quy trình thủ công này bộc lộ những hạn chế, tồn tại nghiêm trọng sau:",
            { indent: 400 }
          ),
          createPara("1. Lãng phí thời gian và làm chậm trễ tiến độ: Thời gian trung bình để hoàn tất ký duyệt một bộ chứng từ mất từ 3 đến 5 ngày. Đặc biệt, vào các đợt Ban Giám đốc đi công tác hoặc về phép tại Việt Nam, các hồ sơ quan trọng như phiếu đề xuất sửa chữa máy móc, phiếu kiểm nghiệm xuất hàng buộc phải nằm chờ trên bàn làm việc, gây gián đoạn dây chuyền sản xuất và lỡ hạn đóng container xuất khẩu.", { indent: 400 }),
          createPara("2. Tốn kém chi phí văn phòng phẩm: Mỗi tháng nhà máy tiêu thụ khoảng 25 đến 30 ram giấy in, 2 hộp mực lớn, cùng hàng loạt cặp lưu trữ, bìa còng; tổng chi phí văn phòng phẩm trực tiếp lên tới hơn 65 triệu VNĐ/năm.", { indent: 400 }),
          createPara("3. Nguy cơ sử dụng sai phiên bản biểu mẫu: Khi Phòng Kỹ thuật ban hành bản sửa đổi biểu mẫu mới (ví dụ Phiếu kiểm nghiệm KCS bản Rev 02), việc thu hồi triệt để hàng trăm tờ biểu mẫu Rev 01 đã photo sẵn tại các phân xưởng là điều không thể thực hiện hoàn hảo. Hậu quả là công nhân vẫn tiếp tục ghi chép trên bản cũ, vi phạm nghiêm trọng quy trình kiểm soát tài liệu ISO.", { indent: 400 }),
          createPara("4. Thiếu tính an toàn và bảo mật: Chữ ký tay trên giấy rất dễ bị ký nhái, ký hộ. Số liệu ghi chép trên giấy (như nhiệt độ sấy, chỉ số DRC, khối lượng mủ) hoàn toàn có thể bị tẩy xóa hoặc viết chèn thêm mà không có cơ chế phát hiện sửa đổi.", { indent: 400 }),
          createPara("5. Khó khăn cực độ khi đánh giá ISO định kỳ: Mỗi đợt đánh giá chứng nhận ISO 9001:2015, các bộ phận phải mất từ 3 đến 5 ngày dừng công việc chuyên môn để lục lọi, sắp xếp lại hàng chục tập hồ sơ giấy đóng bụi trong kho, nguy cơ thất lạc biên bản nghiệm thu hoặc chữ ký xác nhận của các khâu bàn giao luôn là nỗi ám ảnh thường trực.", { indent: 400 }),

          createHeading2("2. Các giải pháp, biện pháp đã thực hiện"),
          createPara(
            "Để giải quyết triệt để các hạn chế trên, Nhóm tác giả đã triển khai đồng bộ 6 nhóm giải pháp công nghệ kỹ thuật trên phân hệ ISO của ứng dụng Rubber ERP:",
            { indent: 400 }
          ),

          createHeading3("2.1. Chuẩn hóa kiến trúc số hóa tài liệu ISO và cấu trúc sinh mã tự động:"),
          createPara(
            "Nhóm tác giả đã tiến hành cấu trúc lại toàn bộ hệ thống tài liệu ISO của công ty thành mô hình phân cấp thực thể rõ ràng gồm hai cấp độ: Tài liệu Cha (Parent Documents) và Hồ sơ/Biểu mẫu Con (Child Forms/Instances).",
            { indent: 400 }
          ),
          createPara(
            "• Danh mục loại tài liệu chuẩn: Định nghĩa 11 mã chuẩn gồm CS (Chính sách), OB (Mục tiêu), ST (Sổ tay), QC (Quy chế), TC (Tiêu chuẩn), QT (Quy trình), HD (Hướng dẫn), MT (Mô tả), QĐ (Quy định), PL (Phụ lục) và F (Biểu mẫu). Trong đó, F luôn là hồ sơ con gắn liền với quy trình mẹ.",
            { indent: 400 }
          ),
          createPara(
            "• Thuật toán tự động sinh mã hiệu chuẩn xác: Xây dựng hàm tạo mã chuẩn hóa theo cú pháp:\n  + Mã tài liệu Cha: `[Mã phòng ban]-[Loại tài liệu][Số hiệu 2 chữ số]` (Ví dụ: `NMCB-QT01` là Quy trình số 01 của Nhà máy chế biến; `QLCL-TC02` là Tiêu chuẩn số 02 của Phòng Quản lý chất lượng).\n  + Mã hồ sơ Con: `[Mã tài liệu Cha]-[Loại con][Số hiệu con]` (Ví dụ: `NMCB-QT01-F01` là Biểu mẫu số 01 thuộc Quy trình NMCB-QT01).",
            { indent: 400 }
          ),
          createPara(
            "• Quản lý vòng đời tài liệu tự động: Mỗi tài liệu số hóa đều được hệ thống tự động kiểm soát trạng thái theo chuỗi sự kiện: Nháp (Draft) -> Chờ xem xét (Pending Review) -> Chờ phê duyệt (Pending Approval) -> Có hiệu lực (Active) -> Hết hiệu lực (Expired) hoặc Trả về (Returned). Khi một tài liệu mới được ban hành (Rev n+1), hệ thống tự động đánh dấu phiên bản cũ (Rev n) sang trạng thái 'Hết hiệu lực'.",
            { indent: 400 }
          ),

          createHeading3("2.2. Xây dựng luồng phê duyệt phân cấp linh hoạt (Cấp 1 và Cấp 2):"),
          createPara(
            "Để không máy móc áp đặt một quy trình cứng nhắc cho mọi loại giấy tờ, sáng kiến đã thiết kế 2 luồng phê duyệt chuyên biệt:",
            { indent: 400 }
          ),
          createPara(
            "• Luồng Cấp 1 (Quy trình 3 bước): Áp dụng cho các tài liệu hệ thống quan trọng (Sổ tay chất lượng, Quy chế, Quy trình công nghệ, Hướng dẫn công việc). Luồng duyệt gồm:\n  Bước 1: Cán bộ chuyên trách soạn thảo -> Ký số Soạn thảo và gửi xem xét.\n  Bước 2: Trưởng bộ phận/Phó Giám đốc phụ trách kiểm tra nội dung kỹ thuật -> Ký số Xem xét và gửi phê duyệt.\n  Bước 3: Tổng Giám đốc hoặc Phó TGĐ điều hành kiểm tra lần cuối -> Ký số Phê duyệt và công bố ban hành có hiệu lực.",
            { indent: 400 }
          ),
          createPara(
            "• Luồng Cấp 2 (Quy trình 2 bước): Áp dụng cho các biểu mẫu tác nghiệp hàng ngày (Phiếu giao nhận mủ, Báo cáo ca sản xuất, Phiếu xuất kho, Đề xuất sửa chữa thiết bị thường nhật). Luồng duyệt được rút gọn:\n  Bước 1: Nhân viên/Kỹ thuật viên lập phiếu -> Ký số xác nhận và gửi thẳng lên cấp có thẩm quyền phê duyệt.\n  Bước 2: Lãnh đạo phụ trách kiểm tra -> Ký số Phê duyệt và ban hành.\n  Giao diện Cấp 2 tự động ẩn hoàn toàn vùng thông tin xem xét trung gian, giúp giảm 50% thời gian xử lý thủ tục hành chính cho các nghiệp vụ phát sinh hàng ngày.",
            { indent: 400 }
          ),

          createHeading3("2.3. Phát triển phân hệ Ký số điện tử PAdES với mật mã học RSA-2048 & SHA-256:"),
          createPara(
            "Thay vì sử dụng các hình ảnh chữ ký chèn thô sơ (dễ bị cắt dán sao chép), nhóm tác giả đã xây dựng hạ tầng khóa công khai nội bộ chuẩn mực:",
            { indent: 400 }
          ),
          createPara(
            "• Cơ chế sinh khóa và Chứng thư số cá nhân: Mỗi cán bộ được phân quyền ký đều được hệ thống cấp một cặp khóa mật mã RSA-2048 bit riêng biệt. Khóa bí mật (Private Key) được mã hóa bảo vệ nhiều lớp bằng thuật toán AES-256 và mật mã PIN cá nhân của người dùng. Hệ thống tự động tạo Chứng thư số cá nhân X.509 phát hành bởi Root CA nội bộ Rubber ERP.",
            { indent: 400 }
          ),
          createPara(
            "• Chuẩn chữ ký số PAdES và Cơ chế Incremental Update: Ứng dụng thư viện chuyên sâu `@cantoo/pdf-lib` hỗ trợ ghi bổ sung (Incremental Update). Khi văn bản đi qua từng bước ký duyệt, chữ ký mới được nhúng vào phần mở rộng của file PDF mà không làm thay đổi các byte dữ liệu đã ký trước đó. Nhờ vậy, chữ ký của người soạn thảo, người xem xét và người phê duyệt đều cùng tồn tại độc lập và hợp lệ 100%.",
            { indent: 400 }
          ),
          createPara(
            "• Xác minh tính toàn vẹn bằng hàm băm SHA-256: Trước khi ký, tài liệu được băm bằng thuật toán SHA-256 để tạo dấu vân tay số (Hash Digest). Bất kỳ sự thay đổi dù chỉ là 1 dấu chấm, 1 con số trên văn bản sau khi ký đều sẽ lập tức làm sai lệch mã băm và hệ thống sẽ đưa ra cảnh báo 'Tài liệu đã bị can thiệp trái phép'.",
            { indent: 400 }
          ),
          createPara(
            "• Thể hiện chữ ký trực quan đầy đủ tính pháp lý: Trên bản in hoặc bản hiển thị PDF, chữ ký số xuất hiện trang trọng gồm: Hình ảnh nét ký tay đã số hóa của cá nhân, Họ tên đầy đủ, Chức vụ thực tế, Tiền tố thẩm quyền ký thay (nếu có: KT., TM., TL., TUQ.), Ngày giờ ký chính xác đến từng giây (Timestamp) và Mã định danh chứng thư số.",
            { indent: 400 }
          ),

          createHeading3("2.4. Công nghệ kéo-thả vị trí ký trực quan và cơ chế nhân bản chữ ký độc quyền:"),
          createPara(
            "Nhằm mang lại trải nghiệm tiện dụng tối đa cho người ký trên mọi thiết bị cảm ứng, sáng kiến đã tạo ra mô-đun đặt vị trí ký `SignPlacementModal`:",
            { indent: 400 }
          ),
          createPara(
            "• Kéo thả trực quan theo tọa độ thực tế: Người ký có thể xem trước trang tài liệu PDF trực tiếp trên màn hình, dùng ngón tay hoặc chuột để kéo ô chữ ký và ô họ tên đến đúng vị trí quy định trên văn bản với độ chính xác tuyệt đối theo hệ tọa độ điểm ảnh.",
            { indent: 400 }
          ),
          createPara(
            "• Cơ chế Nhân bản Chữ ký và Tên người ký (Extra Signature Placements): Đối với các biên bản kỹ thuật phức tạp có nhiều trang cần ký nháy, hoặc các biểu mẫu cần xác nhận tại nhiều cột/khu vực khác nhau, hệ thống tích hợp nút bấm dấu cộng (+) thông minh ngay trên ô chữ ký gốc. Khi bấm (+), hệ thống tự động nhân bản ra một cặp ô chữ ký - ô tên phụ, đặt lệch 30 pixel để người dùng dễ dàng kéo thả đến vị trí thứ hai, thứ ba. Các ô nhân bản được trang bị nút mắt (ẩn/hiện) và nút xóa (×) tiện lợi. Toàn bộ các vị trí nhân bản này đều được backend ghi nhận và đóng dấu đồng loạt vào tệp PDF kết quả.",
            { indent: 400 }
          ),

          createHeading3("2.5. Cơ chế xác thực hiệu lực văn bản thời gian thực bằng mã QR Code động:"),
          createPara(
            "Một trong những điểm sáng tạo nhất của đề tài là việc tích hợp mã QR xác thực trực tuyến trên từng trang văn bản:",
            { indent: 400 }
          ),
          createPara(
            "• Tự động nhúng tem mã QR: Khi tài liệu được người phê duyệt cuối cùng ký số ban hành, hệ thống sẽ tự động tạo một mã QR bảo mật kích thước chuẩn và nhúng cố định vào góc văn bản.",
            { indent: 400 }
          ),
          createPara(
            "• Quét QR tra cứu trạng thái sống: Bất kỳ công nhân, cán bộ kỹ thuật nào khi cầm trên tay bản in giấy hoặc nhận được file PDF, chỉ cần sử dụng ứng dụng camera trên điện thoại thông minh quét vào mã QR. Điện thoại sẽ tự động mở trang web xác thực của hệ thống Rubber ERP và hiển thị rõ ràng:\n  + Dòng trạng thái xanh lá: 'VĂN BẢN ĐANG CÓ HIỆU LỰC'.\n  + Số hiệu văn bản, tên tài liệu, lần ban hành (Rev), ngày hiệu lực.\n  + Họ tên người soạn thảo, người xem xét, người phê duyệt và thời gian ký số chính xác.\n  + Trường hợp văn bản đã bị thu hồi hoặc đã có bản mới thay thế, hệ thống sẽ bật cảnh báo đỏ: 'VĂN BẢN NÀY ĐÃ HẾT HIỆU LỰC - VUI LÒNG SỬ DỤNG BẢN CẬP NHẬT MỚI NHẤT'. Cơ chế này đã loại bỏ hoàn toàn nguy cơ dùng nhầm biểu mẫu cũ tại nhà máy.",
            { indent: 400 }
          ),

          createHeading3("2.6. Hệ thống phân quyền chi tiết RBAC và Nhật ký kiểm toán bảo mật:"),
          createPara(
            "Để bảo đảm tính toàn vẹn và bảo mật thông tin nội bộ, hệ thống được trang bị kiến trúc kiểm soát an toàn nghiêm ngặt:",
            { indent: 400 }
          ),
          createPara(
            "• Phân quyền RBAC chuẩn hóa: Thay vì phân quyền chung chung, hệ thống kiểm soát quyền hạn dựa trên từng mã hành động cụ thể và được Việt hóa rõ nghĩa như `iso.create` (Soạn thảo văn bản), `iso.review` (Xem xét văn bản), `iso.approve` (Phê duyệt ban hành), `signing.manage` (Quản lý chữ ký số)... bảo đảm nguyên tắc đúng người - đúng việc - đúng thẩm quyền.",
            { indent: 400 }
          ),
          createPara(
            "• Nhật ký hệ thống (Audit Trail) bất biến: Mọi hành động (mở xem, tạo mới, chỉnh sửa, gửi duyệt, từ chối, ký số, tải file) đều được hệ thống tự động ghi nhật ký chi tiết gồm: Mã nhân viên thực hiện, Thời điểm chính xác, Địa chỉ IP, Thiết bị truy cập và Mã băm văn bản. Nhật ký này được khóa bảo vệ, không ai có thể xóa hay sửa đổi, phục vụ đắc lực cho công tác hậu kiểm và thanh tra.",
            { indent: 400 }
          ),

          createHeading2("3. Hiệu quả của sáng kiến"),
          createHeading3("3.1. Hiệu quả về mặt chuyên môn, kỹ thuật và quản lý:"),
          createPara(
            "• Rút ngắn 95% thời gian phê duyệt: Thời gian luân chuyển và ký duyệt một hồ sơ ISO từ mức trung bình 3 - 5 ngày trước đây đã giảm xuống chỉ còn từ 5 đến 15 phút. Ngay cả khi Ban Giám đốc đi công tác hoặc về phép tại Việt Nam, các văn bản vẫn được ký duyệt tức thì trên điện thoại thông minh, không làm gián đoạn bất kỳ hoạt động sản xuất nào của nhà máy.",
            { indent: 400 }
          ),
          createPara(
            "• Đảm bảo 100% tính tuân thủ quy chuẩn ISO 9001:2015: Loại bỏ triệt để 100% các lỗi Không phù hợp (NC) liên quan đến việc sử dụng biểu mẫu hết hiệu lực hoặc thiếu chữ ký xác nhận của các khâu bàn giao trong các đợt đánh giá chứng nhận hàng năm.",
            { indent: 400 }
          ),
          createPara(
            "• Tối ưu hóa năng suất lao động: Cán bộ kỹ thuật và nhân viên kế toán thống kê không còn phải mất thời gian in ấn, chạy đi trình ký thủ công qua các phòng ban, giúp giải phóng thời gian để tập trung vào công tác chuyên môn và kiểm soát chất lượng mủ cao su.",
            { indent: 400 }
          ),

          createHeading3("3.2. Hiệu quả kinh tế và xã hội:"),
          createPara(
            "• Tiết kiệm chi phí văn phòng phẩm và in ấn trực tiếp: Hàng năm giảm tiêu thụ hơn 25 ram giấy in A4, hàng chục hộp mực máy in và chi phí mua sắm cặp còng, tủ lưu trữ; tiết kiệm trực tiếp cho công ty ước tính khoảng 65.000.000 VNĐ/năm.",
            { indent: 400 }
          ),
          createPara(
            "• Tiết kiệm chi phí đầu tư phần mềm thương mại: So với việc phải chi trả khoảng 150.000.000 đến 250.000.000 VNĐ để mua gói phần mềm văn phòng điện tử bên ngoài cùng chi phí duy trì bản quyền từ 30.000.000 đến 50.000.000 VNĐ/năm, sáng kiến tự phát triển nội bộ đã tiết kiệm cho doanh nghiệp hàng trăm triệu đồng ngay trong năm đầu tiên.",
            { indent: 400 }
          ),
          createPara(
            "• Giá trị xã hội và môi trường: Giảm thiểu rác thải giấy, hướng tới mô hình nhà máy xanh - nhà máy số (Green & Digital Factory); nâng cao trình độ ứng dụng công nghệ thông tin cho toàn thể cán bộ công nhân viên, tạo tiền đề vững chắc cho công cuộc chuyển đổi số toàn diện của Tập đoàn VRG.",
            { indent: 400 }
          ),

          createHeading3("3.3. Bảng số liệu minh chứng so sánh kết quả Trước và Sau khi áp dụng sáng kiến:"),
          createPara(
            "Bảng tổng hợp đối chiếu định lượng các chỉ tiêu vận hành thực tế tại Nhà máy Chế biến Cao su Phước Hòa Kampong Thom:",
            { indent: 400, italics: true }
          ),

          buildComparisonTable(),

          createPara("", { spaceAfter: 200 }),

          createHeading2("4. Khả năng áp dụng và mở rộng của sáng kiến"),
          createPara(
            "• Khả năng nhân rộng nội bộ: Sáng kiến đã được áp dụng thành công tại toàn bộ các phòng ban chuyên môn của Nhà máy Chế biến Cao su Phước Hòa Kampong Thom (Phòng Kỹ thuật, Phòng Quản lý chất lượng KCS, Bộ phận Kho thành phẩm, Đội xe vận tải và Bộ phận Kế toán).",
            { indent: 400 }
          ),
          createPara(
            "• Khả năng mở rộng cho toàn Công ty: Hệ thống sẵn sàng mở rộng áp dụng cho khối Nông trường (quản lý sổ sách giao nhận mủ tại các Đội, Nông trường cao su) và Khối Văn phòng Công ty (quản lý văn bản đi/đến, tờ trình nội bộ).",
            { indent: 400 }
          ),
          createPara(
            "• Khả năng chuyển giao cho các đơn vị bạn trong Tập đoàn VRG: Mô hình kiến trúc phần mềm Rubber ERP và giải pháp ký số nội bộ phân cấp hoàn toàn có thể đóng gói, chuyển giao và áp dụng rất hiệu quả cho các Công ty cao su khác của Tập đoàn Công nghiệp Cao su Việt Nam đang đầu tư tại Campuchia (như Công ty TNHH Phát triển Cao su Bà Rịa Kampong Thom, Công ty TNHH Cao su Tân Biên Kampong Thom, v.v.), mang lại giá trị kinh tế và hiệu quả quản trị to lớn trên quy mô toàn ngành.",
            { indent: 400 }
          ),

          createHeading1("PHẦN III: KẾT LUẬN VÀ KIẾN NGHỊ"),

          createHeading2("1. Kết luận"),
          createPara(
            "Sáng kiến \"Số hóa toàn diện hệ thống biểu mẫu ISO 9001:2015 và ứng dụng công nghệ ký số điện tử phân cấp, xác thực mã QR trên nền tảng Rubber ERP\" là một công trình nghiên cứu và ứng dụng công nghệ thông tin nghiêm túc, bám sát hơi thở thực tiễn sản xuất tại Nhà máy Chế biến Cao su Phước Hòa Kampong Thom.",
            { indent: 400 }
          ),
          createPara(
            "Đề tài đã giải quyết triệt để bài toán ách tắc phê duyệt chứng từ do khoảng cách địa lý, xóa bỏ gánh nặng sổ sách giấy tờ cồng kềnh, loại bỏ 100% nguy cơ sử dụng biểu mẫu hết hiệu lực và bảo đảm tính toàn vẹn pháp lý của tài liệu bằng công nghệ mật mã học hiện đại. Với chi phí đầu tư gần như bằng không do đội ngũ kỹ thuật nội bộ tự nghiên cứu làm chủ, sáng kiến đã mang lại hiệu quả kinh tế rõ rệt, tiết kiệm hàng chục triệu đồng mỗi năm và nâng tầm hình ảnh chuyên nghiệp, hiện đại của doanh nghiệp trong mắt các đối tác khách hàng quốc tế.",
            { indent: 400 }
          ),

          createHeading2("2. Kiến nghị và đề xuất"),
          createPara(
            "Để tiếp tục duy trì, hoàn thiện và phát huy tối đa hiệu quả của sáng kiến trong thời gian tới, Nhóm tác giả xin trân trọng kiến nghị với Hội đồng Khoa học Công nghệ và Ban Lãnh đạo Công ty một số nội dung sau:",
            { indent: 400 }
          ),
          createPara(
            "1. Ban hành Quy chế quản lý văn bản và Ký số điện tử nội bộ chính thức: Ban hành văn bản công nhận giá trị pháp lý nội bộ đầy đủ của các chứng từ, biểu mẫu ký số trên hệ thống Rubber ERP, cho phép bãi bỏ hoàn toàn việc in ấn lưu trữ song song bản giấy đối với các quy trình đã số hóa.",
            { indent: 400 }
          ),
          createPara(
            "2. Duy trì hạ tầng máy chủ và sao lưu định kỳ: Tiếp tục phê duyệt kinh phí duy trì máy chủ điện toán đám mây (~300 USD/năm) và trang bị cơ chế sao lưu dự phòng tự động (Auto-backup) hàng ngày để bảo đảm an toàn dữ liệu tuyệt đối trong mọi tình huống.",
            { indent: 400 }
          ),
          createPara(
            "3. Khen thưởng và động viên kịp thời: Đề nghị Hội đồng Khoa học Công nghệ Công ty xem xét xếp loại Sáng kiến Cải tiến loại A cấp Công ty và đề xuất Tập đoàn Công nghiệp Cao su Việt Nam khen thưởng, nhằm động viên tinh thần đổi mới sáng tạo, chuyển đổi số của đội ngũ cán bộ kỹ thuật trẻ tại địa bàn dự án Campuchia.",
            { indent: 400 }
          ),

          createHeading1("PHẦN TÀI LIỆU THAM KHẢO VÀ PHỤ LỤC"),

          createHeading2("1. Danh mục tài liệu tham khảo"),
          createPara("1. Tiêu chuẩn Quốc gia TCVN ISO 9001:2015 / ISO 9001:2015 – Hệ thống quản lý chất lượng – Các yêu cầu (Mục 7.5 - Thông tin dạng văn bản).", { indent: 400 }),
          createPara("2. Luật Giao dịch điện tử số 20/2023/QH15 được Quốc hội nước Cộng hòa Xã hội Chủ nghĩa Việt Nam thông qua ngày 22/06/2023.", { indent: 400 }),
          createPara("3. Nghị định số 130/2018/NĐ-CP của Chính phủ quy định chi tiết thi hành Luật Giao dịch điện tử về chữ ký số và dịch vụ chứng thực chữ ký số.", { indent: 400 }),
          createPara("4. Tiêu chuẩn quốc tế ETSI TS 102 778 – Electronic Signatures and Infrastructures (ESI); PDF Advanced Electronic Signature Profiles (PAdES).", { indent: 400 }),
          createPara("5. Chuẩn mật mã khóa công khai PKCS #1 v2.2: RSA Cryptography Standard (IETF RFC 8017).", { indent: 400 }),
          createPara("6. Sổ tay Chất lượng và Hệ thống quy trình tác nghiệp của Nhà máy Chế biến Cao su Phước Hòa Kampong Thom.", { indent: 400 }),

          createHeading2("2. Phụ lục minh họa"),
          createHeading3("Phụ lục 1: Bảng quy chuẩn hệ thống mã tài liệu và biểu mẫu ISO trên hệ thống ERP"),
          buildDocCodesTable(),

          createPara("", { spaceAfter: 200 }),
          createHeading3("Phụ lục 2: Mô hình kiến trúc mật mã học của Chữ ký số PAdES và Mã QR xác thực"),
          createPara(
            "• Thuật toán ký: RSA-2048 bit với chuẩn đệm PKCS#1 v1.5; hàm băm dữ liệu SHA-256.\n• Cấu trúc chứng thư số: X.509 v3 phát hành bởi Rubber ERP Root CA, bao gồm thông tin Common Name (Họ tên người ký), Department (Phòng ban), Role (Chức danh) và Thời hạn hiệu lực.\n• Cơ chế băm kiểm tra toàn vẹn (Integrity Hash): Hash = SHA-256(Raw_PDF_Content). Khi người dùng quét mã QR, hệ thống tiến hành đối chiếu mã băm tức thì để phát hiện can thiệp số liệu.\n• Đường dẫn tra cứu công khai: https://qlsxkpt.vercel.app/iso/verify?id=[Document_UUID]&v=[Hash_Prefix].",
            { indent: 400 }
          ),

          createPara("", { spaceAfter: 400 }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE },
              bottom: { style: BorderStyle.NONE },
              left: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE },
              insideHorizontal: { style: BorderStyle.NONE },
              insideVertical: { style: BorderStyle.NONE },
            },
            rows: [
              new TableRow({
                children: [
                  createCell(
                    [
                      createPara("XÁC NHẬN CỦA LÃNH ĐẠO ĐƠN VỊ", { bold: true, alignment: AlignmentType.CENTER, size: 24 }),
                      createPara("GIÁM ĐỐC NHÀ MÁY", { bold: true, alignment: AlignmentType.CENTER, size: 23 }),
                      createPara("", { spaceAfter: 800 }),
                      createPara("(Ký, ghi rõ họ tên và đóng dấu)", { italics: true, alignment: AlignmentType.CENTER, size: 22 }),
                    ],
                    { widthPercent: 50 }
                  ),
                  createCell(
                    [
                      createPara("Kampong Thom, ngày ..... tháng ..... năm 2026", { italics: true, alignment: AlignmentType.CENTER, size: 23 }),
                      createPara("ĐẠI DIỆN NHÓM TÁC GIẢ SÁNG KIẾN", { bold: true, alignment: AlignmentType.CENTER, size: 24 }),
                      createPara("CHỦ NHIỆM ĐỀ TÀI", { bold: true, alignment: AlignmentType.CENTER, size: 23 }),
                      createPara("", { spaceAfter: 800 }),
                      createPara("Vương Nguyễn Phương Lâm", { bold: true, alignment: AlignmentType.CENTER, size: 24 }),
                    ],
                    { widthPercent: 50 }
                  ),
                ],
              }),
            ],
          }),

          createPara("", { spaceAfter: 400 }),
          createPara("---------------------------------------------------------------------------------------------------------------------------------", { alignment: AlignmentType.CENTER }),
          createPara("PHẦN XÉT DUYỆT CỦA HỘI ĐỒNG KHOA HỌC CÔNG NGHỆ CÔNG TY", {
            bold: true,
            alignment: AlignmentType.CENTER,
            size: 26,
            spaceAfter: 100,
          }),
          createPara("(Đánh giá, nhận xét và xếp loại sáng kiến cải tiến kỹ thuật cấp Công ty năm 2026)", {
            italics: true,
            alignment: AlignmentType.CENTER,
            size: 24,
            spaceAfter: 160,
          }),
          createPara("1. Ý kiến nhận xét của Hội đồng KHCN: ....................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................", { indent: 400, spaceAfter: 120 }),
          createPara("2. Kết luận và Xếp loại của Hội đồng: ....................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................................", { indent: 400, spaceAfter: 200 }),

          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE },
              bottom: { style: BorderStyle.NONE },
              left: { style: BorderStyle.NONE },
              right: { style: BorderStyle.NONE },
              insideHorizontal: { style: BorderStyle.NONE },
              insideVertical: { style: BorderStyle.NONE },
            },
            rows: [
              new TableRow({
                children: [
                  createCell(
                    [
                      createPara("THƯ KÝ HỘI ĐỒNG", { bold: true, alignment: AlignmentType.CENTER, size: 24 }),
                      createPara("", { spaceAfter: 800 }),
                      createPara("(Ký và ghi rõ họ tên)", { italics: true, alignment: AlignmentType.CENTER, size: 22 }),
                    ],
                    { widthPercent: 50 }
                  ),
                  createCell(
                    [
                      createPara("CHỦ TỊCH HỘI ĐỒNG KHCN", { bold: true, alignment: AlignmentType.CENTER, size: 24 }),
                      createPara("", { spaceAfter: 800 }),
                      createPara("(Ký, ghi rõ họ tên và đóng dấu)", { italics: true, alignment: AlignmentType.CENTER, size: 22 }),
                    ],
                    { widthPercent: 50 }
                  ),
                ],
              }),
            ],
          }),
        ],
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: "Báo cáo sáng kiến cải tiến ISO & Ký số - Trang ",
                    font: FONT_NAME,
                    size: 20,
                    italics: true,
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    font: FONT_NAME,
                    size: 20,
                    bold: true,
                  }),
                ],
              }),
            ],
          }),
        },
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  console.log(`Report 1 Word docx generated successfully at: ${outputPath}`);
}

async function main() {
  const outDocx = path.resolve("cung_cap_dl/BAO_CAO_SANG_KIEN_01_QUAN_LY_ISO_VA_KY_SO.docx");
  await generateReport1Docx(outDocx);
}

main().catch(console.error);

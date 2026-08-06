"use client"

// i18n tối giản cho các bề mặt hướng đến khách hàng nước ngoài — mặc định tiếng Anh.
// Phạm vi: /dashboard/customer-portal/* (Customer Portal), /login (song ngữ cho mọi
// người dùng nhưng mặc định tiếng Việt ở đó — xem hasStoredCustomerPortalLang), khung
// dashboard (sidebar/header/thông báo) khi đang đăng nhập bằng role="customer", và
// trang trung gian /dashboard/eudr/lookup dùng để chuyển hướng QR trong file DDS.
// KHÔNG dùng cho phần còn lại của app (nội bộ nhân viên vẫn thuần tiếng Việt).

export type CustomerPortalLang = "vi" | "en"

const STORAGE_KEY = "customer_portal_lang"
const LANG_CHANGE_EVENT = "customer-portal-lang-changed"

export function getStoredCustomerPortalLang(): CustomerPortalLang {
  if (typeof window === "undefined") return "en"
  return window.localStorage.getItem(STORAGE_KEY) === "vi" ? "vi" : "en"
}

// true nếu người dùng đã từng chọn ngôn ngữ tường minh (ở bất kỳ trang nào dùng chung
// key này) — dùng để trang /login (mặc định tiếng Việt cho đa số nhân viên) chỉ theo
// lựa chọn cũ khi nó thực sự tồn tại, không ăn theo default "en" của Customer Portal.
export function hasStoredCustomerPortalLang(): boolean {
  if (typeof window === "undefined") return false
  return window.localStorage.getItem(STORAGE_KEY) !== null
}

export function setStoredCustomerPortalLang(lang: CustomerPortalLang) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STORAGE_KEY, lang)
}

// Lưu lựa chọn + phát sự kiện để các thành phần khác đang mở cùng lúc (vd khung
// dashboard layout.tsx và nội dung Customer Portal render trong `children`) tự đồng bộ
// lại ngôn ngữ ngay lập tức, không cần tải lại trang.
export function broadcastCustomerPortalLangChange(lang: CustomerPortalLang) {
  setStoredCustomerPortalLang(lang)
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<CustomerPortalLang>(LANG_CHANGE_EVENT, { detail: lang }))
}

// Đăng ký lắng nghe thay đổi ngôn ngữ phát ra từ broadcastCustomerPortalLangChange (kể cả
// khi phát ra từ 1 component khác trên cùng trang). Trả về hàm huỷ đăng ký, dùng trực
// tiếp làm cleanup của useEffect.
export function onCustomerPortalLangChange(handler: (lang: CustomerPortalLang) => void): () => void {
  if (typeof window === "undefined") return () => {}
  const listener = (e: Event) => handler((e as CustomEvent<CustomerPortalLang>).detail)
  window.addEventListener(LANG_CHANGE_EVENT, listener)
  return () => window.removeEventListener(LANG_CHANGE_EVENT, listener)
}

const STRINGS = {
  vi: {
    // Customer Portal — danh sách đơn hàng
    myOrders: "Đơn hàng của tôi",
    myOrdersSubtitle: "Danh sách đơn xuất hàng được cấp quyền xem, kèm chuỗi truy xuất nguồn gốc EUDR",
    loading: "Đang tải...",
    noOrders: "Chưa có đơn hàng nào được cấp quyền xem.",
    dateLabel: "Ngày",
    productTypeLabel: "Chủng loại",
    totalBalesLabel: "Tổng bánh",
    customerLabel: "Khách hàng",
    errorLoadOrders: "Không tải được danh sách đơn hàng.",
    backToList: "Quay lại danh sách",
    ddsPlantation: "DDS Lô vườn (PDF)",
    ddsShipment: "DDS Lô hàng (PDF)",
    geoJson: "GeoJSON",
    downloadAll: "Tải tất cả",
    downloadOne: "Tải về",
    kpiLots: "Số lô",
    kpiStorage: "Số ngăn lưu",
    kpiDeliveryPoints: "Điểm giao nhận",
    kpiPolygons: "Polygon lô vườn",
    plantationMap: "Bản đồ lô vườn",
    noPolygonData: "Không có dữ liệu polygon lô vườn cho đơn hàng này.",
    lotListTitle: "Danh sách lô thành phẩm",
    colLotCode: "Mã lô",
    colProductionDate: "Ngày sản xuất",
    colExtractionDate: "Ngày trích xuất",
    colCertification: "Chứng nhận",
    errorMissingFactory: "Thiếu thông tin nhà máy để tạo DDS.",
    errorGenerateDds: "Không tạo được file DDS.",
    errorLoadOrderDetail: "Không tải được chi tiết đơn hàng.",
    orderNotFound: "Không tìm thấy đơn hàng.",
    attachmentsTitle: "Tệp đính kèm",

    // Bản đồ lô — khung chi tiết khi click 1 lô (Customer Portal)
    plotFieldTeam: "Đội",
    plotFieldSubTeam: "Đội nhỏ",
    plotFieldPlantation: "Nông trường",
    plotFieldVariety: "Giống",
    plotFieldArea: "Diện tích",
    plotFieldPlantingYear: "Năm trồng",
    plotFieldTappingOpenYear: "Năm mở cạo",
    plotFieldTappingAge: "Tuổi cạo",
    plotFieldTreeCount: "Tổng cây KK",
    plotFieldTappingPanel: "Mặt cạo",
    plotFieldTappingRegime: "Chế độ cạo",
    plotFieldSoilGrade: "Hạng đất",
    plotFieldSpacing: "Khoảng cách",
    plotFieldElevation: "Cao trình",
    plotFieldCoordinates: "Tọa độ",
    unitYears: "năm",

    // Trang đăng nhập (/login)
    loginTab: "Đăng nhập",
    registerTab: "Đăng ký",
    factorySubtitle: "NHÀ MÁY CHẾ BIẾN",
    systemSubtitle: "HỆ THỐNG QUẢN LÝ SẢN XUẤT",
    bootingMessage: "Đang kiểm tra phiên đăng nhập và tải dữ liệu ban đầu...",
    selectFactoryPlaceholder: "Chọn nhà máy",
    fullNamePlaceholder: "Họ tên *",
    emailPlaceholder: "Email cá nhân *",
    departmentPlaceholder: "Phòng ban",
    usernamePlaceholder: "Tên đăng nhập *",
    passwordPlaceholder: "Mật khẩu *",
    processingButton: "Đang xử lý...",
    errorFillCreds: "Vui lòng nhập tên đăng nhập và mật khẩu",
    errorWrongCreds: "Sai tên đăng nhập hoặc mật khẩu",
    errorFillAllRequired: "Vui lòng nhập đầy đủ thông tin bắt buộc",
    errorInvalidEmail: "Vui lòng nhập email hợp lệ",
    errorUsernameTaken: "Tên đăng nhập đã tồn tại",
    errorCannotRegister: "Không thể đăng ký. Vui lòng thử lại.",
    errorCannotLoadSession: "Không thể tải phiên đăng nhập tự động. Bạn vẫn có thể đăng nhập thủ công.",
    registerSuccessNotice: "Đăng ký thành công. Tài khoản đang ở trạng thái chờ phê duyệt.",
    reasonPending: "Tài khoản đã đăng nhập nhưng đang chờ admin phê duyệt.",
    reasonDisabled: "Tài khoản đã bị khóa. Vui lòng liên hệ admin.",
    reasonNoFactory: "Tài khoản chưa được gán nhà máy.",
    reasonGeneric: "Tài khoản không thể truy cập hệ thống",

    // Khung dashboard (sidebar/header/thông báo) khi role="customer"
    factoryNameShort: "Nhà máy chế biến Phước Hòa KPT",
    factorySystemShort: "Hệ thống quản lý sản xuất",
    notifications: "Thông báo",
    tasksToDoPrefix: "Việc cần làm",
    markAllRead: "Đánh dấu tất cả đã đọc",
    noNotifications: "Không có thông báo",
    logout: "Đăng xuất",
    openNav: "Mở menu điều hướng",
    closeLabel: "Đóng",

    // Trang trung gian /dashboard/eudr/lookup
    redirecting: "Đang chuyển hướng...",
    lookupMissingCode: "Thiếu mã đơn hàng trong đường dẫn.",
    lookupOrderNotFound: "Không tìm thấy đơn hàng hoặc bạn chưa được cấp quyền xem.",
    lookupNoAccess: "Tài khoản của bạn không có quyền xem trang này. Vui lòng liên hệ admin.",
    lookupBackToOrders: "Quay lại Đơn hàng của tôi",
  },
  en: {
    // Customer Portal — order list
    myOrders: "My Orders",
    myOrdersSubtitle: "Export orders you have been granted access to, including EUDR traceability",
    loading: "Loading...",
    noOrders: "No orders have been granted to you yet.",
    dateLabel: "Date",
    productTypeLabel: "Product type",
    totalBalesLabel: "Total bales",
    customerLabel: "Customer",
    errorLoadOrders: "Unable to load your orders.",
    backToList: "Back to list",
    ddsPlantation: "Plantation DDS (PDF)",
    ddsShipment: "Shipment DDS (PDF)",
    geoJson: "GeoJSON",
    downloadAll: "Download all",
    downloadOne: "Download",
    kpiLots: "Lots",
    kpiStorage: "Storage bins",
    kpiDeliveryPoints: "Delivery points",
    kpiPolygons: "Plantation polygons",
    plantationMap: "Plantation map",
    noPolygonData: "No plantation polygon data available for this order.",
    lotListTitle: "Finished lot list",
    colLotCode: "Lot code",
    colProductionDate: "Production date",
    colExtractionDate: "Extraction date",
    colCertification: "Certification",
    errorMissingFactory: "Missing factory information to generate the DDS.",
    errorGenerateDds: "Could not generate the DDS file.",
    errorLoadOrderDetail: "Unable to load order details.",
    orderNotFound: "Order not found.",
    attachmentsTitle: "Attachments",

    // Plantation map — plot detail panel on click (Customer Portal)
    plotFieldTeam: "Team",
    plotFieldSubTeam: "Sub-team",
    plotFieldPlantation: "Plantation",
    plotFieldVariety: "Clone / Variety",
    plotFieldArea: "Area",
    plotFieldPlantingYear: "Year of planting",
    plotFieldTappingOpenYear: "Tapping opening year",
    plotFieldTappingAge: "Tapping age",
    plotFieldTreeCount: "Total trees (KK)",
    plotFieldTappingPanel: "Tapping panel",
    plotFieldTappingRegime: "Tapping regime",
    plotFieldSoilGrade: "Soil grade",
    plotFieldSpacing: "Spacing",
    plotFieldElevation: "Elevation",
    plotFieldCoordinates: "Coordinates",
    unitYears: "years",

    // Login page
    loginTab: "Login",
    registerTab: "Register",
    factorySubtitle: "PROCESSING FACTORY",
    systemSubtitle: "PRODUCTION MANAGEMENT SYSTEM",
    bootingMessage: "Checking your session and loading initial data...",
    selectFactoryPlaceholder: "Select factory",
    fullNamePlaceholder: "Full name *",
    emailPlaceholder: "Personal email *",
    departmentPlaceholder: "Department",
    usernamePlaceholder: "Username *",
    passwordPlaceholder: "Password *",
    processingButton: "Processing...",
    errorFillCreds: "Please enter your username and password",
    errorWrongCreds: "Incorrect username or password",
    errorFillAllRequired: "Please fill in all required fields",
    errorInvalidEmail: "Please enter a valid email address",
    errorUsernameTaken: "This username is already taken",
    errorCannotRegister: "Could not register. Please try again.",
    errorCannotLoadSession: "Could not auto-load your session. You can still sign in manually.",
    registerSuccessNotice: "Registration successful. Your account is pending approval.",
    reasonPending: "Your account is pending admin approval.",
    reasonDisabled: "Your account has been disabled. Please contact the admin.",
    reasonNoFactory: "Your account has not been assigned to a factory.",
    reasonGeneric: "Your account cannot access the system",

    // Dashboard chrome (sidebar/header/notifications) for role="customer"
    factoryNameShort: "Phuoc Hoa KPT Processing Factory",
    factorySystemShort: "Production Management System",
    notifications: "Notifications",
    tasksToDoPrefix: "Tasks to do",
    markAllRead: "Mark all as read",
    noNotifications: "No notifications",
    logout: "Log out",
    openNav: "Open navigation menu",
    closeLabel: "Close",

    // /dashboard/eudr/lookup intermediate page
    redirecting: "Redirecting...",
    lookupMissingCode: "Missing order code in the link.",
    lookupOrderNotFound: "Order not found, or you have not been granted access to it.",
    lookupNoAccess: "Your account does not have access to this page. Please contact the admin.",
    lookupBackToOrders: "Back to My Orders",
  },
} as const

export type CustomerPortalStringKey = keyof (typeof STRINGS)["en"]

export function tCustomerPortal(lang: CustomerPortalLang, key: CustomerPortalStringKey): string {
  return STRINGS[lang][key]
}

// Nhãn sidebar/nhóm điều hướng nội bộ (tiếng Việt) -> tiếng Anh, chỉ áp dụng khi hiển thị
// khung dashboard cho role="customer". Dùng map tra theo nhãn gốc (không theo `key` route)
// để không phải sửa cấu trúc NAV trong layout.tsx — nhãn nào chưa có trong map thì giữ
// nguyên bản gốc (an toàn, không vỡ hiển thị nếu bỏ sót 1 mục hiếm khi customer được cấp
// thêm quyền ngoài mặc định export.view_own).
const NAV_LABEL_EN: Record<string, string> = {
  "Dashboard": "Dashboard",
  "Đơn hàng của tôi": "My Orders",
  "Ghi chú nhanh": "Quick Notes",
  "Công việc & KPI": "Tasks & KPI",
  "Bản đồ lô": "Plot Map",
  "EUDR / Truy xuất": "EUDR / Traceability",
  "Quản lý sản xuất": "Production Management",
  "Điều xe": "Dispatch",
  "Sản lượng": "Output",
  "Kho nguyên liệu": "Raw Material Storage",
  "Quản lý kho": "Inventory Management",
  "Thành phẩm": "Finished Products",
  "Kho thành phẩm": "Finished Goods Warehouse",
  "Chất lượng": "Quality Control",
  "Xuất hàng": "Export",
  "Bảo trì": "Maintenance",
  "Kiểm soát quá trình": "Process Control",
  "ISO & Văn bản": "ISO & Documents",
  "Quản lý ISO": "ISO Management",
  "Văn bản nội bộ": "Internal Documents",
  "Cài đặt": "Settings",
}

export function translateNavLabel(label: string, lang: CustomerPortalLang): string {
  if (lang !== "en") return label
  return NAV_LABEL_EN[label] || label
}

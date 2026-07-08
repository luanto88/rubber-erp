"use client"

// i18n tối giản riêng cho Customer Portal (khách hàng bên ngoài, chủ yếu quốc tế —
// mặc định tiếng Anh). KHÔNG dùng cho phần còn lại của app — chỉ scope trong
// /dashboard/customer-portal/*.

export type CustomerPortalLang = "vi" | "en"

const STORAGE_KEY = "customer_portal_lang"

export function getStoredCustomerPortalLang(): CustomerPortalLang {
  if (typeof window === "undefined") return "en"
  return window.localStorage.getItem(STORAGE_KEY) === "vi" ? "vi" : "en"
}

export function setStoredCustomerPortalLang(lang: CustomerPortalLang) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STORAGE_KEY, lang)
}

const STRINGS = {
  vi: {
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
  },
  en: {
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
  },
} as const

export type CustomerPortalStringKey = keyof (typeof STRINGS)["en"]

export function tCustomerPortal(lang: CustomerPortalLang, key: CustomerPortalStringKey): string {
  return STRINGS[lang][key]
}

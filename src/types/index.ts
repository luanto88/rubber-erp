export interface Factory {
  id: string
  code: string
  name: string
  prefix: 'CSR' | 'SVR'
  location: string
}

export interface User {
  id: string
  username: string
  auth_email?: string
  full_name: string
  role: 'admin' | 'manager' | 'user' | 'customer'
  factory_id: string | null
  department?: string
  status: 'pending' | 'active' | 'disabled'
  permissions: string[]
  approved_by?: string | null
  approved_at?: string | null
  disabled_by?: string | null
  disabled_at?: string | null
}

export interface Ngan {
  id: string
  factory_id: string
  ma_ngan: string
  ten_ngan: string
  loai_nl: string
  nguon_goc: string
  xu_ly: string
  chung_nhan: string
  ngay_bd: string
  ngay_kt: string | null
  trang_thai: string
  tong_tuoi: number
  tong_kho: number
  trips: string[]
  lo_nguon_goc: string
}

export interface Lot {
  id: string
  factory_id: string
  ma_lo: string
  num: number
  suffix: string
  year: string
  ngay_sx: string
  ngay_ht: string | null
  ca: string
  ngan_id: string | null
  loai_csr: string
  loai_banh: number
  boc: string
  tham: string
  pallet: string[]
  chi_thi: string
  kien_a: number
  kien_b: number
  kien_c: number
  kien_d: number
  tong_banh: number
  tong_kg: number
  trang_thai: 'Dở dang' | 'Hoàn thành'
  dd_snapshot: Record<string, unknown> | null
  ghi_chu: string
}

export interface LotTransaction {
  id: string
  lot_id: string
  ngan_id: string
  ca: string
  ngay_nhap: string
  kien_a: number
  kien_b: number
  kien_c: number
  kien_d: number
  so_banh: number
  so_kg: number
  created_at?: string
  created_by?: string | null
}

export interface LotWithTransactions extends Lot {
  lot_transactions?: LotTransaction[]
}

export interface QCResult {
  id: string
  factory_id: string
  lot_id: string
  ma_lo: string
  pkn: number
  ma_kl: string | null
  ngay_kn: string
  ngay_sx: string
  chung_loai: string
  loai_csr: string
  loai_kn: string
  tieu_chuan: string
  so_mau: number
  samples: Record<string, number[]>
  grade: Record<string, unknown>
  dat_hang: string
  trang_thai: 'dat' | 'rot'
  parent_id: string | null
  lan: number
  ly_do: string | null
  nguoi_kn: string
  ghi_chu: string
  audit_log: unknown[]
}

export interface Customer {
  id: string
  factory_id: string
  ma_kh: string
  ten_kh_en: string
  email: string
  dia_chi: string
}

export interface ExportOrder {
  id: string
  factory_id: string
  ma_don: string
  ngay: string
  so_thong_bao: string
  so_hoa_don: string
  so_hop_dong: string
  customer_id: string
  chung_loai: string
  loai_pallet: string
  vehicles: unknown[]
  assignments: unknown[]
  tong_banh: number
}

export interface Suffix {
  id: string
  factory_id: string
  code: string
  name: string
  nguon: string
  chung_nhan: string
  congty: string
}

export interface DispatchDriver {
  id: string
  factory_id: string
  code: string | null
  name: string
  phone: string | null
  is_active: boolean
  created_at?: string
  updated_at?: string
}

export interface DispatchVehicle {
  id: string
  factory_id: string
  code: string
  name: string
  vehicle_type: string | null
  plate_number: string | null
  sort_order: number
  is_active: boolean
  created_at?: string
  updated_at?: string
}

export interface DispatchVehicleDriverAssignment {
  id: string
  factory_id: string
  vehicle_id: string
  driver_id: string
  effective_from: string
  effective_to: string | null
  is_current: boolean
  note: string | null
  created_at?: string
  updated_at?: string
}

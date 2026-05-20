export type DispatchVehicleFallback = {
  key: string
  ten: string
  loai: string
  ma_hieu: string
  tai_xe: string
}

export const FALLBACK_VEHICLES: DispatchVehicleFallback[] = [
  { key: "xe001", ten: "Cozon nội bộ 1B", loai: "Cozon nội bộ", ma_hieu: "1B", tai_xe: "Sreng Seng Hoang" },
  { key: "xe002", ten: "Cozon nội bộ 2B", loai: "Cozon nội bộ", ma_hieu: "2B", tai_xe: "Young Sok Khum" },
  { key: "xe003", ten: "Cozon nội bộ 3B", loai: "Cozon nội bộ", ma_hieu: "3B", tai_xe: "Uk SaRath" },
  { key: "xe004", ten: "Cozon vận chuyển 4B", loai: "Cozon vận chuyển", ma_hieu: "4B", tai_xe: "Mao Borey" },
  { key: "xe005", ten: "Cozon vận chuyển 5B", loai: "Cozon vận chuyển", ma_hieu: "5B", tai_xe: "Seng Sam Nang" },
  { key: "xe006", ten: "Cozon vận chuyển 6B", loai: "Cozon vận chuyển", ma_hieu: "6B", tai_xe: "Kum Dat" },
  { key: "xe007", ten: "Cozon vận chuyển 7B", loai: "Cozon vận chuyển", ma_hieu: "7B", tai_xe: "Mao Borey" },
  { key: "xe008", ten: "Cozon vận chuyển 8B", loai: "Cozon vận chuyển", ma_hieu: "8B", tai_xe: "Nut An" },
  { key: "xe009", ten: "Cozon vận chuyển 9B", loai: "Cozon vận chuyển", ma_hieu: "9B", tai_xe: "Ren Makara" },
  { key: "xe010", ten: "ISUZU 1A", loai: "Isuzu vận chuyển", ma_hieu: "1A", tai_xe: "Nut An" },
  { key: "xe011", ten: "ISUZU 2A", loai: "Isuzu vận chuyển", ma_hieu: "2A", tai_xe: "Moa Morn" },
  { key: "xe012", ten: "ISUZU 3A", loai: "Isuzu vận chuyển", ma_hieu: "3A", tai_xe: "Men Sam Nang" },
  { key: "xe013", ten: "ISUZU 4A", loai: "Isuzu vận chuyển", ma_hieu: "4A", tai_xe: "Seng Chhun Ly" },
  { key: "xe014", ten: "ISUZU 5A", loai: "Isuzu vận chuyển", ma_hieu: "5A", tai_xe: "Seng Sam Nang" },
  { key: "xe015", ten: "ISUZU 6A", loai: "Isuzu vận chuyển", ma_hieu: "6A", tai_xe: "Yim Kun" },
  { key: "xe016", ten: "ISUZU 7A", loai: "Isuzu vận chuyển", ma_hieu: "7A", tai_xe: "Vorn RoThy" },
  { key: "xe017", ten: "ISUZU 8A", loai: "Isuzu vận chuyển", ma_hieu: "8A", tai_xe: "Vorn Rany" },
  { key: "xe018", ten: "ISUZU 9A", loai: "Isuzu vận chuyển", ma_hieu: "9A", tai_xe: "Yath Ry" },
  { key: "xe019", ten: "ISUZU 10A", loai: "Isuzu vận chuyển", ma_hieu: "10A", tai_xe: "Chhov Sok Khum" },
  { key: "xe020", ten: "ISUZU 11A", loai: "Isuzu vận chuyển", ma_hieu: "11A", tai_xe: "Say Chom Rong" },
  { key: "xe021", ten: "ISUZU 12A", loai: "Isuzu vận chuyển", ma_hieu: "12A", tai_xe: "Sok Thy" },
  { key: "xe022", ten: "ISUZU 13A", loai: "Isuzu vận chuyển", ma_hieu: "13A", tai_xe: "Yim Kun" },
  { key: "xe023", ten: "ISUZU 14A", loai: "Isuzu vận chuyển", ma_hieu: "14A", tai_xe: "Chhoun Khet" },
  { key: "xe024", ten: "ISUZU 15A", loai: "Isuzu vận chuyển", ma_hieu: "15A", tai_xe: "Ren Makara" },
  { key: "xe025", ten: "ISUZU 16A", loai: "Isuzu vận chuyển", ma_hieu: "16A", tai_xe: "Nhorm Pov PaNha" },
  { key: "xe026", ten: "ISUZU 17A", loai: "Isuzu vận chuyển", ma_hieu: "17A", tai_xe: "Phorn Khim" },
  { key: "xe027", ten: "ISUZU 18A", loai: "Isuzu vận chuyển", ma_hieu: "18A", tai_xe: "Choun Khea" },
  { key: "xe028", ten: "ISUZU 19A", loai: "Isuzu vận chuyển", ma_hieu: "19A", tai_xe: "Sun Seng Ly" },
  { key: "xe029", ten: "ISUZU 20A", loai: "Isuzu vận chuyển", ma_hieu: "20A", tai_xe: "Yoeng Nha" },
  { key: "xe030", ten: "ISUZU 21A", loai: "Isuzu vận chuyển", ma_hieu: "21A", tai_xe: "Chhun Khea" },
  { key: "xe031", ten: "ISUZU 22A", loai: "Isuzu vận chuyển", ma_hieu: "22A", tai_xe: "Seng Sam Nang" },
  { key: "xe032", ten: "ISUZU 23A", loai: "Isuzu vận chuyển", ma_hieu: "23A", tai_xe: "Phun Nang" },
  { key: "xe033", ten: "Xúc SX 01", loai: "Xúc sản xuất", ma_hieu: "X01", tai_xe: "Uk SaRath" },
  { key: "xe034", ten: "Xúc SX 02", loai: "Xúc sản xuất", ma_hieu: "X02", tai_xe: "Pheap Phin" },
  { key: "xe035", ten: "Xúc Biomass", loai: "Xúc Biomass", ma_hieu: "X03", tai_xe: "Anh 3 bảo" },
  { key: "xe036", ten: "Nâng 01", loai: "Nâng sản xuất", ma_hieu: "N01", tai_xe: "Ban So Sieng" },
  { key: "xe037", ten: "Nâng 02", loai: "Nâng sản xuất", ma_hieu: "N02", tai_xe: "Keo Sarath" },
  { key: "xe038", ten: "Ford", loai: "Ford bán tải", ma_hieu: "XF", tai_xe: "Bao Thea" },
]

export const FALLBACK_DRIVERS = [...new Set(FALLBACK_VEHICLES.map((item) => item.tai_xe))].sort()

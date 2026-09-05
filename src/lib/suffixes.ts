export type SuffixOption = {
  code: string
  name: string
  nguon: string
  chung_nhan: string
}

export const DEFAULT_SUFFIXES: SuffixOption[] = [
  { code: "cs", name: "Cao su nông trường", nguon: "NT", chung_nhan: "PEFC CS" },
  { code: "m", name: "Thu mua / Mua ngoài", nguon: "M", chung_nhan: "Không" },
  { code: "gctpk", name: "Gia công TPK", nguon: "GCTPK", chung_nhan: "Không" },
  { code: "gccpk", name: "Gia công CPK", nguon: "GCCPK", chung_nhan: "Không" },
  { code: "tl", name: "Thanh lý", nguon: "TL", chung_nhan: "Không" },
]

export type DiemGN = {
  ma_lo: string; lat: number; lng: number; doi: number
  phien_a: string[]; phien_b: string[]; phien_c: string[]; phien_d: string[]
}

export const DIEM_GN: DiemGN[] = [
  { ma_lo:"B5",  doi:2,  lat:12.632736, lng:105.495549, phien_a:["A3","A4","A5","A6","A7","B4","B5","B6","B7","C4","C5D","C5T","D4","D5D","D5T","E4","E5"], phien_b:["B4","C4","D4","E4"], phien_c:["E5","D5D","C5D","C5T"], phien_d:["A3","A4","A5"] },
  { ma_lo:"C16", doi:5,  lat:12.628052, lng:105.546290, phien_a:["A14","A15","A16","A17","A18","B14","B15","B16","B17","B18","C14","C15D","C15T","C16","C17","C18"], phien_b:["A14","B15","B14","C14"], phien_c:["A15","A16","A17","A18"], phien_d:["B18","B17","C17","C18"] },
  { ma_lo:"C17", doi:5,  lat:12.628048, lng:105.550884, phien_a:["A14","A15","A16","A17","A18","B14","B15","B16","B17","B18","C14","C15D","C15T","C16","C17","C18"], phien_b:["A14","B15","B14","C14"], phien_c:["A15","A16","A17","A18"], phien_d:["B18","B17","C17","C18"] },
  { ma_lo:"D9",  doi:2,  lat:12.623630, lng:105.513983, phien_a:["A8","A9","A10","B8","B9","B10","C7","C8","C9","C10","D6","D7","D8","D10"], phien_b:["A8","A9","A10","B8"], phien_c:["B9","B10","C9","C10"], phien_d:["D6","D7","C6","C7"] },
  { ma_lo:"D11", doi:5,  lat:12.623617, lng:105.523006, phien_a:["A11","A12","A13","B11","B12","B13","C11","C12","C13","D11","D12","E11","E12","F11","F12"], phien_b:["A11","A12","B11","B12"], phien_c:["A13","B13","C13","D12"], phien_d:["C11","C12","D11","F12"] },
  { ma_lo:"E1",  doi:1,  lat:12.619189, lng:105.477754, phien_a:["A1","A2","B1","B2","B3","C1","C2","C3","D1","D2","D3","E1","E2D","E2T","E3","F1","F2","F3D","F3T"], phien_b:["A1","A2","B1","B2","B3"], phien_c:["C1","C2","C3","D1"], phien_d:["D2","E1","E2D","E2T","E3"] },
  { ma_lo:"F16", doi:8,  lat:12.614454, lng:105.546214, phien_a:["D13","D14","D15S","D15T","D16","D17","D18","E13","E14","E15","E16","E17","E18","F13","F14","F15"], phien_b:["D13","D14","D15S","D15T","D16","D17"], phien_c:["D17","D18","E16","E17","E18"], phien_d:["E16","E14","E15","E13"] },
  { ma_lo:"G3",  doi:1,  lat:12.610155, lng:105.486360, phien_a:["F4","F5","G1","G2","G3","G4","G5","H1","H2","H2D","H3","H3D","H4T","H4S","H5","H6T","H6S","I3","I4","I5","J4"], phien_b:["G1","G2","G3","H1","H2"], phien_c:["H3","H4T","G4","F4"], phien_d:["F5","G5","G6"] },
  { ma_lo:"G5",  doi:1,  lat:12.610102, lng:105.495616, phien_a:[], phien_b:[], phien_c:[], phien_d:[] },
  { ma_lo:"G8",  doi:3,  lat:12.609511, lng:105.509254, phien_a:["E6","E7","E8","E9","F6D","F6T","F7","F8","F9D","F9T","G7","G8","G9","H8","H9"], phien_b:["E6","E7","E8","F6D","F6T"], phien_c:["D9","E9","F9D","F9T","F8"], phien_d:["F7","G7","G8","G9"] },
  { ma_lo:"G9",  doi:3,  lat:12.610070, lng:105.513951, phien_a:[], phien_b:[], phien_c:[], phien_d:[] },
  { ma_lo:"H11", doi:6,  lat:12.605554, lng:105.524477, phien_a:["F10","G10","G11","G12","H10","H11","H12","I10","I11","I12","J13","J14"], phien_b:["F10","G10","H10"], phien_c:["G11","H11","I11"], phien_d:["G12","H12","J14"] },
  { ma_lo:"I16", doi:8,  lat:12.600919, lng:105.546180, phien_a:["F16","F17","F18","G17","G18","H16","H17","H18","I16","I17","I18","J16","J17","J18"], phien_b:["F16","F17","F18","G17"], phien_c:["G17","G18","H18","H17"], phien_d:["H17","H16","I16","I17","I18"] },
  { ma_lo:"J7",  doi:3,  lat:12.596465, lng:105.504800, phien_a:["H7","I6","I7","I8","I9","J5","J6T","J6S","J7","J8","J9","K5","K6","K7","K8","K9D","K9T","L6T","L7T","L7S","L8T","L8S"], phien_b:["H7","I7","I8","I9"], phien_c:["I6","J5","J6T","J6S","K5","K6","L6T"], phien_d:["J7","J8","J9","I9"] },
  { ma_lo:"K10", doi:6,  lat:12.591972, lng:105.518578, phien_a:["M9D","M9T","M10","M12","L9","L10","L11","L12","K9D","K9T","K10","K11","K12B","K12N","J10","J11","J12"], phien_b:["M9D","M9T","M10","M11","L9","L10","L11","K9D","K9T"], phien_c:["K10","K11","L11","J10"], phien_d:["J11","J12","L12","K12B","K12N"] },
  { ma_lo:"L2",  doi:4,  lat:12.587526, lng:105.481750, phien_a:["I1","I2","J1T","J1D","J2","K1","K2","K3","K4","K5D","K5T","L1","L2","L3","L4","L5D","M1","M2","M3","N1","N2"], phien_b:["I1","I2","J1T","J1D","J2","K1"], phien_c:["K2","K3","K4","K5D","K5T","L4","L5T","L3"], phien_d:["L1","L2","L3","M3"] },
  { ma_lo:"L12", doi:6,  lat:12.587459, lng:105.526876, phien_a:[], phien_b:[], phien_c:[], phien_d:[] },
  { ma_lo:"L14", doi:7,  lat:12.586751, lng:105.537313, phien_a:["N13","N14","N15","N16","M13S","M13T","M14","M15","M16","L14","L15","L16","K15","K16"], phien_b:["N14","N15","N16"], phien_c:["N13","M13S","M13T","M14","L14","L15"], phien_d:["L15","M15","M16"] },
  { ma_lo:"C2",  doi:1,  lat:12.628201, lng:105.481744, phien_a:[], phien_b:[], phien_c:[], phien_d:[] },
  { ma_lo:"Q7",  doi:10, lat:12.564886, lng:105.504734, phien_a:["O4","O5","O6","O7","O8","P5","P6","P7","P8","P9","Q5","Q6","Q7","Q8","Q9","R5","R6","R7","R8","R9","R10","S4","S5S"], phien_b:["O4","O5","O7","Q5","R5","R6","S4","S5T"], phien_c:["O6","P5","P6","Q6","Q7","R7","R8"], phien_d:["O8","P7","P8","P9","Q8","Q9","R9","R10"] },
  { ma_lo:"P11", doi:10, lat:12.569342, lng:105.523130, phien_a:["O9","O10","O11","P10","P11","Q10"], phien_b:[], phien_c:[], phien_d:[] },
  { ma_lo:"U2",  doi:9,  lat:12.546942, lng:105.482256, phien_a:["T1","T2","T3","T4","U1","U2","U3","U4","V1S","V2S","V2T","V3S","V3T","V4S","V4T","V5S","V5T"], phien_b:["S1","S2","S3","T1","T2","T3"], phien_c:["U1","V1S","V2S","V2T","U2"], phien_d:["T4","U3","U4"] },
  { ma_lo:"P3",  doi:9,  lat:12.569427, lng:105.486326, phien_a:["O1","O2","O3","P1","P2","P3","P4","Q1","Q2","Q3","Q4","R1","R2","R3","R4"], phien_b:["O1","O2","P1","P2"], phien_c:["Q1","Q2","R1","R2"], phien_d:["O3","P3","Q3","R3"] },
  { ma_lo:"T7",  doi:11, lat:12.551328, lng:105.504718, phien_a:["S5T","S6","T5","T6","T7","T8","U5","U6","U7","U8","V6S","V6T","V7S","V7T","V8T"], phien_b:["S5T","S6","T5","T6"], phien_c:["T7","T8","U7"], phien_d:["U5","U6","V6S","V6T"] },
  { ma_lo:"U11", doi:11, lat:12.545692, lng:105.523100, phien_a:["S8","S9","S10T","S10D","S11","T9","T10","T11","T12","U9","U10","U11","U12","U13","V9T","V10T","V8S","V9S","V10S"], phien_b:["S8","S9","T9","U9"], phien_c:["U10","V9T","V10T","V8S","V9S","V10S"], phien_d:["S10D","S10T","S11","T10","T11T","U11"] },
  { ma_lo:"S15", doi:12, lat:12.555721, lng:105.541486, phien_a:["R15","R16","S14","S15","S16","T14","T15","T16"], phien_b:[], phien_c:[], phien_d:["R15","R16","S15","S16"] },
  { ma_lo:"S12", doi:12, lat:12.555755, lng:105.527695, phien_a:["O12","P12","Q11","Q12","Q13T","R11","R12","R13T","R14","S12","S13","T13"], phien_b:["O12","P12","Q11","Q12","Q13T","R11","R13D","R14"], phien_c:["R12","S12","S13","T13"], phien_d:[] },
  { ma_lo:"P14", doi:12, lat:12.569299, lng:105.536918, phien_a:["O13","O14","O15","O16","P13","P14","P15","P16","Q13D","Q14","Q15","Q16"], phien_b:[], phien_c:["O13","O14","P13","P14"], phien_d:["O15","O16","P15","P16"] },
  { ma_lo:"H13", doi:7,  lat:12.605372, lng:105.532396, phien_a:["G13Đ","G14Đ","G14T","G13T","G15Đ","G15T","G16Đ","G16T"], phien_b:["G16T","G15Đ","G15T","H13Đ","H13T","H14Đ","H14T","H15T"], phien_c:["H15Đ","H15T","I-13Đ","I-13T","I-14Đ","I-14T","I-15Đ","I-15T"], phien_d:["I-13Đ","J15Đ","J15T","K13Đ","K13T","K14Đ","K14T"] },
  { ma_lo:"N7",  doi:4,  lat:12.578057, lng:105.504718, phien_a:["L5T","L5D","L6D","L6T","L7T","L7S","M4","M5","M6","M7","M8","N4","N5","N6","N7","N8"], phien_b:["L5T","L5D","M4","M5","N4","N5"], phien_c:["M6","M7","M8","N6","N7","N8"], phien_d:[] },
]

export function buildLoThuHoach(diem_gn: string[], phien: string[]): string[] {
  const lots: string[] = []
  for (const dgn of diem_gn) {
    const d = DIEM_GN.find(g => g.ma_lo === dgn)
    if (!d) continue
    for (const p of phien) {
      const key = `phien_${p.replace(/Phiên\s*/i, "").toLowerCase()}` as keyof DiemGN
      const pLots = d[key]
      if (Array.isArray(pLots)) lots.push(...(pLots as string[]))
    }
  }
  return [...new Set(lots)]
}

import { NextRequest, NextResponse } from "next/server"
import { spawn } from "node:child_process"
import path from "node:path"
import { requireAuthUser, supabaseAdmin } from "@/app/api/account/_lib/security"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuthUser(req)

    // Kiểm tra quyền: Admin hoặc có quyền quality.tech_support
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("id, role, factory_id")
      .eq("id", authUser.id)
      .single()

    if (profileErr || !profile) {
      return NextResponse.json({ success: false, error: "Không tìm thấy hồ sơ người dùng" }, { status: 401 })
    }

    if (profile.role !== "admin") {
      // Kiểm tra trong user_permissions
      const { data: userPerms } = await supabaseAdmin
        .from("user_permissions")
        .select("permission_code, granted")
        .eq("user_id", authUser.id)

      let hasPerm = false
      if (userPerms && userPerms.length > 0) {
        hasPerm = userPerms.some(
          (p: any) =>
            (p.permission_code === "quality.tech_support" || p.permission_code === "quality.import") &&
            p.granted === true,
        )
      } else {
        const { data: rolePerms } = await supabaseAdmin
          .from("role_permissions")
          .select("permission_code")
          .eq("role", profile.role)

        hasPerm = (rolePerms || []).some(
          (p: any) => p.permission_code === "quality.tech_support" || p.permission_code === "quality.import",
        )
      }

      if (!hasPerm) {
        return NextResponse.json(
          { success: false, error: "Bạn không có quyền thực hiện chức năng hỗ trợ kỹ thuật KQKN" },
          { status: 403 },
        )
      }
    }

    // Đọc FormData hoặc JSON
    const contentType = req.headers.get("content-type") || ""
    let fileBuffer: Buffer
    let filename = "KQKN.pdf"
    let nSamples = 6
    let tieuChuan = "TCCS 112:2022"

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData()
      const file = formData.get("file") as File | null
      if (!file) {
        return NextResponse.json({ success: false, error: "Chưa chọn file PDF biểu KQKN" }, { status: 400 })
      }
      filename = file.name || "KQKN.pdf"
      const arrayBuf = await file.arrayBuffer()
      fileBuffer = Buffer.from(arrayBuf)

      const samplesParam = formData.get("n_samples")
      if (samplesParam) nSamples = parseInt(String(samplesParam), 10) || 6

      const tieuChuanParam = formData.get("tieu_chuan")
      if (tieuChuanParam) tieuChuan = String(tieuChuanParam)
    } else {
      const body = await req.json()
      if (!body.pdf_base64) {
        return NextResponse.json({ success: false, error: "Thiếu dữ liệu file PDF (pdf_base64)" }, { status: 400 })
      }
      fileBuffer = Buffer.from(body.pdf_base64, "base64")
      if (body.filename) filename = String(body.filename)
      if (body.n_samples) nSamples = parseInt(String(body.n_samples), 10) || 6
      if (body.tieu_chuan) tieuChuan = String(body.tieu_chuan)
    }

    if (!filename.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ success: false, error: "Định dạng file không hợp lệ (yêu cầu file .pdf)" }, { status: 400 })
    }

    // Đường dẫn script Python
    const scriptPath = path.join(process.cwd(), "src", "server", "scripts", "parse_kqkn.py")
    const pdfBase64 = fileBuffer.toString("base64")

    // Gọi Python script qua stdin-base64
    const result = await new Promise<any>((resolve, reject) => {
      const pyProcess = spawn("python", [
        scriptPath,
        "--stdin-base64",
        String(nSamples),
        tieuChuan,
        filename
      ])

      let stdoutData = ""
      let stderrData = ""

      pyProcess.stdout.on("data", (chunk) => {
        stdoutData += chunk.toString("utf-8")
      })

      pyProcess.stderr.on("data", (chunk) => {
        stderrData += chunk.toString("utf-8")
      })

      pyProcess.on("close", (code) => {
        let jsonString = stdoutData.trim()
        const startMarker = "__KQKN_JSON_START__"
        const endMarker = "__KQKN_JSON_END__"

        if (jsonString.includes(startMarker) && jsonString.includes(endMarker)) {
          jsonString = jsonString.slice(
            jsonString.indexOf(startMarker) + startMarker.length,
            jsonString.indexOf(endMarker),
          ).trim()
        } else {
          // Bỏ qua cảnh báo như "Consider using the pymupdf_layout..."
          const firstBrace = jsonString.indexOf("{")
          const lastBrace = jsonString.lastIndexOf("}")
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            jsonString = jsonString.slice(firstBrace, lastBrace + 1)
          }
        }

        if (code !== 0) {
          try {
            const parsedErr = JSON.parse(jsonString)
            if (parsedErr.error) return reject(new Error(parsedErr.error))
          } catch {
            // Dùng stderrData nếu không parse được json
          }
          return reject(new Error(stderrData.trim() || `Lỗi xử lý file PDF (mã thoát ${code})`))
        }

        try {
          const parsed = JSON.parse(jsonString)
          resolve(parsed)
        } catch (e: any) {
          reject(new Error(`Không thể giải mã kết quả phân tích: ${e.message}\n${stdoutData.slice(0, 300)}`))
        }
      })

      pyProcess.on("error", (err) => {
        reject(new Error(`Không thể khởi động trình phân tích Python: ${err.message}`))
      })

      // Ghi dữ liệu base64 vào stdin
      pyProcess.stdin.write(pdfBase64)
      pyProcess.stdin.end()
    })

    return NextResponse.json(result)
  } catch (err: any) {
    console.error("[API parse-pdf error]:", err)
    return NextResponse.json(
      { success: false, error: err.message || "Lỗi máy chủ khi xử lý biểu KQKN" },
      { status: 500 }
    )
  }
}

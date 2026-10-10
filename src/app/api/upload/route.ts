import { NextRequest, NextResponse } from 'next/server'
import { writeFile, readFile, unlink, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const type = formData.get('type') as string

    if (!file || !type) {
      return NextResponse.json({ error: 'File dan type wajib' }, { status: 400 })
    }

    // Determine file type
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    const isDocx = file.name.toLowerCase().endsWith('.docx') ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

    if (!isPdf && !isDocx) {
      return NextResponse.json({ 
        error: 'Format tidak didukung. Gunakan PDF atau DOCX.',
      }, { status: 400 })
    }

    // Save to temp file with correct extension
    const ext = isDocx ? 'docx' : 'pdf'
    const tempPath = join(tmpdir(), `upload-${Date.now()}.${ext}`)
    const bytes = await file.arrayBuffer()
    await writeFile(tempPath, Buffer.from(bytes))

    let text = ''

    if (isPdf) {
      // PDF extraction using pdftotext (poppler-utils)
      try {
        const { stdout } = await execAsync(`pdftotext -layout "${tempPath}" -`)
        text = stdout
      } catch {
        // Fallback: Python pdfplumber
        const pyScript = join(tmpdir(), `extract-${Date.now()}.py`)
        await writeFile(pyScript, `
import pdfplumber
with pdfplumber.open("${tempPath}") as pdf:
    for page in pdf.pages:
        t = page.extract_text()
        if t:
            print(t)
`)
        try {
          const { stdout } = await execAsync(`/home/z/.venv/bin/python3 "${pyScript}"`)
          text = stdout
          await unlink(pyScript)
        } catch {
          text = ''
        }
      }
    } else if (isDocx) {
      // DOCX extraction using pandoc (fast, handles formatting)
      try {
        const { stdout } = await execAsync(`pandoc -f docx -t plain "${tempPath}"`)
        text = stdout
      } catch {
        // Fallback: Python python-docx
        const pyScript = join(tmpdir(), `extract-${Date.now()}.py`)
        await writeFile(pyScript, `
import docx
doc = docx.Document("${tempPath}")
for para in doc.paragraphs:
    if para.text.strip():
        print(para.text)
# Also extract tables
for table in doc.tables:
    for row in table.rows:
        cells = [cell.text.strip() for cell in row.cells]
        print(' | '.join(cells))
`)
        try {
          const { stdout } = await execAsync(`/home/z/.venv/bin/python3 "${pyScript}"`)
          text = stdout
          await unlink(pyScript)
        } catch {
          text = ''
        }
      }
    }

    // Cleanup
    await unlink(tempPath).catch(() => {})

    // Truncate if too long (LLM context limit — keep small for fast response)
    const maxChars = 8000
    if (text.length > maxChars) {
      text = text.substring(0, maxChars) + '\n\n[...dokumen dipotong...]'
    }

    if (!text.trim()) {
      return NextResponse.json({ 
        error: isDocx
          ? 'Tidak bisa ekstrak teks dari DOCX. Pastikan file tidak rusak.'
          : 'Tidak bisa ekstrak teks dari PDF. Pastikan PDF bukan scan gambar.',
        text: '' 
      }, { status: 422 })
    }

    return NextResponse.json({ 
      text,
      chars: text.length,
      type,
      filename: file.name,
      format: isDocx ? 'docx' : 'pdf',
    })
  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ 
      error: 'Gagal memproses file' 
    }, { status: 500 })
  }
}

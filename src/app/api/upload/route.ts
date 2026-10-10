import { NextRequest, NextResponse } from 'next/server'
import { writeFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'

export const runtime = 'nodejs'

const execFileAsync = promisify(execFile)
const MAX_FILE_SIZE = 15 * 1024 * 1024
const MAX_TEXT_CHARS = 8_000
const ALLOWED_TYPES = new Set(['penuntun', 'sumber', 'lembar'])

async function run(command: string, args: string[]) {
  return execFileAsync(command, args, {
    timeout: 30_000,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  })
}

export async function POST(request: NextRequest) {
  let tempPath = ''
  let pyScript = ''

  try {
    const formData = await request.formData()
    const file = formData.get('file')
    const type = formData.get('type')

    if (!(file instanceof File) || typeof type !== 'string') {
      return NextResponse.json({ error: 'File dan type wajib diisi.' }, { status: 400 })
    }
    if (!ALLOWED_TYPES.has(type)) {
      return NextResponse.json({ error: 'Kategori dokumen tidak valid.' }, { status: 400 })
    }
    if (!file.name || file.name.length > 200) {
      return NextResponse.json({ error: 'Nama file tidak valid atau terlalu panjang.' }, { status: 400 })
    }
    if (file.size <= 0 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json({
        error: file.size <= 0 ? 'File kosong.' : 'Ukuran file maksimal 15 MB.',
      }, { status: 413 })
    }

    const lowerName = file.name.toLowerCase()
    const isPdf = lowerName.endsWith('.pdf') || file.type === 'application/pdf'
    const isDocx = lowerName.endsWith('.docx') ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

    if (!isPdf && !isDocx) {
      return NextResponse.json({ error: 'Format tidak didukung. Gunakan PDF atau DOCX.' }, { status: 415 })
    }
    if (type !== 'lembar' && !isPdf) {
      return NextResponse.json({ error: 'Penuntun dan Sumber harus berupa PDF.' }, { status: 415 })
    }

    const ext = isDocx ? 'docx' : 'pdf'
    const id = randomUUID()
    tempPath = join(tmpdir(), `laprak-${id}.${ext}`)
    const bytes = Buffer.from(await file.arrayBuffer())
    const validSignature = isPdf
      ? bytes.subarray(0, 5).toString('ascii') === '%PDF-'
      : bytes.subarray(0, 2).toString('ascii') === 'PK'

    if (!validSignature) {
      return NextResponse.json({ error: 'Isi file tidak cocok dengan format PDF/DOCX.' }, { status: 415 })
    }

    await writeFile(tempPath, bytes, { flag: 'wx' })
    let text = ''

    if (isPdf) {
      try {
        text = (await run('pdftotext', ['-layout', tempPath, '-'])).stdout
      } catch {
        pyScript = join(tmpdir(), `laprak-extract-${id}.py`)
        const script = [
          'import json, pdfplumber',
          `path = ${JSON.stringify(tempPath)}`,
          'with pdfplumber.open(path) as pdf:',
          '    for page in pdf.pages:',
          '        text = page.extract_text()',
          '        if text: print(text)',
        ].join('\n')
        await writeFile(pyScript, script, { flag: 'wx' })
        try {
          text = (await run(process.env.PYTHON_BIN || 'python3', [pyScript])).stdout
        } catch {
          console.error('PDF extraction unavailable: pdftotext and pdfplumber fallback failed.')
          return NextResponse.json({
            error: 'Server belum memiliki alat ekstraksi PDF. Pasang poppler-utils atau Python dengan pdfplumber.',
          }, { status: 503 })
        }
      }
    } else {
      try {
        text = (await run('pandoc', ['-f', 'docx', '-t', 'plain', tempPath])).stdout
      } catch {
        pyScript = join(tmpdir(), `laprak-extract-${id}.py`)
        const script = [
          'import docx',
          `path = ${JSON.stringify(tempPath)}`,
          'doc = docx.Document(path)',
          'for para in doc.paragraphs:',
          '    if para.text.strip(): print(para.text)',
          'for table in doc.tables:',
          '    for row in table.rows:',
          '        print(" | ".join(cell.text.strip() for cell in row.cells))',
        ].join('\n')
        await writeFile(pyScript, script, { flag: 'wx' })
        try {
          text = (await run(process.env.PYTHON_BIN || 'python3', [pyScript])).stdout
        } catch {
          console.error('DOCX extraction unavailable: pandoc and python-docx fallback failed.')
          return NextResponse.json({
            error: 'Server belum memiliki alat ekstraksi DOCX. Pasang pandoc atau Python dengan python-docx.',
          }, { status: 503 })
        }
      }
    }

    text = text.trim()
    if (!text) {
      return NextResponse.json({
        error: isDocx
          ? 'Tidak ditemukan teks pada DOCX. Pastikan dokumen tidak rusak atau hanya berisi gambar.'
          : 'Tidak ditemukan teks pada PDF. Jika PDF berupa hasil scan, OCR diperlukan.',
        text: '',
      }, { status: 422 })
    }

    const truncated = text.length > MAX_TEXT_CHARS
    if (truncated) text = text.slice(0, MAX_TEXT_CHARS) + '\n\n[...dokumen dipotong...]'

    return NextResponse.json({
      text,
      chars: text.length,
      truncated,
      type,
      filename: file.name,
      format: ext,
    })
  } catch (error) {
    console.error('Upload processing failed:', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json({ error: 'Gagal memproses file. Periksa format dan ukuran file.' }, { status: 500 })
  } finally {
    if (tempPath) await unlink(tempPath).catch(() => {})
    if (pyScript) await unlink(pyScript).catch(() => {})
  }
}

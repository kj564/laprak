import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import ZAI from 'z-ai-web-dev-sdk'
import { createJob, completeJob, failJob, cleanupOldJobs } from '@/lib/job-store'

export const runtime = 'nodejs'

type UploadedDoc = {
  type: 'penuntun' | 'sumber' | 'lembar'
  name: string
  text: string
}

const VALID_TYPES = new Set(['penuntun', 'sumber', 'lembar'])
const MAX_BODY_CHARS = 1_500_000
const MAX_FILES = 8
const MAX_DOCUMENT_CHARS = 8_000
const MAX_TOTAL_TEXT_CHARS = 45_000

let ppkiGuidelines = ''
try {
  const guidelinesPath = join(process.cwd(), 'src/lib/ppki-guidelines.txt')
  ppkiGuidelines = readFileSync(guidelinesPath, 'utf-8').substring(0, 3000)
} catch {
  console.warn('PPKI guidelines not found')
}

const PPKI_SYSTEM_PROMPT = `Anda adalah asisten yang menyusun laporan praktikum mengikuti PPKI IPB Edisi Ke-4.

ATURAN ANTI-HALUSINASI:
1. HANYA gunakan informasi dari dokumen yang diupload.
2. Jangan mengarang data, angka, hasil pengukuran, observasi, atau referensi.
3. Hasil pengamatan hanya boleh berasal dari Lembar Kerja.
4. Teori hanya boleh berasal dari dokumen Sumber yang diunggah.
5. Jika data tidak tersedia, tulis "[data tidak tersedia di dokumen]".
6. Jika pertanyaan tidak dapat dijawab dari dokumen, jelaskan keterbatasannya secara eksplisit.
7. Jangan menyimpulkan hasil eksperimen yang tidak didukung data.

Sistematika laporan: Abstrak, Pendahuluan, Tinjauan Pustaka, Metode, Hasil dan Pembahasan, Simpulan dan Saran, Daftar Pustaka. Gunakan bahasa formal akademis. ${ppkiGuidelines}`

function validateFiles(value: unknown): { files?: UploadedDoc[]; error?: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: 'Upload minimal satu dokumen yang sudah berhasil diekstrak.' }
  }
  if (value.length > MAX_FILES) {
    return { error: `Maksimal ${MAX_FILES} dokumen per laporan.` }
  }

  const files: UploadedDoc[] = []
  let totalChars = 0

  for (const item of value) {
    if (!item || typeof item !== 'object') return { error: 'Format dokumen tidak valid.' }
    const doc = item as Record<string, unknown>
    if (typeof doc.type !== 'string' || !VALID_TYPES.has(doc.type)) {
      return { error: 'Kategori dokumen tidak valid.' }
    }
    if (typeof doc.name !== 'string' || !doc.name.trim() || doc.name.length > 200) {
      return { error: 'Nama dokumen tidak valid.' }
    }
    if (typeof doc.text !== 'string' || !doc.text.trim()) {
      return { error: `Teks dokumen "${doc.name}" kosong. Upload ulang dokumen tersebut.` }
    }
    if (doc.text.length > MAX_DOCUMENT_CHARS) {
      return { error: `Teks dokumen "${doc.name}" melebihi batas ${MAX_DOCUMENT_CHARS} karakter.` }
    }
    totalChars += doc.text.length
    files.push({ type: doc.type as UploadedDoc['type'], name: doc.name.trim(), text: doc.text })
  }

  if (totalChars > MAX_TOTAL_TEXT_CHARS) {
    return { error: 'Total teks dokumen terlalu besar. Kurangi jumlah dokumen atau unggah dokumen yang lebih ringkas.' }
  }
  return { files }
}

function extractJSON(text: string): unknown {
  let str = text.trim()
  if (str.startsWith('```')) {
    str = str.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')
  }
  const firstBrace = str.indexOf('{')
  const lastBrace = str.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) str = str.slice(firstBrace, lastBrace + 1)
  return JSON.parse(str)
}

function isValidReport(value: unknown): value is { title: string; sections: Array<{ id: string; title: string; content: string; editable: boolean }> } {
  if (!value || typeof value !== 'object') return false
  const report = value as Record<string, unknown>
  if (typeof report.title !== 'string' || !report.title.trim() || report.title.length > 300) return false
  if (!Array.isArray(report.sections) || report.sections.length < 1 || report.sections.length > 20) return false
  return report.sections.every((item) => {
    if (!item || typeof item !== 'object') return false
    const section = item as Record<string, unknown>
    return typeof section.id === 'string' &&
      typeof section.title === 'string' &&
      typeof section.content === 'string' &&
      section.content.length <= 30_000 &&
      typeof section.editable === 'boolean'
  })
}

function buildFallbackReport(files: UploadedDoc[]) {
  const penuntun = files.find(f => f.type === 'penuntun')
  const sumber = files.filter(f => f.type === 'sumber')
  const lembar = files.find(f => f.type === 'lembar')
  const unavailable = '[data tidak tersedia di dokumen]'
  return {
    title: penuntun?.text.split('\n')[0]?.trim().slice(0, 200) || 'Laporan Praktikum',
    sections: [
      { id: 'abstrak', title: 'Abstrak', content: 'Penyusunan abstrak otomatis gagal karena respons AI tidak dapat dibaca. Silakan coba generate ulang.', editable: true },
      { id: 'pendahuluan', title: 'Pendahuluan', content: penuntun?.text.slice(0, 2000) || unavailable, editable: true },
      { id: 'tinjauan-pustaka', title: 'Tinjauan Pustaka', content: sumber.map(s => s.text).join('\n\n').slice(0, 4000) || unavailable, editable: true },
      { id: 'metode', title: 'Metode', content: penuntun?.text.slice(2000, 5000) || unavailable, editable: true },
      { id: 'hasil-pembahasan', title: 'Hasil dan Pembahasan', content: lembar?.text.slice(0, 3000) || unavailable, editable: true },
      { id: 'simpulan-saran', title: 'Simpulan dan Saran', content: unavailable, editable: true },
      { id: 'daftar-pustaka', title: 'Daftar Pustaka', content: sumber.map(s => s.name).join('\n') || unavailable, editable: true },
    ],
  }
}

export async function POST(request: NextRequest) {
  try {
    const contentLength = Number(request.headers.get('content-length') || 0)
    if (contentLength > MAX_BODY_CHARS) {
      return NextResponse.json({ error: 'Payload terlalu besar. Kurangi teks atau jumlah dokumen.' }, { status: 413 })
    }

    const rawBody = await request.text()
    if (rawBody.length > MAX_BODY_CHARS) {
      return NextResponse.json({ error: 'Payload terlalu besar. Kurangi teks atau jumlah dokumen.' }, { status: 413 })
    }

    let body: unknown
    try {
      body = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Body harus berupa JSON yang valid.' }, { status: 400 })
    }

    const input = body && typeof body === 'object' ? body as Record<string, unknown> : {}
    const validation = validateFiles(input.files)
    if (!validation.files) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }
    const files = validation.files

    cleanupOldJobs()
    const jobId = createJob()

    // Background processing keeps the initial API request fast; the job store
    // must be shared/persistent in multi-instance or serverless deployments.
    void (async () => {
      try {
        const penuntun = files.find(f => f.type === 'penuntun')
        const sumberFiles = files.filter(f => f.type === 'sumber')
        const lembar = files.find(f => f.type === 'lembar')
        let context = ''

        if (penuntun) context += `=== PENUNTUN (${penuntun.name}) ===\n${penuntun.text}\n\n`
        sumberFiles.forEach((s, i) => { context += `=== SUMBER ${i + 1} (${s.name}) ===\n${s.text}\n\n` })
        if (lembar) context += `=== LEMBAR KERJA (${lembar.name}) ===\n${lembar.text}\n\n`

        const userPrompt = `Susun laporan praktikum berdasarkan dokumen berikut. Kembalikan HANYA JSON valid.

${context}

Panduan:
- Jawab setiap pertanyaan/tugas di Lembar Kerja; pertanyaan analitis masuk ke Hasil dan Pembahasan.
- Gunakan Penuntun untuk tujuan dan prosedur, serta Sumber untuk teori pendukung.
- Jangan membuat hasil pengamatan, data, angka, atau referensi baru. Tandai informasi yang tidak tersedia.
- Daftar pustaka hanya memuat referensi yang benar-benar dapat diidentifikasi dari dokumen Sumber.

Gunakan struktur JSON:
{"title":"Judul laporan","sections":[
{"id":"abstrak","title":"Abstrak","content":"Ringkasan tujuan, metode, hasil yang tersedia, dan simpulan","editable":true},
{"id":"pendahuluan","title":"Pendahuluan","content":"Latar belakang dan tujuan","editable":true},
{"id":"tinjauan-pustaka","title":"Tinjauan Pustaka","content":"Teori dari Sumber yang diunggah","editable":true},
{"id":"metode","title":"Metode","content":"Prosedur dari Penuntun","editable":true},
{"id":"hasil-pembahasan","title":"Hasil dan Pembahasan","content":"Jawaban pertanyaan Lembar Kerja dan analisis berbasis data yang tersedia","editable":true},
{"id":"simpulan-saran","title":"Simpulan dan Saran","content":"Simpulan sesuai bukti yang tersedia dan saran yang relevan","editable":true},
{"id":"daftar-pustaka","title":"Daftar Pustaka","content":"Referensi yang teridentifikasi dari dokumen Sumber","editable":true}
]}

Jangan gunakan pengetahuan eksternal untuk mengisi data yang hilang. Setiap section harus memiliki id, title, content, dan editable.`

        const zai = await ZAI.create()
        const response = await zai.chat.completions.create({
          messages: [
            { role: 'system', content: PPKI_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
        })

        const content = response.choices[0]?.message?.content || ''
        let report: unknown
        try {
          report = extractJSON(content)
        } catch {
          report = null
        }

        if (!isValidReport(report)) report = buildFallbackReport(files)
        completeJob(jobId, report)
      } catch (err) {
        console.error('Background generate error:', err instanceof Error ? err.message : 'Unknown error')
        failJob(jobId, 'Gagal menyusun laporan. Coba lagi beberapa saat lagi.')
      }
    })()

    return NextResponse.json({ jobId, status: 'processing' }, { status: 202 })
  } catch (error) {
    console.error('Generate request failed:', error instanceof Error ? error.message : 'Unknown error')
    return NextResponse.json({ error: 'Gagal memulai pembuatan laporan.' }, { status: 500 })
  }
}

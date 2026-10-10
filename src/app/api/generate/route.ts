import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { join } from 'path'
import ZAI from 'z-ai-web-dev-sdk'
import { createJob, completeJob, failJob, cleanupOldJobs } from '@/lib/job-store'

type UploadedDoc = {
  type: 'penuntun' | 'sumber' | 'lembar'
  name: string
  text: string
}

// Load PPKI IPB guidelines
let ppkiGuidelines = ''
try {
  const guidelinesPath = join(process.cwd(), 'src/lib/ppki-guidelines.txt')
  const fullText = readFileSync(guidelinesPath, 'utf-8')
  ppkiGuidelines = fullText.substring(0, 3000)
} catch {
  console.warn('PPKI guidelines not found')
}

const PPKI_SYSTEM_PROMPT = `Anda adalah asisten yang menyusun laporan praktikum mengikuti PPKI IPB Edisi Ke-4.

ATURAN ANTI-HALUSINASI (SANGAT PENTING):
1. HANYA gunakan informasi dari dokumen yang diupload (Penuntun, Sumber, Lembar Kerja).
2. JANGAN mengarang data, angka, hasil pengukuran, atau observasi yang tidak ada di dokumen.
3. JANGAN membuat referensi/daftar pustaka yang tidak ada di Sumber yang diupload.
4. JANGAN menambahkan teori atau penjelasan dari pengetahuan eksternal Anda.
5. Jika data tidak tersedia di dokumen → tulis "[data tidak tersedia di dokumen]".
6. Jika pertanyaan Lembar Kerja tidak bisa dijawab dari dokumen → tulis "Berdasarkan dokumen yang tersedia, pertanyaan ini belum dapat dijawab secara lengkap."
7. Daftar Pustaka HANYA berisi sumber yang diupload oleh user — jangan karang referensi.
8. Hasil pengamatan HANYA dari Lembar Kerja — jangan tambahkan data fiktif.
9. Teori HANYA dari Sumber yang diupload — jangan gunakan pengetahuan umum Anda.
10. Jika dokumen tidak lengkap, tulis laporan berdasarkan apa yang ADA — jangan diisi dengan karangan.

Sistematika PPKI: Pendahuluan, Tinjauan Pustaka, Metode, Hasil & Pembahasan, Simpulan & Saran, Daftar Pustaka. Bahasa formal akademis, ringkas, jelas. ${ppkiGuidelines}`

function extractJSON(text: string): any {
  let str = text.trim()
  if (str.startsWith('```')) {
    str = str.replace(/^```(?:json)?\n?/, '').replace(/```\s*$/, '')
  }
  const firstBrace = str.indexOf('{')
  const lastBrace = str.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    str = str.substring(firstBrace, lastBrace + 1)
  }
  try {
    return JSON.parse(str)
  } catch {
    let fixed = str.replace(/\n/g, '\\n').replace(/(?<=[a-zA-Z])"(?=[a-zA-Z])/g, '\\"').replace(/,\s*([}\]])/g, '$1')
    return JSON.parse(fixed)
  }
}

function buildFallbackReport(files: UploadedDoc[]): any {
  const penuntun = files.find(f => f.type === 'penuntun')
  const sumber = files.filter(f => f.type === 'sumber')
  const lembar = files.find(f => f.type === 'lembar')
  const title = penuntun?.text.split('\n')[0]?.trim() || 'Laporan Praktikum'
  const sumberText = sumber.map(s => s.text).join('\n\n') || ''
  return {
    title,
    sections: [
      { id: 'abstrak', title: 'Abstrak', content: `Praktikum ${title}. ${penuntun?.text.substring(0, 300) || ''}...`, editable: true },
      { id: 'pendahuluan', title: 'Pendahuluan', content: penuntun?.text.substring(0, 2000) || 'Latar belakang...', editable: true },
      { id: 'tinjauan-pustaka', title: 'Tinjauan Pustaka', content: sumberText.substring(0, 2000) || 'Dasar teori...', editable: true },
      { id: 'metode', title: 'Metode', content: penuntun?.text.substring(2000, 5000) || 'Prosedur...', editable: true },
      { id: 'hasil-pembahasan', title: 'Hasil dan Pembahasan', content: lembar?.text.substring(0, 2000) || 'Hasil pengamatan...', editable: true },
      { id: 'simpulan-saran', title: 'Simpulan dan Saran', content: 'Kesimpulan dari praktikum dan saran untuk perbaikan.', editable: true },
      { id: 'daftar-pustaka', title: 'Daftar Pustaka', content: sumber.map(s => s.name.replace(/\.[^.]+$/, '')).join('\n') || '', editable: true },
    ],
  }
}

export async function POST(request: NextRequest) {
  try {
    const { files } = await request.json() as { files: UploadedDoc[] }
    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'Tidak ada dokumen' }, { status: 400 })
    }

    cleanupOldJobs()
    const jobId = createJob()

    // Start LLM generation in background (non-blocking)
    ;(async () => {
      try {
        const penuntun = files.find(f => f.type === 'penuntun')
        const sumberFiles = files.filter(f => f.type === 'sumber')
        const lembar = files.find(f => f.type === 'lembar')

        let context = ''
        if (penuntun) context += `=== PENUNTUN (${penuntun.name}) ===\n${penuntun.text}\n\n`
        sumberFiles.forEach((s, i) => { context += `=== SUMBER ${i + 1} (${s.name}) ===\n${s.text}\n\n` })
        if (lembar) context += `=== LEMBAR KERJA (${lembar.name}) ===\n${lembar.text}\n\n`

        const userPrompt = `Berdasarkan dokumen ini, susun laporan praktikum dalam JSON. Pastikan JSON valid (escape \\n dan \\" dalam content).

${context}

PENTING — LEMBAR KERJA:
Lembar Kerja berisi PERTANYAAN/TUGAS yang HARUS DIJAWAB dalam laporan.
- Baca setiap pertanyaan/perintah di Lembar Kerja
- Jawab setiap pertanyaan secara lengkap dan detail di section yang sesuai
- Gunakan data dari Penuntun Praktikum untuk membantu menjawab (prosedur, teori)
- Gunakan Sumber untuk memperkaya jawaban dengan teori pendukung
- Hasil pengamatan dari Lembar Kerja → masuk ke "Hasil dan Pembahasan"
- Pertanyaan analitis (mengapa, jelaskan, bandingkan) → jawab di "Hasil dan Pembahasan"
- Pertanyaan tentang tujuan → jawab di "Pendahuluan"
- Pertanyaan tentang prosedur → jawab di "Metode"

Setiap pertanyaan di Lembar Kerja HARUS terjawab di laporan. Jangan ada pertanyaan yang terlewat.

JSON format:
{"title":"Judul","sections":[
  {"id":"abstrak","title":"Abstrak","content":"Ringkasan: tujuan, metode, hasil, kesimpulan","editable":true},
  {"id":"pendahuluan","title":"Pendahuluan","content":"Latar belakang, tujuan, manfaat, ruang lingkup (jawab pertanyaan Lembar Kerja yang relevan)","editable":true},
  {"id":"tinjauan-pustaka","title":"Tinjauan Pustaka","content":"Dasar teori dari Sumber untuk mendukung jawaban","editable":true},
  {"id":"metode","title":"Metode","content":"Prosedur/cara kerja dari Penuntun (jawab pertanyaan prosedur Lembar Kerja)","editable":true},
  {"id":"hasil-pembahasan","title":"Hasil dan Pembahasan","content":"JAWAB SEMUA PERTANYAAN dari Lembar Kerja di sini. Setiap jawaban disertai analisis dan teori pendukung dari Sumber","editable":true},
  {"id":"simpulan-saran","title":"Simpulan dan Saran","content":"Kesimpulan dari semua jawaban + saran","editable":true},
  {"id":"daftar-pustaka","title":"Daftar Pustaka","content":"Daftar pustaka format hemat","editable":true}
]}

Gunakan Penuntun untuk pendahuluan+metode, Lembar Kerja untuk hasil (JAWAB PERTANYAANNYA), Sumber untuk teori.

ANTI-HALUSINASI: Jangan mengarang data/angka/hasil yang tidak ada di dokumen. Jangan karang referensi. Jika data tidak ada, tulis "[data tidak tersedia]". HANYA gunakan informasi dari dokumen yang diupload.

HANYA JSON, no markdown.`

        const zai = await ZAI.create()
        const response = await zai.chat.completions.create({
          messages: [
            { role: 'system', content: PPKI_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
        })

        const content = response.choices[0]?.message?.content || ''

        let report: any
        try {
          report = extractJSON(content)
        } catch {
          report = buildFallbackReport(files)
        }

        if (!report.title || !report.sections) {
          report = buildFallbackReport(files)
        }

        completeJob(jobId, report)
      } catch (err) {
        console.error('Background generate error:', err)
        failJob(jobId, err instanceof Error ? err.message : 'Unknown error')
      }
    })()

    // Return immediately with job_id — client polls /api/status
    return NextResponse.json({ jobId, status: 'processing' })
  } catch (error) {
    console.error('Generate error:', error)
    return NextResponse.json({ error: 'Gagal memulai generate' }, { status: 500 })
  }
}

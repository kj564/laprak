import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const runtime = 'nodejs'

type ReportSection = {
  id: string
  title: string
  content: string
  editable: boolean
}

type Report = {
  title: string
  sections: ReportSection[]
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as {
      report: Report
      sectionId: string
      context?: string
    }

    if (!body?.report || !body?.sectionId) {
      return NextResponse.json({ error: 'Report dan sectionId wajib' }, { status: 400 })
    }

    const section = body.report.sections.find(s => s.id === body.sectionId)
    if (!section) {
      return NextResponse.json({ error: 'Section tidak ditemukan' }, { status: 400 })
    }

    // Build context from other sections
    const otherSections = body.report.sections
      .filter(s => s.id !== body.sectionId)
      .map(s => `[${s.title}]\n${s.content.substring(0, 500)}`)
      .join('\n\n')

    const extraContext = body.context ? `\n\nKONTEKS TAMBAHAN:\n${body.context}` : ''

    const systemPrompt = `Anda adalah asisten akademik yang menyusun laporan praktikum berbahasa Indonesia mengikuti PPKI IPB Edisi Ke-4.

ATURAN ANTI-HALUSINASI:
- HANYA gunakan informasi dari dokumen/konteks yang diberikan.
- Jangan mengarang data, angka, hasil, atau referensi.
- Jika data tidak tersedia, tulis "[data tidak tersedia di dokumen]".

Tulis dalam bahasa Indonesia formal akademis, ringkas, jelas.`

    const userPrompt = `Tugas: Regenerate HANYA section "${section.title}" dari laporan praktikum ini.

JUDUL LAPORAN: ${body.report.title}

SECTION YANG HARUS DIREGENERATE:
- ID: ${section.id}
- Judul: ${section.title}
- Konten saat ini: ${section.content.substring(0, 500)}...

KONTEKS SECTION LAIN (untuk konsistensi):
${otherSections}${extraContext}

Instruksi:
1. Tulis ulang section "${section.title}" dengan kualitas yang lebih baik.
2. Pastikan konsisten dengan section lain (jangan kontradiksi).
3. Gunakan informasi yang ADA di konteks — jangan karang.
4. Kembalikan HANYA teks konten section (tanpa judul, tanpa JSON, tanpa markdown fence).
5. Jika section ini adalah "Hasil dan Pembahasan", pastikan jawab pertanyaan Lembar Kerja.

Kembalikan HANYA teks konten, tanpa formatting tambahan.`

    const zai = await ZAI.create()
    const response = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
    })

    const newContent = response.choices[0]?.message?.content?.trim() || section.content

    return NextResponse.json({
      sectionId: body.sectionId,
      content: newContent,
    })
  } catch (error) {
    console.error('Regenerate section error:', error)
    return NextResponse.json({ error: 'Gagal regenerate section' }, { status: 500 })
  }
}

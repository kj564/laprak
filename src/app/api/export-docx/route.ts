import { NextRequest, NextResponse } from 'next/server'
import { writeFile, readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'

export const runtime = 'nodejs'
const execFileAsync = promisify(execFile)

type ReportSection = {
  id: string
  title: string
  content: string
}

export async function POST(request: NextRequest) {
  let mdTempPath = ''
  let docxTempPath = ''

  try {
    const { report } = await request.json() as {
      report: { title: string; sections: ReportSection[] }
    }

    if (!report?.title || !report?.sections) {
      return NextResponse.json({ error: 'Data laporan tidak valid' }, { status: 400 })
    }

    // Build markdown content for pandoc
    let markdown = `# ${report.title}\n\n`
    for (const section of report.sections) {
      markdown += `## ${section.title}\n\n${section.content}\n\n`
    }

    // Write markdown to temp file
    mdTempPath = join(tmpdir(), `laprak-${Date.now()}.md`)
    docxTempPath = join(tmpdir(), `laprak-${Date.now()}.docx`)
    await writeFile(mdTempPath, markdown, 'utf8')

    // Convert markdown → DOCX using pandoc
    try {
      await execFileAsync('pandoc', ['-f', 'markdown', '-t', 'docx', '-o', docxTempPath, mdTempPath], {
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
      })
    } catch {
      // Fallback: use python-docx
      const pyScript = join(tmpdir(), `docx-gen-${Date.now()}.py`)
      await writeFile(pyScript, `
import docx
doc = docx.Document()
doc.add_heading("${report.title.replace(/"/g, '\\"')}", 0)
${report.sections.map(s => `
doc.add_heading("${s.title.replace(/"/g, '\\"')}", 1)
for para in """${s.content.replace(/"""/g, '\\"')}""".split('\\n'):
    if para.strip():
        doc.add_paragraph(para)
`).join('')}
doc.save("${docxTempPath}")
`)
      await execFileAsync('/home/z/.venv/bin/python3', [pyScript], { timeout: 30_000 })
      await unlink(pyScript)
    }

    // Read DOCX file
    const docxBuffer = await readFile(docxTempPath)

    // Return as file download
    return new NextResponse(docxBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': 'attachment; filename="laporan-praktikum.docx"',
      },
    })
  } catch (error) {
    console.error('Export DOCX error:', error)
    return NextResponse.json({ error: 'Gagal export DOCX' }, { status: 500 })
  } finally {
    await unlink(mdTempPath).catch(() => {})
    await unlink(docxTempPath).catch(() => {})
  }
}

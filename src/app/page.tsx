'use client'

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { UploadPanel } from '@/components/practicum/upload-panel'
import { ReportPreview } from '@/components/practicum/report-preview'
import { FileText, Sparkles, Download, RotateCcw, CheckCircle2, Loader2, BookOpen } from 'lucide-react'

export type UploadedFile = {
  id: string
  name: string
  type: 'penuntun' | 'sumber' | 'lembar'
  size: number
  text: string
  status: 'uploaded' | 'extracting' | 'extracted' | 'error'
}

export type ReportSection = {
  id: string
  title: string
  content: string
  editable: boolean
}

export type GeneratedReport = {
  title: string
  sections: ReportSection[]
}

export default function Home() {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [generating, setGenerating] = useState(false)
  const [report, setReport] = useState<GeneratedReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)

  const handleGenerate = useCallback(async () => {
    const extractedFiles = files.filter(f => f.status === 'extracted' && f.text)
    if (extractedFiles.length === 0) {
      setError('Upload dan ekstrak minimal 1 file dulu')
      return
    }

    setGenerating(true)
    setError(null)
    setElapsed(0)

    // Timer untuk show elapsed time
    const timer = setInterval(() => {
      setElapsed(prev => prev + 1)
    }, 1000)

    try {
      // Step 1: Start generate job (returns immediately with jobId)
      const startResponse = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: extractedFiles.map(f => ({
            type: f.type,
            name: f.name,
            text: f.text,
          })),
        }),
      })

      if (!startResponse.ok) {
        let serverMessage = ''
        try {
          const errorData = await startResponse.json()
          if (typeof errorData?.error === 'string') serverMessage = errorData.error
        } catch {
          // Response may not be JSON (for example, a proxy error page).
        }
        throw new Error(
          serverMessage
            ? `Gagal memulai generate (${startResponse.status}): ${serverMessage}`
            : `Gagal memulai generate (${startResponse.status}). Periksa log server untuk detail.`
        )
      }

      const startData = await startResponse.json()
      const jobId = startData.jobId

      if (!jobId) {
        throw new Error('Tidak menerima job ID dari server')
      }

      // Step 2: Poll for result every 3 seconds (each poll is fast → no 502)
      const maxWait = 180 // 3 minutes max
      let waitCount = 0

      const pollResult = await new Promise<{ report?: any; error?: string }>((resolve, reject) => {
        const poll = async () => {
          if (waitCount >= maxWait) {
            reject(new Error('Timeout — LLM butuh waktu terlalu lama'))
            return
          }
          waitCount++

          try {
            const res = await fetch(`/api/status?jobId=${jobId}`)
            if (!res.ok) {
              // Retry on error
              setTimeout(poll, 3000)
              return
            }
            const data = await res.json()

            if (data.status === 'done') {
              resolve({ report: data.report })
            } else if (data.status === 'error') {
              resolve({ error: data.error })
            } else {
              // Still processing → poll again in 3s
              setTimeout(poll, 3000)
            }
          } catch {
            // Network error → retry
            setTimeout(poll, 3000)
          }
        }
        poll()
      })

      if (pollResult.error) {
        setError(pollResult.error)
      } else if (pollResult.report) {
        setReport(pollResult.report)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Terjadi kesalahan')
    } finally {
      clearInterval(timer)
      setGenerating(false)
    }
  }, [files])

  const handleSectionEdit = (id: string, content: string) => {
    if (!report) return
    setReport({
      ...report,
      sections: report.sections.map(s =>
        s.id === id ? { ...s, content } : s
      ),
    })
  }

  const handleDownload = () => {
    if (!report) return
    const fullText = `${report.title}\n\n${report.sections.map(s => `${s.title}\n${s.content}`).join('\n\n')}`
    const blob = new Blob([fullText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'laporan-praktikum.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  const allExtracted = files.length >= 1 && files.every(f => f.status === 'extracted')
  const hasPenuntun = files.some(f => f.type === 'penuntun' && f.status === 'extracted')
  const hasLembar = files.some(f => f.type === 'lembar' && f.status === 'extracted')

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <FileText className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900 sm:text-xl">
                Pengerja Laporan Praktikum
              </h1>
              <p className="text-xs text-slate-500">
                Upload dokumen → generate laporan otomatis
              </p>
            </div>
          </div>
          {/* PPKI IPB Badge */}
          <a
            href="/ppki-ipb.pdf"
            download
            className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
            title="Pedoman Penulisan Karya Ilmiah IPB Edisi Ke-4"
          >
            <BookOpen className="h-3.5 w-3.5" />
            PPKI IPB
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {/* Step 1: Upload */}
        <section className="mb-8">
          <div className="mb-4 flex items-center gap-2">
            {allExtracted ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green-500 text-white">
                <CheckCircle2 className="h-4 w-4" />
              </span>
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">1</span>
            )}
            <h2 className="text-base font-semibold text-slate-900">Upload Dokumen</h2>
            {files.length > 0 && (
              <span className="text-xs text-slate-400">{files.length} file terupload</span>
            )}
          </div>
          <UploadPanel files={files} onFilesUpdate={setFiles} />
        </section>

        {/* Step 2: Generate */}
        <section className="mb-8">
          <div className="mb-4 flex items-center gap-2">
            {report ? (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green-500 text-white">
                <CheckCircle2 className="h-4 w-4" />
              </span>
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">2</span>
            )}
            <h2 className="text-base font-semibold text-slate-900">Generate Laporan</h2>
            {report && <span className="text-xs text-green-600">Laporan siap ✓</span>}
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-slate-600">
                  {files.length === 0
                    ? 'Upload dokumen dulu untuk memulai'
                    : hasPenuntun && hasLembar
                    ? `${files.length} dokumen siap. Klik generate untuk menyusun laporan.`
                    : 'Disarankan upload Penuntun Praktikum + Lembar Kerja untuk hasil terbaik'}
                </p>
                {files.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {files.map(f => (
                      <span
                        key={f.id}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                          f.status === 'extracted'
                            ? 'bg-green-100 text-green-700'
                            : f.status === 'extracting'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {f.status === 'extracted' ? <CheckCircle2 className="h-3 w-3" /> : f.status === 'extracting' ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                        {f.type === 'penuntun' ? 'Penuntun' : f.type === 'sumber' ? 'Sumber' : 'Lembar'}: {f.name.substring(0, 20)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={handleGenerate}
                disabled={!allExtracted || generating}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Menyusun... {elapsed > 0 ? `${elapsed}s` : ''}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate Laporan
                  </>
                )}
              </button>
              {generating && (
                <p className="mt-2 text-xs text-slate-500">
                  AI sedang menyusun laporan mengikuti PPKI IPB. Proses ini biasanya 15-60 detik, mohon tunggu...
                </p>
              )}
            </div>
            {error && (
              <p className="mt-3 text-sm text-red-600">{error}</p>
            )}
          </div>
        </section>

        {/* Step 3: Preview & Edit */}
        <AnimatePresence>
          {report && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-8"
            >
              <div className="mb-4 flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green-500 text-white">
                  <CheckCircle2 className="h-4 w-4" />
                </span>
                <h2 className="text-base font-semibold text-slate-900">Preview & Edit Laporan</h2>
                <span className="text-xs text-slate-400">Siap di-download</span>
              </div>
              <ReportPreview
                report={report}
                onSectionEdit={handleSectionEdit}
                onDownload={handleDownload}
                onRegenerate={handleGenerate}
              />
            </motion.section>
          )}
        </AnimatePresence>
      </div>

      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-400">
        Pengerja Laporan Praktikum • Powered by AI
      </footer>
    </main>
  )
}

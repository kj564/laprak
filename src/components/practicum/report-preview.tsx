'use client'

import { useState } from 'react'
import { Download, RotateCcw, Edit3, Save, FileText, Copy, Check, Loader2 } from 'lucide-react'
import type { GeneratedReport } from '@/app/page'

export function ReportPreview({
  report,
  onSectionEdit,
  onDownload,
  onRegenerate,
}: {
  report: GeneratedReport
  onSectionEdit: (id: string, content: string) => void
  onDownload: () => void
  onRegenerate: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const startEdit = (id: string, content: string) => {
    setEditingId(id)
    setEditContent(content)
  }

  const saveEdit = () => {
    if (editingId) {
      onSectionEdit(editingId, editContent)
    }
    setEditingId(null)
  }

  const copySection = (id: string, title: string, content: string) => {
    navigator.clipboard.writeText(`${title}\n\n${content}`)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleExportDocx = async () => {
    setExporting(true)
    try {
      const response = await fetch('/api/export-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report }),
      })
      if (!response.ok) throw new Error('Export gagal')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'laporan-praktikum.docx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export error:', err)
    } finally {
      setExporting(false)
    }
  }

  const getWordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length
  const totalWords = report.sections.reduce((sum, s) => sum + getWordCount(s.content), 0)

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Actions bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-6 py-3">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-slate-900">{report.title}</h3>
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-600">
            {totalWords} kata
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onRegenerate}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-200"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Generate Ulang
          </button>
          <button
            onClick={onDownload}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100"
          >
            <Download className="h-3.5 w-3.5" />
            TXT
          </button>
          <button
            onClick={handleExportDocx}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-40"
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
            DOCX
          </button>
        </div>
      </div>

      {/* Report content */}
      <div className="max-h-[70vh] overflow-y-auto px-6 py-6">
        <article className="max-w-none">
          {report.sections.map((section) => {
            const wordCount = getWordCount(section.content)
            return (
              <div key={section.id} className="mb-6">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h4 className="text-base font-bold text-slate-900">{section.title}</h4>
                    <span className="text-[10px] text-slate-400">{wordCount} kata</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Copy section */}
                    <button
                      onClick={() => copySection(section.id, section.title, section.content)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-emerald-600"
                      title="Copy section"
                    >
                      {copiedId === section.id ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedId === section.id ? 'Copied' : 'Copy'}
                    </button>
                    {/* Edit toggle */}
                    {editingId === section.id ? (
                      <button
                        onClick={saveEdit}
                        className="inline-flex items-center gap-1 text-xs font-medium text-green-600 hover:text-green-700"
                      >
                        <Save className="h-3.5 w-3.5" />
                        Simpan
                      </button>
                    ) : (
                      <button
                        onClick={() => startEdit(section.id, section.content)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-indigo-600"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Edit
                      </button>
                    )}
                  </div>
                </div>
                {editingId === section.id ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 p-3 text-sm leading-relaxed text-slate-700 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    rows={8}
                  />
                ) : (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                    {section.content}
                  </p>
                )}
              </div>
            )
          })}
        </article>
      </div>
    </div>
  )
}

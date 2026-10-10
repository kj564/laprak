'use client'

import { useState } from 'react'
import { Download, RotateCcw, Edit3, Save, Eye } from 'lucide-react'
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

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Actions bar */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-3">
        <h3 className="text-sm font-semibold text-slate-900">{report.title}</h3>
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
            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700"
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </button>
        </div>
      </div>

      {/* Report content */}
      <div className="max-h-[70vh] overflow-y-auto px-6 py-6">
        <article className="prose prose-slate max-w-none">
          {report.sections.map((section) => (
            <div key={section.id} className="mb-6">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-base font-bold text-slate-900">{section.title}</h4>
                {editingId === section.id ? (
                  <button
                    onClick={saveEdit}
                    className="inline-flex items-center gap-1 text-xs font-medium text-green-600 hover:text-green-700"
                  >
                    <Save className="h-3 w-3" />
                    Simpan
                  </button>
                ) : (
                  <button
                    onClick={() => startEdit(section.id, section.content)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-indigo-600"
                  >
                    <Edit3 className="h-3 w-3" />
                    Edit
                  </button>
                )}
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
          ))}
        </article>
      </div>
    </div>
  )
}

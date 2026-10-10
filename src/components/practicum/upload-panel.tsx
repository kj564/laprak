'use client'

import { useState, useCallback } from 'react'
import { Upload, X, Loader2, CheckCircle2, AlertCircle, Plus } from 'lucide-react'
import type { UploadedFile } from '@/app/page'

const UPLOAD_CONFIG = [
  {
    type: 'penuntun' as const,
    title: 'Penuntun Praktikum',
    desc: 'Panduan/instruksi praktikum (PDF)',
    color: 'indigo',
    bg: 'bg-indigo-50',
    border: 'border-indigo-200',
    text: 'text-indigo-700',
    icon: '📋',
    accept: '.pdf,application/pdf',
    multiple: false,
  },
  {
    type: 'sumber' as const,
    title: 'Sumber',
    desc: 'Bahan referensi/materi (PDF) — boleh multiple',
    color: 'emerald',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
    icon: '📚',
    accept: '.pdf,application/pdf',
    multiple: true,
  },
  {
    type: 'lembar' as const,
    title: 'Lembar Kerja',
    desc: 'Template/form kerja (DOCX)',
    color: 'amber',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    icon: '✏️',
    accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.pdf',
    multiple: false,
  },
]

export function UploadPanel({
  files,
  onFilesUpdate,
}: {
  files: UploadedFile[]
  onFilesUpdate: (files: UploadedFile[]) => void
}) {
  const [dragOver, setDragOver] = useState<string | null>(null)

  const handleFile = useCallback(async (file: File, type: 'penuntun' | 'sumber' | 'lembar') => {
    const config = UPLOAD_CONFIG.find(c => c.type === type)!
    const isPdf = file.type === 'application/pdf'
    const isDocx = file.name.toLowerCase().endsWith('.docx') ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

    // Validate based on type
    if (type === 'lembar') {
      if (!isPdf && !isDocx) return
    } else {
      if (!isPdf) return
    }

    const id = `${type}-${Date.now()}`
    const newFile: UploadedFile = {
      id,
      name: file.name,
      type,
      size: file.size,
      text: '',
      status: 'extracting',
    }

    if (config.multiple) {
      // Multiple: just append
      onFilesUpdate([...files, newFile])
    } else {
      // Single: remove existing of same type, add new
      onFilesUpdate([...files.filter(f => f.type !== type), newFile])
    }

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('type', type)

      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error('Upload gagal')
      }

      const data = await response.json()

      onFilesUpdate(prev => prev.map(f =>
        f.id === id
          ? { ...f, text: data.text, status: 'extracted' as const }
          : f
      ))
    } catch (err) {
      onFilesUpdate(prev => prev.map(f =>
        f.id === id
          ? { ...f, status: 'error' as const }
          : f
      ))
    }
  }, [files, onFilesUpdate])

  const handleDrop = useCallback((e: React.DragEvent, type: 'penuntun' | 'sumber' | 'lembar') => {
    e.preventDefault()
    setDragOver(null)
    const droppedFiles = Array.from(e.dataTransfer.files)

    droppedFiles.forEach(file => {
      const isPdf = file.type === 'application/pdf'
      const isDocx = file.name.toLowerCase().endsWith('.docx') ||
        file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

      if (type === 'lembar') {
        if (isPdf || isDocx) handleFile(file, type)
      } else {
        if (isPdf) handleFile(file, type)
      }
    })
  }, [handleFile])

  const handleRemove = (id: string) => {
    onFilesUpdate(files.filter(f => f.id !== id))
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {UPLOAD_CONFIG.map((config) => {
        const typeFiles = files.filter(f => f.type === config.type)
        const hasFile = typeFiles.length > 0

        return (
          <div
            key={config.type}
            className={`relative rounded-xl border-2 border-dashed p-4 transition-colors ${
              dragOver === config.type
                ? 'border-indigo-400 bg-indigo-50'
                : hasFile
                ? `${config.border} ${config.bg}`
                : 'border-slate-300 bg-white hover:border-slate-400'
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(config.type) }}
            onDragLeave={() => setDragOver(null)}
            onDrop={(e) => handleDrop(e, config.type)}
          >
            <input
              type="file"
              accept={config.accept}
              multiple={config.multiple}
              className="hidden"
              id={`upload-${config.type}`}
              onChange={(e) => {
                const fileList = e.target.files
                if (!fileList) return
                Array.from(fileList).forEach(file => handleFile(file, config.type))
                // Reset input so same file can be re-selected
                e.target.value = ''
              }}
            />

            {/* Header */}
            <div className="mb-3 flex items-center gap-2">
              <span className="text-2xl">{config.icon}</span>
              <div>
                <p className={`text-sm font-semibold ${config.text}`}>{config.title}</p>
                <p className="text-[10px] text-slate-500">{config.desc}</p>
              </div>
            </div>

            {/* Files list */}
            {hasFile && (
              <div className="mb-2 space-y-1.5">
                {typeFiles.map(file => (
                  <div key={file.id} className="flex items-center gap-2 rounded-lg bg-white/80 px-2.5 py-1.5">
                    <div className="flex-shrink-0">
                      {file.status === 'extracted' ? (
                        <CheckCircle2 className={`h-4 w-4 ${config.text}`} />
                      ) : file.status === 'extracting' ? (
                        <Loader2 className={`h-4 w-4 ${config.text} animate-spin`} />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                    <span className="flex-1 truncate text-xs font-medium text-slate-700">{file.name}</span>
                    <span className="text-[10px] text-slate-400">
                      {(file.size / 1024 / 1024).toFixed(1)}MB
                    </span>
                    <button
                      onClick={() => handleRemove(file.id)}
                      className="flex-shrink-0 text-slate-300 hover:text-red-500"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Upload button / zone */}
            {config.multiple || !hasFile ? (
              <label
                htmlFor={`upload-${config.type}`}
                className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500 transition-colors hover:bg-slate-50"
              >
                {config.multiple && hasFile ? (
                  <>
                    <Plus className="h-3.5 w-3.5" />
                    Tambah file
                  </>
                ) : (
                  <>
                    <Upload className="h-3.5 w-3.5" />
                    Klik atau drag {config.accept.includes('docx') ? 'DOCX/PDF' : 'PDF'}
                  </>
                )}
              </label>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

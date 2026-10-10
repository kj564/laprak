import { NextRequest, NextResponse } from 'next/server'
import { getJob, cleanupOldJobs } from '@/lib/job-store'

export const runtime = 'nodejs'
const JOB_ID_PATTERN = /^job-\d+-[a-z0-9]{6}$/

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId')

  if (!jobId) {
    return NextResponse.json({ error: 'jobId wajib' }, { status: 400 })
  }
  if (!JOB_ID_PATTERN.test(jobId)) {
    return NextResponse.json({ error: 'Format jobId tidak valid.' }, { status: 400 })
  }

  cleanupOldJobs()
  const job = getJob(jobId)

  if (!job) {
    return NextResponse.json({ error: 'Job tidak ditemukan atau sudah kedaluwarsa.' }, { status: 404 })
  }

  const elapsed = Math.max(0, Math.round((Date.now() - job.startedAt) / 1000))

  if (job.status === 'done') {
    return NextResponse.json({ status: 'done', elapsed, report: job.report })
  }

  if (job.status === 'error') {
    return NextResponse.json({
      status: 'error',
      elapsed,
      error: job.error || 'Gagal menyusun laporan. Silakan coba lagi.',
    })
  }

  return NextResponse.json({
    status: 'processing',
    elapsed,
    message: 'AI sedang menyusun laporan... mohon tunggu',
  }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { getJob, cleanupOldJobs } from '@/lib/job-store'

export async function GET(request: NextRequest) {
  const jobId = request.nextUrl.searchParams.get('jobId')
  
  if (!jobId) {
    return NextResponse.json({ error: 'jobId wajib' }, { status: 400 })
  }

  cleanupOldJobs()
  const job = getJob(jobId)

  if (!job) {
    return NextResponse.json({ error: 'Job tidak ditemukan' }, { status: 404 })
  }

  const elapsed = Math.round((Date.now() - job.startedAt) / 1000)

  if (job.status === 'done') {
    return NextResponse.json({
      status: 'done',
      elapsed,
      report: job.report,
    })
  }

  if (job.status === 'error') {
    return NextResponse.json({
      status: 'error',
      elapsed,
      error: job.error,
    })
  }

  // Still processing
  return NextResponse.json({
    status: 'processing',
    elapsed,
  message: 'AI sedang menyusun laporan... mohon tunggu',
  })
}

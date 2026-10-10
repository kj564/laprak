/** File-based job storage — persists across Next.js dev mode requests.
 *  Module-level Map doesn't work in Turbopack dev mode (resets per request). */
import { writeFileSync, readFileSync, unlinkSync, existsSync, readdirSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const JOBS_DIR = join(tmpdir(), 'practicum-jobs')

// Ensure directory exists
try {
  if (!existsSync(JOBS_DIR)) {
    mkdirSync(JOBS_DIR, { recursive: true })
  }
} catch {}

function jobPath(id: string): string {
  return join(JOBS_DIR, `${id}.json`)
}

export function createJob(): string {
  const id = `job-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
  const job = { status: 'processing', startedAt: Date.now() }
  try {
    writeFileSync(jobPath(id), JSON.stringify(job))
  } catch (e) {
    console.error('Failed to create job file:', e)
  }
  return id
}

export function getJob(id: string): { status: string; report?: any; error?: string; startedAt: number } | undefined {
  try {
    if (!existsSync(jobPath(id))) return undefined
    const data = readFileSync(jobPath(id), 'utf-8')
    return JSON.parse(data)
  } catch {
    return undefined
  }
}

export function completeJob(id: string, report: any) {
  try {
    const job = getJob(id) || { status: 'processing', startedAt: Date.now() }
    writeFileSync(jobPath(id), JSON.stringify({ ...job, status: 'done', report }))
  } catch (e) {
    console.error('Failed to complete job:', e)
  }
}

export function failJob(id: string, error: string) {
  try {
    const job = getJob(id) || { status: 'processing', startedAt: Date.now() }
    writeFileSync(jobPath(id), JSON.stringify({ ...job, status: 'error', error }))
  } catch (e) {
    console.error('Failed to fail job:', e)
  }
}

export function cleanupOldJobs() {
  try {
    if (!existsSync(JOBS_DIR)) return
    const now = Date.now()
    const maxAge = 10 * 60 * 1000 // 10 minutes
    const files = readdirSync(JOBS_DIR)
    for (const file of files) {
      if (!file.endsWith('.json')) continue
      try {
        const filepath = join(JOBS_DIR, file)
        const data = JSON.parse(readFileSync(filepath, 'utf-8'))
        if (now - data.startedAt > maxAge) {
          unlinkSync(filepath)
        }
      } catch {}
    }
  } catch {}
}

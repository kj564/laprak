/** File-based job storage for local/single-instance deployments.
 * For serverless or multi-instance hosting, replace this with a shared database/queue. */
import {
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
  readdirSync,
  mkdirSync,
  renameSync,
  statSync,
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const JOBS_DIR = join(tmpdir(), 'practicum-jobs')
const JOB_ID_PATTERN = /^job-\d+-[a-z0-9]{6}$/

function ensureDirectory() {
  mkdirSync(JOBS_DIR, { recursive: true })
}

function jobPath(id: string): string {
  if (!JOB_ID_PATTERN.test(id)) throw new Error('Invalid job ID')
  return join(JOBS_DIR, `${id}.json`)
}

function writeJob(id: string, value: unknown) {
  ensureDirectory()
  const target = jobPath(id)
  const temporary = join(JOBS_DIR, `${id}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 })
    renameSync(temporary, target)
  } finally {
    try { unlinkSync(temporary) } catch {}
  }
}

export function createJob(): string {
  const id = `job-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
  writeJob(id, { status: 'processing', startedAt: Date.now() })
  return id
}

export function getJob(id: string): { status: string; report?: any; error?: string; startedAt: number } | undefined {
  if (!JOB_ID_PATTERN.test(id)) return undefined
  try {
    const filepath = jobPath(id)
    if (!existsSync(filepath)) return undefined
    const data = JSON.parse(readFileSync(filepath, 'utf-8'))
    if (!data || typeof data.startedAt !== 'number' || typeof data.status !== 'string') return undefined
    return data
  } catch {
    return undefined
  }
}

export function completeJob(id: string, report: unknown) {
  try {
    const job = getJob(id)
    if (!job) return
    writeJob(id, { ...job, status: 'done', report })
  } catch (error) {
    console.error('Failed to complete job:', error instanceof Error ? error.message : 'Unknown error')
  }
}

export function failJob(id: string, error: string) {
  try {
    const job = getJob(id)
    if (!job) return
    writeJob(id, { ...job, status: 'error', error })
  } catch (reason) {
    console.error('Failed to fail job:', reason instanceof Error ? reason.message : 'Unknown error')
  }
}

export function cleanupOldJobs() {
  try {
    ensureDirectory()
    const now = Date.now()
    const maxAge = 30 * 60 * 1000
    for (const file of readdirSync(JOBS_DIR)) {
      const filepath = join(JOBS_DIR, file)
      try {
        if (file.endsWith('.tmp')) {
          // Remove abandoned atomic-write temp files older than the same retention window.
          const stat = statSync(filepath)
          if (now - stat.mtimeMs > maxAge) unlinkSync(filepath)
          continue
        }
        if (!file.endsWith('.json')) continue
        const data = JSON.parse(readFileSync(filepath, 'utf-8'))
        if (typeof data.startedAt !== 'number' || now - data.startedAt > maxAge) {
          unlinkSync(filepath)
        }
      } catch {
        try { unlinkSync(filepath) } catch {}
      }
    }
  } catch (error) {
    console.error('Job cleanup failed:', error instanceof Error ? error.message : 'Unknown error')
  }
}

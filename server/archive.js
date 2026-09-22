// 调用日志自动归档：超期日志导出为压缩 NDJSON 文件后从库中删除
import { createGzip } from 'node:zlib'
import { createWriteStream, mkdirSync, readdirSync, statSync, createReadStream } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { db, flushWrites } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const ARCHIVE_DIR = join(__dirname, 'archives')
mkdirSync(ARCHIVE_DIR, { recursive: true })

/** 日志保留天数，可用环境变量 LOG_RETENTION_DAYS 覆盖 */
export const RETENTION_DAYS = Math.max(1, Number(process.env.LOG_RETENTION_DAYS ?? 30))

/** 通用导出：把某张表保留期之前的记录写入压缩文件并删除，返回 {archived, file} */
async function exportOldRows(table, filePrefix) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString().replace('T', ' ').slice(0, 19)
  const rows = db.prepare(`SELECT * FROM ${table} WHERE ts < ? ORDER BY id`).all(cutoff)
  if (rows.length === 0) return { archived: 0, file: null }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const fileName = `${filePrefix}-${stamp}.ndjson.gz`
  const filePath = join(ARCHIVE_DIR, fileName)

  const ndjson = rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
  await pipeline(Readable.from(ndjson), createGzip(), createWriteStream(filePath))

  db.prepare(`DELETE FROM ${table} WHERE ts < ?`).run(cutoff)
  console.log(`[archive] 已归档 ${rows.length} 条 ${table} → ${fileName}`)
  return { archived: rows.length, file: fileName }
}

/** 执行一次归档：超期的调用日志与操作审计日志分别压缩导出后从库中删除 */
export async function runArchive() {
  flushWrites() // 先把队列中的日志落库，避免漏归档
  const logs = await exportOldRows('logs', 'logs-archive')
  const audits = await exportOldRows('audit_logs', 'audit-archive')
  return {
    archived: logs.archived,
    file: logs.file,
    auditArchived: audits.archived,
    auditFile: audits.file,
  }
}

/** 列出归档文件（名称、类型、大小、修改时间） */
export function listArchives() {
  return readdirSync(ARCHIVE_DIR)
    .filter((f) => /^(logs|audit)-archive-.*\.ndjson\.gz$/.test(f))
    .map((f) => {
      const st = statSync(join(ARCHIVE_DIR, f))
      return {
        name: f,
        type: f.startsWith('audit-') ? 'audit' : 'logs',
        size: st.size,
        createdAt: st.mtime.toISOString().replace('T', ' ').slice(0, 19),
      }
    })
    .sort((a, b) => (a.name < b.name ? 1 : -1))
}

/** 校验归档文件名并返回可读流；非法名称返回 null（防目录穿越） */
export function openArchive(name) {
  if (!/^(logs|audit)-archive-[\dT\-]+\.ndjson\.gz$/.test(String(name ?? ''))) return null
  const filePath = join(ARCHIVE_DIR, name)
  try {
    statSync(filePath)
    return createReadStream(filePath)
  } catch {
    return null
  }
}

/** 启动定时归档：启动时执行一次，之后每天执行 */
export function startArchiver() {
  runArchive().catch((err) => console.error('[archive] 归档失败:', err))
  setInterval(() => {
    runArchive().catch((err) => console.error('[archive] 归档失败:', err))
  }, 24 * 3600 * 1000).unref()
}

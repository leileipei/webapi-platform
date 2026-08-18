import type { MetricPoint } from '@/types'

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return Math.abs(h)
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 基于 api id 生成确定性的近 N 天指标序列 */
export function genMetrics(seedStr: string, base: number, days = 30): MetricPoint[] {
  const rnd = mulberry32(hashCode(seedStr))
  const points: MetricPoint[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const weekendFactor = d.getDay() === 0 || d.getDay() === 6 ? 0.55 : 1
    const growth = 1 + (days - 1 - i) * 0.008
    const noise = 0.75 + rnd() * 0.5
    const calls = Math.round(base * weekendFactor * growth * noise)
    const errorRate = rnd() < 0.08 ? 0.03 + rnd() * 0.1 : rnd() * 0.015
    const errors = Math.round(calls * errorRate)
    const avgLatency = Math.round(20 + rnd() * 60 + (errorRate > 0.03 ? rnd() * 300 : 0))
    points.push({ date: fmtDate(d), calls, errors, avgLatency })
  }
  return points
}

/** 汇总多个序列（按天求和） */
export function mergeMetrics(list: MetricPoint[][]): MetricPoint[] {
  if (list.length === 0) return []
  const days = list[0].length
  const out: MetricPoint[] = []
  for (let i = 0; i < days; i++) {
    out.push({
      date: list[0][i].date,
      calls: list.reduce((s, m) => s + (m[i]?.calls ?? 0), 0),
      errors: list.reduce((s, m) => s + (m[i]?.errors ?? 0), 0),
      avgLatency: Math.round(list.reduce((s, m) => s + (m[i]?.avgLatency ?? 0), 0) / list.length),
    })
  }
  return out
}

export function fmtNum(n: number): string {
  if (n >= 1_0000_0000) return (n / 1_0000_0000).toFixed(1) + ' 亿'
  if (n >= 1_0000) return (n / 1_0000).toFixed(1) + ' 万'
  return n.toLocaleString()
}

export function randomKey(prefix: string, len = 24): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return `${prefix}_${s}`
}

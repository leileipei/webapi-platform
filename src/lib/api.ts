// 后端 API 客户端 + 指标查询 Hook
import { useEffect, useState } from 'react'
import type { MetricPoint } from '@/types'

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const data = await res.json()
      if (data?.message) msg = data.message
    } catch {
      // ignore
    }
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export const apiClient = {
  getState: <T>() => request<T>('/admin/state'),
  post: <T>(url: string, body: unknown) => request<T>(url, { method: 'POST', body: JSON.stringify(body) }),
  del: <T>(url: string) => request<T>(url, { method: 'DELETE' }),
}

/** 拉取指标序列；apiId 为空时返回全部已发布 API 的汇总 */
export function useMetrics(apiId?: string, days = 30, refreshKey: unknown = 0) {
  const [data, setData] = useState<MetricPoint[]>([])
  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ days: String(days) })
    if (apiId) params.set('apiId', apiId)
    fetch(`/admin/metrics?${params}`)
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && Array.isArray(d)) setData(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [apiId, days, refreshKey])
  return data
}

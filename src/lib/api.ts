// 后端 API 客户端 + 指标查询 Hook + 会话令牌管理
import { useEffect, useState } from 'react'
import type { MetricPoint } from '@/types'

const TOKEN_KEY = 'webapi-admin-token'
const USER_KEY = 'webapi-admin-user'

export const authStorage = {
  getToken: () => localStorage.getItem(TOKEN_KEY),
  getUser: () => localStorage.getItem(USER_KEY),
  save: (token: string, username: string) => {
    localStorage.setItem(TOKEN_KEY, token)
    localStorage.setItem(USER_KEY, username)
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
  },
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = authStorage.getToken()
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...options,
  })
  if (res.status === 401 && !url.includes('/auth/login')) {
    authStorage.clear()
    if (!window.location.pathname.startsWith('/login')) window.location.assign('/login')
    throw new Error('未登录或会话已过期')
  }
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
    const token = authStorage.getToken()
    fetch(`/admin/metrics?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : []))
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

export interface MinutePoint {
  minute: string // UTC 'YYYY-MM-DD HH:MM'
  calls: number
  errors: number
  rejected: number
  avgLatency: number
}

/** 近 N 分钟分钟级流量（实时，基于调用日志） */
export function useMinuteMetrics(minutes = 60, apiId?: string, refreshKey: unknown = 0) {
  const [data, setData] = useState<MinutePoint[]>([])
  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ minutes: String(minutes) })
    if (apiId) params.set('apiId', apiId)
    const token = authStorage.getToken()
    fetch(`/admin/logs/minutes?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (!cancelled && Array.isArray(d)) setData(d)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [minutes, apiId, refreshKey])
  return data
}

/** 后端时间串为 UTC（'YYYY-MM-DD HH:MM[:SS]'），转本地显示 */
export function toLocal(ts: string, withSeconds = true): string {
  const d = new Date(ts.replace(' ', 'T') + 'Z')
  if (Number.isNaN(d.getTime())) return ts
  const pad = (n: number) => String(n).padStart(2, '0')
  const base = `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return withSeconds ? `${base}:${pad(d.getSeconds())}` : base
}

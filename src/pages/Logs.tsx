import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Search, RefreshCw, ChevronLeft, ChevronRight, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useStore } from '@/lib/store'
import { authStorage } from '@/lib/api'
import { MethodBadge } from '@/components/badges'
import type { ApiLog, LogPage, HttpMethod } from '@/types'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']

function statusBadge(status: number) {
  const cls =
    status < 300 ? 'bg-emerald-100 text-emerald-700'
    : status < 500 ? 'bg-amber-100 text-amber-700'
    : 'bg-red-100 text-red-700'
  return <span className={`inline-block rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${cls}`}>{status}</span>
}

export default function Logs() {
  const { state } = useStore()
  const [searchParams] = useSearchParams()
  const [apiId, setApiId] = useState(searchParams.get('apiId') ?? 'all')
  const [statusClass, setStatusClass] = useState('all')
  const [appName, setAppName] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [data, setData] = useState<LogPage>({ total: 0, page: 1, pageSize: 20, items: [] })
  const [loading, setLoading] = useState(false)

  const pageSize = 20

  const load = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
    if (apiId !== 'all') params.set('apiId', apiId)
    if (statusClass !== 'all') params.set('statusClass', statusClass)
    if (appName !== 'all') params.set('appName', appName)
    if (keyword.trim()) params.set('keyword', keyword.trim())
    const token = authStorage.getToken()
    fetch(`/admin/logs?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.json() : { total: 0, page: 1, pageSize, items: [] }))
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [apiId, statusClass, appName, keyword, page])

  useEffect(load, [load])

  useEffect(() => {
    if (!autoRefresh) return
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [autoRefresh, load])

  const totalPages = Math.max(1, Math.ceil(data.total / pageSize))
  const changeFilter = (fn: () => void) => {
    fn()
    setPage(1)
  }

  const appNames = state.apps.map((a) => a.name)

  return (
    <div className="space-y-5 p-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ScrollText className="h-6 w-6 text-slate-500" /> 调用日志
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            网关全量请求审计（含被拒绝的请求），共 {data.total} 条
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="auto-refresh" checked={autoRefresh} onCheckedChange={setAutoRefresh} />
            <Label htmlFor="auto-refresh" className="text-sm text-slate-600">自动刷新（5s）</Label>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 刷新
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <Select value={apiId} onValueChange={(v) => changeFilter(() => setApiId(v))}>
            <SelectTrigger className="w-44"><SelectValue placeholder="API" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部 API</SelectItem>
              {state.apis.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusClass} onValueChange={(v) => changeFilter(() => setStatusClass(v))}>
            <SelectTrigger className="w-36"><SelectValue placeholder="状态码" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="2xx">2xx 成功</SelectItem>
              <SelectItem value="4xx">4xx 客户端/网关拒绝</SelectItem>
              <SelectItem value="5xx">5xx 服务端错误</SelectItem>
            </SelectContent>
          </Select>
          <Select value={appName} onValueChange={(v) => changeFilter(() => setAppName(v))}>
            <SelectTrigger className="w-44"><SelectValue placeholder="调用方" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部调用方</SelectItem>
              {appNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              className="pl-9"
              placeholder="搜索路径 / 说明…"
              value={keyword}
              onChange={(e) => changeFilter(() => setKeyword(e.target.value))}
            />
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">时间</TableHead>
              <TableHead>API</TableHead>
              <TableHead className="w-20">方法</TableHead>
              <TableHead>路径</TableHead>
              <TableHead>调用方</TableHead>
              <TableHead className="w-16">状态</TableHead>
              <TableHead className="w-20 text-right">耗时</TableHead>
              <TableHead>说明</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-sm text-slate-400">
                  暂无日志。通过网关（/gw/*）或「在线调试」发起调用后此处会有记录。
                </TableCell>
              </TableRow>
            )}
            {data.items.map((log: ApiLog) => (
              <TableRow key={log.id}>
                <TableCell className="font-mono text-xs text-slate-500">{log.ts.slice(5)}</TableCell>
                <TableCell className="text-sm">
                  {log.api_id ? (
                    <Link to={`/apis/${log.api_id}`} className="text-blue-600 hover:underline">{log.api_name}</Link>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {METHODS.includes(log.method as HttpMethod)
                    ? <MethodBadge method={log.method as HttpMethod} />
                    : <span className="font-mono text-xs">{log.method}</span>}
                </TableCell>
                <TableCell className="max-w-56 truncate font-mono text-xs text-slate-600" title={log.path}>{log.path}</TableCell>
                <TableCell className="text-sm text-slate-600">{log.app_name ?? <span className="text-slate-400">匿名</span>}</TableCell>
                <TableCell>{statusBadge(log.status)}</TableCell>
                <TableCell className="text-right font-mono text-xs">{log.latency} ms</TableCell>
                <TableCell className="max-w-56 truncate text-xs text-slate-500" title={log.message ?? ''}>{log.message ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
          <span className="text-xs text-slate-500">第 {data.page} / {totalPages} 页 · 共 {data.total} 条</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" /> 上一页
            </Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              下一页 <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

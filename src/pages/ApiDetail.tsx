import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import {
  ArrowLeft, Pencil, ArrowUpCircle, ArrowDownCircle, Ban, Trash2, Play, Loader2, Copy, Check,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useStore } from '@/lib/store'
import { genMetrics, fmtNum } from '@/lib/metrics'
import { MethodBadge, StatusBadge, HealthDot, AUTH_LABELS } from '@/components/badges'
import type { ApiItem } from '@/types'

function ParamTable({ title, params }: { title: string; params: ApiItem['queryParams'] }) {
  return (
    <div>
      <h4 className="mb-2 text-sm font-medium">{title}</h4>
      {params.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 py-3 text-center text-xs text-slate-400">无</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-48">参数名</TableHead>
              <TableHead className="w-28">类型</TableHead>
              <TableHead className="w-20">必填</TableHead>
              <TableHead>说明</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {params.map((p, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">{p.name}</TableCell>
                <TableCell className="font-mono text-xs text-slate-500">{p.type}</TableCell>
                <TableCell>{p.required ? <span className="text-xs font-medium text-red-600">是</span> : <span className="text-xs text-slate-400">否</span>}</TableCell>
                <TableCell className="text-sm text-slate-600">{p.description || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

export default function ApiDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { state, dispatch } = useStore()
  const api = state.apis.find((a) => a.id === id)
  const metrics = useMemo(() => (api ? genMetrics(api.id, api.baseCalls, 30) : []), [api])

  // debug console state
  const [debugParams, setDebugParams] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ status: number; latency: number; body: string } | null>(null)
  const [copied, setCopied] = useState(false)

  if (!api) {
    return (
      <div className="p-8">
        <p className="text-slate-500">API 不存在或已被删除。</p>
        <Button variant="link" onClick={() => navigate('/apis')} className="px-0">返回列表</Button>
      </div>
    )
  }

  const group = state.groups.find((g) => g.id === api.groupId)
  const boundApps = state.apps.filter((app) => app.apiIds.includes(api.id))
  const totalCalls = metrics.reduce((s, m) => s + m.calls, 0)
  const totalErrors = metrics.reduce((s, m) => s + m.errors, 0)
  const successRate = totalCalls > 0 ? ((1 - totalErrors / totalCalls) * 100).toFixed(2) : '100.00'
  const avgLatency = metrics.length ? Math.round(metrics.reduce((s, m) => s + m.avgLatency, 0) / metrics.length) : 0

  const runDebug = () => {
    setRunning(true)
    setResult(null)
    const latency = Math.round(30 + Math.random() * (api.health === 'degraded' ? 400 : 120))
    setTimeout(() => {
      const fail = api.health === 'down' || Math.random() < 0.03
      let body: string
      try {
        body = JSON.stringify(JSON.parse(api.responseExample), null, 2)
      } catch {
        body = api.responseExample
      }
      setResult({
        status: fail ? 502 : 200,
        latency,
        body: fail ? '{\n  "code": 50200,\n  "message": "Bad Gateway: 后端服务无响应"\n}' : body,
      })
      setRunning(false)
    }, latency + 200)
  }

  const changeStatus = (s: ApiItem['status']) => {
    dispatch({ type: 'setApiStatus', id: api.id, status: s })
    toast.success('状态已更新')
  }

  const curlCmd = `curl -X ${api.method} "https://gateway.example.com${api.path}" \\\n  -H "X-Access-Key: <YOUR_ACCESS_KEY>"${api.method !== 'GET' ? ' \\\n  -H "Content-Type: application/json" \\\n  -d \'{}\'' : ''}`

  return (
    <div className="space-y-5 p-8">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/apis')}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <MethodBadge method={api.method} />
              <h1 className="text-2xl font-bold">{api.name}</h1>
              <StatusBadge status={api.status} />
              <HealthDot health={api.health} />
            </div>
            <p className="mt-1 font-mono text-sm text-slate-500">{api.path} <span className="font-sans text-xs text-slate-400">· {group?.name ?? '未分组'} · {api.version} · {api.protocol}</span></p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate(`/apis/${api.id}/edit`)}>
            <Pencil className="mr-1 h-4 w-4" /> 编辑
          </Button>
          {api.status !== 'published' ? (
            <Button onClick={() => changeStatus('published')}>
              <ArrowUpCircle className="mr-1 h-4 w-4" /> 发布上线
            </Button>
          ) : (
            <Button variant="outline" className="text-amber-600" onClick={() => changeStatus('offline')}>
              <ArrowDownCircle className="mr-1 h-4 w-4" /> 下线
            </Button>
          )}
          {api.status !== 'deprecated' && (
            <Button variant="outline" className="text-red-500" onClick={() => changeStatus('deprecated')}>
              <Ban className="mr-1 h-4 w-4" /> 废弃
            </Button>
          )}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="text-red-600"><Trash2 className="mr-1 h-4 w-4" /> 删除</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>删除 API「{api.name}」？</AlertDialogTitle>
                <AlertDialogDescription>删除后不可恢复，相关应用授权将同步移除。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => { dispatch({ type: 'deleteApi', id: api.id }); toast.success('已删除'); navigate('/apis') }}>
                  确认删除
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {api.description && <p className="max-w-3xl text-sm text-slate-600">{api.description}</p>}

      <Tabs defaultValue="monitor">
        <TabsList>
          <TabsTrigger value="monitor">运行监控</TabsTrigger>
          <TabsTrigger value="doc">接口文档</TabsTrigger>
          <TabsTrigger value="debug">在线调试</TabsTrigger>
          <TabsTrigger value="versions">版本历史</TabsTrigger>
        </TabsList>

        {/* 监控 */}
        <TabsContent value="monitor" className="space-y-4">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {[
              { label: '近 30 天调用量', value: fmtNum(totalCalls) },
              { label: '成功率', value: successRate + '%' },
              { label: '平均延迟', value: avgLatency + ' ms' },
              { label: '授权应用数', value: String(boundApps.length) },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="p-4">
                  <div className="text-xs text-slate-500">{s.label}</div>
                  <div className="mt-1 text-xl font-bold">{s.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">调用量与错误数</CardTitle></CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={metrics} margin={{ left: 8, right: 8 }}>
                    <defs>
                      <linearGradient id="dcalls" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis tickFormatter={(v: number) => fmtNum(v)} tick={{ fontSize: 11 }} stroke="#94a3b8" width={56} />
                    <RTooltip formatter={(v: number, name: string) => [fmtNum(v), name === 'calls' ? '调用量' : '错误数']} />
                    <Area type="monotone" dataKey="calls" stroke="#3b82f6" fill="url(#dcalls)" name="calls" />
                    <Area type="monotone" dataKey="errors" stroke="#ef4444" fill="none" name="errors" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">平均延迟 (ms)</CardTitle></CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={metrics} margin={{ left: 8, right: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={48} />
                    <RTooltip />
                    <Line type="monotone" dataKey="avgLatency" stroke="#8b5cf6" strokeWidth={2} dot={false} name="平均延迟" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">稳定性配置</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm md:grid-cols-4">
                <div><div className="text-xs text-slate-500">超时时间</div><div className="font-medium">{api.timeout} ms</div></div>
                <div><div className="text-xs text-slate-500">失败重试</div><div className="font-medium">{api.retry} 次</div></div>
                <div><div className="text-xs text-slate-500">QPS 限流</div><div className="font-medium">{api.qps}</div></div>
                <div>
                  <div className="text-xs text-slate-500">熔断保护</div>
                  <div className="font-medium">
                    {api.circuitBreaker.enabled ? `错误率 > ${api.circuitBreaker.errorRateThreshold}% / ${api.circuitBreaker.windowSec}s` : '未启用'}
                  </div>
                </div>
                <div><div className="text-xs text-slate-500">鉴权方式</div><div className="font-medium">{AUTH_LABELS[api.auth]}</div></div>
                <div className="col-span-2"><div className="text-xs text-slate-500">后端地址</div><div className="truncate font-mono text-xs font-medium">{api.backendUrl}</div></div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 文档 */}
        <TabsContent value="doc" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">调用方式</CardTitle>
              <Button
                variant="outline" size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(curlCmd).catch(() => {})
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                }}
              >
                {copied ? <Check className="mr-1 h-3.5 w-3.5 text-emerald-600" /> : <Copy className="mr-1 h-3.5 w-3.5" />} 复制 cURL
              </Button>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">{curlCmd}</pre>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">请求参数</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <ParamTable title="Query 参数" params={api.queryParams} />
              <ParamTable title="请求头" params={api.headers} />
              {api.method !== 'GET' && <ParamTable title="Body 参数" params={api.bodyParams} />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">响应示例</CardTitle></CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-emerald-300">{api.responseExample}</pre>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 调试 */}
        <TabsContent value="debug">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">请求参数</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {api.queryParams.length === 0 && api.bodyParams.length === 0 && (
                  <p className="text-sm text-slate-500">该接口没有可填参数，直接发送即可。</p>
                )}
                {api.queryParams.map((p) => (
                  <div key={p.name} className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">
                      {p.name} {p.required && <span className="text-red-500">*</span>}
                      <span className="ml-1 font-normal text-slate-400">({p.type})</span>
                    </label>
                    <Input
                      value={debugParams[p.name] ?? ''}
                      onChange={(e) => setDebugParams((d) => ({ ...d, [p.name]: e.target.value }))}
                      placeholder={p.description}
                      className="h-9 font-mono text-xs"
                    />
                  </div>
                ))}
                {api.bodyParams.map((p) => (
                  <div key={p.name} className="space-y-1">
                    <label className="text-xs font-medium text-slate-600">
                      {p.name} {p.required && <span className="text-red-500">*</span>}
                      <span className="ml-1 font-normal text-slate-400">({p.type})</span>
                    </label>
                    <Input
                      value={debugParams[p.name] ?? ''}
                      onChange={(e) => setDebugParams((d) => ({ ...d, [p.name]: e.target.value }))}
                      placeholder={p.description}
                      className="h-9 font-mono text-xs"
                    />
                  </div>
                ))}
                {api.status !== 'published' && (
                  <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">该 API 当前未发布，调试请求将发送至沙箱环境（模拟数据）。</p>
                )}
                <Button onClick={runDebug} disabled={running} className="w-full">
                  {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  发送请求
                </Button>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">响应</CardTitle></CardHeader>
              <CardContent>
                {!result && !running && <p className="py-16 text-center text-sm text-slate-400">点击「发送请求」查看结果</p>}
                {running && (
                  <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> 请求中…
                  </div>
                )}
                {result && !running && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-4 text-sm">
                      <span className={`rounded px-2 py-0.5 font-mono text-xs font-semibold ${result.status === 200 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                        {result.status}
                      </span>
                      <span className="text-slate-500">{result.latency} ms</span>
                    </div>
                    <pre className="max-h-96 overflow-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-emerald-300">{result.body}</pre>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* 版本 */}
        <TabsContent value="versions">
          <Card>
            <CardHeader><CardTitle className="text-base">版本历史</CardTitle></CardHeader>
            <CardContent>
              <div className="relative space-y-6 pl-6 before:absolute before:left-2 before:top-1 before:h-full before:w-px before:bg-slate-200">
                {api.versions.map((v, i) => (
                  <div key={i} className="relative">
                    <span className={`absolute -left-[19px] top-1 h-3 w-3 rounded-full border-2 border-white ${i === 0 ? 'bg-blue-500' : 'bg-slate-300'}`} />
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{v.version}</span>
                      {i === 0 && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600">当前版本</span>}
                      <span className="text-xs text-slate-400">{v.date}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{v.note}</p>
                  </div>
                ))}
              </div>
              <p className="mt-6 text-xs text-slate-400">
                提示：在<Link to={`/apis/${api.id}/edit`} className="text-blue-600 hover:underline">编辑页面</Link>修改版本号并保存，会自动生成新的版本记录。
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

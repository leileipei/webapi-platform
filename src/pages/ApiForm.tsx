import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ArrowLeft, Plus, Trash2, PlugZap, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useStore, newId } from '@/lib/store'
import { apiClient, canWrite } from '@/lib/api'
import { TestResultView, type TestResult } from '@/components/ConnectivityTest'
import type { ApiItem, HttpMethod, AuthType, Protocol, ParamDoc } from '@/types'

const emptyParam: ParamDoc = { name: '', type: 'string', required: false, description: '' }

function defaultApi(groupId: string): Omit<ApiItem, 'id'> {
  return {
    name: '', path: '/api/v1/', method: 'GET', protocol: 'HTTPS', groupId,
    version: 'v1.0.0', description: '', status: 'draft',
    backendUrl: '', timeout: 3000, retry: 1, qps: 500, auth: 'apikey',
    circuitBreaker: { enabled: true, errorRateThreshold: 50, windowSec: 30 },
    queryParams: [], headers: [{ name: 'X-Access-Key', type: 'string', required: true, description: '应用访问密钥' }],
    bodyParams: [], responseExample: '{\n  "code": 0,\n  "message": "success",\n  "data": {}\n}',
    createdAt: new Date().toISOString().slice(0, 10),
    updatedAt: new Date().toISOString().slice(0, 10),
    health: 'unknown', baseCalls: 5000,
    versions: [],
  }
}

function ParamEditor({
  title, params, onChange,
}: { title: string; params: ParamDoc[]; onChange: (p: ParamDoc[]) => void }) {
  const update = (i: number, patch: Partial<ParamDoc>) => onChange(params.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-medium">{title}</h4>
        <Button type="button" variant="outline" size="sm" onClick={() => onChange([...params, { ...emptyParam }])}>
          <Plus className="mr-1 h-3.5 w-3.5" /> 添加参数
        </Button>
      </div>
      {params.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 py-4 text-center text-xs text-slate-400">暂无参数</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">参数名</TableHead>
              <TableHead className="w-28">类型</TableHead>
              <TableHead className="w-20">必填</TableHead>
              <TableHead>说明</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {params.map((p, i) => (
              <TableRow key={i}>
                <TableCell><Input value={p.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="paramName" className="h-8 font-mono text-xs" /></TableCell>
                <TableCell>
                  <Select value={p.type} onValueChange={(v) => update(i, { type: v })}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['string', 'number', 'boolean', 'array', 'object'].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell><Switch checked={p.required} onCheckedChange={(v) => update(i, { required: v })} /></TableCell>
                <TableCell><Input value={p.description} onChange={(e) => update(i, { description: e.target.value })} className="h-8 text-xs" /></TableCell>
                <TableCell>
                  <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600" onClick={() => onChange(params.filter((_, idx) => idx !== i))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

export default function ApiForm() {
  const { id } = useParams()
  const isEdit = !!id
  const { state, dispatch } = useStore()
  const navigate = useNavigate()
  const existing = isEdit ? state.apis.find((a) => a.id === id) : undefined

  const [form, setForm] = useState<Omit<ApiItem, 'id'>>(() => defaultApi(state.groups[0]?.id ?? ''))
  const [publishNow, setPublishNow] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  // 测试范围：basic=基本信息（经网关测平台侧 API）；backend=后端服务地址直连
  const [testScope, setTestScope] = useState<'basic' | 'backend'>('backend')

  /** 基本信息测试：经平台网关调用该 API（/gw + 路径 + 方法），验证平台侧链路是否正常 */
  const testGatewayApi = async () => {
    if (!form.path || !form.path.startsWith('/')) {
      toast.error('请先填写合法的请求路径')
      return
    }
    // 路径占位符用测试值 1 替换
    const gwPath = form.path.replace(/\{(\w+)\}/g, '1')
    setTestScope('basic')
    setTesting(true)
    setTestResult(null)
    const t0 = performance.now()
    try {
      const resp = await fetch(`/gw${gwPath}`, {
        method: form.method,
        headers: form.method === 'GET' ? {} : { 'Content-Type': 'application/json' },
        body: form.method === 'GET' ? undefined : '{}',
      })
      const latency = Math.round(performance.now() - t0)
      const text = await resp.text()
      setTestResult({ reachable: resp.ok, status: resp.status, latency, bodyPreview: text.slice(0, 300) })
      if (resp.ok) toast.success(`网关调用成功：HTTP ${resp.status} · ${latency}ms`)
      else toast.warning(`网关返回 HTTP ${resp.status}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '请求失败'
      setTestResult({ reachable: false, latency: Math.round(performance.now() - t0), error: msg })
      toast.error(msg)
    } finally {
      setTesting(false)
    }
  }

  const testConnectivity = async () => {
    if (!/^https?:\/\/.+/.test(form.backendUrl.trim())) {
      toast.error('请先在下方「后端服务与稳定性」中填写合法的 http(s):// 后端服务地址')
      return
    }
    setTestScope('backend')
    setTesting(true)
    setTestResult(null)
    try {
      const r = await apiClient.post<TestResult>('/admin/test', {
        url: form.backendUrl.trim(),
        method: form.method,
        timeoutMs: form.timeout,
      })
      setTestResult(r)
      if (r.reachable) {
        toast.success(`连通正常：HTTP ${r.status} · ${r.latency}ms`)
      } else {
        toast.error(`连接失败：${r.error}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '请求失败'
      setTestResult({ reachable: false, latency: 0, error: msg })
      toast.error(msg)
    } finally {
      setTesting(false)
    }
  }

  useEffect(() => {
    if (existing) {
      const { id: _id, ...rest } = existing
      setForm(rest)
    }
  }, [existing])

  useEffect(() => {
    // 只读角色无注册/编辑入口，直接访问 URL 也会被引导回列表页
    if (!canWrite()) {
      toast.error('当前为只读角色，无注册/编辑 API 权限')
      navigate('/apis')
      return
    }
    if (isEdit && !existing) {
      toast.error('未找到该 API')
      navigate('/apis')
      return
    }
    // 已发布状态的 API 不允许编辑，防止在线接口被改动
    if (isEdit && existing?.status === 'published') {
      toast.error('已发布状态的 API 不允许编辑，请先下线')
      navigate(`/apis/${existing.id}`)
    }
  }, [isEdit, existing, navigate])

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))

  const validate = (): string | null => {
    if (!form.name.trim()) return '请填写 API 名称'
    if (!/^\/[\w\-/{}/.~]*$/.test(form.path) || form.path.length < 2) return '路径格式不正确，需以 / 开头，可包含字母、数字、- _ . ~ 与 {param} 占位符'
    if (!form.groupId) return '请选择分组'
    if (!form.backendUrl.trim() || !/^https?:\/\/.+/.test(form.backendUrl)) return '后端服务地址需为 http(s):// 开头的合法 URL'
    if (form.timeout < 100 || form.timeout > 60000) return '超时时间需在 100 ~ 60000 ms 之间'
    if (form.qps < 1) return 'QPS 限流需 ≥ 1'
    const dup = state.apis.find((a) => a.path === form.path && a.method === form.method && a.id !== id)
    if (dup) return `路径 + 方法与已有 API「${dup.name}」冲突`
    try {
      JSON.parse(form.responseExample)
    } catch {
      return '响应示例不是合法的 JSON'
    }
    return null
  }

  const submit = async () => {
    const err = validate()
    if (err) {
      toast.error(err)
      return
    }
    if (saving) return
    setSaving(true)
    const now = new Date().toISOString().slice(0, 10)
    try {
      if (isEdit && existing) {
        const versionChanged = existing.version !== form.version
        const api: ApiItem = {
          ...form,
          id: existing.id,
          updatedAt: now,
          versions: versionChanged
            ? [{ version: form.version, date: now, note: '编辑更新' }, ...existing.versions]
            : existing.versions,
        }
        // 等待后端写入成功后再跳转，避免详情页读到旧状态
        await dispatch({ type: 'upsertApi', api })
        toast.success(`「${api.name}」已更新`)
        navigate(`/apis/${api.id}`)
      } else {
        const api: ApiItem = {
          ...form,
          id: newId('api'),
          status: publishNow ? 'published' : 'draft',
          health: publishNow ? 'healthy' : 'unknown',
          versions: [{ version: form.version, date: now, note: '首次注册' }],
        }
        await dispatch({ type: 'upsertApi', api })
        toast.success(`「${api.name}」注册成功${publishNow ? '，已发布上线' : '，当前为草稿'}`)
        navigate(`/apis/${api.id}`)
      }
    } catch {
      // 后端写入失败：store 已弹出错误提示，停留在表单页便于修改后重试
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-8">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /></Button>
        <div>
          <h1 className="text-2xl font-bold">{isEdit ? `编辑 API · ${existing?.name ?? ''}` : '注册新 API'}</h1>
          <p className="mt-0.5 text-sm text-slate-500">带 * 为必填项，保存前会进行合法性校验</p>
        </div>
      </div>

      {/* 基本信息 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">基本信息</CardTitle>
          <CardDescription>定义平台对外暴露的 API：调用方访问 <span className="font-mono">/gw + 请求路径</span>，路径 + 方法在平台内必须唯一</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>API 名称 *</Label>
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="如：用户登录" />
            </div>
            <div className="space-y-1.5">
              <Label>所属分组 *</Label>
              <Select value={form.groupId} onValueChange={(v) => set('groupId', v)}>
                <SelectTrigger><SelectValue placeholder="选择分组" /></SelectTrigger>
                <SelectContent>
                  {state.groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-[120px_1fr_auto] items-end gap-4">
            <div className="space-y-1.5">
              <Label>请求方法 *</Label>
              <Select value={form.method} onValueChange={(v) => set('method', v as HttpMethod)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-baseline gap-2">
                请求路径 *
                <span className="truncate text-[11px] font-normal text-slate-400">
                  对外地址 <span className="font-mono">/gw{form.path && form.path.startsWith('/') ? form.path : ''}</span> · 粘贴完整 URL 自动拆分
                </span>
              </Label>
              <Input
                value={form.path}
                onChange={(e) => {
                  const v = e.target.value
                  // 粘贴完整 URL 时自动拆分：路径部分填入本字段，完整 URL 填入后端服务地址
                  if (/^https?:\/\//.test(v)) {
                    try {
                      const u = new URL(v)
                      setForm((f) => ({ ...f, path: u.pathname || '/', backendUrl: f.backendUrl || v }))
                      toast.success('已自动拆分：路径与后端服务地址已分别填好')
                      return
                    } catch { /* 不是合法 URL，走普通校验 */ }
                  }
                  set('path', v)
                  setTestResult(null)
                }}
                className="font-mono" placeholder="/api/v1/resource/{id}"
              />
            </div>
            <Button type="button" variant="outline" onClick={testGatewayApi} disabled={testing} className="shrink-0">
              {testing && testScope === 'basic' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PlugZap className="mr-1 h-4 w-4" />}
              API 测试
            </Button>
          </div>
          {testResult && testScope === 'basic' && <TestResultView result={testResult} variant="gateway" />}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>协议</Label>
              <Select value={form.protocol} onValueChange={(v) => set('protocol', v as Protocol)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['HTTP', 'HTTPS', 'WebSocket'].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>版本号</Label>
              <Input value={form.version} onChange={(e) => set('version', e.target.value)} className="font-mono" placeholder="v1.0.0" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>描述</Label>
            <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={2} placeholder="接口用途、注意事项、变更说明…" />
          </div>
        </CardContent>
      </Card>

      {/* 后端与稳定性 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">后端服务与稳定性</CardTitle>
          <CardDescription>外部真实接口地址：平台收到调用后，将请求转发到这里并带回响应；容错策略直接影响线上稳定性</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>后端服务地址 *</Label>
            <div className="flex gap-2">
              <Input
                value={form.backendUrl}
                onChange={(e) => { set('backendUrl', e.target.value); setTestResult(null) }}
                className="font-mono"
                placeholder="http://10.0.0.11:8080/service/path"
              />
              <Button type="button" variant="outline" onClick={testConnectivity} disabled={testing} className="shrink-0">
                {testing && testScope === 'backend' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PlugZap className="mr-1 h-4 w-4" />}
                测试连接
              </Button>
            </div>
            {testResult && testScope === 'backend' && (
              <div className="mt-2">
                <TestResultView result={testResult} variant="backend" />
              </div>
            )}
            <p className="text-xs text-slate-400">支持 {'{param}'} 占位符，网关转发时会用路径中的实际值替换。保存前建议先测试连接。</p>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>超时时间 (ms)</Label>
              <Input type="number" value={form.timeout} onChange={(e) => set('timeout', Number(e.target.value))} />
            </div>
            <div className="space-y-1.5">
              <Label>失败重试次数</Label>
              <Select value={String(form.retry)} onValueChange={(v) => set('retry', Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[0, 1, 2, 3].map((n) => <SelectItem key={n} value={String(n)}>{n} 次</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>QPS 限流</Label>
              <Input type="number" value={form.qps} onChange={(e) => set('qps', Number(e.target.value))} />
            </div>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">熔断保护</div>
                <p className="text-xs text-slate-500">窗口内错误率超过阈值时自动熔断，快速失败以保护后端</p>
              </div>
              <Switch
                checked={form.circuitBreaker.enabled}
                onCheckedChange={(v) => set('circuitBreaker', { ...form.circuitBreaker, enabled: v })}
              />
            </div>
            {form.circuitBreaker.enabled && (
              <div className="mt-3 grid grid-cols-2 gap-4 border-t border-slate-100 pt-3">
                <div className="space-y-1.5">
                  <Label>错误率阈值 (%)</Label>
                  <Input
                    type="number" min={1} max={100} value={form.circuitBreaker.errorRateThreshold}
                    onChange={(e) => set('circuitBreaker', { ...form.circuitBreaker, errorRateThreshold: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>统计窗口 (秒)</Label>
                  <Input
                    type="number" min={5} max={300} value={form.circuitBreaker.windowSec}
                    onChange={(e) => set('circuitBreaker', { ...form.circuitBreaker, windowSec: Number(e.target.value) })}
                  />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 安全 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">安全与鉴权</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Label>鉴权方式</Label>
          <Select value={form.auth} onValueChange={(v) => set('auth', v as AuthType)}>
            <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">无鉴权（公开接口）</SelectItem>
              <SelectItem value="apikey">API Key（AccessKey + SecretKey 签名）</SelectItem>
              <SelectItem value="oauth2">OAuth 2.0</SelectItem>
              <SelectItem value="jwt">JWT</SelectItem>
            </SelectContent>
          </Select>
          <p className="pt-1 text-xs text-slate-500">
            使用 API Key 鉴权的接口仅对「应用与密钥」中已授权的应用开放
          </p>
        </CardContent>
      </Card>

      {/* 文档 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">接口文档</CardTitle>
          <CardDescription>供调用方查阅的参数说明与响应示例</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <ParamEditor title="Query 参数" params={form.queryParams} onChange={(p) => set('queryParams', p)} />
          <ParamEditor title="请求头" params={form.headers} onChange={(p) => set('headers', p)} />
          {form.method !== 'GET' && (
            <ParamEditor title="Body 参数" params={form.bodyParams} onChange={(p) => set('bodyParams', p)} />
          )}
          <div className="space-y-1.5">
            <Label>响应示例 (JSON)</Label>
            <Textarea
              value={form.responseExample}
              onChange={(e) => set('responseExample', e.target.value)}
              rows={6}
              className="font-mono text-xs"
            />
          </div>
        </CardContent>
      </Card>

      {/* Footer actions */}
      <div className="sticky bottom-0 -mx-8 flex items-center justify-between border-t border-slate-200 bg-white/90 px-8 py-4 backdrop-blur">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          {!isEdit && (
            <>
              <Switch checked={publishNow} onCheckedChange={setPublishNow} />
              注册后立即发布上线
            </>
          )}
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => navigate(-1)}>取消</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {isEdit ? '保存修改' : '完成注册'}
          </Button>
        </div>
      </div>
    </div>
  )
}

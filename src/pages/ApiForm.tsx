import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
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

  useEffect(() => {
    if (existing) {
      const { id: _id, ...rest } = existing
      setForm(rest)
    }
  }, [existing])

  useEffect(() => {
    if (isEdit && !existing) {
      toast.error('未找到该 API')
      navigate('/apis')
    }
  }, [isEdit, existing, navigate])

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))

  const validate = (): string | null => {
    if (!form.name.trim()) return '请填写 API 名称'
    if (!/^\/[\w\-/{}/]*$/.test(form.path) || form.path.length < 2) return '路径格式不正确，需以 / 开头，可包含 {param} 占位符'
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

  const submit = () => {
    const err = validate()
    if (err) {
      toast.error(err)
      return
    }
    const now = new Date().toISOString().slice(0, 10)
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
      dispatch({ type: 'upsertApi', api })
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
      dispatch({ type: 'upsertApi', api })
      toast.success(`「${api.name}」注册成功${publishNow ? '，已发布上线' : '，当前为草稿'}`)
      navigate(`/apis/${api.id}`)
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
          <CardDescription>API 的身份信息，路径 + 方法在平台内必须唯一</CardDescription>
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
          <div className="grid grid-cols-[120px_1fr] gap-4">
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
              <Label>请求路径 *</Label>
              <Input value={form.path} onChange={(e) => set('path', e.target.value)} className="font-mono" placeholder="/api/v1/resource/{id}" />
            </div>
          </div>
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
          <CardDescription>网关转发目标与容错策略，直接影响线上稳定性</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>后端服务地址 *</Label>
            <Input value={form.backendUrl} onChange={(e) => set('backendUrl', e.target.value)} className="font-mono" placeholder="http://10.0.0.11:8080/service/path" />
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
          <Button onClick={submit}>{isEdit ? '保存修改' : '完成注册'}</Button>
        </div>
      </div>
    </div>
  )
}

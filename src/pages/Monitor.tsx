import { useState } from 'react'
import { Link } from 'react-router'
import { Plus, Pencil, Trash2, CheckCheck, BellRing } from 'lucide-react'
import { toast } from 'sonner'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer, LineChart, Line,
} from 'recharts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useStore, newId } from '@/lib/store'
import { useMetrics } from '@/lib/api'
import type { AlertRule, AlertMetric, AlertLevel } from '@/types'

const METRIC_LABELS: Record<AlertMetric, { label: string; unit: string }> = {
  errorRate: { label: '错误率', unit: '%' },
  latency: { label: '平均延迟', unit: 'ms' },
  qps: { label: 'QPS', unit: '' },
}

const LEVEL_META: Record<AlertLevel, { label: string; cls: string; dot: string }> = {
  critical: { label: '严重', cls: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  warning: { label: '警告', cls: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  info: { label: '提醒', cls: 'bg-blue-100 text-blue-700', dot: 'bg-blue-400' },
}

export default function Monitor() {
  const { state, dispatch } = useStore()
  const [editing, setEditing] = useState<AlertRule | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const merged = useMetrics(undefined, 30)

  const trend = merged.map((m) => ({
    ...m,
    errorRate: m.calls > 0 ? Number(((m.errors / m.calls) * 100).toFixed(2)) : 0,
  }))

  const unacked = state.alertRecords.filter((r) => !r.acked)

  const openNew = () => {
    setEditing({ id: newId('rule'), name: '', metric: 'errorRate', threshold: 5, level: 'warning', enabled: true, createdAt: new Date().toISOString().slice(0, 10) })
    setDialogOpen(true)
  }

  const saveRule = () => {
    if (!editing) return
    if (!editing.name.trim()) return toast.error('请填写规则名称')
    if (editing.threshold <= 0) return toast.error('阈值需大于 0')
    dispatch({ type: 'upsertRule', rule: editing })
    toast.success('告警规则已保存')
    setDialogOpen(false)
  }

  return (
    <div className="space-y-5 p-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">监控告警</h1>
          <p className="mt-1 text-sm text-slate-500">
            网关全局运行指标与告警策略
            {unacked.length > 0 && <span className="ml-2 rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">{unacked.length} 条未处理</span>}
          </p>
        </div>
        {unacked.length > 0 && (
          <Button
            variant="outline"
            onClick={() => {
              unacked.forEach((r) => dispatch({ type: 'ackAlert', id: r.id }))
              toast.success('已全部标记为已处理')
            }}
          >
            <CheckCheck className="mr-1 h-4 w-4" /> 全部处理
          </Button>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">错误率趋势 (%)</CardTitle></CardHeader>
          <CardContent className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={48} />
                <RTooltip />
                <Line type="monotone" dataKey="errorRate" stroke="#ef4444" strokeWidth={2} dot={false} name="错误率 %" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">平均延迟趋势 (ms)</CardTitle></CardHeader>
          <CardContent className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend} margin={{ left: 8, right: 8 }}>
                <defs>
                  <linearGradient id="lat" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" width={48} />
                <RTooltip />
                <Area type="monotone" dataKey="avgLatency" stroke="#8b5cf6" fill="url(#lat)" name="平均延迟" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Rules */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">告警规则（{state.alertRules.length}）</CardTitle>
          <Button size="sm" onClick={openNew}><Plus className="mr-1 h-4 w-4" /> 新建规则</Button>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>规则名称</TableHead>
              <TableHead>指标</TableHead>
              <TableHead>阈值</TableHead>
              <TableHead>级别</TableHead>
              <TableHead>启用</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.alertRules.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{METRIC_LABELS[r.metric].label}</TableCell>
                <TableCell className="font-mono text-sm">&gt; {r.threshold}{METRIC_LABELS[r.metric].unit}</TableCell>
                <TableCell><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_META[r.level].cls}`}>{LEVEL_META[r.level].label}</span></TableCell>
                <TableCell>
                  <Switch checked={r.enabled} onCheckedChange={(v) => dispatch({ type: 'upsertRule', rule: { ...r, enabled: v } })} />
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditing({ ...r }); setDialogOpen(true) }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600"
                      onClick={() => { dispatch({ type: 'deleteRule', id: r.id }); toast.success('规则已删除') }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Records */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <BellRing className="h-4 w-4 text-slate-500" />
          <CardTitle className="text-base">告警记录（{state.alertRecords.length}）</CardTitle>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">级别</TableHead>
              <TableHead>内容</TableHead>
              <TableHead className="w-44">时间</TableHead>
              <TableHead className="w-24">状态</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.alertRecords.length === 0 && (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-sm text-slate-400">暂无告警记录</TableCell></TableRow>
            )}
            {state.alertRecords.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                    <span className={`h-2 w-2 rounded-full ${LEVEL_META[r.level].dot}`} />
                    {LEVEL_META[r.level].label}
                  </span>
                </TableCell>
                <TableCell className="max-w-xl">
                  <span className="text-sm">{r.message}</span>
                  <Link to={`/apis/${r.apiId}`} className="ml-2 text-xs text-blue-600 hover:underline">查看 API</Link>
                </TableCell>
                <TableCell className="font-mono text-xs text-slate-500">{r.time}</TableCell>
                <TableCell>
                  {r.acked ? <span className="text-xs text-slate-400">已处理</span> : <span className="text-xs font-medium text-red-600">未处理</span>}
                </TableCell>
                <TableCell>
                  {!r.acked && (
                    <Button variant="outline" size="sm" onClick={() => dispatch({ type: 'ackAlert', id: r.id })}>标记处理</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing && state.alertRules.some((r) => r.id === editing.id) ? '编辑规则' : '新建告警规则'}</DialogTitle>
            <DialogDescription>指标超过阈值时生成告警记录</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>规则名称 *</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="如：错误率过高" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>监控指标</Label>
                  <Select value={editing.metric} onValueChange={(v) => setEditing({ ...editing, metric: v as AlertMetric })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(METRIC_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>阈值（{METRIC_LABELS[editing.metric].unit || '次/秒'}）</Label>
                  <Input type="number" min={0} value={editing.threshold} onChange={(e) => setEditing({ ...editing, threshold: Number(e.target.value) })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>告警级别</Label>
                <Select value={editing.level} onValueChange={(v) => setEditing({ ...editing, level: v as AlertLevel })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">严重</SelectItem>
                    <SelectItem value="warning">警告</SelectItem>
                    <SelectItem value="info">提醒</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={saveRule}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

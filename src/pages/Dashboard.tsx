import { useMemo } from 'react'
import { Link } from 'react-router'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend,
} from 'recharts'
import { Globe, Zap, CheckCircle2, BellRing, ArrowRight } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useStore } from '@/lib/store'
import { genMetrics, mergeMetrics, fmtNum } from '@/lib/metrics'
import { MethodBadge, StatusBadge, HealthDot, STATUS_META } from '@/components/badges'

const PIE_COLORS: Record<string, string> = {
  draft: '#94a3b8', published: '#10b981', offline: '#f59e0b', deprecated: '#ef4444',
}

export default function Dashboard() {
  const { state } = useStore()
  const { apis, groups, alertRecords } = state

  const allMetrics = useMemo(() => {
    const published = apis.filter((a) => a.status === 'published')
    return mergeMetrics(published.map((a) => genMetrics(a.id, a.baseCalls, 30)))
  }, [apis])

  const today = allMetrics[allMetrics.length - 1]
  const totalCalls = allMetrics.reduce((s, m) => s + m.calls, 0)
  const totalErrors = allMetrics.reduce((s, m) => s + m.errors, 0)
  const successRate = totalCalls > 0 ? ((1 - totalErrors / totalCalls) * 100) : 100
  const unacked = alertRecords.filter((r) => !r.acked)

  const statusDist = useMemo(() => {
    const map = new Map<string, number>()
    apis.forEach((a) => map.set(a.status, (map.get(a.status) ?? 0) + 1))
    return [...map.entries()].map(([k, v]) => ({ name: STATUS_META[k as keyof typeof STATUS_META].label, value: v, key: k }))
  }, [apis])

  const topApis = useMemo(() => {
    return [...apis]
      .filter((a) => a.status === 'published')
      .map((a) => {
        const m = genMetrics(a.id, a.baseCalls, 30)
        return { name: a.name, calls: m.reduce((s, p) => s + p.calls, 0), id: a.id }
      })
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 5)
  }, [apis])

  const stats = [
    { label: 'API 总数', value: apis.length, sub: `${apis.filter((a) => a.status === 'published').length} 个发布中`, icon: Globe, color: 'bg-blue-500' },
    { label: '今日调用量', value: fmtNum(today?.calls ?? 0), sub: `近 30 天累计 ${fmtNum(totalCalls)}`, icon: Zap, color: 'bg-violet-500' },
    { label: '平均成功率', value: successRate.toFixed(2) + '%', sub: `今日错误 ${fmtNum(today?.errors ?? 0)} 次`, icon: CheckCircle2, color: 'bg-emerald-500' },
    { label: '未处理告警', value: unacked.length, sub: `${groups.length} 个分组 · ${state.apps.length} 个应用`, icon: BellRing, color: unacked.length > 0 ? 'bg-red-500' : 'bg-slate-400' },
  ]

  return (
    <div className="space-y-6 p-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">平台概览</h1>
          <p className="mt-1 text-sm text-slate-500">网关 API 资产与运行状况一览</p>
        </div>
        <Link to="/apis/new" className="text-sm font-medium text-blue-600 hover:underline">
          注册新 API →
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-4 p-5">
              <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${s.color}`}>
                <s.icon className="h-5 w-5 text-white" />
              </div>
              <div>
                <div className="text-sm text-slate-500">{s.label}</div>
                <div className="text-2xl font-bold">{s.value}</div>
                <div className="text-xs text-slate-400">{s.sub}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Trend + pie */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">近 30 天调用量趋势（已发布 API）</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={allMetrics} margin={{ left: 8, right: 8 }}>
                <defs>
                  <linearGradient id="calls" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis tickFormatter={(v: number) => fmtNum(v)} tick={{ fontSize: 12 }} stroke="#94a3b8" width={64} />
                <RTooltip formatter={(v: number, name: string) => [fmtNum(v), name === 'calls' ? '调用量' : '错误数']} />
                <Area type="monotone" dataKey="calls" stroke="#3b82f6" strokeWidth={2} fill="url(#calls)" name="calls" />
                <Area type="monotone" dataKey="errors" stroke="#ef4444" strokeWidth={1.5} fill="none" name="errors" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">API 状态分布</CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusDist} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                  {statusDist.map((s) => (
                    <Cell key={s.key} fill={PIE_COLORS[s.key]} />
                  ))}
                </Pie>
                <RTooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top APIs + alerts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">调用量 Top 5 API（近 30 天）</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topApis} layout="vertical" margin={{ left: 24, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                <XAxis type="number" tickFormatter={(v: number) => fmtNum(v)} tick={{ fontSize: 12 }} stroke="#94a3b8" />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} stroke="#475569" width={110} />
                <RTooltip formatter={(v: number) => fmtNum(v)} />
                <Bar dataKey="calls" fill="#3b82f6" radius={[0, 6, 6, 0]} barSize={18} name="调用量" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">最新告警</CardTitle>
            <Link to="/monitor" className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
              全部 <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {alertRecords.slice(0, 4).map((r) => (
              <div key={r.id} className="rounded-lg border border-slate-200 p-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${r.level === 'critical' ? 'bg-red-500' : r.level === 'warning' ? 'bg-amber-500' : 'bg-blue-400'}`} />
                  <span className="text-sm font-medium">{r.ruleName}</span>
                  {!r.acked && <span className="rounded bg-red-50 px-1.5 text-[11px] text-red-600">未处理</span>}
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">{r.message}</p>
                <div className="mt-1 text-[11px] text-slate-400">{r.time}</div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Health overview */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">健康度概览</CardTitle>
          <Link to="/apis" className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
            进入 API 管理 <ArrowRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {apis.slice(0, 6).map((a) => (
              <Link key={a.id} to={`/apis/${a.id}`} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 transition-shadow hover:shadow-sm">
                <MethodBadge method={a.method} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{a.name}</div>
                  <div className="truncate font-mono text-xs text-slate-400">{a.path}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <HealthDot health={a.health} />
                  <StatusBadge status={a.status} />
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

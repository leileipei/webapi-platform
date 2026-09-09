// 连通性测试共享组件与 Hook：
// - TestResultView：统一的测试结果展示（状态、耗时、错误、状态码提示、响应预览）
// - useConnectivityTest：已注册 API 的后端源连通性测试（run() + 结果对话框）
import { useState } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { apiClient } from '@/lib/api'

export interface TestResult {
  reachable: boolean
  status?: number
  latency: number
  error?: string
  bodyPreview?: string
}

/** 常见 HTTP 状态码的排查提示，帮助用户快速定位问题 */
export const STATUS_HINTS: Record<number, string> = {
  400: '请求被目标服务拒绝：参数或方法可能不符合对方要求',
  401: '需要鉴权：请使用已授权应用的 AccessKey 调用',
  403: '无访问权限：API 未发布或调用方无授权',
  404: '路径不存在：新 API 需保存并发布到网关后再测；测后端时请检查地址路径是否正确',
  405: '方法不匹配：请确认请求方法（GET/POST…）与目标接口一致',
  429: '已触发限流，请稍后重试',
  500: '目标服务内部错误，请联系后端负责人排查',
  502: '网关上游异常：目标服务返回了无效响应',
  503: '目标服务暂不可用，可能正在重启或过载',
}

/** 测试结果展示：gateway=经平台网关链路；backend=后端地址直连 */
export function TestResultView({ result, variant = 'backend' }: { result: TestResult; variant?: 'gateway' | 'backend' }) {
  const okLabel = variant === 'gateway' ? '平台链路调用正常' : '后端地址连通正常'
  const failLabel = variant === 'gateway' ? '平台链路调用失败' : '后端地址无法连通'
  const hint = !result.reachable && result.status ? STATUS_HINTS[result.status] : undefined
  return (
    <div className={`min-w-0 max-w-full rounded-lg p-3 text-xs ${result.reachable ? 'bg-emerald-50 text-emerald-700' : variant === 'gateway' && result.status === 404 ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700'}`}>
      <div className="flex items-center gap-1.5 font-medium">
        {result.reachable ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
        <span className="min-w-0 break-all">
          {result.reachable
            ? `${okLabel} · HTTP ${result.status} · 延迟 ${result.latency}ms`
            : result.error
              ? `${failLabel} · ${result.error}`
              : `${failLabel} · HTTP ${result.status}`}
        </span>
      </div>
      {hint && <div className="mt-1 pl-5 opacity-80">💡 {hint}</div>}
      {result.bodyPreview && (
        <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-white/60 p-2 font-mono text-[11px] text-slate-600">{result.bodyPreview}</pre>
      )}
    </div>
  )
}

interface TestState {
  target: string
  method: string
  timeoutMs: number
  loading: boolean
  result: TestResult | null
}

export function useConnectivityTest() {
  const [state, setState] = useState<TestState | null>(null)

  const run = async (url: string, method: string, timeoutMs: number) => {
    setState({ target: url, method, timeoutMs, loading: true, result: null })
    try {
      const r = await apiClient.post<TestResult>('/admin/test', { url, method, timeoutMs })
      setState({ target: url, method, timeoutMs, loading: false, result: r })
      if (r.reachable) {
        toast.success(`连通正常：HTTP ${r.status} · ${r.latency}ms`)
      } else {
        toast.error(r.error ? `连接失败：${r.error}` : `目标返回 HTTP ${r.status}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '请求失败'
      setState({ target: url, method, timeoutMs, loading: false, result: { reachable: false, latency: 0, error: msg } })
      toast.error(msg)
    }
  }

  const dialog = (
    <Dialog open={!!state} onOpenChange={(open) => !open && setState(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>后端源连通性测试</DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">
            {state && `${state.method} ${state.target} · 超时 ${state.timeoutMs}ms`}
          </DialogDescription>
        </DialogHeader>
        {state?.loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在探测目标地址…
          </div>
        )}
        {state?.result && (
          <div className="space-y-3">
            <TestResultView result={state.result} variant="backend" />
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => state && run(state.target, state.method, state.timeoutMs)}>重新测试</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )

  return { run, dialog, testing: !!state?.loading }
}

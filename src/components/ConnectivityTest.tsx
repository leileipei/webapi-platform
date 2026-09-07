// 已注册 API 的后端源连通性测试：useConnectivityTest() 返回 run() 与结果对话框
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
        toast.error(`连接失败：${r.error}`)
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
          <DialogDescription className="break-all font-mono text-xs">{state?.target}</DialogDescription>
        </DialogHeader>
        {state?.loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在探测目标地址…
          </div>
        )}
        {state?.result && (
          <div className="space-y-3">
            <div className={`flex items-center gap-2 rounded-lg border p-3 text-sm font-medium ${
              state.result.reachable
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}>
              {state.result.reachable
                ? <><CheckCircle2 className="h-4 w-4" /> 目标可达</>
                : <><XCircle className="h-4 w-4" /> 目标不可达</>}
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {state.result.reachable && (
                <div className="rounded-lg bg-slate-50 p-3">
                  <div className="text-xs text-slate-500">HTTP 状态码</div>
                  <div className="mt-0.5 font-mono font-semibold">{state.result.status}</div>
                </div>
              )}
              <div className="rounded-lg bg-slate-50 p-3">
                <div className="text-xs text-slate-500">响应耗时</div>
                <div className="mt-0.5 font-mono font-semibold">{state.result.latency} ms</div>
              </div>
            </div>
            {state.result.error && (
              <div className="rounded-lg bg-red-50 p-3 text-xs text-red-600">{state.result.error}</div>
            )}
            {state.result.bodyPreview && (
              <div>
                <div className="mb-1 text-xs text-slate-500">响应预览（前 300 字符）</div>
                <pre className="max-h-40 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-200">{state.result.bodyPreview}</pre>
              </div>
            )}
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

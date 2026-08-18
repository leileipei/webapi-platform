import { NavLink, Outlet } from 'react-router'
import {
  LayoutDashboard, Globe, FolderTree, KeyRound, Activity, Plus, RefreshCw, ShieldCheck,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/lib/store'
import { toast } from 'sonner'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

const NAV = [
  { to: '/', label: '概览', icon: LayoutDashboard, end: true },
  { to: '/apis', label: 'API 管理', icon: Globe },
  { to: '/groups', label: '分组管理', icon: FolderTree },
  { to: '/apps', label: '应用与密钥', icon: KeyRound },
  { to: '/monitor', label: '监控告警', icon: Activity },
]

export default function Layout() {
  const { state, dispatch, ready, loadError, reload } = useStore()
  const unacked = state.alertRecords.filter((r) => !r.acked).length

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-100 text-sm text-slate-500">
        正在连接后端服务…
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-slate-100">
        <p className="text-lg font-semibold text-slate-700">无法连接后端服务</p>
        <p className="max-w-md text-center text-sm text-slate-500">
          请先在项目根目录启动后端：<code className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-xs">npm run server</code>
          <br />
          <span className="text-xs text-slate-400">错误详情：{loadError}</span>
        </p>
        <button onClick={reload} className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-medium text-white hover:bg-blue-600">
          重新连接
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-slate-100 text-slate-900">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col bg-slate-900 text-slate-300">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500">
            <ShieldCheck className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">WebAPI 管理平台</div>
            <div className="text-[11px] text-slate-400">API Gateway Console</div>
          </div>
        </div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors',
                  isActive ? 'bg-blue-500/15 font-medium text-blue-300' : 'hover:bg-white/5 hover:text-white',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {item.to === '/monitor' && unacked > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[11px] font-semibold text-white">
                  {unacked}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 px-3 pb-5">
          <NavLink
            to="/apis/new"
            className="flex items-center justify-center gap-2 rounded-lg bg-blue-500 px-3 py-2.5 text-sm font-medium text-white hover:bg-blue-600"
          >
            <Plus className="h-4 w-4" /> 注册新 API
          </NavLink>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:bg-white/5 hover:text-white">
                <RefreshCw className="h-3.5 w-3.5" /> 重置演示数据
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>重置演示数据？</AlertDialogTitle>
                <AlertDialogDescription>将清除你在本地做的全部修改，恢复为内置示例数据。此操作不可撤销。</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    dispatch({ type: 'reset' })
                    toast.success('已恢复内置示例数据')
                  }}
                >
                  确认重置
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}

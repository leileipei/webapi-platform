import { NavLink, Navigate, Outlet, useNavigate } from 'react-router'
import { useState } from 'react'
import {
  LayoutDashboard, Globe, FolderTree, KeyRound, Activity,
  CircleUserRound, LogOut, LockKeyhole, ScrollText, Settings as SettingsIcon, ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/lib/store'
import { apiClient, authStorage, ROLE_LABEL } from '@/lib/api'
import { APP_VERSION } from '@/lib/version'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

const NAV: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; adminOnly?: boolean }[] = [
  { to: '/', label: '概览', icon: LayoutDashboard, end: true },
  { to: '/apis', label: 'API 管理', icon: Globe },
  { to: '/groups', label: '分组管理', icon: FolderTree },
  { to: '/apps', label: '应用与密钥', icon: KeyRound },
  { to: '/monitor', label: '监控告警', icon: Activity },
  { to: '/logs', label: '调用日志', icon: ScrollText },
  { to: '/settings', label: '系统管理', icon: SettingsIcon, adminOnly: true },
]

function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (newPassword.length < 8) return toast.error('新密码至少 8 位')
    if (newPassword !== confirm) return toast.error('两次输入的新密码不一致')
    setSaving(true)
    try {
      await apiClient.post('/admin/auth/password', { oldPassword, newPassword })
      toast.success('密码已修改，请重新登录')
      authStorage.clear()
      navigate('/login', { replace: true })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '修改失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>修改密码</DialogTitle>
          <DialogDescription>修改成功后所有会话将失效，需要重新登录</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>原密码</Label>
            <Input type="password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="space-y-1.5">
            <Label>新密码（至少 8 位）</Label>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="space-y-1.5">
            <Label>确认新密码</Label>
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={submit} disabled={saving}>确认修改</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function Layout() {
  const { state, ready, loadError, reload } = useStore()
  const navigate = useNavigate()
  const [pwdOpen, setPwdOpen] = useState(false)
  const unacked = state.alertRecords.filter((r) => !r.acked).length
  const role = authStorage.getRole()

  if (!authStorage.getToken()) return <Navigate to="/login" replace />

  const doLogout = async () => {
    try {
      await apiClient.post('/admin/auth/logout', {})
    } catch {
      // 会话可能已过期，本地照常清理
    }
    authStorage.clear()
    navigate('/login', { replace: true })
  }

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
          <img src="/logo.png" alt="系统 logo" className="h-9 w-9 rounded-lg" />
          <div>
            <div className="text-sm font-semibold text-white">WebAPI 管理平台</div>
            <div className="text-[11px] text-slate-400">API Gateway Console</div>
          </div>
        </div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          {NAV.filter((item) => !item.adminOnly || role === 'admin').map((item) => (
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
        <div className="px-3 pb-5">
          {/* 当前用户 */}
          <div className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2">
            <CircleUserRound className="h-4 w-4 shrink-0 text-slate-400" />
            <span className="flex-1 truncate text-xs text-slate-300">
              {authStorage.getUser() ?? 'admin'}
              <span className="ml-1.5 rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-300">{ROLE_LABEL[role]}</span>
            </span>
          </div>
          {/* 系统版本号（构建时从 package.json 注入） */}
          <div className="mt-2 text-center text-[11px] text-slate-500">v{APP_VERSION}</div>
        </div>
      </aside>

      <ChangePasswordDialog open={pwdOpen} onOpenChange={setPwdOpen} />

      {/* Main */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* 顶栏：右侧用户菜单 */}
        <header className="flex h-14 shrink-0 items-center justify-end border-b border-slate-200 bg-white px-6">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
                <CircleUserRound className="h-5 w-5 text-slate-400" />
                <span className="font-medium">{authStorage.getUser() ?? 'admin'}</span>
                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">{ROLE_LABEL[role]}</span>
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => setPwdOpen(true)}>
                <LockKeyhole className="mr-2 h-3.5 w-3.5" /> 修改密码
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-600" onClick={doLogout}>
                <LogOut className="mr-2 h-3.5 w-3.5" /> 退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <div className="flex-1 overflow-y-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

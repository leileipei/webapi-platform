import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router'
import { Plus, Pencil, Trash2, Users, Archive, Download, Play, RefreshCw, History, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { apiClient, authStorage, ROLE_LABEL, toLocal, type Role } from '@/lib/api'

interface UserRow {
  username: string
  role: Role
  createdAt: string
}

interface ArchiveFile {
  name: string
  size: number
  createdAt: string
}

interface AuditRow {
  id: number
  ts: string
  username: string
  role: Role | null
  action: string
  target: string | null
  detail: string | null
  ip: string | null
}

const ROLE_BADGE: Record<Role, string> = {
  admin: 'bg-red-50 text-red-600 border-red-200',
  operator: 'bg-blue-50 text-blue-600 border-blue-200',
  viewer: 'bg-slate-100 text-slate-500 border-slate-200',
}

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function Settings() {
  const role = authStorage.getRole()
  const [users, setUsers] = useState<UserRow[]>([])
  const [retentionDays, setRetentionDays] = useState<number>(30)
  const [archives, setArchives] = useState<ArchiveFile[]>([])
  const [archiving, setArchiving] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<{ username: string; role: Role; password: string; isNew: boolean } | null>(null)
  const [toDelete, setToDelete] = useState<UserRow | null>(null)
  const [saving, setSaving] = useState(false)

  const [audit, setAudit] = useState<{ total: number; items: AuditRow[] }>({ total: 0, items: [] })
  const [auditPage, setAuditPage] = useState(1)
  const [auditKeyword, setAuditKeyword] = useState('')
  const [auditUser, setAuditUser] = useState('')
  const AUDIT_PAGE_SIZE = 15

  const fetchUsers = useCallback(async () => {
    try {
      setUsers(await apiClient.get<UserRow[]>('/admin/users'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载用户失败')
    }
  }, [])

  const fetchArchives = useCallback(async () => {
    try {
      const data = await apiClient.get<{ retentionDays: number; files: ArchiveFile[] }>('/admin/archives')
      setRetentionDays(data.retentionDays)
      setArchives(data.files)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载归档失败')
    }
  }, [])

  const fetchAudit = useCallback(async (page = auditPage) => {
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(AUDIT_PAGE_SIZE) })
      if (auditKeyword.trim()) params.set('keyword', auditKeyword.trim())
      if (auditUser.trim()) params.set('username', auditUser.trim())
      setAudit(await apiClient.get<{ total: number; items: AuditRow[] }>(`/admin/audit-logs?${params}`))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '加载审计日志失败')
    }
  }, [auditPage, auditKeyword, auditUser])

  useEffect(() => {
    if (role !== 'admin') return
    fetchUsers()
    fetchArchives()
  }, [role, fetchUsers, fetchArchives])

  useEffect(() => {
    if (role === 'admin') fetchAudit(auditPage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, auditPage])

  if (role !== 'admin') return <Navigate to="/" replace />

  const openNew = () => {
    setEditing({ username: '', role: 'viewer', password: '', isNew: true })
    setDialogOpen(true)
  }

  const openEdit = (u: UserRow) => {
    setEditing({ username: u.username, role: u.role, password: '', isNew: false })
    setDialogOpen(true)
  }

  const save = async () => {
    if (!editing) return
    if (editing.isNew && editing.password.length < 8) return toast.error('新建用户密码至少 8 位')
    if (!editing.isNew && editing.password && editing.password.length < 8) return toast.error('密码至少 8 位')
    setSaving(true)
    try {
      await apiClient.post('/admin/users', {
        username: editing.username.trim(),
        role: editing.role,
        password: editing.password || undefined,
      })
      toast.success(editing.isNew ? '用户已创建' : '用户已更新（其旧会话已失效）')
      setDialogOpen(false)
      fetchUsers()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const runArchive = async () => {
    setArchiving(true)
    try {
      const r = await apiClient.post<{ archived: number; file: string | null }>('/admin/archives/run', {})
      toast.success(r.archived > 0 ? `已归档 ${r.archived} 条日志 → ${r.file}` : '没有超过保留期的日志需要归档')
      fetchArchives()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '归档失败')
    } finally {
      setArchiving(false)
    }
  }

  const download = async (name: string) => {
    try {
      const token = authStorage.getToken()
      const res = await fetch(`/admin/archives/download?file=${encodeURIComponent(name)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '下载失败')
    }
  }

  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">系统管理</h1>
        <p className="mt-1 text-sm text-slate-500">用户与角色管理、调用日志归档（仅管理员可见）</p>
      </div>

      {/* 用户管理 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4" /> 用户管理</CardTitle>
            <CardDescription>角色说明：管理员（全部权限）/ 操作员（注册、发布、编辑、确认告警）/ 只读（仅查看）</CardDescription>
          </div>
          <Button size="sm" onClick={openNew}><Plus className="mr-1 h-4 w-4" /> 新建用户</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户名</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="w-24 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.username}>
                  <TableCell className="font-medium">
                    {u.username}
                    {u.username === authStorage.getUser() && <span className="ml-2 text-xs text-slate-400">（当前登录）</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={ROLE_BADGE[u.role] ?? ''}>{ROLE_LABEL[u.role] ?? u.role}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-slate-500">{toLocal(u.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(u)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon"
                      className="h-8 w-8 text-slate-400 hover:text-red-600"
                      disabled={u.username === authStorage.getUser()}
                      onClick={() => setToDelete(u)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 日志归档 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Archive className="h-4 w-4" /> 日志自动归档</CardTitle>
            <CardDescription>
              调用日志保留 {retentionDays} 天，超期日志每天自动压缩归档（gzip NDJSON）并从库中清除。可用环境变量 LOG_RETENTION_DAYS 调整保留期。
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={fetchArchives}><RefreshCw className="mr-1 h-4 w-4" /> 刷新</Button>
            <Button size="sm" onClick={runArchive} disabled={archiving}>
              <Play className="mr-1 h-4 w-4" /> {archiving ? '归档中…' : '立即归档'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {archives.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">暂无归档文件</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>文件名</TableHead>
                  <TableHead className="w-28">大小</TableHead>
                  <TableHead className="w-44">归档时间</TableHead>
                  <TableHead className="w-20 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {archives.map((f) => (
                  <TableRow key={f.name}>
                    <TableCell className="font-mono text-xs">{f.name}</TableCell>
                    <TableCell className="text-sm text-slate-500">{fmtSize(f.size)}</TableCell>
                    <TableCell className="text-sm text-slate-500">{toLocal(f.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8" title="下载" onClick={() => download(f.name)}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* 操作审计 */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" /> 操作审计</CardTitle>
            <CardDescription>记录所有管理操作：登录、增删改、状态流转、归档等，共 {audit.total} 条</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Input
              className="h-8 w-32" placeholder="用户名"
              value={auditUser}
              onChange={(e) => setAuditUser(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (setAuditPage(1), fetchAudit(1))}
            />
            <Input
              className="h-8 w-44" placeholder="关键词（操作/对象/详情）"
              value={auditKeyword}
              onChange={(e) => setAuditKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (setAuditPage(1), fetchAudit(1))}
            />
            <Button size="sm" variant="outline" onClick={() => { setAuditPage(1); fetchAudit(1) }}>
              <Search className="mr-1 h-3.5 w-3.5" /> 查询
            </Button>
            <Button size="sm" variant="ghost" onClick={() => fetchAudit()}><RefreshCw className="h-4 w-4" /></Button>
          </div>
        </CardHeader>
        <CardContent>
          {audit.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">暂无审计记录</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-40">时间</TableHead>
                    <TableHead className="w-32">用户</TableHead>
                    <TableHead className="w-32">操作</TableHead>
                    <TableHead className="w-40">对象</TableHead>
                    <TableHead>详情</TableHead>
                    <TableHead className="w-28">IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {audit.items.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs text-slate-500">{toLocal(r.ts)}</TableCell>
                      <TableCell className="text-sm font-medium">
                        {r.username}
                        {r.role && <span className="ml-1.5 text-[10px] text-slate-400">{ROLE_LABEL[r.role] ?? r.role}</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={r.action.includes('删除') || r.action.includes('重置') || r.action.includes('失败') ? 'border-red-200 bg-red-50 text-red-600' : 'border-slate-200 bg-slate-50 text-slate-600'}>
                          {r.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-40 truncate text-sm text-slate-600">{r.target ?? '—'}</TableCell>
                      <TableCell className="max-w-64 truncate text-xs text-slate-500">{r.detail ?? '—'}</TableCell>
                      <TableCell className="text-xs text-slate-400">{r.ip?.replace('::ffff:', '') ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>第 {auditPage} / {Math.max(1, Math.ceil(audit.total / AUDIT_PAGE_SIZE))} 页</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={auditPage <= 1} onClick={() => setAuditPage(auditPage - 1)}>上一页</Button>
                  <Button size="sm" variant="outline" disabled={auditPage * AUDIT_PAGE_SIZE >= audit.total} onClick={() => setAuditPage(auditPage + 1)}>下一页</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 新建/编辑用户对话框 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing?.isNew ? '新建用户' : `编辑用户「${editing?.username}」`}</DialogTitle>
            <DialogDescription>
              {editing?.isNew ? '创建后用户可立即登录' : '修改角色或密码后，该用户的现有会话将立即失效'}
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>用户名 *</Label>
                <Input
                  value={editing.username}
                  disabled={!editing.isNew}
                  onChange={(e) => setEditing({ ...editing, username: e.target.value })}
                  placeholder="2~32 位字母/数字/下划线/中划线"
                />
              </div>
              <div className="space-y-1.5">
                <Label>角色 *</Label>
                <Select value={editing.role} onValueChange={(v) => setEditing({ ...editing, role: v as Role })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">只读 — 仅查看各页面</SelectItem>
                    <SelectItem value="operator">操作员 — 注册、发布、编辑、确认告警</SelectItem>
                    <SelectItem value="admin">管理员 — 全部权限（含用户管理、删除、归档）</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{editing.isNew ? '密码 *（至少 8 位）' : '重置密码（留空则不修改）'}</Label>
                <Input
                  type="password"
                  value={editing.password}
                  onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                  autoComplete="new-password"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={save} disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除用户确认 */}
      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除用户「{toDelete?.username}」？</AlertDialogTitle>
            <AlertDialogDescription>删除后该用户立即无法登录，且不可恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={async () => {
                if (!toDelete) return
                try {
                  await apiClient.del(`/admin/users/${encodeURIComponent(toDelete.username)}`)
                  toast.success('用户已删除')
                  fetchUsers()
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : '删除失败')
                }
                setToDelete(null)
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

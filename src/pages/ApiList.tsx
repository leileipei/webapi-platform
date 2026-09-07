import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Plus, Search, MoreHorizontal, Pencil, Trash2, ArrowUpCircle, ArrowDownCircle, Ban } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useStore } from '@/lib/store'
import { fmtNum } from '@/lib/metrics'
import { MethodBadge, StatusBadge, HealthDot, AUTH_LABELS } from '@/components/badges'
import type { ApiItem } from '@/types'

export default function ApiList() {
  const { state, dispatch } = useStore()
  const navigate = useNavigate()
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState('all')
  const [method, setMethod] = useState('all')
  const [groupId, setGroupId] = useState('all')
  const [toDelete, setToDelete] = useState<ApiItem | null>(null)

  const groupName = (id: string) => state.groups.find((g) => g.id === id)?.name ?? '未分组'

  const filtered = useMemo(() => {
    return state.apis.filter((a) => {
      if (keyword && !`${a.name}${a.path}`.toLowerCase().includes(keyword.toLowerCase())) return false
      if (status !== 'all' && a.status !== status) return false
      if (method !== 'all' && a.method !== method) return false
      if (groupId !== 'all' && a.groupId !== groupId) return false
      return true
    })
  }, [state.apis, keyword, status, method, groupId])

  const changeStatus = (api: ApiItem, s: ApiItem['status']) => {
    dispatch({ type: 'setApiStatus', id: api.id, status: s })
    toast.success(`「${api.name}」已${{ published: '发布上线', offline: '下线', deprecated: '标记废弃', draft: '退回草稿' }[s]}`)
  }

  return (
    <div className="space-y-5 p-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">API 管理</h1>
          <p className="mt-1 text-sm text-slate-500">共 {state.apis.length} 个 API，筛选后 {filtered.length} 个</p>
        </div>
        <Button onClick={() => navigate('/apis/new')}>
          <Plus className="mr-1 h-4 w-4" /> 注册 API
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-64 flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="搜索 API 名称或路径…" value={keyword} onChange={(e) => setKeyword(e.target.value)} />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-32"><SelectValue placeholder="状态" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="draft">草稿</SelectItem>
              <SelectItem value="published">已发布</SelectItem>
              <SelectItem value="offline">已下线</SelectItem>
              <SelectItem value="deprecated">已废弃</SelectItem>
            </SelectContent>
          </Select>
          <Select value={method} onValueChange={setMethod}>
            <SelectTrigger className="w-32"><SelectValue placeholder="方法" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部方法</SelectItem>
              {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={groupId} onValueChange={setGroupId}>
            <SelectTrigger className="w-36"><SelectValue placeholder="分组" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分组</SelectItem>
              {state.groups.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">方法</TableHead>
              <TableHead>API</TableHead>
              <TableHead>分组</TableHead>
              <TableHead>版本</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>健康度</TableHead>
              <TableHead>鉴权</TableHead>
              <TableHead className="text-right">今日调用</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="py-12 text-center text-sm text-slate-400">
                  没有匹配的 API，试试调整筛选条件
                </TableCell>
              </TableRow>
            )}
            {filtered.map((a) => {
              const todayCalls = a.todayCalls ?? 0
              return (
                <TableRow key={a.id} className="cursor-pointer" onClick={() => navigate(`/apis/${a.id}`)}>
                  <TableCell><MethodBadge method={a.method} /></TableCell>
                  <TableCell>
                    <div className="font-medium text-slate-900">{a.name}</div>
                    <div className="font-mono text-xs text-slate-400">{a.path}</div>
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">{groupName(a.groupId)}</TableCell>
                  <TableCell className="font-mono text-xs">{a.version}</TableCell>
                  <TableCell><StatusBadge status={a.status} /></TableCell>
                  <TableCell><HealthDot health={a.health} /></TableCell>
                  <TableCell className="text-sm text-slate-600">{AUTH_LABELS[a.auth]}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{a.status === 'published' ? fmtNum(todayCalls) : '—'}</TableCell>
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => navigate(`/apis/${a.id}`)}>查看详情</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => navigate(`/apis/${a.id}/edit`)}>
                          <Pencil className="mr-2 h-3.5 w-3.5" /> 编辑
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {a.status !== 'published' && (
                          <DropdownMenuItem onClick={() => changeStatus(a, 'published')}>
                            <ArrowUpCircle className="mr-2 h-3.5 w-3.5 text-emerald-600" /> 发布上线
                          </DropdownMenuItem>
                        )}
                        {a.status === 'published' && (
                          <DropdownMenuItem onClick={() => changeStatus(a, 'offline')}>
                            <ArrowDownCircle className="mr-2 h-3.5 w-3.5 text-amber-600" /> 下线
                          </DropdownMenuItem>
                        )}
                        {a.status !== 'deprecated' && (
                          <DropdownMenuItem onClick={() => changeStatus(a, 'deprecated')}>
                            <Ban className="mr-2 h-3.5 w-3.5 text-red-500" /> 标记废弃
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-red-600" onClick={() => setToDelete(a)}>
                          <Trash2 className="mr-2 h-3.5 w-3.5" /> 删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除 API「{toDelete?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后调用方将立即无法访问 <span className="font-mono">{toDelete?.path}</span>，相关应用授权同步移除。此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (toDelete) {
                  dispatch({ type: 'deleteApi', id: toDelete.id })
                  toast.success(`已删除「${toDelete.name}」`)
                }
                setToDelete(null)
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <p className="text-xs text-slate-400">
        找不到想要的 API？<Link to="/apis/new" className="text-blue-600 hover:underline">立即注册</Link>
      </p>
    </div>
  )
}

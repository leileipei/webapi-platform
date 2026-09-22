import { useState } from 'react'
import { Plus, Pencil, Trash2, KeyRound, Eye, EyeOff, Copy, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useStore, newId } from '@/lib/store'
import { copyText } from '@/lib/clipboard'
import { canWrite, isAdmin } from '@/lib/api'
import type { AppCredential } from '@/types'

function mask(s: string, visible: boolean): string {
  if (visible) return s
  return s.slice(0, 6) + '•'.repeat(12) + s.slice(-4)
}
/** 服务端对只读角色下发的脱敏密钥（含 **** 标记），不可复制/展示原文 */
const isMasked = (s: string) => s.includes('****')

export default function Apps() {
  const { state, dispatch } = useStore()
  const write = canWrite()
  const admin = isAdmin()
  const [editing, setEditing] = useState<AppCredential | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [toDelete, setToDelete] = useState<AppCredential | null>(null)
  const [toReset, setToReset] = useState<AppCredential | null>(null)
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({})
  // 创建/重置成功后的一次性密钥展示（明文只存在于本次服务端响应中）
  const [issued, setIssued] = useState<{ name: string; accessKey: string; secretKey: string } | null>(null)

  const copy = async (text: string, label: string) => {
    const okCopy = await copyText(text)
    if (okCopy) toast.success(`${label}已复制`)
    else toast.error('复制失败，请手动选中内容复制')
  }

  const openNew = () => {
    // 密钥由服务端以加密安全随机数生成，前端不再预生成
    setEditing({
      id: newId('app'), name: '', owner: '', accessKey: '', secretKey: '',
      status: 'active', apiIds: [], createdAt: new Date().toISOString().slice(0, 10),
    })
    setDialogOpen(true)
  }

  const save = async () => {
    if (!editing) return
    if (!editing.name.trim()) return toast.error('请填写应用名称')
    if (!editing.owner.trim()) return toast.error('请填写负责人/团队')
    const resp = (await dispatch({ type: 'upsertApp', app: editing })) as { secretKey?: string; accessKey?: string } | undefined
    setDialogOpen(false)
    // 密钥明文仅在创建/重置的本次响应中返回，必须立即提示保存
    if (resp?.secretKey) setIssued({ name: editing.name, accessKey: resp.accessKey ?? '', secretKey: resp.secretKey })
    else toast.success('应用已保存')
  }

  const requestRegenerate = (app: AppCredential) => {
    if (app.status === 'active') {
      toast.error('请先停用应用，再重置 SecretKey', { description: '启用中的应用不允许重置密钥，避免在线调用方瞬间失效' })
      return
    }
    setToReset(app)
  }

  const regenerate = async (app: AppCredential) => {
    // 服务端校验停用状态并生成新密钥（resetSecret 标记）；明文仅本次响应返回
    const resp = (await dispatch({ type: 'upsertApp', app: { ...app, secretKey: '', resetSecret: true } })) as { secretKey?: string; accessKey?: string } | undefined
    if (resp?.secretKey) setIssued({ name: app.name, accessKey: resp.accessKey ?? app.accessKey, secretKey: resp.secretKey })
    else toast.success(`「${app.name}」SecretKey 已重置，旧密钥立即失效`)
  }

  return (
    <div className="space-y-5 p-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">应用与密钥</h1>
          <p className="mt-1 text-sm text-slate-500">管理 API 调用方的 AccessKey / SecretKey 与接口授权</p>
        </div>
        {write && <Button onClick={openNew}><Plus className="mr-1 h-4 w-4" /> 新建应用</Button>}
      </div>

      <div className="space-y-4">
        {state.apps.map((app) => (
          <Card key={app.id}>
            <CardContent className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-50">
                    <KeyRound className="h-5 w-5 text-violet-600" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{app.name}</span>
                      <Badge variant={app.status === 'active' ? 'default' : 'secondary'} className={app.status === 'active' ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : ''}>
                        {app.status === 'active' ? '启用中' : '已停用'}
                      </Badge>
                    </div>
                    <div className="text-xs text-slate-400">{app.owner} · 创建于 {app.createdAt}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {write && (
                    <>
                      <span className="text-xs text-slate-500">启用</span>
                      <Switch
                        checked={app.status === 'active'}
                        onCheckedChange={(v) => {
                          dispatch({ type: 'upsertApp', app: { ...app, status: v ? 'active' : 'disabled' } })
                          toast.success(v ? '应用已启用' : '应用已停用，调用将被网关拒绝')
                        }}
                      />
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditing({ ...app }); setDialogOpen(true) }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                  {admin && (
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600" onClick={() => setToDelete(app)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                  <span className="shrink-0 text-xs text-slate-500">AccessKey</span>
                  <code className="flex-1 truncate text-xs">{app.accessKey}</code>
                  <Button variant="ghost" size="icon" className="h-7 w-7" title="复制 AccessKey" onClick={() => copy(app.accessKey, 'AccessKey ')}>
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                  <span className="shrink-0 text-xs text-slate-500">SecretKey</span>
                  <code className="flex-1 truncate text-xs">{mask(app.secretKey, !!showSecret[app.id])}</code>
                  {!isMasked(app.secretKey) && (
                    <>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title={showSecret[app.id] ? '隐藏 SecretKey' : '显示 SecretKey'} onClick={() => setShowSecret((s) => ({ ...s, [app.id]: !s[app.id] }))}>
                        {showSecret[app.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="复制 SecretKey" onClick={() => copy(app.secretKey, 'SecretKey ')}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                  {isMasked(app.secretKey) && <span className="text-[10px] text-slate-400">已加密存储，仅创建/重置时可见一次</span>}
                  {write && (
                    <Button
                      variant="ghost" size="icon"
                      className={app.status === 'active' ? 'h-7 w-7 cursor-not-allowed text-slate-300' : 'h-7 w-7 text-amber-600'}
                      title={app.status === 'active' ? '启用中的应用不可重置密钥：请先停用该应用' : '重置 SecretKey（需二次确认，旧密钥立即失效）'}
                      onClick={() => requestRegenerate(app)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-slate-500">已授权 API：</span>
                {app.apiIds.length === 0 && <span className="text-xs text-slate-400">暂无授权</span>}
                {app.apiIds.slice(0, 8).map((id) => {
                  const a = state.apis.find((x) => x.id === id)
                  if (!a) return null
                  // 同步展示 API 当前状态：非已发布的授权接口会标注，调用实际已被网关拒绝
                  const statusTag = { draft: '草稿', offline: '已下线', deprecated: '已废弃' }[a.status as 'draft' | 'offline' | 'deprecated']
                  return (
                    <Badge key={id} variant="outline" className={`text-xs font-normal ${statusTag ? 'border-amber-300 bg-amber-50 text-amber-700' : ''}`}>
                      {a.name}
                      {statusTag && <span className="ml-1 text-[10px]">· {statusTag}</span>}
                    </Badge>
                  )
                })}
                {app.apiIds.length > 8 && <span className="text-xs text-slate-400">等 {app.apiIds.length} 个</span>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing && state.apps.some((a) => a.id === editing.id) ? '编辑应用' : '新建应用'}</DialogTitle>
            <DialogDescription>创建后自动生成 AccessKey / SecretKey，勾选允许调用的 API</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>应用名称 *</Label>
                  <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>负责人 / 团队 *</Label>
                  <Input value={editing.owner} onChange={(e) => setEditing({ ...editing, owner: e.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>API 授权（{editing.apiIds.length} 个）</Label>
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {state.apis.filter((a) => a.status === 'published').map((a) => (
                    <label key={a.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                      <Checkbox
                        checked={editing.apiIds.includes(a.id)}
                        onCheckedChange={(v) =>
                          setEditing({
                            ...editing,
                            apiIds: v ? [...editing.apiIds, a.id] : editing.apiIds.filter((x) => x !== a.id),
                          })
                        }
                      />
                      <span className="font-mono text-[11px] text-slate-400">{a.method}</span>
                      <span>{a.name}</span>
                      <span className="ml-auto truncate font-mono text-[11px] text-slate-400">{a.path}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-slate-400">仅列出已发布的 API</p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={save}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除应用「{toDelete?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>删除后该应用的密钥立即失效，所有调用将被网关拒绝。此操作不可撤销。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (toDelete) {
                  dispatch({ type: 'deleteApp', id: toDelete.id })
                  toast.success('应用已删除')
                }
                setToDelete(null)
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={!!toReset} onOpenChange={(open) => !open && setToReset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重置「{toReset?.name}」的 SecretKey？</AlertDialogTitle>
            <AlertDialogDescription>
              重置后旧 SecretKey 立即失效，使用该密钥的调用方将无法通过网关校验。请确认已通知相关团队并做好密钥轮换准备。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (toReset) regenerate(toReset)
                setToReset(null)
              }}
            >
              确认重置
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 一次性密钥展示：明文仅存在于本次服务端响应，关闭后无法再次查看 */}
      <Dialog open={!!issued} onOpenChange={(open) => !open && setIssued(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>「{issued?.name}」密钥已生成</DialogTitle>
            <DialogDescription>
              请立即复制并妥善保管以下密钥。SecretKey 已加密存储，<span className="font-semibold text-red-600">关闭此窗口后将无法再次查看</span>，只能通过重置获取新密钥。
            </DialogDescription>
          </DialogHeader>
          {issued && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
                <span className="shrink-0 text-xs text-slate-500">AccessKey</span>
                <code className="flex-1 truncate text-xs">{issued.accessKey}</code>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="复制 AccessKey" onClick={() => copy(issued.accessKey, 'AccessKey ')}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2">
                <span className="shrink-0 text-xs text-slate-500">SecretKey</span>
                <code className="flex-1 truncate text-xs">{issued.secretKey}</code>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="复制 SecretKey" onClick={() => copy(issued.secretKey, 'SecretKey ')}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setIssued(null)}>我已妥善保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

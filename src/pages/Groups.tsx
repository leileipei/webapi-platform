import { useState } from 'react'
import { Plus, Pencil, Trash2, FolderTree } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useStore, newId } from '@/lib/store'
import type { ApiGroup } from '@/types'

export default function Groups() {
  const { state, dispatch } = useStore()
  const [editing, setEditing] = useState<ApiGroup | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [toDelete, setToDelete] = useState<ApiGroup | null>(null)

  const apiCount = (gid: string) => state.apis.filter((a) => a.groupId === gid).length

  const openNew = () => {
    setEditing({ id: newId('g'), name: '', description: '', createdAt: new Date().toISOString().slice(0, 10) })
    setDialogOpen(true)
  }

  const save = () => {
    if (!editing) return
    if (!editing.name.trim()) {
      toast.error('请填写分组名称')
      return
    }
    dispatch({ type: 'upsertGroup', group: editing })
    toast.success('分组已保存')
    setDialogOpen(false)
  }

  const deleteBlocked = toDelete ? apiCount(toDelete.id) > 0 : false

  return (
    <div className="space-y-5 p-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">分组管理</h1>
          <p className="mt-1 text-sm text-slate-500">按业务域组织 API，便于授权与统计</p>
        </div>
        <Button onClick={openNew}><Plus className="mr-1 h-4 w-4" /> 新建分组</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {state.groups.map((g) => (
          <Card key={g.id}>
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
                    <FolderTree className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <div className="font-semibold">{g.name}</div>
                    <div className="text-xs text-slate-400">{apiCount(g.id)} 个 API · 创建于 {g.createdAt}</div>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditing({ ...g }); setDialogOpen(true) }}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-red-600" onClick={() => setToDelete(g)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <p className="mt-3 line-clamp-2 text-sm text-slate-500">{g.description || '暂无描述'}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing && state.groups.some((g) => g.id === editing.id) ? '编辑分组' : '新建分组'}</DialogTitle>
            <DialogDescription>分组用于归类 API，并可作为授权粒度</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>分组名称 *</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="如：用户中心" />
              </div>
              <div className="space-y-1.5">
                <Label>描述</Label>
                <Textarea value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} rows={2} />
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
            <AlertDialogTitle>删除分组「{toDelete?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteBlocked
                ? `该分组下仍有 ${toDelete ? apiCount(toDelete.id) : 0} 个 API，请先迁移或删除这些 API。`
                : '分组删除后不可恢复。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteBlocked}
              className="bg-red-600 hover:bg-red-700"
              onClick={() => {
                if (toDelete) {
                  dispatch({ type: 'deleteGroup', id: toDelete.id })
                  toast.success('分组已删除')
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

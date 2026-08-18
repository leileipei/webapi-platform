import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { ShieldCheck, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { apiClient, authStorage } from '@/lib/api'
import { useStore } from '@/lib/store'

export default function Login() {
  const navigate = useNavigate()
  const { reload } = useStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('请输入用户名和密码')
      return
    }
    setLoading(true)
    setError('')
    try {
      const r = await apiClient.post<{ token: string; username: string }>('/admin/auth/login', {
        username: username.trim(),
        password,
      })
      authStorage.save(r.token, r.username)
      reload()
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 px-4">
      <Card className="w-full max-w-sm border-slate-700 bg-slate-800 text-slate-100">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500">
            <ShieldCheck className="h-6 w-6 text-white" />
          </div>
          <CardTitle className="text-xl">WebAPI 管理平台</CardTitle>
          <CardDescription className="text-slate-400">管理员登录 · API Gateway Console</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-slate-300">用户名</Label>
              <Input
                id="username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="border-slate-600 bg-slate-900 text-slate-100 placeholder:text-slate-500"
                placeholder="admin"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-slate-300">密码</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="border-slate-600 bg-slate-900 text-slate-100 placeholder:text-slate-500"
                placeholder="••••••••"
              />
            </div>
            {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">{error}</p>}
            <Button type="submit" className="w-full bg-blue-500 hover:bg-blue-600" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              登 录
            </Button>
            <p className="text-center text-xs text-slate-500">初始账号 admin / Admin@123，登录后请尽快修改密码</p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

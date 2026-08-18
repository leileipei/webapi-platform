// 一键启动前后端：node scripts/dev-all.mjs [--port 7100 ...]
// CLI 参数（host/port 等）全部透传给 Vite；任一进程退出时连带关闭另一个
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)

const server = spawn(process.execPath, ['server/index.js'], { stdio: 'inherit' })
const vite = spawn('npm', ['run', 'dev:web', '--', ...args], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

function shutdown() {
  if (!server.killed) server.kill()
  if (!vite.killed) vite.kill()
}

process.on('SIGINT', () => { shutdown(); process.exit(130) })
process.on('SIGTERM', () => { shutdown(); process.exit(143) })

vite.on('exit', (code) => {
  shutdown()
  process.exit(code ?? 0)
})
server.on('exit', (code, signal) => {
  if (signal) return // 被我们主动 kill
  console.error(`[dev] 后端进程退出（code=${code}），前端一并停止`)
  shutdown()
  process.exit(code ?? 1)
})

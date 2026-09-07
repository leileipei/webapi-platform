// 用 CDP 驱动无头 Chrome 截图：先注入登录令牌，再打开目标页面
// 用法: node scripts/screenshot.mjs <url> <token> <username> <role> <out.png>
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const [url, token, username, role, out] = process.argv.slice(2)
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9333

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--user-data-dir=/tmp/webapi-shot-profile',
  '--window-size=1440,900', '--hide-scrollbars',
  'about:blank',
], { stdio: 'ignore' })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getWsUrl() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      return (await r.json()).webSocketDebuggerUrl
    } catch { await sleep(300) }
  }
  throw new Error('Chrome CDP 未就绪')
}

let msgId = 0
const pending = new Map()
let ws

function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
}

async function main() {
  const wsUrl = await getWsUrl()
  ws = new WebSocket(wsUrl)
  await new Promise((r) => (ws.onopen = r))
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id)
      pending.delete(m.id)
      m.error ? reject(new Error(m.error.message)) : resolve(m.result)
    }
  }

  const { targetId } = await send('Target.createTarget', { url: 'http://localhost:7100/login' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  await send('Page.enable', {}, sessionId)
  await sleep(2000) // 等登录页加载

  // 注入会话令牌
  await send('Runtime.evaluate', {
    expression: `localStorage.setItem('webapi-admin-token',${JSON.stringify(token)});
                 localStorage.setItem('webapi-admin-user',${JSON.stringify(username)});
                 localStorage.setItem('webapi-admin-role',${JSON.stringify(role)}); 'ok'`,
  }, sessionId)

  await send('Page.navigate', { url }, sessionId)
  await sleep(4000) // 等页面渲染与数据加载

  const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log('saved:', out)
}

try {
  await main()
} finally {
  chrome.kill()
}
process.exit(0)

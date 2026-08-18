// 管理员认证：账号密码登录、内存会话、防暴力破解锁定
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
import { db } from './db.js'

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  username  TEXT PRIMARY KEY,
  salt      TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`)

const SESSION_TTL = 12 * 3600 * 1000 // 12 小时
const MAX_ATTEMPTS = 5
const LOCK_DURATION = 5 * 60 * 1000 // 锁定 5 分钟

// token -> { username, exp }
const sessions = new Map()
// username -> { count, lockUntil }
const loginAttempts = new Map()

function hash(password, salt) {
  return createHash('sha256').update(`${salt}:${password}`).digest('hex')
}

/** 首次启动创建默认管理员 admin / Admin@123 */
export function ensureAdmin() {
  const row = db.prepare('SELECT username FROM users WHERE username = ?').get('admin')
  if (!row) {
    const salt = randomBytes(16).toString('hex')
    db.prepare('INSERT INTO users (username, salt, pass_hash, created_at) VALUES (?, ?, ?, ?)').run(
      'admin', salt, hash('Admin@123', salt), new Date().toISOString(),
    )
    console.log('[auth] 已创建默认管理员 admin（默认密码 Admin@123，请登录后修改）')
  }
}

export function login(username, password) {
  const att = loginAttempts.get(username)
  if (att && att.lockUntil > Date.now()) {
    const minutes = Math.ceil((att.lockUntil - Date.now()) / 60000)
    const err = new Error(`失败次数过多，账号已锁定，请 ${minutes} 分钟后再试`)
    err.status = 429
    throw err
  }
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  const ok =
    row &&
    row.pass_hash.length === hash(password, row.salt).length &&
    timingSafeEqual(Buffer.from(row.pass_hash), Buffer.from(hash(password, row.salt)))
  if (!ok) {
    const a = loginAttempts.get(username) ?? { count: 0, lockUntil: 0 }
    a.count += 1
    if (a.count >= MAX_ATTEMPTS) {
      a.lockUntil = Date.now() + LOCK_DURATION
      a.count = 0
    }
    loginAttempts.set(username, a)
    return null
  }
  loginAttempts.delete(username)
  const token = randomBytes(24).toString('hex')
  sessions.set(token, { username, exp: Date.now() + SESSION_TTL })
  return { token, username, expiresIn: SESSION_TTL / 1000 }
}

/** 校验请求中的 Bearer token，返回会话或 null */
export function verify(req) {
  const h = req.headers.authorization
  const token = h && h.startsWith('Bearer ') ? h.slice(7) : null
  const s = token ? sessions.get(token) : null
  if (!s) return null
  if (s.exp < Date.now()) {
    sessions.delete(token)
    return null
  }
  return { ...s, token }
}

export function logout(token) {
  sessions.delete(token)
}

export function changePassword(username, oldPassword, newPassword) {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!row) return { ok: false, message: '用户不存在' }
  if (row.pass_hash !== hash(oldPassword, row.salt)) return { ok: false, message: '原密码不正确' }
  if (typeof newPassword !== 'string' || newPassword.length < 8) return { ok: false, message: '新密码至少 8 位' }
  const salt = randomBytes(16).toString('hex')
  db.prepare('UPDATE users SET salt = ?, pass_hash = ? WHERE username = ?').run(salt, hash(newPassword, salt), username)
  // 修改密码后注销该用户所有会话
  for (const [t, s] of sessions) if (s.username === username) sessions.delete(t)
  return { ok: true }
}

// 定期清理过期会话
setInterval(() => {
  const now = Date.now()
  for (const [t, s] of sessions) if (s.exp < now) sessions.delete(t)
}, 10 * 60 * 1000).unref()

// 管理员认证：账号密码登录、内存会话、防暴力破解锁定、多用户与角色
import { randomBytes, scryptSync, createHash, timingSafeEqual } from 'node:crypto'
import { db } from './db.js'

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  username  TEXT PRIMARY KEY,
  salt      TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`)
// 存量库迁移：补充角色列 / 强制改密标记列
try {
  db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'`)
} catch {
  // 列已存在
}
try {
  db.exec(`ALTER TABLE users ADD COLUMN must_change_pwd INTEGER NOT NULL DEFAULT 0`)
} catch {
  // 列已存在
}

const SESSION_TTL = 12 * 3600 * 1000 // 12 小时
const MAX_ATTEMPTS = 5
const LOCK_DURATION = 5 * 60 * 1000 // 锁定 5 分钟

export const ROLES = ['viewer', 'operator', 'admin']
export const ROLE_LEVEL = { viewer: 0, operator: 1, admin: 2 }

// token -> { username, role, exp }
const sessions = new Map()
// username -> { count, lockUntil }
const loginAttempts = new Map()

/** 当前算法：scrypt（带前缀标识）。N=16384, r=8, p=1 为默认参数 */
function hash(password, salt) {
  return 'scrypt:' + scryptSync(String(password), String(salt), 32).toString('hex')
}
/** 历史算法（v1.3.1 及之前）：单次 sha256，仅用于校验旧数据并在登录成功后自动升级 */
function hashLegacy(password, salt) {
  return createHash('sha256').update(`${salt}:${password}`).digest('hex')
}
/** 校验密码；命中旧算法时返回 'legacy' 以便调用方升级哈希 */
function verifyPassword(row, password) {
  if (row.pass_hash.startsWith('scrypt:')) {
    const stored = Buffer.from(row.pass_hash.slice(7), 'hex')
    const dig = scryptSync(String(password), row.salt, 32)
    return stored.length === dig.length && timingSafeEqual(stored, dig) ? 'ok' : 'bad'
  }
  const h = hashLegacy(password, row.salt)
  const ok = row.pass_hash.length === h.length && timingSafeEqual(Buffer.from(row.pass_hash), Buffer.from(h))
  return ok ? 'legacy' : 'bad'
}
const DEFAULT_ADMIN_PASSWORD = 'Admin@123'

/** 首次启动创建默认管理员 admin / Admin@123（标记必须改密） */
export function ensureAdmin() {
  const row = db.prepare('SELECT username FROM users WHERE username = ?').get('admin')
  if (!row) {
    const salt = randomBytes(16).toString('hex')
    db.prepare('INSERT INTO users (username, salt, pass_hash, created_at, role, must_change_pwd) VALUES (?, ?, ?, ?, ?, 1)').run(
      'admin', salt, hash(DEFAULT_ADMIN_PASSWORD, salt), new Date().toISOString(), 'admin',
    )
    console.log('[auth] 已创建默认管理员 admin（默认密码 Admin@123，首次登录将强制修改）')
    return
  }
  // 存量部署兜底：admin 仍在使用默认口令时，强制要求改密
  const full = db.prepare('SELECT * FROM users WHERE username = ?').get('admin')
  if (!full.must_change_pwd && verifyPassword(full, DEFAULT_ADMIN_PASSWORD) !== 'bad') {
    db.prepare('UPDATE users SET must_change_pwd = 1 WHERE username = ?').run('admin')
    console.log('[auth] 检测到 admin 仍使用默认密码，已标记首次登录强制修改')
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
  const verdict = row ? verifyPassword(row, password) : 'bad'
  if (verdict === 'bad') {
    const a = loginAttempts.get(username) ?? { count: 0, lockUntil: 0 }
    a.count += 1
    if (a.count >= MAX_ATTEMPTS) {
      a.lockUntil = Date.now() + LOCK_DURATION
      a.count = 0
    }
    loginAttempts.set(username, a)
    return null
  }
  // 旧 sha256 哈希自动升级为 scrypt
  if (verdict === 'legacy') {
    const salt = randomBytes(16).toString('hex')
    db.prepare('UPDATE users SET salt = ?, pass_hash = ? WHERE username = ?').run(salt, hash(password, salt), username)
  }
  loginAttempts.delete(username)
  const token = randomBytes(24).toString('hex')
  sessions.set(token, { username, role: row.role ?? 'admin', exp: Date.now() + SESSION_TTL })
  return { token, username, role: row.role ?? 'admin', expiresIn: SESSION_TTL / 1000, mustChangePwd: !!row.must_change_pwd }
}

/** 校验请求中的 Bearer token，返回会话（含角色）或 null */
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

/** 会话角色是否满足最低要求 */
export function hasRole(session, minRole) {
  return (ROLE_LEVEL[session?.role] ?? -1) >= (ROLE_LEVEL[minRole] ?? 99)
}

export function changePassword(username, oldPassword, newPassword) {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!row) return { ok: false, message: '用户不存在' }
  if (verifyPassword(row, oldPassword) === 'bad') return { ok: false, message: '原密码不正确' }
  if (typeof newPassword !== 'string' || newPassword.length < 8) return { ok: false, message: '新密码至少 8 位' }
  const salt = randomBytes(16).toString('hex')
  db.prepare('UPDATE users SET salt = ?, pass_hash = ?, must_change_pwd = 0 WHERE username = ?').run(salt, hash(newPassword, salt), username)
  // 修改密码后注销该用户所有会话
  for (const [t, s] of sessions) if (s.username === username) sessions.delete(t)
  return { ok: true }
}

/* ---------- 用户管理（仅 admin 可调用，由路由层控制） ---------- */

export function listUsers() {
  return db.prepare('SELECT username, role, created_at FROM users ORDER BY created_at').all()
    .map((u) => ({ username: u.username, role: u.role, createdAt: u.created_at }))
}

export function upsertUser({ username, password, role }) {
  if (!/^[a-zA-Z0-9_\-]{2,32}$/.test(String(username ?? ''))) return { ok: false, message: '用户名需为 2~32 位字母/数字/下划线/中划线' }
  if (!ROLES.includes(role)) return { ok: false, message: '非法角色' }
  const existing = db.prepare('SELECT username, role FROM users WHERE username = ?').get(username)
  if (existing) {
    // 系统至少保留一个管理员：不允许把唯一的管理员降级
    if (existing.role === 'admin' && role !== 'admin') {
      const adminCount = db.prepare(`SELECT COUNT(*) c FROM users WHERE role = 'admin'`).get().c
      if (adminCount <= 1) return { ok: false, message: '系统至少保留一个管理员' }
    }
    // 已存在：更新角色，可选重置密码（重置后用户下次登录须自行改密）；角色或密码变化后旧会话立即失效
    db.prepare('UPDATE users SET role = ? WHERE username = ?').run(role, username)
    if (password) {
      if (password.length < 8) return { ok: false, message: '密码至少 8 位' }
      const salt = randomBytes(16).toString('hex')
      db.prepare('UPDATE users SET salt = ?, pass_hash = ?, must_change_pwd = 1 WHERE username = ?').run(salt, hash(password, salt), username)
    }
    if (existing.role !== role || password) revokeSessions(username)
    return { ok: true }
  }
  if (typeof password !== 'string' || password.length < 8) return { ok: false, message: '新建用户密码至少 8 位' }
  const salt = randomBytes(16).toString('hex')
  db.prepare('INSERT INTO users (username, salt, pass_hash, created_at, role) VALUES (?, ?, ?, ?, ?)').run(
    username, salt, hash(password, salt), new Date().toISOString(), role,
  )
  return { ok: true }
}

export function deleteUser(username, currentUsername) {
  if (username === currentUsername) return { ok: false, message: '不能删除当前登录账号' }
  const target = db.prepare('SELECT username, role FROM users WHERE username = ?').get(username)
  if (!target) return { ok: false, message: '用户不存在' }
  // 系统至少保留一个管理员
  if (target.role === 'admin') {
    const adminCount = db.prepare(`SELECT COUNT(*) c FROM users WHERE role = 'admin'`).get().c
    if (adminCount <= 1) return { ok: false, message: '系统至少保留一个管理员' }
  }
  db.prepare('DELETE FROM users WHERE username = ?').run(username)
  for (const [t, s] of sessions) if (s.username === username) sessions.delete(t)
  return { ok: true }
}

/** 角色变更/删除后，让该用户旧会话立即失效 */
export function revokeSessions(username) {
  for (const [t, s] of sessions) if (s.username === username) sessions.delete(t)
}

/** 注销全部会话（如恢复含用户表的备份后强制重新登录） */
export function revokeAllSessions() {
  sessions.clear()
}

// 定期清理过期会话
setInterval(() => {
  const now = Date.now()
  for (const [t, s] of sessions) if (s.exp < now) sessions.delete(t)
}, 10 * 60 * 1000).unref()

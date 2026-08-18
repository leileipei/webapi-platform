export function fmtNum(n: number): string {
  if (n >= 1_0000_0000) return (n / 1_0000_0000).toFixed(1) + ' 亿'
  if (n >= 1_0000) return (n / 1_0000).toFixed(1) + ' 万'
  return n.toLocaleString()
}

export function randomKey(prefix: string, len = 24): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return `${prefix}_${s}`
}

/**
 * 复制文本到剪贴板。
 * navigator.clipboard 仅在安全上下文（https 或 localhost）可用；
 * 局域网 http://<IP> 部署时降级为隐藏 textarea + execCommand。
 * 返回是否复制成功，由调用方决定提示文案。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 继续走降级方案
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const okCopy = document.execCommand('copy')
    document.body.removeChild(ta)
    return okCopy
  } catch {
    return false
  }
}

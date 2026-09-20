import { test, expect } from '@playwright/test'

/** 前端冒烟：登录页渲染 → 错误密码提示 → 正确登录 → 控制台首页渲染 */

test('未登录访问根路径应跳转登录页', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByText('WebAPI 管理平台')).toBeVisible()
  await expect(page.getByText(/API Gateway Console · v\d+\.\d+\.\d+/)).toBeVisible()
})

test('错误密码应显示错误提示且不跳转', async ({ page }) => {
  await page.goto('/login')
  await page.locator('#username').fill('admin')
  await page.locator('#password').fill('wrong-password')
  await page.getByRole('button', { name: /登\s*录/ }).click()
  await expect(page.getByText('用户名或密码错误')).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
})

test('管理员登录成功并渲染控制台首页', async ({ page }) => {
  await page.goto('/login')
  await page.locator('#username').fill('admin')
  await page.locator('#password').fill('Admin@123')
  await page.getByRole('button', { name: /登\s*录/ }).click()

  // 跳转到控制台首页，概览标题出现（初始密码未改时会叠加强制改密对话框，
  // 模态框会把背景树标记 aria-hidden，故用文本而非 role 定位）
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.getByText('平台概览').first()).toBeVisible()

  // 侧边栏核心导航可见
  for (const item of ['应用与密钥', '系统管理']) {
    await expect(page.getByText(item, { exact: true }).first()).toBeVisible()
  }

  // 退出登录后回到登录页（如界面提供退出入口则验证，无则跳过）
  const logout = page.getByText('退出登录', { exact: true })
  if (await logout.count()) {
    await logout.first().click()
    await expect(page).toHaveURL(/\/login/)
  }
})

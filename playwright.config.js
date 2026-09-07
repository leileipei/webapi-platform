import { defineConfig } from '@playwright/test'

/**
 * 前端 UI 冒烟：需目标实例已在运行（后端托管 dist 或 vite dev）
 * 本地：BASE_URL=http://localhost:3100 npx playwright test
 * CI：由 workflow 负责 build + 启动后端后执行
 */
export default defineConfig({
  testDir: './e2e-ui',
  timeout: 30_000,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3100',
    headless: true,
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})

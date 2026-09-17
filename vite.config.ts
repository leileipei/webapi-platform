import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'
import pkg from './package.json'

// https://vite.dev/config/
export default defineConfig({
  // 必须用绝对路径：相对路径（./）在 /apis/new 等二级路由刷新时会把资源解析到错误位置导致白屏
  base: '/',
  // 构建期注入系统版本号（来源 package.json），前端通过 @/lib/version 的 APP_VERSION 使用
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [inspectAttr(), react()],
  server: {
    port: 3000,
    proxy: {
      '/admin': 'http://localhost:3100',
      '/gw': 'http://localhost:3100',
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

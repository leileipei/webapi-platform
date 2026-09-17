// 系统版本号：构建时由 vite.config.ts 从 package.json 注入（define.__APP_VERSION__）
// 发版流程：npm version <x.y.z> --no-git-tag-version 后重新构建即可自动同步
export const APP_VERSION = __APP_VERSION__

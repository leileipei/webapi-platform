# WebAPI 管理平台

对标市面主流 API 管理平台（如 Apifox / YApi / Konga）的 API 网关管理控制台，覆盖 API 从注册、发布、监控到废弃的完整生命周期。

## 功能总览

| 模块 | 能力 |
|---|---|
| **平台概览** | API 总数、今日调用量、成功率、告警统计；30 天调用趋势、状态分布饼图、Top 5 调用量排行、健康度一览 |
| **API 注册** | 分段式表单：基本信息（路径 + 方法全局唯一性校验）、后端服务地址、超时 / 失败重试 / QPS 限流 / **熔断保护**等稳定性配置、鉴权方式（无鉴权 / API Key / OAuth2 / JWT）、Query / Header / Body 参数文档、响应示例（JSON 合法性校验） |
| **API 管理** | 关键词搜索 + 状态 / 方法 / 分组多维筛选；草稿 → 已发布 → 已下线 → 已废弃 完整生命周期流转；删除二次确认并联动清理应用授权 |
| **API 详情** | 运行监控图表（调用量 / 错误数 / 延迟趋势）、接口文档（含一键复制 cURL）、**在线调试**（模拟请求，返回状态码与延迟）、版本历史时间线（修改版本号自动追加记录） |
| **分组管理** | 分组 CRUD，非空分组禁止删除（保护性约束） |
| **应用与密钥** | 调用方应用管理；AccessKey / SecretKey 自动生成、脱敏显示、一键重置；按 API 粒度勾选授权；应用启停控制 |
| **监控告警** | 全局错误率 / 延迟趋势图；告警规则 CRUD（错误率 / 延迟 / QPS 阈值，严重 / 警告 / 提醒三级）；告警记录标记处理 |

## 技术栈

- **框架**:React 19 + TypeScript + Vite
- **UI**:Tailwind CSS + shadcn/ui（40+ 组件）
- **图表**:Recharts
- **路由**:React Router 7
- **状态管理**:React Context + useReducer，数据持久化至 `localStorage`（刷新不丢失，内置示例数据，侧栏可一键重置）

## 本地启动

```bash
npm install
npm run dev        # 默认 http://localhost:3000，可用 -- --port <N> 指定端口
```

## 构建

```bash
npm run build      # 产物输出到 dist/，为纯静态站点，可部署到任意静态托管
npm run preview    # 本地预览生产构建
```

## 目录结构

```
src/
├── components/        # Layout 布局、通用徽标组件、shadcn/ui 组件库
├── lib/
│   ├── store.tsx      # 全局状态（Context + Reducer + localStorage 持久化）
│   ├── seed.ts        # 内置示例数据（11 个 API / 4 分组 / 3 应用 / 告警规则）
│   └── metrics.ts     # 确定性模拟指标生成（调用量 / 错误数 / 延迟）
├── pages/
│   ├── Dashboard.tsx  # 平台概览
│   ├── ApiList.tsx    # API 列表管理
│   ├── ApiForm.tsx    # API 注册 / 编辑
│   ├── ApiDetail.tsx  # API 详情（监控 / 文档 / 调试 / 版本）
│   ├── Groups.tsx     # 分组管理
│   ├── Apps.tsx       # 应用与密钥
│   └── Monitor.tsx    # 监控告警
└── types/             # TypeScript 类型定义
```

## 说明

当前为纯前端实现，调用量、错误率、延迟等指标由基于 API ID 的确定性伪随机算法生成，用于演示完整的产品形态；接入真实网关时替换 `src/lib/metrics.ts` 与 `src/lib/store.tsx` 的数据源即可，页面层无需改动。

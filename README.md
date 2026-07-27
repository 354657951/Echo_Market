<div align="center">

# 回声集 · Echo Market

**AI 辅助的校园旧物循环站**

让闲置物品以更清楚的信息，被下一位真正需要它的人看见。

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vite.dev/)
[![AI API](https://img.shields.io/badge/AI-SiliconFlow-171717)](https://siliconflow.cn/)
[![Course Project](https://img.shields.io/badge/Type-Course_Project-8B8B8B)](#项目说明)

[完整在线版](https://echo-market-campus.ldwmrbcilqkbv.chatgpt.site) ·
[GitHub Pages 静态演示](https://354657951.github.io/Echo_Market/) ·
[功能概览](#功能概览) ·
[快速开始](#快速开始) ·
[项目结构](#项目结构)

</div>

---

## 项目说明

回声集是本科暑期实习期间完成的小组 Web 项目，围绕“校园闲置物品循环”这一主题，练习多页面前端开发、状态管理、服务端接口、账号会话和 AI API 接入。

项目使用独立账号密码登录，不依赖 ChatGPT 账号。AI 用于整理发布者已经提供的商品信息；标题、成色、价格、瑕疵和交易方式仍需由发布者人工确认。未配置 AI 接口时，浏览、筛选、收藏、交易清单和手动发布等基础功能仍可使用。

> 本项目是课程实习作业，并非实际交易平台。完整在线版使用共享数据库和图片存储，方便小组共同测试；目前没有在线支付、物流或实名认证功能。

> GitHub Pages 版本用于快速查看界面与前端交互，可直接访问，无需登录。由于 GitHub Pages 只托管静态文件，该版本不连接账号会话和 AI 服务；完整登录与 AI 发布请使用上方“完整在线版”。

## 功能概览

- **独立页面导航**：首页、集市、商品详情、发布、收藏、交易清单、循环故事和账户均使用独立 URL。
- **商品浏览与筛选**：支持关键词搜索、分类筛选和价格排序，筛选条件会同步到地址栏。
- **AI 辅助发布**：调用 SiliconFlow Chat Completions API，整理标题、分类、描述、标签和参考价格。
- **人工确认机制**：AI 结果可以继续修改，提交前必须确认公开信息与实物一致。
- **收藏与交易清单**：支持收藏商品、调整清单数量、填写校内交接计划并生成确认记录。
- **小组共享数据**：商品发布、收藏、清单和订单记录写入共享数据库，组员可以跨设备查看最新结果。
- **共享商品图片**：发布照片进入独立对象存储，不再依赖当前浏览器的临时预览数据。
- **操作反馈**：保存、同步、收藏、清单和确认单操作提供加载、成功与失败状态。
- **响应式界面**：适配桌面与移动端，并为 `prefers-reduced-motion` 提供减少动态效果的路径。
- **服务端密钥隔离**：AI 密钥只由 Node 服务或托管运行环境读取，不进入前端构建产物。

## 页面结构

| 路径 | 页面 | 主要内容 |
| --- | --- | --- |
| `/` | 首页 | 视频叙事首屏、功能入口与近期商品 |
| `/market` | 校园集市 | 搜索、分类、排序和商品列表 |
| `/product/:id` | 商品详情 | 商品图片、状态、描述与交易操作 |
| `/publish` | AI 发布 | 原始信息输入、AI 整理、人工校对和图片预览 |
| `/favorites` | 我的收藏 | 当前登录用户保存的收藏商品 |
| `/cart` | 交易清单 | 数量管理、校内交接计划和确认记录 |
| `/story` | 循环故事 | 项目主题、物品流转过程与当前记录 |
| `/account` | 账户 | 个人发布、收藏与交易记录 |

## 技术栈

| 层级 | 使用技术 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite |
| 样式 | Tailwind CSS、项目级 CSS |
| 路由 | 轻量客户端路由与 History API |
| 状态 | React Context、共享 D1 数据库或服务端文档存储、定时同步 |
| 图片 | R2 对象存储；文档存储模式下使用受限尺寸的数据图片 |
| 本地服务 | Node.js、Express |
| AI 接口 | SiliconFlow Chat Completions API |
| 线上运行 | Cloudflare Worker 兼容服务入口 |

## 快速开始

### 1. 环境要求

- Node.js 20 或更高版本
- npm 10 或兼容版本

### 2. 安装依赖

```bash
git clone https://github.com/354657951/Echo_Market.git
cd Echo_Market
npm install
```

### 3. 配置本地环境

复制 `.env.example` 为 `.env`，再填写本地配置：

```env
AI_API_URL=https://api.siliconflow.cn/v1/chat/completions
AI_API_KEY=你的服务端密钥
AI_MODEL=Qwen/Qwen3.5-27B

APP_USERNAME=campus
APP_PASSWORD=请设置本地演示密码
APP_SESSION_SECRET=请填写至少 32 字符的随机密钥
APP_INVITE_CODE=请设置注册邀请码
STORE_BLOB_URL=可选的服务端共享文档地址
PORT=8787
```

`.env` 已被 Git 忽略，请勿把 API Key、正式密码或会话密钥提交到仓库。

### 4. 启动项目

```bash
npm run dev:all
```

- 前端页面：`http://localhost:5173`
- 本地接口：`http://127.0.0.1:8787`

### 5. 生产构建

```bash
npm run build
npm run preview
```

GitHub Pages 静态演示构建：

```bash
npm run build:pages
```

## 账号与会话

完整版本支持邀请码注册。密码使用 PBKDF2-SHA256 加盐哈希保存，浏览器通过 HttpOnly Cookie 使用 15 分钟访问 JWT 与 30 天可撤销刷新会话。

首次迁移时，可通过 `APP_USERNAME` 与 `APP_PASSWORD` 初始化兼容的 campus 账号；后续用户使用 `APP_INVITE_CODE` 完成注册。

## AI 发布流程

```text
用户填写真实情况
        ↓
服务端调用 SiliconFlow
        ↓
返回结构化商品字段
        ↓
用户修改并确认信息
        ↓
写入共享商品与图片存储
```

浏览器只请求项目自己的 `/api/ai-polish` 接口。服务端负责读取 AI 密钥、构造提示内容并解析 JSON 结果，避免把密钥发送到前端。

## 项目结构

```text
Echo_Market/
├─ .github/
│  └─ workflows/                 # GitHub Pages 自动部署
├─ docs/
│  ├─ design/                    # 原始视觉提示词
│  └─ requirements/              # 课程项目任务书
├─ data/
│  └─ seed-products.json        # 本地与线上共用的初始商品
├─ db/
│  └─ schema.ts                 # 共享数据表结构
├─ drizzle/                     # 数据库迁移
├─ public/
│  └─ products/                  # 演示商品图片
├─ scripts/
│  └─ prepare-sites-build.mjs    # 托管构建整理脚本
├─ src/
│  ├─ components/
│  │  ├─ auth/                   # 登录与会话界面
│  │  ├─ layout/                 # 公共导航与页脚
│  │  ├─ market/                 # 商品展示组件
│  │  └─ motion/                 # 入场与文字动效组件
│  ├─ config/                    # 公共媒体配置
│  ├─ api/                       # 共享数据请求封装
│  ├─ data/                      # 初始商品数据适配
│  ├─ pages/                     # 各独立路由页面
│  ├─ router/                    # 客户端路由
│  ├─ state/                     # 全局状态、共享同步与操作反馈
│  ├─ types/                     # TypeScript 类型
│  ├─ App.tsx                    # 页面分发与登录状态
│  ├─ index.css                  # 全站样式与响应式规则
│  └─ main.tsx                   # 前端入口
├─ worker/
│  ├─ index.js                   # 线上鉴权、AI 接口与 SPA 回退
│  └─ store.js                   # 共享数据和图片接口
├─ server.mjs                    # 本地 Node API 服务
├─ server-store.mjs              # 本地持久化实现
├─ package.json
└─ vite.config.ts
```

## 数据与隐私

- 完整在线版的商品、收藏、交易清单和确认记录保存在服务端共享存储中；优先使用 D1/R2，托管环境未提供绑定时可通过 `STORE_BLOB_URL` 使用同源接口后方的文档存储。
- 用户主动发布的商品图片保存到项目对象存储中，供其他已登录组员查看。
- 本地开发数据保存在被 Git 忽略的 `.local-data` 目录，不会进入仓库。
- AI 接口只接收用户主动填写的商品说明、成色和期望价格。
- 项目不应保存真实身份证件、支付信息、联系方式或其他敏感资料。
- 课程任务书和原始视觉提示词位于 `docs/`，便于提交时核对要求与设计来源。

## 当前边界

- 市场商品对所有登录用户可见；收藏、清单和交易记录按用户隔离。
- 页面通过操作后立即更新、窗口重新聚焦和定时刷新获取其他组员的最新修改。
- 交易流程用于课程演示，最终交接仍需双方线下确认。
- AI 输出可能不准确，必须由发布者检查后再提交。
- GitHub Pages 是静态演示入口，不包含服务端登录、会话与 AI 接口。

---

<div align="center">

**回声集 · 让旧物继续流动**

本科暑期实习小组课程项目

</div>

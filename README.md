# 回声集

回声集是一座由 AI 辅助发布的校园旧物循环站。站点使用自己的账号密码登录，不依赖 ChatGPT 账号。未配置 AI 接口时，商品浏览、筛选、详情、收藏、购物清单、图片上传和手动发布仍可正常使用。

## 页面结构

- `/`：视频叙事首页与精选旧物
- `/market`：支持搜索、分类和价格排序的校园集市
- `/product/:id`：独立商品详情与相似旧物
- `/publish`：AI 辅助整理、人工校对和图片预览
- `/favorites`：收藏档案
- `/cart`：数量管理与线下交接计划
- `/story`：物品循环故事
- `/account`：个人发布与交易确认记录

页面之间使用真实路由跳转，商品发布、收藏、交易清单和确认记录会保存在当前浏览器中。

## 本地运行

```bash
npm install
npm run dev:all
```

页面默认运行在 `http://localhost:5173`，本地接口默认运行在 `http://127.0.0.1:8787`。

## 登录账号

默认课程演示账号：

```text
账号：campus
密码：Echo@2026
```

部署时可以通过 `APP_USERNAME`、`APP_PASSWORD` 和 `APP_SESSION_SECRET` 修改登录账号、密码与会话签名密钥。

## AI 接口配置

复制 `.env.example` 为 `.env`，填写：

```env
AI_API_URL=https://api.siliconflow.cn/v1/chat/completions
AI_API_KEY=你的服务端密钥
AI_MODEL=Qwen/Qwen3-8B
APP_USERNAME=campus
APP_PASSWORD=Echo@2026
APP_SESSION_SECRET=随机且足够长的字符串
PORT=8787
```

API Key 只由本地 Node 服务或 Sites 生产环境读取，不会进入浏览器构建产物。默认使用 SiliconFlow 的 Chat Completions 接口，以 `messages` 发送商品原始信息，并要求模型返回 JSON；服务端同时保留对 Responses API `output_text` 的兼容。

## 生产构建

```bash
npm run build
npm run preview
```

## 数据与隐私

- 商品、收藏和清单保存在浏览器本地存储中。
- 上传图片在浏览器内转换为预览数据，不会自动上传到外部服务。
- 页面提示用户当面验货，避免通过不明链接付款。

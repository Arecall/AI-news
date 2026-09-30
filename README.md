# AI-news

一个支持自部署的 AI 科技资讯聚合平台。自动从 RSS 和网站订阅源收集新闻，通过 AI 翻译、提炼内容，并生成每日早报与晚报，让你在一个页面里浏览最新资讯、追踪热点、阅读摘要和访问原文。

当前版本：**v2.6.4** · [在线体验](https://news.shbya.com) · [版本源码](https://github.com/Arecall/AI-news/tree/v2.6.4)

## 功能介绍

- **多源资讯聚合**：支持 RSS 与网站订阅源，提供来源管理、连通性探测和定时抓取。
- **AI 内容处理**：翻译和整理新闻内容，生成摘要；优先使用来源配图，并支持 AI 生成配图和图片压缩。
- **每日早晚报**：聚合新闻生成科技简报，支持手动生成、定时生成，以及两种首页展示布局。
- **新闻阅读与发现**：支持搜索、分类浏览、热点排行、分页、文章详情和原文跳转；收藏保存在当前浏览器中。
- **管理后台**：配置 AI 接口与模型、测试模型连通性、管理订阅源、调整抓取与早晚报计划，以及修改管理员账号密码。
- **自部署与持久化**：使用 SQLite 保存新闻和配置，提供 Docker Compose 部署方式，适配桌面与移动端。

## 技术栈

| 部分 | 技术 |
| --- | --- |
| 前端 | React 19、React Router 7、Vite 8 |
| 后端 | Node.js、Express 5 |
| 数据存储 | SQLite、better-sqlite3 |
| 内容采集 | RSS Parser、JSDOM、Mozilla Readability |
| 任务与图片 | node-cron、Bottleneck、Sharp |
| 部署 | Docker Compose、Nginx |
| 测试 | Node.js Test Runner、Vitest、Testing Library |

## 本地运行

建议使用 **Node.js 24** 和 npm。前端、后端分别安装依赖并启动。

### 1. 获取代码

```bash
git clone https://github.com/Arecall/AI-news.git
cd AI-news
```

### 2. 配置环境变量

在 `backend` 目录下新建 `.env` 文件，填入自己的接口地址、密钥和模型名称：

```dotenv
ANTHROPIC_BASE_URL=https://your-api.example.com/v1
ANTHROPIC_AUTH_TOKEN=your-api-key
GEMINI_CHAT_MODEL=your-chat-model
GEMINI_IMAGE_MODEL=your-image-model
ADMIN_PASSWORD=replace-with-a-strong-password
TZ=Asia/Shanghai
```

| 配置项 | 说明 |
| --- | --- |
| `ANTHROPIC_BASE_URL` | OpenAI 兼容接口的基础地址，建议包含 `/v1`；未包含时程序会自动补齐 |
| `ANTHROPIC_AUTH_TOKEN` | 接口访问密钥 |
| `GEMINI_CHAT_MODEL` | 翻译、摘要和早晚报使用的文本模型 |
| `GEMINI_IMAGE_MODEL` | 生成新闻配图使用的图片模型 |
| `FALLBACK_IMAGE_MODELS` | 可选，备用图片模型，多个名称以英文逗号分隔 |
| `ADMIN_PASSWORD` | 首次使用时的管理员密码，请设置为自己的强密码 |
| `TZ` | 进程时区，建议使用 `Asia/Shanghai` |

变量名沿用项目历史命名，实际请求使用 OpenAI 兼容接口。模型名称需替换为服务商支持的名称；文本与图片生成需要对应的接口能力。

管理后台保存的非空配置优先于环境变量。如果修改 `.env` 后配置未生效，请检查后台是否已经保存了同名配置。请勿将真实密钥、密码或运行数据库提交到仓库。

### 3. 启动后端

```bash
cd backend
npm ci
node index.js
```

后端监听 `3003` 端口，默认在 `backend/news.db` 创建数据库。服务启动后会触发抓取和清理，首次获取新闻需要等待一段时间，AI 处理需要有效的接口配置。

### 4. 启动前端

另开一个终端，在项目根目录执行：

```bash
cd frontend
npm ci
npm run dev
```

默认访问地址为 [http://localhost:5173](http://localhost:5173)，管理入口为 [http://localhost:5173/admin](http://localhost:5173/admin)。初始用户名为 `admin`，密码使用上面配置的 `ADMIN_PASSWORD`；已在后台修改过的账号密码以数据库中保存的值为准。

Vite 开发服务器会将 `/api` 和 `/images` 请求代理到本地后端。

## Docker 部署

先按上面的说明创建 `backend/.env`。仓库的基础 Compose 配置没有对外发布端口；如需直接访问，可在项目根目录新建 `docker-compose.override.yml`：

```yaml
services:
  frontend:
    ports:
      - "8080:80"
```

然后在项目根目录运行：

```bash
mkdir -p data
docker compose up -d --build
```

访问 [http://localhost:8080](http://localhost:8080)，或服务器的 `8080` 端口。前端容器中的 Nginx 会转发 API 和图片请求到后端，无需单独暴露后端端口。

常用管理命令：

```bash
# 查看服务状态
docker compose ps

# 查看后端日志
docker compose logs -f backend

# 停止服务
docker compose down
```

数据库与图片保存在宿主机的 `data/` 目录中，更新前请备份该目录和环境配置。使用域名部署时，可在前端服务前配置 HTTPS 反向代理。

## 定时任务

| 任务 | 默认计划 |
| --- | --- |
| 新闻抓取 | 每两小时一次，`0 */2 * * *` |
| AI 早报 | 每天北京时间 08:00 |
| AI 晚报 | 每天北京时间 20:00 |

抓取计划和早晚报开关、时间可在管理后台调整。早晚报调度显式使用 `Asia/Shanghai` 时区；服务需要保持运行才能执行定时任务。关闭定时抓取不会阻止服务启动时触发的首次抓取。

## 项目结构

```text
AI-news/
├── frontend/              # React 页面、静态资源与 Nginx 配置
├── backend/
│   ├── index.js           # 后端入口
│   ├── crawler.js         # 新闻采集
│   ├── ai-service.js      # AI 内容与图片处理
│   ├── scheduler.js       # 定时任务调度
│   ├── routes/            # API 路由
│   ├── services/          # 早晚报等业务逻辑
│   └── test/              # 后端测试
├── docker/                # 容器构建文件
├── docker-compose.yml
└── data/                  # Docker 运行时数据，首次部署时创建
```

## 前端验证

在 `frontend` 目录执行：

```bash
npm test
npm run build
```

后端测试位于 `backend/test/`，部分测试涉及数据库读写，应使用独立的测试数据库，避免连接线上数据。

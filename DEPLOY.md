# SLR System 部署指南

## 🌐 部署架构

```
┌─────────────────────┐          ┌─────────────────────┐
│   Cloudflare Pages  │          │      Render.com     │
│   (静态前端)         │◄────────►│   (FastAPI 后端)    │
│ slr-system.pages.dev│          │slr-system-api.onrender│
└─────────────────────┘          └─────────────────────┘
                                          │
                                          ▼
                                  ┌───────────────┐
                                  │   SQLite DB   │
                                  │   (持久化磁盘)  │
                                  └───────────────┘
```

## 📋 前置要求

- Node.js 20+
- Cloudflare 账号
- Render.com 账号
- OpenAI API Key (用于 AI 分析功能)

---

## 🚀 快速部署

### 方式一：GitHub Actions 自动部署（推荐）

1. **Fork 或 push 代码到 GitHub**

2. **设置 Secrets**
   
   在 GitHub Repo → Settings → Secrets and variables → Actions 中添加：
   
   | Secret Name | 说明 | 获取方式 |
   |------------|------|---------|
   | `CLOUDFLARE_API_TOKEN` | Cloudflare API Token | Cloudflare Dashboard → My Profile → API Tokens → Create Token (使用 "Edit Cloudflare Workers" 模板) |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID | Cloudflare Dashboard 右侧边栏 |

3. **触发部署**
   
   ```bash
   git push origin main
   ```
   
   或手动触发：GitHub → Actions → Deploy to Production → Run workflow

### 方式二：本地手动部署

```bash
# 1. 登录 Cloudflare
npx wrangler login

# 2. 运行部署脚本
./deploy.sh
```

---

## 🔧 Render 后端部署

### 方法 A：Git 自动部署（推荐）

1. 在 Render.com Dashboard 点击 "New +" → "Web Service"
2. 连接 GitHub 仓库
3. 配置如下：

| 配置项 | 值 |
|-------|---|
| Name | slr-system-api |
| Root Directory | ./ |
| Runtime | Docker |
| Dockerfile Path | ./backend/Dockerfile |
| Docker Context | ./backend |

4. **设置环境变量**：

| 变量名 | 值 | 说明 |
|-------|---|------|
| `CORS_ORIGINS` | `https://slr-system.pages.dev` | 前端地址 |
| `OPENAI_API_KEY` | `sk-...` | **必需**：OpenAI/DashScope API Key |
| `OPENAI_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | 可选：使用 DashScope |
| `LLM_MODEL` | `qwen-max` | 可选：模型名称 |

5. **添加持久化磁盘**：
   
   - 在 Render Dashboard → Disks → Add Disk
   - Name: `slr-data`
   - Mount Path: `/app/data`
   - Size: 1 GB (免费额度)

### 方法 B：Blueprint 部署

使用 `render.yaml` Blueprint 文件：

```bash
# 在 Render Dashboard 导入此文件
render.yaml
```

---

## ✅ 部署检查清单

### 前端 (Cloudflare Pages)

- [ ] `dist/` 目录成功构建
- [ ] `dist/_redirects` 存在（SPA 路由支持）
- [ ] `dist/_headers` 存在（安全头配置）
- [ ] `wrangler.toml` 配置正确
- [ ] 域名 `slr-system.pages.dev` 可访问

### 后端 (Render)

- [ ] Docker 构建成功
- [ ] Health Check `/api/health` 返回 200
- [ ] SQLite 数据库持久化到 `/app/data/`
- [ ] `CORS_ORIGINS` 包含前端域名
- [ ] `OPENAI_API_KEY` 已设置
- [ ] 磁盘挂载到 `/app/data`

### 功能测试

- [ ] 首页加载正常
- [ ] 文件上传功能正常
- [ ] AI 分析功能正常（需要 API Key）
- [ ] 导出功能正常

---

## 🆘 故障排除

### 前端显示 "无法连接后端"

1. 检查 `.env.production` 中的 `VITE_API_BASE_URL`
2. 检查 Render 后端是否启动 (可能需要 2-5 分钟)
3. 检查浏览器控制台 CORS 错误

### CORS 错误

确保 Render 的环境变量 `CORS_ORIGINS` 包含正确的域名：

```
https://slr-system.pages.dev,https://slr-system.pages.dev/
```

### 数据库数据丢失

确保 Render Disk 正确挂载：
- Mount Path 必须是 `/app/data`
- 检查 `render.yaml` 中的 disk 配置

### 构建失败

```bash
# 本地测试构建
npm ci
npm run build

# 检查输出
ls -la dist/
```

---

## 📚 相关文件

| 文件 | 用途 |
|-----|------|
| `wrangler.toml` | Cloudflare Pages 配置 |
| `render.yaml` | Render.com Blueprint 配置 |
| `.env.production` | 前端生产环境变量 |
| `.github/workflows/deploy.yml` | GitHub Actions 自动部署 |
| `deploy.sh` | 本地手动部署脚本 |
| `backend/Dockerfile` | 后端 Docker 配置 |

---

## 🔗 重要链接

- **前端生产地址**: https://slr-system.pages.dev/
- **后端 API 地址**: https://slr-system-api.onrender.com
- **API 文档**: https://slr-system-api.onrender.com/docs
- **健康检查**: https://slr-system-api.onrender.com/api/health

#!/bin/bash

# SLR System 部署脚本
# 用于本地手动部署到 Cloudflare Pages

set -e

echo "🚀 开始部署 SLR System..."

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 检查必要工具
check_command() {
    if ! command -v $1 &> /dev/null; then
        echo -e "${RED}❌ $1 未安装${NC}"
        exit 1
    fi
    echo -e "${GREEN}✅ $1 已安装${NC}"
}

echo ""
echo "📦 检查依赖..."
check_command node
check_command npm

# 检查 wrangler 是否安装
if ! command -v wrangler &> /dev/null; then
    echo -e "${YELLOW}⚠️ wrangler 未安装，尝试安装...${NC}"
    npm install -g wrangler
fi
check_command wrangler

echo ""
echo "🔧 安装项目依赖..."
npm ci

echo ""
echo "🧪 运行测试..."
npm run test

echo ""
echo "🔍 运行 Lint..."
npm run lint

echo ""
echo "🏗️ 构建前端..."
VITE_API_BASE_URL=https://slr-system-api.onrender.com npm run build

echo ""
echo "📁 检查构建输出..."
if [ ! -f "dist/index.html" ]; then
    echo -e "${RED}❌ 构建失败：dist/index.html 不存在${NC}"
    exit 1
fi
echo -e "${GREEN}✅ 构建成功${NC}"

# 检查 _redirects 和 _headers
if [ ! -f "dist/_redirects" ]; then
    echo -e "${YELLOW}⚠️ 警告: dist/_redirects 不存在，复制 public/_redirects${NC}"
    cp public/_redirects dist/_redirects 2>/dev/null || echo "/*    /index.html   200" > dist/_redirects
fi

echo ""
echo "☁️ 部署到 Cloudflare Pages..."

# 检查 wrangler 登录状态
if ! wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}⚠️ 未登录 Cloudflare，请先运行: wrangler login${NC}"
    wrangler login
fi

# 部署
wrangler pages deploy dist --project-name=slr-system

echo ""
echo -e "${GREEN}🎉 部署完成！${NC}"
echo ""
echo "🔗 访问地址:"
echo "   前端: https://slr-system.pages.dev/"
echo "   API: https://slr-system-api.onrender.com"
echo ""
echo "⚠️  重要提醒："
echo "   1. 确保 Render 后端服务已启动"
echo "   2. 在 Render Dashboard 设置 OPENAI_API_KEY"
echo "   3. 后端首次启动需要几分钟时间"
echo ""

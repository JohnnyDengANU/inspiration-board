#!/usr/bin/env bash
# 部署到 GitHub Pages（公开仓库）
# 用法（在 Git Bash 中）：
#   export GITHUB_TOKEN=ghp_xxx        # 需要 repo + pages 权限
#   ./deploy.sh your-username inspiration-board
#
# 说明：
#   - 创建「公开」仓库（数据完全公开，任何人可经公开链接 / API 读取）
#   - 推送当前目录到 main 分支
#   - 开启 GitHub Pages（来源：main 分支根目录）
# 依赖：gh CLI（推荐）或 curl。Windows 请在 Git Bash 中运行。

set -e
OWNER="${1:?用法: ./deploy.sh <github-username> <repo-name>}"
REPO="${2:?用法: ./deploy.sh <github-username> <repo-name>}"
BRANCH="main"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "错误：请先 export GITHUB_TOKEN=你的Token" >&2
  exit 1
fi

echo "==> 初始化 git（如有）"
git init -q 2>/dev/null || true
git config user.email "bot@local" 2>/dev/null || true
git config user.name "insp-bot" 2>/dev/null || true
git checkout -B "$BRANCH" 2>/dev/null || true

echo "==> 创建公开仓库 $OWNER/$REPO"
if command -v gh >/dev/null 2>&1; then
  echo "$GITHUB_TOKEN" | gh auth login --with-token 2>/dev/null || true
  gh repo create "$OWNER/$REPO" --public --description "公开灵感收集与展示" 2>/dev/null \
    || echo "（仓库已存在，跳过创建）"
else
  curl -s -X POST "https://api.github.com/user/repos" \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -d "{\"name\":\"$REPO\",\"description\":\"公开灵感收集与展示\",\"private\":false}" >/dev/null \
    || echo "（创建请求已发出）"
fi

echo "==> 提交并推送"
git add -A
git commit -q -m "deploy inspiration board" 2>/dev/null || true
git remote remove origin 2>/dev/null || true
git remote add origin "https://$OWNER:$GITHUB_TOKEN@github.com/$OWNER/$REPO.git"
git push -u origin "$BRANCH" --force

echo "==> 开启 GitHub Pages"
curl -s -X POST "https://api.github.com/repos/$OWNER/$REPO/pages" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -d "{\"source\":{\"branch\":\"$BRANCH\",\"path\":\"/\"}}" >/dev/null \
  && echo "Pages 已开启" || echo "（Pages 可能需稍后在仓库 Settings > Pages 手动开启）"

echo ""
echo "完成！"
echo "  网站：  https://$OWNER.github.io/$REPO/"
echo "  数据：  https://raw.githubusercontent.com/$OWNER/$REPO/$BRANCH/inspirations.json"
echo "  API：   https://api.github.com/repos/$OWNER/$REPO/contents/inspirations.json"
echo ""
echo "首次使用：打开网站 → ⚙ 设置 → 填写 用户名 / 仓库名 / 分支 / Token（仅存本机）→ 即可增删改。"

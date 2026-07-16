# 灵感板 · 公开灵感收集与展示

一个**完全公开**的灵感收集与展示应用：任何人都能通过公开链接 / API 读取全部灵感，支持文字、图片、标签、分类，响应式适配桌面与移动端。零依赖、纯静态前端。

## 特性

- ✅ **完全公开**：数据存于公开仓库的 `inspirations.json`，任何人无需登录即可读取（公开链接 + 公开 API）。
- ✅ **增 / 删 / 改**：创建、编辑、删除灵感条目。
- ✅ **多格式**：文字 + 图片（图片链接或本地图片转 base64）。
- ✅ **筛选**：按标题 / 内容 / 作者搜索，按标签、分类过滤。
- ✅ **连续序号**：删除后序号自动重排（`No.1, No.2 …`），真实 `id` 弱化显示。
- ✅ **响应式**：桌面多列网格，移动端单列；表单在手机上全屏。
- ✅ **持久化**：数据写入仓库 JSON 文件，提交即持久保存。

## 两种运行模式

| 模式 | 读取 | 写入 | 适用 |
|------|------|------|------|
| `github`（默认） | 公开 raw 链接，**无需 Token** | 需你自己的 GitHub Token（仅存本机浏览器） | 部署到 GitHub Pages，免费、公开 |
| `local` | `/api/inspirations` | 同接口（公开读写） | 自托管 / 本地验证 |

> 为什么写入仍要 Token？纯静态站点（GitHub Pages）无法安全做「匿名公开写入」——若把可写 Token 写进前端，任何人都能篡改数据。当前设计：**读取全公开，写入由你自己的 Token 控制**，兼顾「公开」与「不被乱改」。若需要彻底匿名公开写入，可改用 `server.js` 自托管模式（任何人可经 `/api/inspirations` 增删改）。

## 快速开始（本地验证）

```bash
cd inspiration-board
node server.js            # 零依赖 Node 服务，默认端口 3000
# 浏览器打开 http://localhost:3000
```

本地模式直接可用（公开读写）。在网页 ⚙ 设置里把模式切到 `local`、API 填 `/api/inspirations` 即可。

## 部署到 GitHub Pages（公开）

```bash
cd inspiration-board
export GITHUB_TOKEN=ghp_xxx      # 需要 repo + pages 权限
./deploy.sh your-username inspiration-board
```

部署后：
- 网站：`https://your-username.github.io/inspiration-board/`
- 公开数据链接：`https://raw.githubusercontent.com/your-username/inspiration-board/main/inspirations.json`
- 公开 API：`https://api.github.com/repos/your-username/inspiration-board/contents/inspirations.json`

首次使用：打开网站 → ⚙ 设置 → 填写 **用户名 / 仓库名 / 分支 / Token**（Token 仅保存在你本机浏览器，不会上传）→ 即可创建 / 编辑 / 删除灵感。

## 数据格式

```json
[
  {
    "id": "1001",
    "title": "灵感标题",
    "content": "灵感内容（支持多行）",
    "images": ["https://… 或 data:image/…;base64,…"],
    "tags": ["AI", "方法论"],
    "category": "工作",
    "author": "匿名",
    "created_at": "2026-07-15T09:12:00.000Z",
    "updated_at": "2026-07-15T09:12:00.000Z"
  }
]
```

## 文件结构

```
inspiration-board/
├── index.html       # 页面结构
├── style.css        # 响应式样式
├── app.js           # 前端逻辑（零依赖）
├── inspirations.json# 数据源（公开）
├── server.js        # 零依赖 Node 服务（本地/自托管）
├── deploy.sh        # GitHub Pages 部署脚本
└── README.md
```

## 隐私说明

按需求，本应用**不含任何权限控制或隐私设置**：所有人都能读取全部灵感及作者信息。请勿在其中存放敏感或个人隐私内容。

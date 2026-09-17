# 古籍智能阅读器 Guji Reader V0.1

Local-first、可静态部署的《通鑑紀事本末》阅读器。React + TypeScript + Vite 前端，
Python 离线构建脚本，无服务端、无数据库服务、无云同步。

## 环境

- Node 20+
- Python 3.11+（本机使用 `/opt/homebrew/bin/python3.12`）

## 快速开始

语料已在仓库中（注释与古注 fixture），但正文需先构建一次：

```bash
npm install
python3.12 -m venv .venv
.venv/bin/pip install -r python/requirements.txt

# 1. 导入语料（首次需要联网抓取 42 卷，约 2–3 分钟）
.venv/bin/python scripts/sync_wikisource.py

# 2. 生成前端可消费的 public/data
.venv/bin/python scripts/build_catalog.py

# 3. 启动
npm run dev          # http://localhost:5173
```

> 用 `localhost` 而非 `127.0.0.1`：Vite 只绑 IPv6 loopback。

## 常用命令

```bash
npm run dev        # 开发服务器
npm run build      # 生产构建（产物在 dist/，可直接静态部署）
npm run preview    # 预览构建产物（http://localhost:4173）
npm run typecheck  # TypeScript 类型检查
npm test           # 前端单元测试（Vitest）

.venv/bin/pytest python/tests/ -q          # Python 测试
env -u CI npx playwright test --project=chromium   # 三条 smoke（真实浏览器）
```

注意 `npm run build` 会连带把 `public/data/` 拷进 `dist/`，所以**先跑 `build_catalog.py` 再 build**。

## 语料与数据分层

四层严格分离，互不写入：

| 层 | 位置 | 谁写 |
|---|---|---|
| canonical 原文 | `data/canonical/` → `public/data/works/` | 仅 `sync_wikisource.py` |
| 古注（胡三省注） | `public/data/source_notes/`（已提交） | 人工 fixture |
| AI 注释 | `data/ai_annotations/`、`data/review_reports/`、`public/data/annotations/`（已提交） | `annotate.py` + `review_annotations.py` |
| 个人标记 | 浏览器 IndexedDB（Dexie） | 阅读器，仅本机 |

- `data/raw/` 为 write-once immutable：重复运行 `sync_wikisource.py` 会复用已抓取的 raw，不覆盖。
- `build_catalog.py` 只替换它生成的 `works/` 与 `catalog.json`，不会动 `annotations/` 与 `source_notes/`。
- canonical 原文不可被任何 AI 路径修改；AI 只能新增独立注释。

## AI 注释（可选，需要 API key）

AI 生成与复核使用环境变量指定的模型，Coding 模型不参与：

```bash
cp .env.example .env      # 填入 GUJI_LLM_BASE_URL / GUJI_LLM_API_KEY / GUJI_LLM_MODEL
.venv/bin/python scripts/check_llm.py     # 连通性与 structured-output canary

.venv/bin/python scripts/annotate.py --volume vol01 --limit 8
.venv/bin/python scripts/review_annotations.py --volume vol01 --limit 8
```

- `annotate.py` 生成候选，`review_annotations.py` 发起**第二次独立请求**复核并决定发布。
- publish gate：`accept` 用生成结果、`revise` 用复核修订、`reject` 不发布。
- 两个脚本都支持 `--passage` / `--volume` / `--limit`；重复运行会复用已有结果，加 `--force` 才重跑。
- `.env` 已在 `.gitignore` 中，永不进入版本控制。

## 已知限制

- 仅 vol01 有 AI 注释（51 条）与 2 条古注；其余 41 卷只有正文。
- 个人标记限单段落内，重叠会被阻止；无导出、无云同步。
- 阅读位置不持久化（只保存主题、横竖排、字号、行距等 UI 偏好）。
- 响应式只保证桌面浏览器。

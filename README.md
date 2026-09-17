# 古籍智能阅读器 Guji Reader V0.1

Local-first 的《通鑑紀事本末》阅读器：React + TypeScript + Vite 前端，Python 离线构建脚本。
无服务端、无数据库服务、无云同步。

## 环境

- Node 20+
- Python 3.11+（本机用 `/opt/homebrew/bin/python3.12`）

## 1. Bootstrap

```bash
npm install
python3.12 -m venv .venv
.venv/bin/pip install -r python/requirements.txt
```

## 2. Sync corpus

```bash
.venv/bin/python scripts/sync_wikisource.py   # 抓取 42 卷 → data/raw/ 与 data/canonical/
.venv/bin/python scripts/build_catalog.py     # 生成 public/data/
```

首次需联网，约 2–3 分钟。`data/raw/` 为 write-once：重复运行会复用已抓取的 raw，不覆盖。
`data/canonical/` 与 `public/data/works/`、`public/data/catalog.json` 不进 git（可重建）。

## 3. Check LLM

```bash
cp .env.example .env     # 填入 GUJI_LLM_BASE_URL / GUJI_LLM_API_KEY / GUJI_LLM_MODEL
.venv/bin/python scripts/check_llm.py
```

`.env` 已在 `.gitignore` 中，不会进入版本控制。

## 4. Annotate selected volume

```bash
.venv/bin/python scripts/annotate.py --volume vol01 --limit 8
.venv/bin/python scripts/review_annotations.py --volume vol01 --limit 8
```

`review_annotations.py` 发起**第二次独立请求**复核，并据此决定发布：
`accept` 用生成结果、`revise` 用复核修订、`reject` 不发布。
两个脚本都支持 `--passage` / `--volume` / `--limit`；已有结果会复用，加 `--force` 才重跑。
不指定 `--volume` 时范围是全书。

## 5. Run dev

```bash
npm run dev      # http://localhost:5173
```

用 `localhost` 而非 `127.0.0.1`：Vite 只绑 IPv6 loopback。

## 6. Run tests

```bash
.venv/bin/pytest python/tests/ -q
npm test
env -u CI npx playwright test --project=chromium
```

Playwright 会自行启动 dev server；若已有 server 在跑，用 `env -u CI` 复用它。

## 7. Build

```bash
npm run build      # 产物在 dist/，可直接静态部署
npm run preview    # http://localhost:4173
```

**先跑 `build_catalog.py` 再 `npm run build`**：构建会把 `public/data/` 一并拷进 `dist/`，
顺序反了 `dist/` 里就没有正文。

## 已知限制

见 `docs/V0.1_RELEASE_REPORT.md` §4。

# 古籍智能阅读器 Guji Reader V0.1

Local-first、可静态部署的《通鑑紀事本末》阅读器。

## 环境

- Node 20+
- Python 3.11+（本机使用 3.12 venv）

## 启动

```bash
npm install
npm run dev       # 开发服务器
npm run build     # 生产构建
npm run typecheck # TypeScript 类型检查
```

## 导入 Wikisource 语料

```bash
python3 -m venv .venv
.venv/bin/pip install -r python/requirements.txt
.venv/bin/python scripts/sync_wikisource.py   # 抓取 42 卷到 data/raw/ 与 data/canonical/
.venv/bin/python scripts/build_catalog.py     # 生成 public/data/catalog.json
```

`data/raw/` 为 write-once immutable；重复运行 sync 会直接使用已缓存的 raw。

## 测试

```bash
.venv/bin/pytest python/tests/ -v
```

## 配置（P03 AI 注释阶段才需要）

```bash
cp .env.example .env
# 填写 GUJI_LLM_BASE_URL / GUJI_LLM_API_KEY / GUJI_LLM_MODEL
```

`.env` 已加入 `.gitignore`，永远不会进入版本控制。

# Neotel Industry Trends — PCB/SMT 行业趋势 Agent

> Fork of [`TencentEdgeOne/ai-trends-agent`](https://github.com/TencentEdgeOne/ai-trends-agent) adapted
> for the electronics-manufacturing (PCB / SMT / EMS) domain. Runs on **EdgeOne Makers** (OpenAI Agents
> SDK, TypeScript), collects public industry news every morning, and emits both a Chinese Markdown
> report and a strict JSON brief (`schema.json`) that a separate CN-server tool syncs into WordPress.

**Framework:** OpenAI Agents SDK · **Category:** Scheduled · **Language:** TypeScript · **Branch:** `neotel`

- **Runbook (deploy / env / endpoints / open questions):** [`docs/RUNBOOK.md`](docs/RUNBOOK.md)
- **Architecture notes (what each file does):** [`docs/ARCHITECTURE-NOTES.md`](docs/ARCHITECTURE-NOTES.md)
- **Data contract:** [`schema.json`](schema.json) · sample output [`docs/sample-brief.json`](docs/sample-brief.json)
- **Source list (edit here to add/disable sources):** [`agents/trends/_source_list.ts`](agents/trends/_source_list.ts)

## What it does

1. **Fetch & Merge** — 21 sources (`_source_list.ts`: CPCA, 中国电子报, 电子发烧友, 集微网, 半导体行业观察,
   国际电子商情, SMT007/PCB007, EMSNOW, Evertiq, Global Electronics Association, SEMI, Fuji, Yamaha, JUKI,
   ASMPT, Mycronic, Koh Young, NEPCON, productronica, IPC APEX). RSS via `fetch()`, list pages via the
   sandbox browser (plain `fetch()` fallback). Canonical-URL fingerprints (utm/tracker/fragment stripped)
   dedupe across runs and track `seenCount`.
2. **Curator ‖ Summarizer** — keep only PCB/SMT/EMS/供应链/设备厂商/政策标准/展会; ≤80 字 factual Chinese
   summaries with `eventTime` when stated.
3. **Analyst** — 0–100 score (决策价值 / 来源可信度 / 相关度), topic clustering
   (`设备|材料|供应链|政策标准|展会|厂商动态`), optional `fetch_url` deep-read of 2–3 items.
4. **Writer** — fixed Markdown skeleton (今日要点 / 分主题动态 / 持续发酵 / 原文细读 / 挚锦解读) plus a
   `<!--BRIEF-JSON-->` tail. `挚锦解读` is written only when an item has a real link to SMT material
   management; the code (`_policy.ts`) blanks it on any competitor name, comparison, superlative or sales word.
5. **Contract** — `_contract.ts` builds `report.brief` (plan §4) and validates it against `schema.json`.
6. **Weekly** — `POST /trends/weekly` rolls the last 7 daily reports into one weekly draft (no LLM call).

## Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/trends/run` | POST | Start the daily pipeline (SSE stream; final `complete` event carries the report incl. `brief`) |
| `/trends/weekly` | POST | Build the weekly roll-up from the last 7 daily reports (JSON) |
| `/trends/stop` | POST | Abort a running pipeline (`{conversationId}`) |
| `/trends/latest` | GET | Latest report. `?kind=daily` (default) / `weekly` / `any`; `?brief=1` returns only the §4 JSON |
| `/trends/history` | GET | `{history: [...]}` (30 max, with `kind`) |
| `/trends/detail` | POST | `{runId}` → full report incl. `brief` |
| `/trends/delete` | POST | `{runId}`; requires header `x-admin-token` = env `ADMIN_TOKEN` |
| `/trends/health` | GET | `{status:'ok'}` |
| `/ai-trends/*` | * | Legacy aliases re-exporting the routes above |

The dashboard passes `makers-conversation-id: trends-dashboard`; `/trends/stop` must **not** carry that header.

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AI_GATEWAY_API_KEY` | Yes | Makers Models API key (or any OpenAI-compatible key) |
| `AI_GATEWAY_BASE_URL` | Yes | e.g. `https://ai-gateway.edgeone.link/v1` |
| `AI_GATEWAY_MODEL` | No | Default `@makers/deepseek-v4.1-flash` |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | No | Override chain: `LLM_* → AI_GATEWAY_* → OPENAI_*` |
| `ADMIN_TOKEN` | No | Enables `POST /trends/delete`; unset = delete disabled |
| `TRENDS_DATA_DIR` | No | Local-dev file fallback dir (default `data/trends`) |

See `.env.example`. Never commit real values.

## Local development

```bash
npm install
npm run build        # tsc (frontend + agents) + vite build
npm test             # unit tests → also writes docs/sample-brief.json
npm run schema       # regenerate schema.json from agents/trends/_schema.ts
edgeone makers dev   # needs `edgeone login`; do NOT pass -n (it creates a Makers project)
```

## Project structure

```text
agents/trends/
  run.ts              POST /trends/run — SSE pipeline entry (+ brief assembly)
  weekly.ts           POST /trends/weekly — 7-day roll-up
  stop.ts             POST /trends/stop
  _source_list.ts     ← the source data file (type/lang/region/trust/patterns)
  _sources.ts         RSS/Atom parser, HTML anchor extractor, keyword gate, allocation
  _items.ts           canonical URL + fingerprint dedupe library
  _model.ts           4 agents + prompts (zh, PCB/SMT), streaming, fallbacks
  _contract.ts        plan §4 TrendBrief builder + validation
  _schema.ts          BRIEF_SCHEMA + minimal JSON-schema validator (mirrored in /schema.json)
  _policy.ts          absolute/comparative/competitor/sales word rules, clampSummary
  _weekly.ts          pure weekly aggregation
  _memory.ts          platform store (context.store) persistence, kind filter
  _storage.ts         file-system fallback
  _report.ts          code-only fallback report
  tests/              node:assert unit tests + schema exporter
agents/ai-trends/     legacy route aliases
cloud-functions/trends/{latest,history,detail,delete,health}
cloud-functions/ai-trends/   legacy route aliases
src/                  React dashboard (strings renamed, delete gated)
edgeone.json          agents runtime + schedules (daily 09:00, weekly Fri 10:00, Asia/Shanghai)
schema.json           data contract for the WordPress sync tool
docs/                 RUNBOOK.md, ARCHITECTURE-NOTES.md, sample-brief.json
```

## License

MIT (upstream template) — see the original repository.

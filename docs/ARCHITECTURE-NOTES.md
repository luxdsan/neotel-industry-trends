# Architecture notes — upstream template `TencentEdgeOne/ai-trends-agent`

Written 2026-09-27 while adapting the template into the PCB/SMT industry-trend agent
(`luxdsan/neotel-industry-trends`, branch `neotel`). Paths below are the **upstream** layout;
the `neotel` branch renames `ai-trends/` → `trends/` (see "Neotel changes" at the end).

## 1. Runtime model (EdgeOne Makers)

| Directory | Runtime | Route mapping | Context object |
|---|---|---|---|
| `agents/<dir>/<file>.ts` | **Agent runtime** (session mode, OpenAI Agents SDK, 1200 s timeout) | `/<dir>/<file>` — e.g. `agents/ai-trends/run.ts` → `POST /ai-trends/run` | `AgentContext` (`@edgeone/types`): `run_id`, `conversation_id`, `request.{body,headers,signal}`, `env`, `store` (AgentMemory), `sandbox?` (browser + shell), `utils.abortActiveRun()` |
| `cloud-functions/<dir>/<name>/index.ts` | **Cloud Function** (plain Node handler, `onRequestGet` / `onRequestPost`) | `/<dir>/<name>` — e.g. `cloud-functions/ai-trends/latest/index.ts` → `GET /ai-trends/latest` | `CloudFunctionContext`: `request` (Fetch `Request`), `env`, `agent?.store` (same memory as agents) |
| `src/` + `index.html` | React 18 + Vite static frontend | served from `dist/` (`edgeone.json → outputDirectory`) | — |

Files whose name starts with `_` are private modules and are **not** exposed as routes.
Requests carrying the same `makers-conversation-id` header are routed to the same agent instance
(and sandbox); the `/stop` route deliberately omits that header so it does not hijack the run's signal.

## 2. File-by-file

### Agent side — `agents/ai-trends/`

| File | Role |
|---|---|
| `run.ts` | Entry for `POST /ai-trends/run`. Reads body (`sources[]`, `limit`, `_schedule`), builds an SSE `ReadableStream`, runs **Fetch & Merge → 4-agent pipeline → persist**, emits `stage` / `items` / `analysis` / `token` / `complete` events. On error it stores a `failed` report. `runId = context.run_id` (platform) or `run_<uuid12>`. |
| `stop.ts` | `POST /ai-trends/stop` → `context.utils.abortActiveRun(conversationId)`; the AbortSignal breaks the `for await` loops in `_model.ts`. |
| `_sources.ts` | Data collection. `collectHackerNews()` / `collectDevto()` use public JSON APIs via `fetch`; `collectFromWeb()` uses `sandbox.browser.goto()` + `evaluate(extractScript)` for JS-rendered pages (`DEFAULT_WEB_SOURCES`). `filterAiItems()` applies the `AI_KEYWORDS` list to title+summary+url, dedupes by URL, infers a `category` from `CATEGORY_KEYWORDS`, and sets a code-generated `aiSummary` fallback. `collectSources()` allocates HN 40 % / Dev.to 30 % / web 30 % of `limit`. |
| `_items.ts` | Cross-run **dedupe / item library**. `normalizeUrl()` (drops `utm_*`, `ref`, `source`, fragment, trailing slash, lower-cases host); `fingerprintItem()` = normalised URL or `title:<normalised title>`; `mergeItemLibrary(existing, candidates, now, limit)` → `{items, newItems, reusedItems, reportItems, newItemCount, reusedItemCount}` maintaining `firstSeenAt/lastSeenAt/seenCount/isNew`; `selectReportItems()` sorts new-first then score, and back-fills from the library. |
| `_model.ts` | The **4 agents** (OpenAI Agents SDK `Agent` + `OpenAIChatCompletionsModel` pointed at the AI Gateway): `createCuratorAgent` (keep/drop + category), `createSummarizerAgent` (1–2 sentence zh summary), `createAnalystAgent` (tools: `get_history_items`, `compare_periods`, optional sandbox `fetch_url`; outputs categories/status/importance/deepDives/keyInsight/scores 0–100), `createWriterAgent` (Markdown report with a fixed section skeleton). `runAgentPipeline()` orchestrates: Curator ‖ Summarizer (`Promise.allSettled`) → Analyst → Writer (token streaming, `<think>` filtering, non-stream retry) with graceful degradation (Writer fail → analyst-based report → code fallback). `parseJsonFromText()` repairs model JSON (code fences, trailing commas, truncation). `createModel()` resolves `LLM_* → AI_GATEWAY_* → OPENAI_*` env chain; default model `@makers/minimax-m2.7`. |
| `_report.ts` | Code-only fallback report (`generateFallbackReport`, `generateMarkdown`), `utcNow()`. |
| `_memory.ts` | Persistence on the platform store (`context.store`, an `AgentMemory`): reports are appended as messages in conversation `ai-trends-reports` with `metadata.kind = 'ai_trends_report'`; the whole item library is one snapshot message in `ai-trends-items` (`kind = 'ai_trends_item_snapshot'`, latest wins). `loadReports()` reads newest-first, dedupes by `runId`. Delete = `deleteMessage` on the matching message. |
| `_storage.ts` | File-system fallback (`data/ai-trends/latest.json`, `reports/<runId>.json`, `history.json`, `items.json`; base dir from `AI_TRENDS_DATA_DIR`). Only used when `context.store` is missing (local dev). |
| `_http.ts` | `jsonResponse()`, `getBody(context)` (body may be `context.request.body` or the context itself), `getEnv(context)` = `process.env` + `context.env`. |
| `_types.ts` | TS interfaces (`TrendSourceItem`, `TrendReport`, `HistoryEntry`, SSE `StreamEvent`) + Zod schemas describing each agent's I/O (documentary — agents are prompt-guided, output parsed manually). |
| `tests/report-pipeline.test.ts` | Node `assert` script compiled by `tsconfig.test.json` into `.test-build/`. Upstream test references `buildOpenAIClientOptions` which `_model.ts` does not export → **upstream `npm test` does not compile** (fixed on `neotel`). |

### Cloud-function side — `cloud-functions/`

| File | Route | Behaviour |
|---|---|---|
| `_store.ts` | — | Same store access as `_memory.ts` but via `context.agent.store`; `loadLatestReport`, `loadHistory`, `loadReportByRunId`, `deleteReport`. |
| `_http.ts` | — | `jsonResponse`, `readJsonBody(context)` (`await context.request.json()`). |
| `ai-trends/latest/index.ts` | `GET /ai-trends/latest` | newest report, or an `empty` placeholder. |
| `ai-trends/history/index.ts` | `GET /ai-trends/history` | `{ history: HistoryEntry[] }` (30 max). |
| `ai-trends/detail/index.ts` | `POST /ai-trends/detail {runId}` | one report. |
| `ai-trends/delete/index.ts` | `POST /ai-trends/delete {runId}` | deletes the store message — **unauthenticated upstream**. |
| `ai-trends/health/index.ts` | `GET /ai-trends/health` | `{status:'ok'}`. |

### Frontend — `src/`

`api.ts` (route constants, `runReportSSE()` SSE parser, REST helpers, hard-coded `CONVERSATION_ID = 'ai-trends-dashboard'`), `App.tsx` (~1 000 lines: header, `PipelineBar`, `LiveFeed` with progressive phases, report sidebar with delete buttons, report drawer, `TOPICS` chip list), `i18n.tsx` (zh/en strings), `MarkdownReport.tsx` (tiny Markdown renderer: headings, lists, bold, links), `reportModel.ts` (`EMPTY_REPORT`, `normalizeReport`), `types.ts` (frontend mirror of `_types.ts`).

### Config

* `edgeone.json` — `buildCommand`, `outputDirectory: dist`, `agents.framework = openai-agents-sdk`, `agents.timeout = 1200`, `agents.sandbox.timeout = 300`, `schedules[]`. Schedule schema (from `@edgeone/types/edgeone.schema.json`): `{name, cron (5-field), path, method?, payload?, timezone?}` — **`timeout` is not an allowed schedule key** even though the upstream file has it.
* `.env.example` — `AI_GATEWAY_API_KEY`, `AI_GATEWAY_BASE_URL`, optional `AI_GATEWAY_MODEL`.
* `tsconfig.json` (frontend, `src/`), `tsconfig.agent.json` (type-check `agents/**` excluding tests), `tsconfig.test.json` (emit tests to `.test-build/`), `vite.config.ts`.
* `package.json` scripts: `dev` (vite), `build` (`tsc -p tsconfig.json && tsc -p tsconfig.agent.json && vite build`), `test`.

## 3. How a scheduled run works

1. Platform cron (`schedules[].cron`, parsed in `schedules[].timezone`) issues `POST <path>` with `payload` as body.
2. `agents/ai-trends/run.ts` sees `body._schedule === true` → `trigger = 'schedule'`.
3. `collectSources()` fetches candidates → `mergeItemLibrary()` against the item snapshot from `context.store` (or `data/ai-trends/items.json`).
4. `runAgentPipeline()` → Curator ‖ Summarizer → Analyst → Writer.
5. Report + new item snapshot are appended to the store; `report.storage = 'memory' | 'file-fallback'`.
6. SSE `complete` event carries the full `TrendReport`. Cloud functions read it back from the same store.

Storage is **not** a durable database: it is the agent-memory service keyed by conversation id, so
WordPress (via the CN-server sync tool) must remain the archive of record.

## 4. Neotel changes (branch `neotel`)

* Route prefix `/ai-trends/*` → `/trends/*` (`agents/trends/`, `cloud-functions/trends/`); old paths kept as thin re-export aliases.
* Sources: HN/Dev.to/36kr replaced by the PCB/SMT list in `agents/trends/_source_list.ts` (typed data file: `type rss|html`, `lang`, `region`, `trust`); generic RSS/Atom parser + sandbox/HTML anchor extractor in `_sources.ts`; industry keyword filter.
* Prompts rewritten for PCB/SMT/EMS in Chinese; topic enum `设备|材料|供应链|政策标准|展会|厂商动态`; `neotelNote` only with a real link to SMT material management; policy filter (`_policy.ts`) removes absolute marketing words and competitor names in the note.
* Writer emits Markdown followed by a `<!--BRIEF-JSON-->` tail; `_contract.ts` assembles the §4 JSON (`runId, generatedAt, status, window, items[], report{...}`) into `report.brief`, validated against `schema.json` (mirrored in `_schema.ts`) by a dependency-free validator.
* `/trends/weekly` (`agents/trends/weekly.ts`) rolls up the last 7 daily briefs without an LLM call.
* `edgeone.json`: `daily-trends` (`0 9 * * *`) + `weekly-trends` (`0 10 * * 5`), `Asia/Shanghai`.
* Default model `@makers/deepseek-v4.1-flash` (env override unchanged).
* `/trends/delete` requires `x-admin-token` = env `ADMIN_TOKEN`; frontend hides delete unless a token is stored locally.

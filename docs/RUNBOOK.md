# RUNBOOK — neotel-industry-trends (EdgeOne Makers)

Status 2026-09-27: code adapted on branch `neotel`, **not deployed**, no Makers project exists yet.
Companion plan: `WORDPRESS SEO/cn/trend-brief/DEPLOY-PLAN-2026-09-27.md` (§1 architecture, §3 sources,
§4 contract, §5 policy). This runbook covers only the Makers side; the WordPress sync tool is a separate
program on the CN server and is out of scope here.

## 1. Environment variables (names only)

| Name | Required | Where it comes from |
|---|---|---|
| `AI_GATEWAY_API_KEY` | yes | Makers console → 模型 → API Key（中国站控制台） |
| `AI_GATEWAY_BASE_URL` | yes | the gateway URL shown next to the key (international: `https://ai-gateway.edgeone.link/v1`; China console shows its own) |
| `AI_GATEWAY_MODEL` | no | default `@makers/deepseek-v4.1-flash` (same model as chat.neotel.tech) |
| `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` | no | generic overrides, win over `AI_GATEWAY_*` |
| `ADMIN_TOKEN` | recommended | any long random string you generate; enables `POST /trends/delete` + the dashboard delete button. Leave unset to disable deletion entirely |
| `TRENDS_DATA_DIR` | no | local dev only (file fallback when `context.store` is missing) |

Set them in the Makers project settings (环境变量). `.env` is git-ignored; `.env.example` lists the names.
Nothing in the repo contains a secret; the frontend bundle never embeds `ADMIN_TOKEN`.

## 2. Create the Makers project from Git (user, China console)

1. Push branch `neotel` to `github.com/luxdsan/neotel-industry-trends` and make it the default branch
   (or merge into `main`) — Makers auto-deploys the repo's default branch on every push.
2. 腾讯云控制台 → EdgeOne → **Makers** → 新建项目 → **从 Git 仓库导入** → 选择
   `luxdsan/neotel-industry-trends`（首次需授权 GitHub）。
3. **可用区选「全球可用区」**（同 KAI 项目）。国内可用区无法抓取 SMT007 / EMSNOW / OEM 等海外源。
4. 构建设置保持 `edgeone.json` 的值：build `npm run build`，输出目录 `dist`；Node 20。
5. 填环境变量（§1）。保存 → 首次部署。函数部署比静态页晚 2–4 分钟。
6. 部署完成后把 **项目名 / 默认域名** 回填到 `WORDPRESS SEO/cn/trend-brief/README.md`（A4）。
7. 不要在本机执行 `edgeone makers link -n <name>` / `edgeone makers dev -n` —— 会创建空项目
   （见 memory `reference_kai_edgeone_deploy`）。本地 `edgeone makers dev` 需要先 link，因此本次未运行。
8. 可选：绑定 `trends.neotel.tech`（neotel.tech 已 ICP）作为内部控制台；页面已带 `noindex,nofollow`。

Schedules come from `edgeone.json` and are registered automatically on deploy:

| name | cron | tz | path | payload |
|---|---|---|---|---|
| `daily-trends` | `0 9 * * *` | Asia/Shanghai | `POST /trends/run` | `{_schedule:true, sources:["all"], limit:30}` |
| `weekly-trends` | `0 10 * * 5` | Asia/Shanghai | `POST /trends/weekly` | `{_schedule:true, days:7}` |

## 3. Manual run

Dashboard: open the project URL → 「手动生成」（SSE progress, live items, streaming Markdown）.

CLI (from any box that can reach the domain; replace `HOST`):

```bash
# start the daily pipeline (SSE; the last `data:` frame with stage=complete carries the report)
curl -N -X POST https://HOST/trends/run \
  -H 'content-type: application/json' -H 'makers-conversation-id: trends-manual' \
  -d '{"trigger":"manual","sources":["all"],"limit":30}'

# only a subset of sources (ids from agents/trends/_source_list.ts)
curl -N -X POST https://HOST/trends/run -H 'content-type: application/json' \
  -H 'makers-conversation-id: trends-manual' -d '{"sources":["emsnow","smt007","cpca"],"limit":15}'

# weekly roll-up (JSON response)
curl -X POST https://HOST/trends/weekly -H 'content-type: application/json' -d '{"days":7}'

# stop a run (NO makers-conversation-id header here)
curl -X POST https://HOST/trends/stop -H 'content-type: application/json' -d '{"conversationId":"trends-manual"}'
```

Pipeline timeout is 1200 s (`edgeone.json → agents.timeout`); sandbox browser lifetime 300 s.

## 4. Where results are read

| Endpoint | Returns |
|---|---|
| `GET /trends/latest` | latest **daily** `TrendReport` (JSON). `report.brief` = plan §4 object |
| `GET /trends/latest?brief=1` | **only** the §4 brief — this is what the WordPress sync tool should poll (404 `{status:"empty"}` when none) |
| `GET /trends/latest?kind=weekly` / `?kind=any` | latest weekly / newest of either kind |
| `GET /trends/history` | `{history:[{runId,status,kind,trigger,generatedAt,itemCount,newItemCount,summary}]}` |
| `POST /trends/detail {"runId":"…"}` | one full report incl. `brief` |
| `GET /trends/health` | liveness |

### §4 JSON shape (`report.brief`, validated against `schema.json`)

```json
{
  "runId": "…", "generatedAt": "2026-09-28T09:14:32+08:00", "status": "completed|failed|empty",
  "window": {"from": "2026-09-27T09:14:32+08:00", "to": "2026-09-28T09:14:32+08:00"},
  "items": [{"id": "<sha1 of canonical url>", "title": "…", "url": "https://…", "source": "EMSNOW",
             "eventTime": "2026-09-26", "fetchedAt": "…+08:00", "summaryZh": "≤80 字",
             "topic": "设备|材料|供应链|政策标准|展会|厂商动态", "score": 0, "seenCount": 1}],
  "report": {"titleZh": "2026-09-28 PCB/SMT 行业趋势日报",
             "highlights": [{"text": "一句话", "itemIds": ["<sha1>"]}],
             "topics": [{"name": "供应链", "count": 3}],
             "neotelNote": "", "markdown": "# …"}
}
```

Guarantees enforced in code (`_contract.ts`, `_policy.ts`), independent of the model:
`items[].summaryZh` ≤ 80 code points (superlatives/comparisons → degraded to title); every
`highlights[].itemIds` entry exists in `items`; `neotelNote` is `""` on any competitor name, comparison,
superlative or sales word; `topics` are counted from items; `status="empty"` when 0 items (no empty report
is invented). A real example produced by the unit test from a mocked run: `docs/sample-brief.json`.

**Sync-tool hard checks still to implement on the CN side (plan §4):** domain whitelist for `items[].url`,
number/currency back-tracing against fetched text, `runId` idempotency, `generatedAt` ≥ window start.

### Storage caveat

Reports live in the Makers agent memory (`context.store`, conversation `trends-reports`) — not a durable
DB. Redeploys/region moves may lose history. WordPress is the archive of record.

## 5. Local verification performed (2026-09-27, Node 20.18.2, npm 10.8.2)

| Step | Result |
|---|---|
| `npm install` | ok (168 packages; no rolldown workaround needed — template uses Vite 5/Rollup) |
| `npm run build` (`tsc` frontend + agents, `vite build`) | ok |
| `npx tsc -p tsconfig.json --noEmit` / `-p tsconfig.agent.json --noEmit` | ok / ok |
| `npm test` (17 groups: sources, feed/anchor parsing, dedupe, policy, brief+schema, weekly, storage) | all pass |
| `npm run schema` | writes `schema.json`; test asserts it mirrors `_schema.ts` |
| `edgeone makers dev` | **skipped** — CLI refuses to start without `edgeone makers link` / `-n`, which creates a Makers project |
| Real model / network fetch | **not exercised** (no keys used; sources unverified until trial A5) |

## 6. Open questions / TODO

1. **Source URLs are unverified** (`verified:false` in `_source_list.ts`). Run 5 trial days (plan A5) via
   manual `POST /trends/run`, read `[sources] per-source stats` in function logs, fix `linkPattern`s,
   disable dead sources, find real RSS for Evertiq / esmchina / elecfans. Success target ≥ 80 % per source.
2. **eventTime for HTML sources** = fetch date unless the Summarizer sees a date in the text. Trade-show
   items need the show date — may require a per-source detail fetch (`fetch_url`) in the Analyst step.
3. **Dedupe window**: the item library snapshot grows forever (one message per run). Add pruning (> 60 days)
   once the trial shows the snapshot size.
4. **Weekly** roll-up is code-only; the plan expects a human "工厂决策视角" paragraph before indexing. Decide
   whether the weekly should also get an LLM pass or stay a draft.
5. **Legacy `/ai-trends/*` aliases** double the agent route count; delete them once nothing calls them.
6. **Deploy button / template link** in the dashboard still point at the upstream template (kept to avoid a
   redesign); remove if the console goes on `trends.neotel.tech`.
7. **Sandbox availability in 全球可用区** for `sandbox.browser` is assumed from the template; if absent the
   code falls back to plain `fetch()` (JS-rendered lists like 集微网 will return 0 items).
8. Upstream `npm test` was broken (referenced a non-existent export) — fixed here; consider a PR upstream.

## Listed-company collector (`POST /trends/listed`, added 2026-09-28)

- **What**: 31 listed companies in 3 tiers (`agents/trends/_listed_companies.ts`): A-share announcements via 巨潮资讯 (code+orgId), HKEXnews title search (stockId), SEC EDGAR atom by ticker (8-K press release EX-99.1 is read and summarised; 10-Q/10-K listed), Koh Young RSS, Fuji newsroom (current-year page). Only 定期报告 / 业绩预告快报 / 产能·订单·投资 / official news; personnel, dividends, financing, governance and HKEX housekeeping are dropped in code.
- **When**: schedule `listed-daily` 09:20 Asia/Shanghai (edgeone.json), 45-day window, ≤20 model calls per run (only items with body text, plus title-only calls for A-share 产能/预告 to get a 挚锦解读). Stored in memory conversation `trends-listed`, one message per run; 30/45-day merge, cap 12/10/8 per tier and 3 per company.
- **Served**: `GET /trends/latest?brief=1` → `listed` (the CN syncer renders sentinel `nt-trend:listed` on /blog/industry-news); `GET /trends/latest?listed=1` → the doc alone.
- **Manual run**: `curl -N -X POST https://trends.neotel.tech/trends/listed -H 'Content-Type: application/json' -H 'makers-conversation-id: nt-listed-manual-1' -d '{"windowDays":45,"maxModelCalls":20,"reset":false}'` — agent routes need the `makers-conversation-id` header. The SSE stream may be cut by the edge on long runs; the run continues server-side, so poll `?listed=1` for a newer `generatedAt` (CN box helper: `/root/nt-trend/run_listed_first.sh 45 20 [true]`; `true` = `reset`, use after registry/filter changes).
- **Policy**: competitor-flagged companies (JFE rule) never get a note; summaries ≤80 chars, facts and periods from the source only; `_policy.ts` checks re-applied after the model.
- **Local smoke**: `npx tsc -p tsconfig.test.json && node .test-build/trends/tests/listed-smoke.js "快克智能,Nordson"` (set `SMOKE_MODEL_CALLS=2` + `LLM_API_KEY/LLM_BASE_URL/LLM_MODEL` to exercise the summariser).
- **DART (2026-09-28)**: Koh Young / Hanwha Aerospace / 三星电机 via `opendart.fss.or.kr/api/list.json` (corp_code map in `_listed_companies.ts`). Needs **`DART_API_KEY` in the Makers project env** (项目设置 → 环境变量); without it the three companies log `DART_API_KEY not set` and are skipped. Korean report names are classified in code (사업/반기/분기보고서 = 财报, 잠정실적 = 业绩预告, 신규시설투자/공급계약/취득 = 产能·订单); every DART item goes to the model for a Chinese one-liner.
- **Phase 2**: EDINET (Fuji/村田/TDK) API (free key), Taiwan MOPS, Mycronic newsroom (Cision feed dead since 2023), PDF text for A-share reports, quarterly 财报速览 table + PDF asset.

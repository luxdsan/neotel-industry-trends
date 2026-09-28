/**
 * POST /trends/listed — collect listed-company disclosures + newsroom items (plan §1–2), summarise the new ones,
 * merge with the previous 30-day doc and store it (memory conversation `trends-listed`).
 *
 * Streams SSE like /trends/run (progress events, then `{stage:'complete', doc}`) — a plain JSON response is cut by
 * the edge gateway on multi-minute runs. Scheduled 09:20 Asia/Shanghai (edgeone.json `listed-daily`). Served to the
 * CN syncer inside GET /trends/latest?brief=1 as `brief.listed` (and alone via ?listed=1).
 * Body (optional): { windowDays?: number (30), maxModelCalls?: number (20), companies?: string[] (names) }
 * Manual calls need the `makers-conversation-id` header (6–36 chars).
 */

import type { AgentContext } from '@edgeone/types';
import { randomUUID } from 'node:crypto';

import { getBody, getEnv } from './_http.js';
import { buildListedDoc, collectListed, summariseNew, type ListedDoc } from './_listed.js';
import { LISTED_COMPANIES } from './_listed_companies.js';
import { loadLatestListedFromMemory, saveListedToMemory } from './_memory.js';

export async function onRequest(context: AgentContext): Promise<Response> {
  const body = getBody(context);
  const runId = context?.run_id || `listed_${randomUUID().slice(0, 12)}`;
  const windowDays = Math.min(90, Math.max(7, Number(body.windowDays || 30)));
  const maxCalls = Math.min(40, Math.max(0, Number(body.maxModelCalls ?? 20)));
  const names: string[] | null = Array.isArray(body.companies) && body.companies.length ? body.companies.map(String) : null;
  const companies = names ? LISTED_COMPANIES.filter(c => names.includes(c.name)) : LISTED_COMPANIES;
  const started = Date.now();
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: Record<string, unknown>) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { /* closed */ }
      };
      const heartbeat = setInterval(() => emit({ stage: 'heartbeat', t: Date.now() - started }), 15000);
      try {
        emit({ stage: 'fetch', status: 'running', companies: companies.length, windowDays });
        // body.reset=true → ignore the stored doc (after a registry/filter change); every item is treated as new
        const previous = body.reset ? null : await loadLatestListedFromMemory(context).catch(() => null) as ListedDoc | null;
        const known = new Set((previous?.items || []).map(i => i.id));
        const { items, bySource, errors } = await collectListed(windowDays, companies, (msg) => emit({ stage: 'fetch', status: 'running', detail: msg }));
        const fresh = items.filter(i => !known.has(i.id));
        emit({ stage: 'fetch', status: 'done', items: items.length, newItems: fresh.length, bySource, errors, duration: +((Date.now() - started) / 1000).toFixed(1) });
        console.log(`[listed] collected ${items.length} (new ${fresh.length}) from ${companies.length} companies; errors ${errors.length}`);

        emit({ stage: 'summarizer', status: 'running', candidates: fresh.filter(i => (i.text || '').length >= 80).length, cap: maxCalls });
        const modelCalls = await summariseNew(fresh, getEnv(context), maxCalls);
        emit({ stage: 'summarizer', status: 'done', modelCalls });

        const doc = buildListedDoc(runId, [...fresh, ...items.filter(i => known.has(i.id)).map(i => ({ ...i, summaryZh: '', note: '', tool: '' }))], previous, windowDays, bySource, errors, modelCalls);
        (doc as ListedDoc & { durationMs?: number; trigger?: string }).durationMs = Date.now() - started;
        (doc as ListedDoc & { trigger?: string }).trigger = body._schedule ? 'schedule' : body.trigger || 'manual';
        const saved = await saveListedToMemory(context, doc).catch(() => false);
        console.log(`[listed] doc ${doc.items.length} items, model calls ${modelCalls}, saved=${saved}, ${Date.now() - started} ms`);
        emit({ stage: 'complete', status: 'done', saved, newItems: fresh.length, doc });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[listed] failed:', message);
        emit({ stage: 'error', status: 'failed', detail: message });
        emit({ stage: 'complete', status: 'failed', runId, error: message });
      } finally {
        clearInterval(heartbeat);
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}

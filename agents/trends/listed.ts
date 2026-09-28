/**
 * POST /trends/listed — collect listed-company disclosures + newsroom items (plan §1–2), summarise the new ones,
 * merge with the previous 30-day doc and store it (memory conversation `trends-listed`).
 *
 * Scheduled 09:20 Asia/Shanghai (edgeone.json `listed-daily`). Served to the CN syncer inside
 * GET /trends/latest?brief=1 as `brief.listed` (cloud-functions/trends/latest).
 * Body (optional): { windowDays?: number (30), maxModelCalls?: number (20), companies?: string[] (names) }
 */

import type { AgentContext } from '@edgeone/types';
import { randomUUID } from 'node:crypto';

import { getBody, getEnv, jsonResponse } from './_http.js';
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

  try {
    const previous = await loadLatestListedFromMemory(context).catch(() => null) as ListedDoc | null;
    const known = new Set((previous?.items || []).map(i => i.id));
    const { items, bySource, errors } = await collectListed(windowDays, companies);
    const fresh = items.filter(i => !known.has(i.id));
    console.log(`[listed] collected ${items.length} (new ${fresh.length}) from ${companies.length} companies; errors ${errors.length}`);
    const modelCalls = await summariseNew(fresh, getEnv(context), maxCalls);
    // items already known keep their stored summary/note (buildListedDoc merges by id)
    const doc = buildListedDoc(runId, [...fresh, ...items.filter(i => known.has(i.id)).map(i => ({ ...i, summaryZh: '', note: '', tool: '' }))], previous, windowDays, bySource, errors, modelCalls);
    (doc as ListedDoc & { durationMs?: number }).durationMs = Date.now() - started;
    const saved = await saveListedToMemory(context, doc).catch(() => false);
    console.log(`[listed] doc ${doc.items.length} items, model calls ${modelCalls}, saved=${saved}, ${Date.now() - started} ms`);
    return jsonResponse({ ...doc, saved, newItems: fresh.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[listed] failed:', message);
    return jsonResponse({ kind: 'listed', runId, status: 'failed', error: message }, 500);
  }
}

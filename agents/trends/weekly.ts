/**
 * POST /trends/weekly — roll up the last 7 days of daily reports into one weekly report.
 *
 * Triggered by the `weekly-trends` schedule (Fri 10:00 Asia/Shanghai) or manually.
 * No model call: see _weekly.ts. Body (optional): { days?: number (default 7), trigger?: string }.
 * Returns the saved TrendReport (kind='weekly') as JSON.
 */

import type { AgentContext } from '@edgeone/types';
import { randomUUID } from 'node:crypto';

import { getBody, jsonResponse } from './_http.js';
import { loadReportsSince, saveReportToMemory } from './_memory.js';
import { utcNow } from './_report.js';
import { loadHistory, loadReport, saveReport } from './_storage.js';
import type { TrendReport } from './_types.js';
import { buildWeeklyReport } from './_weekly.js';

async function loadDailyReportsFromFiles(sinceIso: string): Promise<TrendReport[]> {
  const history = await loadHistory();
  const out: TrendReport[] = [];
  for (const entry of history) {
    if (!entry.runId || String(entry.generatedAt || '') < sinceIso) continue;
    if ((entry.kind ?? 'daily') !== 'daily') continue;
    const report = await loadReport(entry.runId);
    if (report) out.push(report);
  }
  return out;
}

export async function onRequest(context: AgentContext): Promise<Response> {
  const body = getBody(context);
  const runId = context?.run_id || `weekly_${randomUUID().slice(0, 12)}`;
  const trigger = body._schedule ? 'schedule' : body.trigger || 'manual';
  const days = Math.min(31, Math.max(1, Number(body.days || 7)));
  const generatedAt = utcNow();
  const sinceIso = new Date(Date.now() - days * 86400000).toISOString();

  try {
    let daily = await loadReportsSince(context, sinceIso, 'daily').catch(() => [] as TrendReport[]);
    if (!daily.length) daily = await loadDailyReportsFromFiles(sinceIso);
    console.log(`[weekly] ${daily.length} daily reports since ${sinceIso}`);

    const report = buildWeeklyReport({ runId, dailyReports: daily, trigger, generatedAt });
    report.durationMs = Date.now() - new Date(generatedAt).getTime();

    const savedToMemory = await saveReportToMemory(context, report).catch(() => false);
    report.storage = savedToMemory ? 'memory' : 'file-fallback';
    if (!savedToMemory) await saveReport(report);

    return jsonResponse(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[weekly] failed:', message);
    return jsonResponse({ status: 'failed', runId, kind: 'weekly', error: message }, 500);
  }
}

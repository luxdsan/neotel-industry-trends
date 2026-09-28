/**
 * Store access layer for cloud-functions.
 *
 * In cloud-functions, the store is accessed via `context.agent!.store`
 * (vs `context.store` in agents/).
 * Both point to the same underlying data.
 */

// Inline minimal types (mirrors agents/trends/_types.ts)
import type { CloudFunctionContext } from '@edgeone/types';
interface TrendReport {
  runId: string;
  status: string;
  kind?: 'daily' | 'weekly';
  brief?: unknown;
  trigger?: string;
  generatedAt: string;
  durationMs?: number;
  itemCount: number;
  newItemCount?: number;
  reusedItemCount?: number;
  summary: string;
  reportMarkdown: string;
  trends: unknown[];
  items: unknown[];
  error?: string;
  storage?: 'memory' | 'file-fallback' | 'empty';
  [key: string]: unknown;
}

interface HistoryEntry {
  runId?: string;
  status?: string;
  kind?: 'daily' | 'weekly';
  trigger?: string;
  generatedAt?: string;
  itemCount?: number;
  newItemCount?: number;
  reusedItemCount?: number;
  summary?: string;
  error?: string;
  storage?: 'memory' | 'file-fallback' | 'empty';
}

const REPORT_CONVERSATION_ID = 'trends-reports';
const REPORT_KIND = 'trends_report';

interface MemoryMessage {
  messageId?: string;
  content?: unknown;
  metadata?: Record<string, unknown>;
}

interface AgentMemoryLike {
  appendMessage(input: {
    conversationId: string;
    role: 'assistant' | 'tool';
    content: string;
    metadata: Record<string, unknown>;
  }): Promise<string>;
  getMessages(input: {
    conversationId: string;
    limit?: number;
    order?: 'asc' | 'desc';
  }): Promise<MemoryMessage[]>;
  deleteMessage?(input: { conversationId: string; messageId: string }): Promise<void>;
}

export function getStore(context: CloudFunctionContext): AgentMemoryLike | null {
  // cloud-functions access: context.agent!.store
  const store = context?.agent?.store;
  if (!store || typeof store.getMessages !== 'function') return null;
  return store;
}

function parseReportMessage(message: MemoryMessage): TrendReport | null {
  if (message.metadata?.kind !== REPORT_KIND) return null;
  const content = message.content;
  if (typeof content === 'object' && content !== null) return content as TrendReport;
  try {
    const parsed = JSON.parse(String(content));
    return parsed && typeof parsed === 'object' ? parsed as TrendReport : null;
  } catch {
    return null;
  }
}

function withStorageMarker(report: TrendReport): TrendReport {
  return { ...report, storage: 'memory' };
}

function toHistoryEntry(report: TrendReport): HistoryEntry {
  return {
    runId: report.runId,
    status: report.status,
    kind: report.kind ?? 'daily',
    trigger: report.trigger,
    generatedAt: report.generatedAt,
    itemCount: report.itemCount,
    newItemCount: report.newItemCount,
    reusedItemCount: report.reusedItemCount,
    summary: report.summary,
    error: report.error,
    storage: report.storage ?? 'memory',
  };
}

async function loadReports(store: AgentMemoryLike, limit = 30): Promise<TrendReport[]> {
  const messages = await store.getMessages({
    conversationId: REPORT_CONVERSATION_ID,
    limit: Math.min(limit, 100),
    order: 'desc',
  });
  const seen = new Set<string>();
  const reports: TrendReport[] = [];
  for (const message of messages) {
    const report = parseReportMessage(message);
    if (!report) continue;
    if (report.runId && seen.has(report.runId)) continue;
    if (report.runId) seen.add(report.runId);
    reports.push(withStorageMarker(report));
  }
  return reports;
}

export type ReportKind = 'daily' | 'weekly' | 'any';

/** Latest listed-company doc written by POST /trends/listed (conversation `trends-listed`). */
export async function loadLatestListed(store: AgentMemoryLike): Promise<Record<string, unknown> | null> {
  try {
    const messages = await store.getMessages({ conversationId: 'trends-listed', limit: 3, order: 'desc' });
    for (const message of messages) {
      if (message.metadata?.kind !== 'trends_listed') continue;
      const c = message.content;
      if (typeof c === 'object' && c !== null) return c as Record<string, unknown>;
      try { return JSON.parse(String(c)) as Record<string, unknown>; } catch { continue; }
    }
  } catch { /* store unavailable */ }
  return null;
}

/**
 * Latest report. `kind` defaults to 'daily' so the WordPress sync tool never mistakes a
 * Friday weekly roll-up for today's daily brief; pass 'any' for the dashboard behaviour.
 */
export async function loadLatestReport(store: AgentMemoryLike, kind: ReportKind = 'daily'): Promise<TrendReport | null> {
  if (kind === 'any') {
    const reports = await loadReports(store, 1);
    return reports[0] ?? null;
  }
  const reports = await loadReports(store, 30);
  return reports.find(r => (r.kind ?? 'daily') === kind) ?? null;
}

/** Constant-time-ish comparison for the admin token (avoid trivially short-circuiting). */
export function tokenMatches(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export async function loadHistory(store: AgentMemoryLike): Promise<HistoryEntry[]> {
  const reports = await loadReports(store, 30);
  return reports.map(toHistoryEntry);
}

export async function loadReportByRunId(store: AgentMemoryLike, runId: string): Promise<TrendReport | null> {
  const reports = await loadReports(store, 100);
  return reports.find(r => r.runId === runId) ?? null;
}

export async function deleteReport(store: AgentMemoryLike, runId: string): Promise<boolean> {
  if (typeof store.deleteMessage !== 'function') return false;
  const messages = await store.getMessages({
    conversationId: REPORT_CONVERSATION_ID,
    limit: 100,
    order: 'desc',
  });
  for (const message of messages) {
    if (message.metadata?.kind !== REPORT_KIND) continue;
    if (message.metadata?.runId !== runId) continue;
    if (!message.messageId) continue;
    await store.deleteMessage({ conversationId: REPORT_CONVERSATION_ID, messageId: message.messageId });
    return true;
  }
  return false;
}

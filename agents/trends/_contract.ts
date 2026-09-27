/**
 * Assemble and validate the plan §4 data contract (`TrendBrief`) from pipeline output.
 *
 *   TrendSourceItem[] (+ Analyst scores, Summarizer text)  ─┐
 *   Writer output  = Markdown + optional `<!--BRIEF-JSON-->` tail ─┴─▶ buildBrief() ─▶ TrendBrief
 *
 * All policy rules from _policy.ts are enforced here (never only in prompts):
 *   - summaryZh ≤ 80 chars; absolute/comparative wording → item degrades to "title + link"
 *   - highlights must point at real items; unknown ids are dropped; empty → highlight dropped
 *   - neotelNote is emptied on any competitor name / comparison / absolute / sales wording
 */

import { createHash } from 'node:crypto';

import { normalizeUrl } from './_items.js';
import { checkHighlight, checkNeotelNote, checkSummary, clampSummary } from './_policy.js';
import { BRIEF_SCHEMA, TOPIC_ENUM, validateAgainstSchema, type SchemaError } from './_schema.js';
import { inferTopic } from './_sources.js';
import type { TrendSourceItem } from './_types.js';

export type BriefTopicName = typeof TOPIC_ENUM[number];
export type BriefStatus = 'completed' | 'failed' | 'empty';

export interface BriefItem {
  id: string;
  title: string;
  url: string;
  source: string;
  eventTime: string;
  fetchedAt: string;
  summaryZh: string;
  topic: BriefTopicName;
  score: number;
  seenCount: number;
}

export interface BriefHighlight { text: string; itemIds: string[] }
export interface BriefTopic { name: BriefTopicName; count: number }

export interface BriefReport {
  titleZh: string;
  highlights: BriefHighlight[];
  topics: BriefTopic[];
  neotelNote: string;
  markdown: string;
}

export interface TrendBrief {
  runId: string;
  generatedAt: string;
  status: BriefStatus;
  window: { from: string; to: string };
  items: BriefItem[];
  report: BriefReport;
}

/** What the Writer may append after `<!--BRIEF-JSON-->` (all optional, all validated). */
export interface WriterTail {
  titleZh?: string;
  highlights?: Array<{ text?: string; itemIds?: string[] }>;
  neotelNote?: string;
}

export const BRIEF_JSON_MARKER = '<!--BRIEF-JSON-->';

// ── Time helpers (all public timestamps are Asia/Shanghai, +08:00) ─────────────

const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;

function pad(n: number): string { return String(n).padStart(2, '0'); }

/** ISO-8601 with an explicit +08:00 offset, e.g. 2026-09-28T09:14:32+08:00 */
export function toShanghaiIso(input: Date | string | number = Date.now()): string {
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return toShanghaiIso(Date.now());
  const s = new Date(d.getTime() + SHANGHAI_OFFSET_MS);
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())}T${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}:${pad(s.getUTCSeconds())}+08:00`;
}

/** YYYY-MM-DD in Asia/Shanghai */
export function toShanghaiDate(input: Date | string | number = Date.now()): string {
  return toShanghaiIso(input).slice(0, 10);
}

export function sha1(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}

export function briefItemId(url: string): string {
  return sha1(normalizeUrl(url) || String(url || ''));
}

// ── Writer output splitting ───────────────────────────────────────────────────

export function splitWriterOutput(raw: string): { markdown: string; tail: WriterTail | null } {
  const text = String(raw || '');
  const idx = text.indexOf(BRIEF_JSON_MARKER);
  if (idx === -1) return { markdown: text.trim(), tail: null };
  const markdown = text.slice(0, idx).trim();
  let jsonText = text.slice(idx + BRIEF_JSON_MARKER.length).trim();
  const fence = jsonText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fence) jsonText = fence[1];
  const start = jsonText.indexOf('{');
  const end = jsonText.lastIndexOf('}');
  if (start === -1 || end === -1) return { markdown, tail: null };
  try {
    const parsed = JSON.parse(jsonText.slice(start, end + 1)) as WriterTail;
    return { markdown, tail: parsed && typeof parsed === 'object' ? parsed : null };
  } catch {
    return { markdown, tail: null };
  }
}

// ── Assembly ──────────────────────────────────────────────────────────────────

export interface BuildBriefInput {
  runId: string;
  items: TrendSourceItem[];
  markdown: string;
  tail?: WriterTail | null;
  status?: BriefStatus;
  generatedAt?: Date | string;
  windowHours?: number;
  /** Fallback title date; defaults to generatedAt's Shanghai date */
  titleDate?: string;
}

function isTopic(value: unknown): value is BriefTopicName {
  return typeof value === 'string' && (TOPIC_ENUM as readonly string[]).includes(value);
}

function toBriefItem(item: TrendSourceItem, generatedAtIso: string): BriefItem | null {
  const url = normalizeUrl(item.url);
  if (!url) return null;
  const title = String(item.title || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!title) return null;

  let summaryZh = clampSummary(item.aiSummary || item.summary || title, 80);
  if (checkSummary(summaryZh).length) summaryZh = clampSummary(title, 80); // degrade to title + link
  if (!summaryZh) summaryZh = clampSummary(title, 80);

  const topic = isTopic(item.category) ? item.category : inferTopic(item);
  const scoreRaw = Number(item.score ?? 0);
  const score = Math.min(100, Math.max(0, Math.round(Number.isFinite(scoreRaw) ? scoreRaw : 0)));

  return {
    id: briefItemId(url),
    title,
    url,
    source: String(item.source || 'unknown').slice(0, 120),
    eventTime: toShanghaiDate(item.publishedAt || item.firstSeenAt || generatedAtIso),
    fetchedAt: toShanghaiIso(item.lastSeenAt || item.firstSeenAt || generatedAtIso),
    summaryZh,
    topic,
    score,
    seenCount: Math.max(1, Math.round(Number(item.seenCount || 1))),
  };
}

export function buildBrief(input: BuildBriefInput): TrendBrief {
  const generatedAt = toShanghaiIso(input.generatedAt ?? Date.now());
  const windowHours = input.windowHours ?? 24;
  const toMs = new Date(generatedAt).getTime();
  const window = { from: toShanghaiIso(toMs - windowHours * 3600 * 1000), to: generatedAt };

  // Items: canonical ids, policy-checked summaries, dedupe by canonical id.
  const idMap = new Map<string, string>(); // original pipeline id → sha1 id
  const items: BriefItem[] = [];
  const seen = new Set<string>();
  for (const raw of input.items) {
    const bi = toBriefItem(raw, generatedAt);
    if (!bi || seen.has(bi.id)) continue;
    seen.add(bi.id);
    idMap.set(raw.id, bi.id);
    idMap.set(bi.id, bi.id);
    items.push(bi);
  }
  items.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  // Topics: counted from items (deterministic, never from the model).
  const counts = new Map<BriefTopicName, number>();
  for (const it of items) counts.set(it.topic, (counts.get(it.topic) || 0) + 1);
  const topics: BriefTopic[] = [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || TOPIC_ENUM.indexOf(a.name) - TOPIC_ENUM.indexOf(b.name));

  // Highlights: must trace back to items; drop policy violations; cap at 5.
  const highlights: BriefHighlight[] = [];
  for (const h of input.tail?.highlights || []) {
    const text = clampSummary(String(h?.text || ''), 160);
    if (!text || checkHighlight(text).length) continue;
    const ids = [...new Set((h?.itemIds || []).map(id => idMap.get(String(id))).filter((x): x is string => Boolean(x)))];
    if (!ids.length) continue;
    highlights.push({ text, itemIds: ids });
    if (highlights.length >= 5) break;
  }
  if (!highlights.length) {
    for (const it of items.slice(0, 5)) highlights.push({ text: it.summaryZh, itemIds: [it.id] });
  }

  // 挚锦解读: only when clean; otherwise empty string.
  let neotelNote = String(input.tail?.neotelNote || '').replace(/\s+/g, ' ').trim();
  if (neotelNote && (checkNeotelNote(neotelNote).length || Array.from(neotelNote).length > 300)) neotelNote = '';

  const titleDate = input.titleDate || generatedAt.slice(0, 10);
  const titleZhRaw = String(input.tail?.titleZh || '').trim();
  const titleZh = titleZhRaw && Array.from(titleZhRaw).length <= 120 && !checkHighlight(titleZhRaw).length
    ? titleZhRaw
    : `${titleDate} PCB/SMT 行业趋势日报`;

  const status: BriefStatus = input.status ?? (items.length ? 'completed' : 'empty');

  return {
    runId: input.runId,
    generatedAt,
    status,
    window,
    items,
    report: { titleZh, highlights, topics, neotelNote, markdown: String(input.markdown || '') },
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

export function validateBrief(brief: unknown): { ok: boolean; errors: SchemaError[] } {
  const errors = validateAgainstSchema(brief, BRIEF_SCHEMA);
  // Cross-field rule the schema cannot express: every highlight id must exist in items.
  const b = brief as TrendBrief | null;
  if (b && Array.isArray(b.items) && b.report && Array.isArray(b.report.highlights)) {
    const ids = new Set(b.items.map(i => i.id));
    b.report.highlights.forEach((h, i) => {
      for (const id of h.itemIds || []) {
        if (!ids.has(id)) errors.push({ path: `$.report.highlights[${i}].itemIds`, message: `unknown item id ${id}` });
      }
    });
  }
  return { ok: errors.length === 0, errors };
}

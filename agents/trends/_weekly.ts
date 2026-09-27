/**
 * Weekly roll-up (plan §5: 每周五 10:00 生成周报草稿) — pure, no model call.
 *
 * Takes the daily reports of the last 7 days and produces one TrendReport(kind='weekly')
 * whose `brief` follows the same §4 contract (window = 168 h). A human adds the
 * "工厂决策视角" paragraph on the WordPress side before publishing, so the code here only
 * aggregates: dedupe by canonical URL, count the days an item was seen, rank by score,
 * group by topic, and carry over the daily 挚锦解读 texts that passed policy.
 */

import { buildBrief, toShanghaiDate, type TrendBrief } from './_contract.js';
import { fingerprintItem } from './_items.js';
import { checkNeotelNote } from './_policy.js';
import { utcNow } from './_report.js';
import type { TrendGroup, TrendReport, TrendSourceItem } from './_types.js';

interface Aggregated extends TrendSourceItem { daysSeen: number }

function aggregateItems(reports: TrendReport[]): Aggregated[] {
  const map = new Map<string, Aggregated>();
  // newest report first → its summary wins; older reports only bump daysSeen.
  const ordered = [...reports].sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
  for (const report of ordered) {
    const day = String(report.generatedAt || '').slice(0, 10);
    const seenToday = new Set<string>();
    for (const item of report.items || []) {
      const fp = fingerprintItem(item);
      if (!fp || seenToday.has(fp)) continue;
      seenToday.add(fp);
      const existing = map.get(fp);
      if (existing) {
        existing.daysSeen += 1;
        existing.score = Math.max(existing.score || 0, item.score || 0);
        existing.firstSeenAt = day < String(existing.firstSeenAt || day) ? `${day}T00:00:00+08:00` : existing.firstSeenAt;
      } else {
        map.set(fp, { ...item, daysSeen: 1, seenCount: item.seenCount || 1 });
      }
    }
  }
  return [...map.values()]
    .map(i => ({ ...i, seenCount: Math.max(i.seenCount || 1, i.daysSeen) }))
    .sort((a, b) => (b.score || 0) - (a.score || 0) || b.daysSeen - a.daysSeen);
}

function collectNotes(reports: TrendReport[]): string {
  const notes: string[] = [];
  for (const r of reports) {
    const brief = r.brief as TrendBrief | undefined;
    const note = String(brief?.report?.neotelNote || '').trim();
    if (!note || notes.includes(note) || checkNeotelNote(note).length) continue;
    notes.push(note);
  }
  let out = '';
  for (const n of notes) {
    if (Array.from(`${out}${out ? ' ' : ''}${n}`).length > 300) break;
    out = out ? `${out} ${n}` : n;
  }
  return out;
}

function groupByTopic(items: TrendSourceItem[]): TrendGroup[] {
  const grouped = new Map<string, TrendSourceItem[]>();
  for (const item of items) {
    const category = item.category || '厂商动态';
    grouped.set(category, [...(grouped.get(category) || []), item]);
  }
  return [...grouped.entries()].map(([category, catItems]) => ({
    category,
    summary: catItems.slice(0, 3).map(i => i.title).join('；'),
    count: catItems.length,
    items: catItems.slice(0, 8),
  }));
}

export interface WeeklyInput {
  runId: string;
  dailyReports: TrendReport[];
  trigger?: string;
  generatedAt?: string;
  maxItems?: number;
}

export function buildWeeklyReport(input: WeeklyInput): TrendReport {
  const generatedAt = input.generatedAt || utcNow();
  const endDate = toShanghaiDate(generatedAt);
  const startDate = toShanghaiDate(new Date(generatedAt).getTime() - 6 * 86400000);
  const usable = input.dailyReports.filter(r => r.status === 'success' && (r.kind ?? 'daily') === 'daily');
  const items = aggregateItems(usable).slice(0, input.maxItems ?? 40);
  const groups = groupByTopic(items);
  const recurring = items.filter(i => i.daysSeen >= 2);
  const note = collectNotes(usable);
  const top = items.slice(0, 5);

  const lines: string[] = [
    `# ${endDate} PCB/SMT 行业趋势周报（${startDate} ~ ${endDate}）`,
    '',
    `覆盖 ${usable.length} 期日报，共 ${items.length} 条去重资讯。`,
    '',
    '## 本周要点',
    '',
  ];
  if (top.length) {
    for (const i of top) lines.push(`- [${i.title}](${i.url}) — ${i.aiSummary || i.summary || ''}（${i.source || ''}）`);
  } else {
    lines.push('本期无');
  }
  lines.push('', '## 分主题动态', '');
  if (groups.length) {
    for (const g of groups) {
      lines.push(`### ${g.category}（${g.count}）`, '');
      for (const i of g.items) lines.push(`- [${i.title}](${i.url}) — ${i.aiSummary || i.summary || ''}（${i.source || ''}）`);
      lines.push('');
    }
  } else {
    lines.push('本期无', '');
  }
  lines.push('## 持续发酵', '');
  if (recurring.length) {
    for (const i of recurring) lines.push(`- [${i.title}](${i.url}) — 连续 ${i.daysSeen} 天出现`);
  } else {
    lines.push('本期无');
  }
  lines.push('', '## 挚锦解读', '', note || '本期无', '', '## 工厂决策视角', '', '（人工补充后再发布）');

  const markdown = lines.join('\n');
  const tail = {
    titleZh: `${endDate} PCB/SMT 行业趋势周报`,
    highlights: top.map(i => ({ text: i.aiSummary || i.summary || i.title, itemIds: [i.id] })),
    neotelNote: note,
  };
  const brief = buildBrief({
    runId: input.runId,
    items,
    markdown,
    tail,
    status: items.length ? 'completed' : 'empty',
    generatedAt,
    windowHours: 168,
  });

  return {
    runId: input.runId,
    status: items.length ? 'success' : 'empty',
    kind: 'weekly',
    brief,
    trigger: input.trigger || 'schedule',
    generatedAt,
    itemCount: items.length,
    newItemCount: items.filter(i => i.daysSeen === 1).length,
    reusedItemCount: recurring.length,
    summary: brief.report.highlights[0]?.text || '本周无新增资讯。',
    reportMarkdown: markdown,
    trends: groups,
    items,
  };
}

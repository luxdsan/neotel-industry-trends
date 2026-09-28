/**
 * GET /trends/latest — Cloud Function
 * Returns the latest generated report including `brief` (plan §4 contract).
 *
 * Query: ?kind=daily (default) | weekly | any
 *        ?brief=1  → return only the §4 `brief` object (what the WordPress sync tool reads);
 *                    it also carries `listed` = latest listed-company doc from POST /trends/listed (or null)
 *        ?listed=1 → return only the listed-company doc
 */

import type { CloudFunctionContext } from '@edgeone/types';
import { jsonResponse } from '../../_http';
import { getStore, loadLatestListed, loadLatestReport, type ReportKind } from '../../_store';

function parseKind(value: string | null): ReportKind {
  return value === 'weekly' || value === 'any' ? value : 'daily';
}

export async function onRequestGet(context: CloudFunctionContext): Promise<Response> {
  const url = new URL(context.request!.url);
  const kind = parseKind(url.searchParams.get('kind'));
  const briefOnly = url.searchParams.get('brief') === '1';
  const listedOnly = url.searchParams.get('listed') === '1';

  const store = getStore(context);
  if (store) {
    if (listedOnly) {
      const listed = await loadLatestListed(store);
      return listed ? jsonResponse(listed) : jsonResponse({ kind: 'listed', status: 'empty' }, 404);
    }
    const report = await loadLatestReport(store, kind);
    if (report) {
      if (!briefOnly) return jsonResponse(report);
      const brief = (report.brief && typeof report.brief === 'object') ? report.brief as Record<string, unknown> : { status: 'empty', runId: report.runId };
      const listed = await loadLatestListed(store);
      return jsonResponse({ ...brief, listed });
    }
  }
  if (briefOnly || listedOnly) return jsonResponse({ status: 'empty' }, 404);
  return jsonResponse({
    status: 'empty',
    kind,
    summary: '还没有生成过行业趋势报告。',
    reportMarkdown: '# PCB/SMT 行业趋势日报\n\n还没有生成过报告，点击"手动生成"开始。',
    trends: [],
    items: [],
  });
}

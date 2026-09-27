/**
 * GET /trends/latest — Cloud Function
 * Returns the latest generated report including `brief` (plan §4 contract).
 *
 * Query: ?kind=daily (default) | weekly | any
 *        ?brief=1  → return only the §4 `brief` object (what the WordPress sync tool reads)
 */

import type { CloudFunctionContext } from '@edgeone/types';
import { jsonResponse } from '../../_http';
import { getStore, loadLatestReport, type ReportKind } from '../../_store';

function parseKind(value: string | null): ReportKind {
  return value === 'weekly' || value === 'any' ? value : 'daily';
}

export async function onRequestGet(context: CloudFunctionContext): Promise<Response> {
  const url = new URL(context.request!.url);
  const kind = parseKind(url.searchParams.get('kind'));
  const briefOnly = url.searchParams.get('brief') === '1';

  const store = getStore(context);
  if (store) {
    const report = await loadLatestReport(store, kind);
    if (report) return jsonResponse(briefOnly ? (report.brief ?? { status: 'empty', runId: report.runId }) : report);
  }
  if (briefOnly) return jsonResponse({ status: 'empty' }, 404);
  return jsonResponse({
    status: 'empty',
    kind,
    summary: '还没有生成过行业趋势报告。',
    reportMarkdown: '# PCB/SMT 行业趋势日报\n\n还没有生成过报告，点击"手动生成"开始。',
    trends: [],
    items: [],
  });
}

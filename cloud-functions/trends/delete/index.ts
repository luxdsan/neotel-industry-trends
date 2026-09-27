/**
 * POST /trends/delete — Cloud Function
 * Deletes a report by runId.
 *
 * Protected: the request must carry header `x-admin-token` equal to env `ADMIN_TOKEN`.
 * When ADMIN_TOKEN is not configured, deletion is disabled entirely (403).
 */

import type { CloudFunctionContext } from '@edgeone/types';
import { jsonResponse, readJsonBody } from '../../_http';
import { getStore, deleteReport, tokenMatches } from '../../_store';

export async function onRequestPost(context: CloudFunctionContext): Promise<Response> {
  const expected = context.env?.ADMIN_TOKEN || process.env.ADMIN_TOKEN;
  const provided = context.request!.headers.get('x-admin-token');
  if (!tokenMatches(provided, expected)) {
    return jsonResponse({ error: expected ? 'forbidden' : 'delete disabled (ADMIN_TOKEN not configured)' }, 403);
  }

  const body = await readJsonBody(context);
  const runId = (body.runId || body.run_id) as string | undefined;
  if (!runId) return jsonResponse({ error: 'runId is required' }, 400);

  const store = getStore(context);
  if (!store) return jsonResponse({ error: 'store not available' }, 500);

  const deleted = await deleteReport(store, runId);
  if (!deleted) return jsonResponse({ error: 'report not found or delete not supported' }, 404);
  return jsonResponse({ success: true, runId });
}

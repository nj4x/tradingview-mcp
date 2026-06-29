import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/documents.js';
import { withTab } from '../core/withTab.js';
import { TvError } from '../core/TvError.js';

function fail(err) {
  const e = TvError.from(err);
  return jsonResult(
    { success: false, error: e.message, code: e.code, retryable: e.retryable },
    true,
  );
}

const DOC_CATEGORIES = [
  'quarterly_report',
  'annual_report',
  'earnings_release',
  'call_transcript',
  'event_transcript',
  'slides',
  'press_release',
];

export function registerDocumentsTools(server) {
  server.tool(
    'documents_list',
    'List corporate/financial documents for a symbol (quarterly & annual reports, earnings releases, call/event transcripts, slides, press releases). Returns id, title, category, fiscal period/year, reported date (ISO), provider, form, and view_ids for documents_get_file.',
    {
      symbol: z.string().describe('Symbol pro_name (e.g., NASDAQ:AMZN).'),
      categories: z
        .array(z.enum(DOC_CATEGORIES))
        .optional()
        .describe(`Optional category filter. Any of: ${DOC_CATEGORIES.join(', ')}.`),
      lang: z.string().optional().describe("Language code (default 'en')."),
      limit: z.coerce.number().optional().describe('Max documents (1-100, default 20).'),
    },
    async ({ symbol, categories, lang, limit }) => {
      try {
        const out = await core.listDocuments({ symbol, categories, lang, limit });
        return jsonResult(out);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.tool(
    'documents_get_file',
    'Fetch a single document file/view by its view_id (from a documents_list view_ids entry). Requires a TradingView documents entitlement; soft-fails with file_available:false on 401/403 rather than throwing.',
    {
      view_id: z.string().describe('The view id from documents_list view_ids (e.g. urn:report:...-abc123).'),
    },
    async ({ view_id }) => {
      try {
        const out = await withTab(
          (deps) => core.getDocumentFile({ view_id, _deps: deps }),
          { route: 'headless' },
        );
        return jsonResult(out);
      } catch (err) {
        return fail(err);
      }
    },
  );
}

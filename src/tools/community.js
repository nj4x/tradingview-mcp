import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/community.js';
import { TvError } from '../core/TvError.js';

function fail(err) {
  const e = TvError.from(err);
  return jsonResult(
    { success: false, error: e.message, code: e.code, retryable: e.retryable },
    true,
  );
}

export function registerCommunityTools(server) {
  server.tool(
    'community_get_ideas',
    'Get published community trade ideas for a symbol from TradingView. Returns id, title, description, author, created_at, chart_url, views, likes, comments. Paginated. Works without TradingView Desktop running.',
    {
      symbol: z.string().describe('Symbol (e.g., NASDAQ:AMZN). Required.'),
      page: z.coerce.number().optional().describe('Page number (default 1)'),
      sort: z.enum(['recent', 'popular', 'trending']).optional().describe("Sort order: 'recent' (default), 'popular', or 'trending'"),
    },
    async ({ symbol, page, sort }) => {
      try {
        const out = await core.getIdeas({ symbol, page, sort });
        return jsonResult(out);
      } catch (err) { return fail(err); }
    },
  );

  server.tool(
    'community_get_minds',
    'Get short community social posts ("Minds") for a symbol from TradingView. Returns id, text, author, created, comments. Cursor-paginated via next_cursor. Works without TradingView Desktop running.',
    {
      symbol: z.string().describe('Symbol (e.g., NASDAQ:AMZN). Required.'),
      limit: z.coerce.number().optional().describe('Max posts (1-50, default 20)'),
      cursor: z.string().optional().describe("Opaque cursor from a previous response's next_cursor field"),
    },
    async ({ symbol, limit, cursor }) => {
      try {
        const out = await core.getMinds({ symbol, limit, cursor });
        return jsonResult(out);
      } catch (err) { return fail(err); }
    },
  );

  server.tool(
    'community_get_scripts',
    'Get community Pine scripts for a symbol from TradingView. Optional keyword search. Returns id, title, description, author, created_at, views, likes. Paginated. Works without TradingView Desktop running.',
    {
      symbol: z.string().describe('Symbol (e.g., NASDAQ:AMZN). Required.'),
      query: z.string().optional().describe('Keyword search filter'),
      page: z.coerce.number().optional().describe('Page number (default 1)'),
    },
    async ({ symbol, query, page }) => {
      try {
        const out = await core.getScripts({ symbol, query, page });
        return jsonResult(out);
      } catch (err) { return fail(err); }
    },
  );
}

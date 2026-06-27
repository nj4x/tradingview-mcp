import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/news.js';

export function registerNewsTools(server) {
  server.tool('news_get_headlines', 'Get recent news headlines for the current (or given) symbol. Returns id, title, provider, published, urgency.', {
    symbol: z.string().optional().describe('Symbol pro_name (e.g., NASDAQ:AMZN). Omit to use the current chart symbol.'),
    limit: z.coerce.number().optional().describe('Max headlines (1-50, default 25)'),
  }, async ({ symbol, limit }) => {
    try { return jsonResult(await core.getHeadlines({ symbol, limit })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('news_get_story', 'Get the full body text of a news story by its headline id (from news_get_headlines).', {
    id: z.string().describe('Story id from news_get_headlines'),
  }, async ({ id }) => {
    try { return jsonResult(await core.getStory({ id })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });
}

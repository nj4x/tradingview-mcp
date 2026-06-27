import { register } from '../router.js';
import * as core from '../../core/news.js';

register('news', {
  description: 'Get recent news headlines for the current (or given) symbol',
  options: {
    limit: { type: 'string', description: 'Max headlines (1-50, default 25)' },
  },
  handler: (opts, positionals) => {
    const symbol = positionals[0];
    const limit = opts.limit !== undefined ? Number(opts.limit) : undefined;
    return core.getHeadlines({ symbol, limit });
  },
});

register('news-story', {
  description: 'Get the full body text of a news story by id',
  handler: (opts, positionals) => {
    const id = positionals[0];
    if (!id) throw new Error('Story id required. Usage: tv news-story <id>');
    return core.getStory({ id });
  },
});

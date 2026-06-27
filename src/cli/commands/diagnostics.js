import { register } from '../router.js';
import { getDiagnostics, clearDiagnostics } from '../../core/diagnostics.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const LOG_DIR = path.join(os.homedir(), '.tradingview-mcp', 'logs', 'diagnostics');
const CURRENT_LINK = path.join(LOG_DIR, 'current');

function diagnosticsHandler(opts) {
  if (opts.clear) {
    clearDiagnostics();
    return { success: true, cleared: true };
  }

  if (opts.follow) {
    let targetFile;
    try {
      targetFile = fs.readlinkSync(CURRENT_LINK);
    } catch {
      throw new Error('No active session — is the MCP server running?');
    }
    // Tail the file by watching it
    let pos = 0;
    try { pos = fs.statSync(targetFile).size; } catch {}
    process.stdout.write('Tailing ' + targetFile + ' (Ctrl-C to stop)\n');
    fs.watchFile(targetFile, { interval: 500 }, () => {
      const stat = fs.statSync(targetFile);
      if (stat.size <= pos) return;
      const stream = fs.createReadStream(targetFile, { start: pos });
      pos = stat.size;
      stream.on('data', chunk => process.stdout.write(chunk));
    });
    // Keep alive until Ctrl-C
    process.on('SIGINT', () => { fs.unwatchFile(targetFile); process.exit(0); });
    return new Promise(() => {}); // keeps the event loop alive; SIGINT exits
  }

  const results = getDiagnostics({
    type: opts.type,
    since: opts.since ? Number(opts.since) : undefined,
    limit: opts.limit ? Number(opts.limit) : undefined,
  });
  return { success: true, count: results.length, events: results };
}

register('diagnostics', {
  description: 'Read or tail CDP diagnostics (console, exceptions, network, logs)',
  options: {
    type:   { type: 'string',  description: 'Filter by event type (console, exception, log, network_response, network_failed, ws_frame)' },
    since:  { type: 'string',  description: 'Filter events after this epoch timestamp (ms)' },
    limit:  { type: 'string',  short: 'n', description: 'Maximum number of events to return' },
    follow: { type: 'boolean', short: 'f', description: 'Tail the active session log file' },
    clear:  { type: 'boolean', description: 'Clear the in-memory ring buffer' },
  },
  handler: diagnosticsHandler,
});

register('logs', {
  description: 'Alias for tv diagnostics',
  options: {
    type:   { type: 'string' },
    since:  { type: 'string' },
    limit:  { type: 'string', short: 'n' },
    follow: { type: 'boolean', short: 'f' },
    clear:  { type: 'boolean' },
  },
  handler: diagnosticsHandler,
});

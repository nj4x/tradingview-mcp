import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/replay.js';

export function registerReplayTools(server) {
  server.tool('replay_start', 'Start bar replay mode, optionally at a specific date', {
    date: z.string().optional().describe('Date to start replay from (YYYY-MM-DD format). If omitted, selects first available date.'),
  }, async ({ date }) => {
    try { return jsonResult(await core.start({ date })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('replay_step', 'Advance one bar in replay mode', {}, async () => {
    try { return jsonResult(await core.step()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('replay_autoplay', 'Toggle autoplay in replay mode, optionally set speed', {
    speed: z.coerce.number().optional().describe('Autoplay delay in ms (lower = faster). Valid values: 100, 143, 200, 300, 1000, 2000, 3000, 5000, 10000. Leave empty to just toggle.'),
  }, async ({ speed }) => {
    try { return jsonResult(await core.autoplay({ speed })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('replay_stop', 'Stop replay and return to realtime', {}, async () => {
    try { return jsonResult(await core.stop()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('replay_trade', 'Execute a trade action in replay mode (buy, sell, or close position)', {
    action: z.string().describe('Trade action: buy, sell, or close'),
  }, async ({ action }) => {
    try { return jsonResult(await core.trade({ action })); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool('replay_status', 'Get current replay mode status', {}, async () => {
    try { return jsonResult(await core.status()); }
    catch (err) { return jsonResult({ success: false, error: err.message }, true); }
  });

  server.tool(
    'replay_run',
    'Run a full replay session in one call: start at `date`, autoplay forward, poll until `steps` bars elapse, then optionally stop. Wall-clock cost ≈ steps × speed_ms + poll overhead (e.g. 50 steps at 200ms ≈ 10s). Returns final date, position, P&L, and steps completed. The atomic replay_start/step/autoplay/status/stop tools remain available.',
    {
      date: z.string().optional().describe('Date to start replay from (YYYY-MM-DD). If omitted, first available date.'),
      steps: z.coerce.number().optional().describe('Number of bars to advance (default 50, capped at 500).'),
      speed_ms: z.coerce.number().optional().describe('Autoplay delay per bar in ms (default 200). Must be one of: 100, 143, 200, 300, 1000, 2000, 3000, 5000, 10000.'),
      stop_after: z.coerce.boolean().optional().describe('If true, stop replay and return to realtime after the run (default false).'),
    },
    async ({ date, steps, speed_ms, stop_after }) => {
      try { return jsonResult(await core.run({ date, steps, speed_ms, stop_after })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    }
  );
}

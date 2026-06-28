import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/pine.js';
import { withTab } from '../core/withTab.js';
import { TvError } from '../core/TvError.js';

function fail(err, extra) {
  const e = TvError.from(err);
  return jsonResult(
    { success: false, error: e.message, code: e.code, retryable: e.retryable, ...extra },
    true,
  );
}

export function registerPineTools(server) {
  server.tool('pine_get_source', 'Get current Pine Script source code from the editor', {}, async () => {
    try {
      const out = await withTab((deps) => core.getSource({ _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('pine_set_source', 'Set Pine Script source code in the editor', {
    source: z.string().describe('Pine Script source code to inject'),
  }, async ({ source }) => {
    try {
      const out = await withTab((deps) => core.setSource({ source, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('pine_compile', 'Compile / add the current Pine Script to the chart', {}, async () => {
    try {
      const out = await withTab((deps) => core.compile({ _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('pine_get_errors', 'Get Pine Script compilation errors from Monaco markers', {}, async () => {
    try {
      const out = await withTab((deps) => core.getErrors({ _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('pine_save', 'Save the current Pine Script (Ctrl+S)', {}, async () => {
    try {
      const out = await withTab((deps) => core.save({ _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('pine_get_console', 'Read Pine Script console/log output (compile messages, log.info(), errors)', {}, async () => {
    try {
      const out = await withTab((deps) => core.getConsole({ _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('pine_smart_compile', 'Intelligent compile: detects button, compiles, checks errors, reports study changes', {}, async () => {
    try {
      const out = await withTab((deps) => core.smartCompile({ _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('pine_new', 'Create a new blank Pine Script', {
    type: z.enum(['indicator', 'strategy', 'library']).describe('Type of script to create'),
  }, async ({ type }) => {
    try {
      const out = await withTab((deps) => core.newScript({ type, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('pine_open', 'Open a saved Pine Script by name', {
    name: z.string().describe('Name of the saved script to open (case-insensitive match)'),
  }, async ({ name }) => {
    try {
      const out = await withTab((deps) => core.openScript({ name, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err, { source: 'internal_api' }); }
  });

  server.tool('pine_list_scripts', 'List saved Pine Scripts', {}, async () => {
    try { return jsonResult(await core.listScripts()); }
    catch (err) { return fail(err); }
  });

  server.tool('pine_analyze', 'Run static analysis on Pine Script code WITHOUT compiling — catches array out-of-bounds, unguarded array.first()/last(), bad loop bounds, and implicit bool casts. Works offline, no TradingView connection needed.', {
    source: z.string().describe('Pine Script source code to analyze'),
  }, async ({ source }) => {
    try { return jsonResult(core.analyze({ source })); }
    catch (err) { return fail(err); }
  });

  server.tool('pine_check', 'Compile Pine Script via TradingView\'s server API without needing the chart open. Returns compilation errors/warnings. Useful for validating code before injecting into the chart.', {
    source: z.string().describe('Pine Script source code to compile/validate'),
  }, async ({ source }) => {
    try { return jsonResult(await core.check({ source })); }
    catch (err) { return fail(err); }
  });

  server.tool('pine_deploy', 'Deploy a Pine script end-to-end in one call: opens the editor, sets source, compiles, reads errors + console output, and optionally saves. Returns the merged result.', {
    source: z.string().describe('Pine Script source code to deploy'),
    save_name: z.string().optional().describe('If provided, save the script after compiling (triggers the save flow).'),
  }, async ({ source, save_name }) => {
    try {
      const out = await withTab((deps) => core.deploy({ source, save_name, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });
}

// Tools requiring TV_MCP_EXTENDED=1. Default = everything not listed here.
export const EXTENDED_TOOLS = new Set([
  // health (diagnostic)
  'tv_discover',
  // pine — ALL 13 (even read-only; Pine dev is a separate power-user capability)
  'pine_get_source', 'pine_set_source', 'pine_compile', 'pine_get_errors',
  'pine_save', 'pine_get_console', 'pine_smart_compile', 'pine_new',
  'pine_open', 'pine_list_scripts', 'pine_analyze', 'pine_check', 'pine_deploy',
  // drawing (mutating)
  'draw_shape', 'draw_clear', 'draw_remove_one',
  // alerts (mutating)
  'alert_create', 'alert_delete',
  // batch
  'batch_run',
  // replay (all mutating; replay_status stays default)
  'replay_start', 'replay_step', 'replay_autoplay', 'replay_stop',
  'replay_trade', 'replay_run',
  // indicators (mutating)
  'indicator_set_inputs', 'indicator_toggle_visibility',
  // watchlist (mutating)
  'watchlist_add',
  // ui automation (all side-effecting; layout_list + ui_find_element stay default)
  'ui_click', 'ui_open_panel', 'ui_fullscreen', 'layout_switch',
  'ui_keyboard', 'ui_type_text', 'ui_hover', 'ui_scroll',
  'ui_mouse_click', 'ui_evaluate',
  // pane (mutating; pane_list stays default)
  'pane_set_layout', 'pane_focus', 'pane_set_symbol',
  // tab (mutating; tab_list stays default)
  'tab_new', 'tab_close', 'tab_switch',
]);
// EXTENDED_TOOLS.size === 45; default surface = 88 - 45 = 43 tools

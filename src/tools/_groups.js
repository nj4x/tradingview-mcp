// Tools requiring TV_MCP_EXTENDED=1. Default = everything not listed here.
export const EXTENDED_TOOLS = new Set([
  // health (diagnostic)
  'tv_discover', 'tv_ui_state', 'tv_launch', 'tv_health_check',
  // chart state + control
  'chart_get_state', 'chart_set_symbol', 'chart_set_timeframe', 'chart_set_type',
  'chart_manage_indicator', 'chart_get_visible_range', 'chart_set_visible_range',
  'chart_scroll_to_date', 'chart_report',
  // capture
  'capture_screenshot',
  // pine — ALL 13 (even read-only; Pine dev is a separate power-user capability)
  'pine_get_source', 'pine_set_source', 'pine_compile', 'pine_get_errors',
  'pine_save', 'pine_get_console', 'pine_smart_compile', 'pine_new',
  'pine_open', 'pine_list_scripts', 'pine_analyze', 'pine_check', 'pine_deploy',
  // drawing
  'draw_shape', 'draw_clear', 'draw_remove_one', 'draw_list', 'draw_get_properties',
  // alerts
  'alert_create', 'alert_delete', 'alert_list',
  // batch
  'batch_run',
  // replay
  'replay_start', 'replay_step', 'replay_autoplay', 'replay_stop',
  'replay_trade', 'replay_run', 'replay_status',
  // indicators (mutating)
  'indicator_set_inputs', 'indicator_toggle_visibility',
  // watchlist (mutating)
  'watchlist_add',
  // ui automation
  'ui_click', 'ui_open_panel', 'ui_fullscreen', 'layout_switch', 'layout_list',
  'ui_keyboard', 'ui_type_text', 'ui_hover', 'ui_scroll',
  'ui_mouse_click', 'ui_evaluate', 'ui_find_element',
  // pane
  'pane_set_layout', 'pane_focus', 'pane_set_symbol', 'pane_list',
  // tab
  'tab_new', 'tab_close', 'tab_switch', 'tab_list',
  // data + options (power-user / analyst surface; not needed for basic chat)
  'data_get_ohlcv', 'data_get_indicator', 'data_get_strategy_results',
  'data_get_trades', 'data_get_equity', 'data_get_pine_lines',
  'data_get_pine_labels', 'data_get_pine_tables', 'data_get_pine_boxes',
  'data_get_pine_graphics', 'data_get_study_values',
  'options_search',
  // depth (unreliable: requires broker-connected DOM panel; zero sizes without Level 2 sub)
  'depth_get',
  // community (social, REST — noisy/low-signal for default surface)
  'community_get_ideas', 'community_get_minds', 'community_get_scripts',
]);
// EXTENDED_TOOLS.size === 82; total surface = 99; default surface = 17 tools

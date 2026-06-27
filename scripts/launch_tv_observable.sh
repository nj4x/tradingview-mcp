#!/bin/bash
# Launch TradingView Desktop on macOS with CDP + maximum observable logging
# Usage: ./scripts/launch_tv_observable.sh [port] [--v=2] [--devtools]
# macOS only.

PORT="9222"
EXTRA_FLAGS=()
LOG_FILE=""

for arg in "$@"; do
  case "$arg" in
    --v=*) EXTRA_FLAGS+=("$arg") ;;
    --devtools) EXTRA_FLAGS+=("--auto-open-devtools-for-tabs") ;;
    [0-9]*) PORT="$arg" ;;
  esac
done

# Auto-detect TradingView install location
APP=""
LOCATIONS=(
  "/Applications/TradingView.app/Contents/MacOS/TradingView"
  "$HOME/Applications/TradingView.app/Contents/MacOS/TradingView"
)

for loc in "${LOCATIONS[@]}"; do
  if [ -f "$loc" ]; then
    APP="$loc"
    break
  fi
done

# Fallback: search with mdfind (Spotlight)
if [ -z "$APP" ]; then
  APP=$(mdfind "kMDItemCFBundleIdentifier == 'com.niceincontact.TradingView'" 2>/dev/null | head -1)
  if [ -n "$APP" ]; then
    APP="$APP/Contents/MacOS/TradingView"
  fi
fi

# Fallback: find any TradingView.app
if [ -z "$APP" ] || [ ! -f "$APP" ]; then
  APP=$(find /Applications "$HOME/Applications" -name "TradingView.app" -maxdepth 2 2>/dev/null | head -1)
  if [ -n "$APP" ]; then
    APP="$APP/Contents/MacOS/TradingView"
  fi
fi

if [ -z "$APP" ] || [ ! -f "$APP" ]; then
  echo "Error: TradingView not found."
  echo "Checked: /Applications/TradingView.app, ~/Applications/TradingView.app"
  echo ""
  echo "If installed elsewhere, run manually:"
  echo "  ELECTRON_ENABLE_LOGGING=1 /path/to/TradingView --remote-debugging-port=$PORT --enable-logging=stderr --v=1"
  exit 1
fi

# Kill any existing TradingView
pkill -f "TradingView" 2>/dev/null
sleep 1

# Set up log directory and file
LOG_ROOT="$HOME/.tradingview-mcp/logs/native"
mkdir -p "$LOG_ROOT"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
LOG_FILE="$LOG_ROOT/tv_native_${TIMESTAMP}.log"

echo "Found TradingView at: $APP"
echo "Launching with CDP + verbose logging..."
echo "Native log: $LOG_FILE"
echo ""

# Launch with verbose flags, tee stderr to log file
ELECTRON_ENABLE_LOGGING=1 "$APP" \
  --remote-debugging-port=$PORT \
  --enable-logging=stderr \
  --v=1 \
  --vmodule='*/net/*=1,*/url/*=1' \
  "${EXTRA_FLAGS[@]}" \
  2>&1 | tee "$LOG_FILE" &
TV_PID=$!
echo "PID: $TV_PID"

# Wait for CDP to be ready
echo "Waiting for CDP on port $PORT..."
for i in $(seq 1 20); do
  if curl -s "http://localhost:$PORT/json/version" > /dev/null 2>&1; then
    echo ""
    echo "CDP ready at http://localhost:$PORT"
    curl -s "http://localhost:$PORT/json/version" | python3 -m json.tool 2>/dev/null || curl -s "http://localhost:$PORT/json/version"
    echo ""

    # Print DevTools URL
    TARGET_ID=$(curl -s "http://localhost:$PORT/json/list" | python3 -c "
import sys, json
targets = json.load(sys.stdin)
page = next((t for t in targets if t.get('type') == 'page' and 'tradingview' in t.get('url','').lower()), None)
if page:
    print(page.get('id', ''))
" 2>/dev/null)

    if [ -n "$TARGET_ID" ]; then
      echo "DevTools URL:"
      echo "  devtools://devtools/bundled/inspector.html?ws=127.0.0.1:$PORT/devtools/page/$TARGET_ID"
      echo ""
    fi

    echo "Tail native logs:  tail -f $LOG_FILE"
    echo "Monitor OS logs:   log stream --predicate 'process == \"TradingView\"' --level debug --style compact"
    exit 0
  fi
  sleep 1
done

echo "Warning: CDP not responding after 20s. TradingView may still be loading."
echo "Check manually: curl http://localhost:$PORT/json/version"
echo "Native logs:     $LOG_FILE"

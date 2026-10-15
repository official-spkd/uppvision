#!/bin/zsh
# Runs the panel in the background whenever you log in to this Mac, and restarts it if it stops.
#   scripts/autostart-mac.sh          install (or reinstall) and start now
#   scripts/autostart-mac.sh remove   stop and remove
set -e
LABEL=com.phonefarm.panel
ROOT=${0:A:h:h}
PLIST=$HOME/Library/LaunchAgents/$LABEL.plist
DOMAIN=gui/$(id -u)

launchctl bootout $DOMAIN/$LABEL 2>/dev/null || true
if [[ "$1" == "remove" ]]; then
  rm -f "$PLIST"
  print "Panel tidak lagi berjalan otomatis."
  exit 0
fi

NODE=$(command -v node || true)
[[ -x /opt/homebrew/bin/node ]] && NODE=/opt/homebrew/bin/node
if [[ -z "$NODE" ]]; then print "Node.js belum terpasang."; exit 1; fi
if [[ ! -d "$ROOT/node_modules" ]]; then (cd "$ROOT" && npm ci); fi
(cd "$ROOT" && npm run build >/dev/null 2>&1)
mkdir -p "$ROOT/.phonefarm" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$ROOT/server/index.mjs</string><string>--production</string></array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>SoftResourceLimits</key><dict><key>NumberOfFiles</key><integer>10240</integer></dict>
  <key>StandardOutPath</key><string>$ROOT/.phonefarm/panel.log</string>
  <key>StandardErrorPath</key><string>$ROOT/.phonefarm/panel.log</string>
</dict>
</plist>
PLIST

launchctl bootstrap $DOMAIN "$PLIST"
print "Panel berjalan otomatis setiap login: http://127.0.0.1:5179"

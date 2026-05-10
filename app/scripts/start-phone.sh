#!/usr/bin/env zsh
set -e

cd "$(dirname "$0")/.."

export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
  nvm use --delete-prefix v22.22.2 >/dev/null
fi

pid="$(lsof -ti :8081 | head -n 1 || true)"
if [ -n "$pid" ]; then
  kill "$pid" || true
  sleep 1
fi

EXPO_NO_TELEMETRY=1 npx expo start --host lan --port 8081

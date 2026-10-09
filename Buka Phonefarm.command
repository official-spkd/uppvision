#!/bin/zsh -l
cd "${0:A:h}"
phonefarm_health=$(curl -fsS http://127.0.0.1:5179/api/health 2>/dev/null)
if [[ "$phonefarm_health" == *'"app":"phonefarm-panel"'* ]]; then
  open 'http://127.0.0.1:5179'
  exit 0
fi
if ! command -v npm >/dev/null; then
  print "Node.js/npm belum tersedia. Pasang Node.js lalu jalankan kembali."
  read "?Tekan Enter untuk menutup."
  exit 1
fi
if [[ ! -d node_modules ]]; then
  npm ci || exit 1
fi
npm run build || exit 1
print "Buka http://127.0.0.1:5179 di browser. Biarkan Terminal ini berjalan."
(
  for phonefarm_attempt in {1..30}; do
    if curl -fsS http://127.0.0.1:5179/api/health >/dev/null 2>&1; then
      open 'http://127.0.0.1:5179'
      break
    fi
    sleep 1
  done
) &
npm start

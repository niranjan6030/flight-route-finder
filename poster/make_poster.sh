#!/bin/bash
# Makes poster.pdf (A3 landscape) and poster.png from poster.html using Chrome.
# Run from the project folder:   bash poster/make_poster.sh
# (start a local server first:   python3 -m http.server 8764)

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
URL="http://localhost:8764/poster/poster.html"

"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer \
  --virtual-time-budget=8000 --print-to-pdf="poster/poster.pdf" "$URL"

"$CHROME" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1587,1123 --force-device-scale-factor=2 \
  --virtual-time-budget=8000 --screenshot="poster/poster.png" "$URL"

#!/bin/sh
# Headless screenshot of the dev server with the game framed at phone size (390 x 844 on the left of a 560 px window):
#   pipeline/shot.sh <out.png> "<query>"        e.g. "demo=gate&to=400"
OUT="$1"; Q="$2"
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader \
  --hide-scrollbars --window-size=560,844 --virtual-time-budget=30000 --run-all-compositor-stages-before-draw \
  --screenshot="$OUT" "http://localhost:5200/?w=390&touch=1&$Q" >/dev/null 2>&1
ls -la "$OUT" 2>/dev/null | awk '{print $5, $9}'

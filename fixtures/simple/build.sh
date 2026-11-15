#!/bin/sh
# Fake build: quick/partial succeed, full emits structured Maven-style errors.
mode="$1"; shift
echo "[INFO] mode=$mode targets=$*"
if [ "$mode" = "full" ]; then
  echo "[ERROR] /src/Bad.java:[12,34] cannot find symbol"
  echo "[WARNING] /src/Old.java:[1,1] deprecated API"
  exit 1
fi
echo "[INFO] Building jar: target/app.jar"
exit 0
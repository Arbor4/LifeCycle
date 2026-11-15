#!/bin/sh
# M6 验收：Java / Node / Rust 三个真实 fixture 的 编译→启动→就绪→停止 闭环
set -e
cd "$(dirname "$0")/.."
BIN=target/debug/lifecycle

check() {
  name="$1"; port="$2"
  CFG="fixtures/$name/lifecycle.toml"
  echo "== [$name] compile quick"
  $BIN --config "$CFG" compile --kind quick
  echo "== [$name] start (wait ready)"
  $BIN --config "$CFG" start
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$port/")
  echo "== [$name] http=$code"
  [ "$code" = "200" ]
  $BIN --config "$CFG" logs --lines 3
  echo "== [$name] stop"
  $BIN --config "$CFG" stop
}

check java 18091
check node 18092
check rust 18093
echo "FIXTURES E2E ALL PASS"
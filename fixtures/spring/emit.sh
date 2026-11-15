#!/bin/sh
# 模拟 Spring Boot 控制台输出：plain = 无 ANSI（验证语义高亮），ansi = 带 SGR（验证终端色解析）。
mode="${1:-plain}"

emit() {
  if [ "$mode" = "ansi" ];
  then printf '%b\n' "$2"
  else printf '%s\n' "$1"
  fi
}

emit '  .   ____          _            __ _ _' '  \033[32m.   ____          _            __ _ _\033[0m'
emit ' /\\ / ___'"'"'_ __ _ _(_)_ __  __ _ \ \ \ \' ' \033[32m/\\ / ___'"'"'_ __ _ _(_)_ __  __ _ \ \ \ \033[0m'
emit ' :: Spring Boot ::                (v3.3.5)' ' \033[32m:: Spring Boot ::                (v3.3.5)\033[0m'
emit '' ''
emit '2026-11-15T16:40:01.123+08:00  INFO 58501 --- [           main] c.e.demo.DemoApplication                 : Starting DemoApplication v0.0.1-SNAPSHOT using Java 21.0.4 with PID 58501' \
     '\033[2m2026-11-15T16:40:01.123+08:00\033[0m  \033[32m INFO\033[0m \033[2m58501\033[0m \033[2m---\033[0m \033[35m[           main]\033[0m \033[36mc.e.demo.DemoApplication\033[0m                 : Starting DemoApplication v0.0.1-SNAPSHOT using Java 21.0.4 with PID 58501'
emit '2026-11-15T16:40:01.126+08:00  INFO 58501 --- [           main] c.e.demo.DemoApplication                 : No active profile set, falling back to 1 default profile: "default"' \
     '\033[2m2026-11-15T16:40:01.126+08:00\033[0m  \033[32m INFO\033[0m \033[2m58501\033[0m \033[2m---\033[0m \033[35m[           main]\033[0m \033[36mc.e.demo.DemoApplication\033[0m                 : No active profile set, falling back to 1 default profile: "default"'
emit '2026-11-15T16:40:02.001+08:00  INFO 58501 --- [           main] o.s.b.w.embedded.tomcat.TomcatWebServer  : Tomcat initialized with port 18095 (http)' \
     '\033[2m2026-11-15T16:40:02.001+08:00\033[0m  \033[32m INFO\033[0m \033[2m58501\033[0m \033[2m---\033[0m \033[35m[           main]\033[0m \033[36mo.s.b.w.embedded.tomcat.TomcatWebServer\033[0m  : Tomcat initialized with port 18095 (http)'
emit '2026-11-15T16:40:02.345+08:00  WARN 58501 --- [           main] c.e.demo.config.CacheConfig              : Cache TTL not set, using default 300s' \
     '\033[2m2026-11-15T16:40:02.345+08:00\033[0m  \033[33m WARN\033[0m \033[2m58501\033[0m \033[2m---\033[0m \033[35m[           main]\033[0m \033[36mc.e.demo.config.CacheConfig\033[0m              : Cache TTL not set, using default 300s'
emit '2026-11-15T16:40:02.876+08:00 ERROR 58501 --- [           main] c.e.demo.repo.UserRepository             : Failed to warm user cache: connection refused' \
     '\033[2m2026-11-15T16:40:02.876+08:00\033[0m \033[31mERROR\033[0m \033[2m58501\033[0m \033[2m---\033[0m \033[35m[           main]\033[0m \033[36mc.e.demo.repo.UserRepository\033[0m             : Failed to warm user cache: connection refused'
emit 'src/main/java/com/example/demo/UserService.java:42:13: error: cannot find symbol' \
     'src/main/java/com/example/demo/UserService.java:42:13: \033[31merror\033[0m: cannot find symbol'
emit '2026-11-15T16:40:03.001+08:00  INFO 58501 --- [           main] c.e.demo.DemoApplication                 : Started DemoApplication in 2.412 seconds (process running for 2.803)' \
     '\033[2m2026-11-15T16:40:03.001+08:00\033[0m  \033[32m INFO\033[0m \033[2m58501\033[0m \033[2m---\033[0m \033[35m[           main]\033[0m \033[36mc.e.demo.DemoApplication\033[0m                 : Started DemoApplication in 2.412 seconds (process running for 2.803)'
emit '2026-11-15T16:40:03.002+08:00  INFO 58501 --- [           main] c.e.demo.DemoApplication                 : Docs at http://localhost:18095/swagger-ui.html' \
     '\033[2m2026-11-15T16:40:03.002+08:00\033[0m  \033[32m INFO\033[0m \033[2m58501\033[0m \033[2m---\033[0m \033[35m[           main]\033[0m \033[36mc.e.demo.DemoApplication\033[0m                 : Docs at \033[4mhttp://localhost:18095/swagger-ui.html\033[0m'

sleep 600
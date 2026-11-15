import { useSyncExternalStore } from "react";
import { api } from "./api.js";

const KEY = "lifecycle-lang";
const LANGS = ["zh", "en"];

/// 中文为源语言（key 即中文文案），英文走映射表；缺失时回退中文，保证不漏译不崩。
const EN = {
  // 通用
  取消: "Cancel",
  保存: "Save",
  删除: "Delete",
  编辑: "Edit",
  复制: "Copy",
  已复制: "Copied",
  下载: "Download",
  查看: "View",
  收起: "Collapse",
  刷新: "Refresh",
  关闭: "Close",
  撤销: "Undo",
  放弃: "Discard",
  全选: "Select all",
  清空: "Clear",
  启动: "Start",
  停止: "Stop",
  重启: "Restart",
  快速启动: "Quick start",
  快速编译: "Quick compile",
  部分编译: "Partial compile",
  完整编译: "Full compile",
  "取消编译…": "Cancel compile…",
  重载配置: "Reload config",
  创建服务: "New service",
  新建分组: "New group",
  一键启动: "Start all",
  一键停止: "Stop all",
  批量启动: "Start selected",
  批量停止: "Stop selected",
  清除选择: "Clear selection",
  "确认?": "Sure?",
  "加载中…": "Loading…",
  搜索: "Search",
  新建: "New",
  操作: "Actions",
  状态: "State",
  端口: "Port",
  运行时长: "Uptime",
  最近编译: "Last build",
  服务名称: "Service",
  工具: "Tool",
  耗时: "Duration",
  结果: "Result",
  时间: "Time",
  成功: "OK",
  失败: "Failed",
  错误: "Errors",
  日志: "Logs",
  配置: "Config",
  设置: "Settings",
  诊断: "Diagnostics",
  全局设置: "Global settings",
  全局: "Global",
  主题: "Theme",
  亮: "Light",
  暗: "Dark",
  自动: "Auto",
  亮色: "Light",
  暗色: "Dark",
  跟随系统: "System",
  亮色主题: "Light theme",
  暗色主题: "Dark theme",
  在线: "Online",
  离线: "Offline",
  后端已连接: "Backend connected",
  后端未连接: "Backend disconnected",
  语言: "Language",
  未知: "unknown",
  // 状态
  运行中: "Running",
  启动中: "Starting",
  停止中: "Stopping",
  崩溃: "Crashed",
  未启动: "Idle",
  // 侧栏
  服务列表: "Services",
  全部服务: "All services",
  服务分组: "Groups",
  "MCP 配置": "MCP",
  "搜索项目/profile…": "Search project/profile…",
  "没有匹配的项目。": "No matching projects.",
  // 服务列表
  启停中: "Starting/stopping",
  编译失败: "Build failed",
  "搜索服务…  /": "Search services…  /",
  全部状态: "All states",
  "已选 {n} 个服务": "{n} services selected",
  "显示 {a}/{b}": "Showing {a}/{b}",
  "点击行进入详情 · 筛选与排序已自动保存": "Click a row for details · filters & sorting are saved",
  没有匹配的服务: "No matching services",
  还没有注册任何服务: "No services registered yet",
  "试试清空搜索或切换状态筛选。": "Try clearing the search or changing the state filter.",
  "填入项目目录即可自动探测 Node / Rust / Maven 工程并生成 lifecycle.toml。":
    "Point at a project directory to auto-detect Node / Rust / Maven and generate lifecycle.toml.",
  创建第一个服务: "Create your first service",
  "按「{label}」筛选": "Filter by “{label}”",
  最近一次编译失败的服务数: "Services whose last build failed",
  全选当前筛选结果: "Select all filtered rows",
  "选择 {key}": "Select {key}",
  查看日志: "View logs",
  "卸载服务（停止并移除注册）": "Unregister (stop and remove)",
  再次点击确认卸载: "Click again to confirm unregister",
  再次点击确认删除: "Click again to confirm delete",
  "{key} 已启动": "{key} started",
  "{key} 已停止": "{key} stopped",
  "{key} 已重启": "{key} restarted",
  "{key} 编译成功 · {ms}ms": "{key} compiled · {ms}ms",
  "{key} 编译失败 · {n} 错误": "{key} build failed · {n} errors",
  "批量启动完成 {ok}/{total}": "Batch start done {ok}/{total}",
  "批量停止完成 {ok}/{total}": "Batch stop done {ok}/{total}",
  "已卸载服务「{name}」": "Unregistered “{name}”",
  "已恢复「{name}」": "Restored “{name}”",
  "{running}/{total} 运行中": "{running}/{total} running",
  // 分组
  "微服务一键启停 · {n} 个分组 · {r} 个成员运行中":
    "One-click microservice batches · {n} groups · {r} members running",
  "{n} 个服务": "{n} services",
  "{run}/{total} 运行中": "{run}/{total} running",
  删除分组: "Delete group",
  "分组「{name}」{label}完成 {ok}/{total}": "Group “{name}” {label} done {ok}/{total}",
  "分组「{name}」: {err}": "Group “{name}”: {err}",
  "已删除分组「{name}」": "Deleted group “{name}”",
  "已恢复分组「{name}」": "Restored group “{name}”",
  还没有分组: "No groups yet",
  "把多个微服务编成一组（如「后端核心」= 注册中心 + 网关 + 用户服务），即可一键启动整批，按依赖顺序并行拉起。":
    "Group microservices (e.g. “backend core” = registry + gateway + user service) and start the whole batch in one click, in parallel.",
  "未知（服务已卸载）": "Unknown (service unregistered)",
  编辑分组: "Edit group",
  "勾选要编入一组的服务，之后可一键启动 / 停止 / 重启整批微服务。":
    "Pick the services to batch; then start / stop / restart them together.",
  分组名称: "Group name",
  "如：后端核心": "e.g. backend core",
  "{n} 个可选服务": "{n} services available",
  "分组「{name}」已更新": "Group “{name}” updated",
  "分组「{name}」已创建": "Group “{name}” created",
  "还没有注册服务。": "No services registered yet.",
  // 注册
  "添加 / 导入项目": "Add / import project",
  "选择或填入项目文件夹。没有 lifecycle.toml 时会自动探测工程类型（Node/Vite、Rust、Maven 等）并生成配置；已有配置则直接导入。":
    "Pick or type a project folder. Without lifecycle.toml we auto-detect the stack (Node/Vite, Rust, Maven…) and generate config; existing config is imported as-is.",
  添加并注册: "Add & register",
  项目文件夹: "Project folder",
  支持本地任意代码工程: "Any local code project",
  "选择文件夹…": "Choose folder…",
  打开系统文件夹选择窗口: "Open the native folder picker",
  "已检测到 lifecycle.toml，将直接载入已有配置": "lifecycle.toml found — existing config will be loaded",
  "探测到工程: {kind}": "Detected stack: {kind}",
  "默认启动: {cmd}": "Default start: {cmd}",
  "默认端口: {port}": "Default port: {port}",
  "项目/服务名称": "Project / service name",
  默认取文件夹名称: "Defaults to folder name",
  "就绪端口（覆盖探测值）": "Ready port (overrides detection)",
  "例如 5173 / 8080": "e.g. 5173 / 8080",
  "启动命令（覆盖默认探测值）": "Start command (overrides detection)",
  "例如 npm run dev / cargo run": "e.g. npm run dev / cargo run",
  "项目配置将保存在工程目录的 lifecycle.toml 中，并在侧边栏与服务列表中实时显示。":
    "Config is saved to lifecycle.toml inside the project and appears live in the sidebar and service list.",
  "已选取文件夹，请确认或完善绝对路径": "Folder picked — confirm or complete the absolute path",
  无法打开文件夹选择窗口: "Could not open the folder picker",
  "已创建服务「{name}」并生成 lifecycle.toml": "Created “{name}” and generated lifecycle.toml",
  "已导入服务「{name}」（使用已有 lifecycle.toml）": "Imported “{name}” (existing lifecycle.toml)",
  // 部分编译
  "部分编译 · {project}/{profile}": "Partial compile · {project}/{profile}",
  "选择模块/目录，或直接输入目标（逗号分隔）。只编译选中的部分，速度远快于完整编译。":
    "Pick modules/directories or type targets (comma separated). Only the selection is compiled — much faster than a full build.",
  "已选 {n} 个目标": "{n} targets selected",
  编译所选: "Compile selection",
  全选模块: "Select all modules",
  "未发现模块目录，可在下方手动输入目标。": "No module directories found; type targets below.",
  自定义目标: "Custom targets",
  // MCP
  "决定 AI 客户端能看到、能调用哪些工具": "Control which tools AI clients can see and call",
  "点击复制 MCP 端点": "Click to copy the MCP endpoint",
  测试连接: "Test connection",
  "无法读取 MCP 配置：{err}": "Cannot load MCP config: {err}",
  项目: "Project",
  "{n} 工具": "{n} tools",
  传输方式: "Transport",
  客户端拉起本地进程: "Client spawns a local process",
  "连接常驻 HTTP 服务": "Connect to the running HTTP service",
  同时声明两种传输: "Declare both transports",
  两者: "Both",
  快速预设: "Presets",
  "写入 {path} 的 [mcp] 段，其余配置与注释保持不变；新的 MCP 会话立即生效。":
    "Writes the [mcp] table of {path}; everything else (including comments) is preserved. New MCP sessions pick it up immediately.",
  工具白名单: "Tool whitelist",
  "AI 可见 {a}/{b}": "AI sees {a}/{b}",
  "空白名单会回退到默认策略（除 reload_config 外全部开放）。请至少勾选一个工具后再保存。":
    "An empty whitelist falls back to the default policy (everything except reload_config). Select at least one tool before saving.",
  "全选「{group}」": "Select all in “{group}”",
  默认不暴露: "Not exposed by default",
  将写入的配置: "Config to be written",
  连接正常: "Connected",
  服务端: "Server",
  协议版本: "Protocol",
  "AI 此刻可见的 {n} 个工具": "{n} tools visible to AI right now",
  "与当前白名单不一致（{a} 缺失 / {b} 多余）。已连接的客户端需重开会话才会刷新。":
    "Differs from the current whitelist ({a} missing / {b} extra). Connected clients refresh on a new session.",
  连接失败: "Connection failed",
  "确认后端在 {port} 端口运行，且 /mcp 未被占用。": "Check the backend is running on port {port} and /mcp is free.",
  接入方式: "Connection",
  "启动命令（内置于 App）": "Start command (bundled in app)",
  "启动命令（独立二进制）": "Start command (standalone binary)",
  "Streamable HTTP 端点": "Streamable HTTP endpoint",
  "配置中已注入当前 PATH，确保从 GUI 客户端拉起时能找到 node / npm / cargo。":
    "The current PATH is injected so GUI clients can find node / npm / cargo.",
  "未找到可执行文件，请先构建。": "Executable not found — build first.",
  "复用常驻后端，无需客户端再拉起进程；仅监听 127.0.0.1。":
    "Reuses the running backend; no extra process. Listens on 127.0.0.1 only.",
  客户端接入: "Client setup",
  "{a}/{b} 已接入": "{a}/{b} connected",
  已接入: "Connected",
  已有配置: "Config exists",
  未配置: "Not configured",
  "仅 stdio": "stdio only",
  "stdio + HTTP": "stdio + HTTP",
  写入配置: "Write config",
  移除: "Remove",
  白名单有未保存的更改: "Unsaved whitelist changes",
  "{sel} · {n} 工具": "{sel} · {n} tools",
  "保存到 lifecycle.toml": "Save to lifecycle.toml",
  "已写入 {path} · {n} 个工具对 AI 可见": "Wrote {path} · {n} tools visible to AI",
  "已套用预设「{name}」，记得保存": "Preset “{name}” applied — remember to save",
  已复制到剪贴板: "Copied to clipboard",
  "复制失败，请手动选择文本": "Copy failed — select the text manually",
  "已写入 {name}：{path}": "Wrote {name}: {path}",
  "已从 {name} 移除 LifeCycle": "Removed LifeCycle from {name}",
  "{name}: {err}": "{name}: {err}",
  查询: "Query",
  进程: "Process",
  编译: "Build",
  高危: "Danger",
  "risk.read": "read",
  "risk.control": "process",
  "risk.build": "build",
  "risk.danger": "danger",
  "tool.list_projects": "List all projects with their profiles and states",
  "tool.get_status": "State, PID, uptime and last build summary",
  "tool.get_logs": "Read run/build logs with regex filter and byte cursor",
  "tool.watch_logs": "Mark the log cursor; later reads return increments only",
  "tool.start_project": "Start a service and wait until ready",
  "tool.stop_project": "Stop a service (process group SIGTERM→SIGKILL)",
  "tool.restart_project": "Restart a service, optionally recompiling first",
  "tool.compile_quick": "Incremental compile with structured errors",
  "tool.compile_partial": "Compile only the given modules/directories",
  "tool.compile_full": "Clean full build",
  "tool.cancel_compile": "Cancel an in-progress compile",
  "tool.reload_config": "Reload lifecycle.toml (not exposed to AI by default)",
  "preset.readonly": "Read-only safe",
  "preset.readonly.desc": "Status and logs only; no start/stop, no compile",
  "preset.recommended": "Recommended (default)",
  "preset.recommended.desc": "Start/stop, compile and logs; excludes reload_config",
  "preset.build": "Read-only + compile",
  "preset.build.desc": "Let AI compile and fix errors, but never touch processes",
  "preset.all": "Everything (incl. reload)",
  "preset.all.desc": "Includes reload_config; AI can change service behavior — use with care",
  "client.claude.note": "stdio only. Fully quit and reopen Claude Desktop after writing.",
  "client.cursor.note": "Global; can also live in a project's .cursor/mcp.json.",
  "client.vscode.note": "Requires GitHub Copilot MCP support; top-level key is servers.",
  "client.codex.note": "Writes [mcp_servers.lifecycle], keeping the rest of the file.",
  "client.gemini.note": "HTTP mode uses the httpUrl field.",
  "client.qoder.note": "Add a server in Qoder Settings → MCP and paste the snippet.",
  // 设置
  "作用于整个 LifeCycle，与具体服务无关": "Applies to all of LifeCycle, not a single service",
  外观: "Appearance",
  "主题立即生效，并持久化到 ~/.lifecycle/settings.json。":
    "Theme applies instantly and persists to ~/.lifecycle/settings.json.",
  "亮暗两套配色均针对长时间盯日志做了对比度调校。":
    "Both palettes are contrast-tuned for long log-reading sessions.",
  通知: "Notifications",
  "进程意外退出或编译失败时推送系统通知。": "System notifications on unexpected exit or build failure.",
  "崩溃 / 编译失败系统通知": "Crash / build-failure notifications",
  编辑器跳转: "Editor jump",
  "点击编译错误时用该命令打开文件，支持 {file} / {line} / {col} 占位。":
    "Command used to open a file when clicking a compile error; supports {file} / {line} / {col}.",
  日志与超时: "Logs & timeouts",
  "实际超时以 lifecycle.toml 中的配置为准，这里只是默认值。":
    "Effective timeouts come from lifecycle.toml; these are defaults.",
  日志缓冲行数: "Log buffer lines",
  "就绪超时 (ms)": "Ready timeout (ms)",
  "编译超时 (ms)": "Compile timeout (ms)",
  "设置持久化于 {a}；分组保存在 {b}。": "Settings persist to {a}; groups to {b}.",
  有未保存的更改: "Unsaved changes",
  已保存: "Saved",
  恢复默认: "Restore defaults",
  保存设置: "Save settings",
  设置已保存: "Settings saved",
  "界面语言立即生效，并随设置持久化。": "UI language applies instantly and persists with settings.",
  // 诊断
  "全局工具调用记录 · UI 与 MCP 共用 · 最近 200 条": "Global tool-call log · shared by UI & MCP · last 200",
  "更新于 {time}": "Updated {time}",
  实时刷新: "Live refresh",
  总调用: "Calls",
  成功率: "Success rate",
  平均耗时: "Avg duration",
  最慢一次: "Slowest",
  全部工具: "All tools",
  全部结果: "All results",
  "{a}/{b} 条": "{a}/{b} rows",
  清除筛选: "Clear filters",
  暂无调用记录: "No calls recorded",
  没有匹配的记录: "No matching records",
  "在界面上启停服务、执行编译，或通过 MCP 调用工具后，记录会实时出现在这里。":
    "Start/stop services, compile, or call tools via MCP — records appear here live.",
  "试试清除筛选条件。": "Try clearing the filters.",
  // 日志
  启动日志: "Run log",
  编译日志: "Build log",
  "查看服务启动/运行控制台输出（一键切换）": "Service startup / runtime console output",
  "查看构建与编译输出（一键切换）": "Build & compile output",
  全部级别: "All levels",
  "正则过滤…": "Regex filter…",
  "搜索…": "Search…",
  "上一个匹配 (Shift+Enter)": "Previous match (Shift+Enter)",
  "下一个匹配 (Enter)": "Next match (Enter)",
  "{n} 行": "{n} lines",
  颜色: "Color",
  "解析 ANSI 终端色与 Spring/Vite 风格语义高亮；子进程需重启后才会输出 ANSI（[logs].color）":
    "Parses ANSI terminal colors and Spring/Vite-style semantic highlighting; children emit ANSI after restart ([logs].color)",
  自动滚动: "Auto-scroll",
  清屏: "Clear",
  打开日志文件: "Open log file",
  "暂无日志。启动服务或执行编译后，输出会实时出现在这里。":
    "No logs yet. Start a service or compile and output streams here.",
  "⌘/Ctrl + 点击在编辑器中打开 {file}:{line}": "⌘/Ctrl + click to open {file}:{line} in editor",
  "⌘/Ctrl + 点击打开 {url}": "⌘/Ctrl + click to open {url}",
  // 状态卡 / 错误 / 配置
  "{ms}ms · {n} 错误": "{ms}ms · {n} errors",
  暂无编译结果: "No build result yet",
  "点击「快速编译 / 部分编译 / 完整编译」后，结构化错误会显示在这里，点击任意一条可直接跳到编辑器对应行列。":
    "Run Quick / Partial / Full compile; structured errors land here and click through to the exact editor line.",
  编译已取消: "Compile cancelled",
  编译成功: "Build succeeded",
  "{a} 错误 / {b} 警告": "{a} errors / {b} warnings",
  点击在编辑器中打开: "Click to open in editor",
  在编辑器中打开: "Open in editor",
  配置已复制: "Config copied",
  "启动命令在 {a}，编译命令在 {b}，MCP 白名单在 {c}；改完点上方「重载配置」即可生效，无需重启。":
    "Start commands live in {a}, compile commands in {b}, MCP whitelist in {c}. Click “Reload config” above to apply without restarting.",
  // App
  "无法连接后端：{msg}": "Cannot reach backend: {msg}",
  "请确认 LifeCycle 后端已启动（默认端口 39517），或运行 {cmd}。":
    "Make sure the LifeCycle backend is running (default port 39517), or run {cmd}.",
  "LifeCycle：进程崩溃": "LifeCycle: process crashed",
  "LifeCycle：编译失败": "LifeCycle: build failed",
  "{k} 意外退出": "{k} exited unexpectedly",
  "{k} 有 {n} 个错误": "{k} has {n} errors",
  "{k} 崩溃": "{k} crashed",
  "编译成功 · {ms}ms": "Build succeeded · {ms}ms",
  "编译失败 · {n} 错误": "Build failed · {n} errors",
  "{k} 已启动（就绪）": "{k} started (ready)",
  配置已重载: "Config reloaded",
  "跳过等待就绪，直接拉起": "Skip readiness wait and spawn immediately",
  运行: "Run",
  快速: "Fast",
  部分: "Partial",
  全量: "Full",
  停止服务: "Stop the service",
  重启服务: "Restart the service",
  启动服务并等待就绪检查: "Start and wait for the readiness check",
  增量快速编译: "Incremental quick compile",
  指定模块部分编译: "Compile selected modules only",
  全量完整编译: "Clean full compile",
  "重新读取 lifecycle.toml，无需重启": "Re-read lifecycle.toml without restarting",
  "后端服务在线（端口 39517）": "Backend online (port 39517)",
  后端服务离线: "Backend offline",
  "{running}/{total} 服务运行中": "{running}/{total} services running",
  "搜索项目或服务…": "Search projects or services…",
  折叠全部项目: "Collapse all projects",
  展开全部项目: "Expand all projects",
  "添加/导入项目（快捷键 n，可直接选择文件夹）": "Add/import project (shortcut n, folder picker available)",
  添加: "Add",
  "点击查看「{name}」的服务列表": "Click to view services of “{name}”",
  "{n} 运行": "{n} running",
  "{n} 服务": "{n} services",
  展开服务列表: "Expand services",
  折叠服务列表: "Collapse services",
  "进入 {key} 详情与日志": "Open {key} details and logs",
  没有匹配的项目或服务: "No matching projects or services",
  "暂无项目，点击右上角「+ 添加」注册工程": "No projects yet — use “+ Add” at the top right to register one",
  外观主题: "Appearance",
  全部服务列表: "All services",
  "项目切换:": "Project:",
  "全部 ({n})": "All ({n})",
  添加项目: "Add project",
  添加服务: "Add service",
  "在已注册项目下新增服务：配置启动命令与就绪检查即可，项目文件夹沿用外层已选项目。":
    "Add a service under a registered project: set the start command and readiness check — the project folder comes from the outer selection.",
  所属项目: "Project",
  项目根目录: "Project root",
  "暂无已注册项目，请先在侧边栏添加项目": "No registered projects yet — add one from the sidebar first",
  "服务名称（profile）": "Service name (profile)",
  "例如 dev / api / web": "e.g. dev / api / web",
  "就绪端口（可选）": "Ready port (optional)",
  启动命令: "Start command",
  "工作目录（相对项目根，可选）": "Workdir (relative to project root, optional)",
  "就绪检查（正则 / 超时）": "Readiness (pattern / timeout)",
  "就绪正则（可选）": "Ready pattern (optional)",
  "例如 Local:.*http": "e.g. Local:.*http",
  "就绪超时（毫秒，可选）": "Ready timeout (ms, optional)",
  "该项目下已存在同名服务「{name}」，请换一个名称":
    "A service named “{name}” already exists in this project — pick another name",
  "服务配置将写入项目 lifecycle.toml 的 [profiles.{name}]，保存后热加载并出现在服务列表。":
    "Written to [profiles.{name}] in the project's lifecycle.toml, hot-reloaded and listed right away.",
  "已添加服务「{key}」": "Service “{key}” added",
  "快捷键 n，在当前项目下配置新服务": "Shortcut n — configure a new service in the current project",
  未保存: "Unsaved",
  从配置文件同步: "Sync from config",
  "重新读取 lifecycle.toml 并覆盖表单（丢弃未保存编辑）": "Re-read lifecycle.toml and overwrite the form (discards unsaved edits)",
  已与配置文件同步: "Synced from config file",
  "配置文件在他处已变更；当前编辑保留，未被覆盖。": "The config file changed elsewhere; your edits are kept, not overwritten.",
  载入最新配置: "Load latest config",
  继续编辑: "Keep editing",
  "可选字段清空后保存即从 lifecycle.toml 删除对应配置；「从配置文件同步」可放弃编辑并载入磁盘最新值。":
    "Saving a cleared optional field removes it from lifecycle.toml; “Sync from config” discards edits and loads the latest on-disk values.",
  清空日志: "Clear logs",
  "仅清空当前显示，不删除日志数据": "Clears the display only; log data is kept",
  "删除磁盘日志文件与缓冲，不可恢复": "Delete on-disk log files and buffers; unrecoverable",
  "不同于「清屏」：这会真正删除日志数据。": "Unlike “clear screen”, this actually deletes log data.",
  "仅当前来源（{name}）": "Current source only ({name})",
  "全部来源（启动 + 编译）": "All sources (run + build)",
  "将清空所选来源的磁盘日志文件，历史输出不可恢复；运行中的服务会继续写入新日志。":
    "Truncates the on-disk log files for the selected scope. History cannot be recovered; running services keep appending new output.",
  "日志已清空（{scope}，释放 {kb} KB）": "Logs cleared ({scope}, freed {kb} KB)",
  全部来源: "all sources",
  编辑原文: "Edit raw",
  保存原文: "Save raw",
  "直接编辑 lifecycle.toml 全文": "Edit the full lifecycle.toml text",
  "校验通过后整份写盘并热加载（Ctrl/⌘+S）": "Validate, write the whole file and hot-reload (Ctrl/⌘+S)",
  配置原文已保存并热加载: "Raw config saved and hot-reloaded",
  "原文保存会整份替换 lifecycle.toml（注释需自行保留）；保存前自动校验，失败不写盘。":
    "Saving raw replaces lifecycle.toml wholesale (keep comments yourself); validated before write, nothing is written on failure.",
  "环境: {env}": "Environment: {env}",
  添加第一个项目: "Add your first project",
  添加第一个服务: "Add your first service",
  "添加 / 导入服务": "Add / import service",
  "选择或填入服务目录。没有 lifecycle.toml 时会自动探测工程类型（Node/Vite、Rust、Maven 等）并生成配置；已有配置则直接导入。":
    "Pick or type the service directory. Without lifecycle.toml we auto-detect the stack (Node/Vite, Rust, Maven…) and generate config; existing config is imported as-is.",
  "快捷键 n，可直接选择文件夹导入服务": "Shortcut n; pick a folder to import a service",
  "快捷键 n，可直接选择文件夹导入项目": "Shortcut n; pick a folder to import",
  点击直接查看该服务的编译日志: "Click to open this service's build log",
  启动服务: "Start service",
  快速增量编译: "Quick incremental compile",
  查看服务启动日志: "View service run log",
  调用记录: "Call log",
  "UI 与 MCP 的每次工具调用，含请求与响应": "Every UI & MCP tool call, with request and response",
  请求: "Request",
  响应: "Response",
  来源: "Source",
  界面: "Console",
  调用详情: "Call details",
  复制请求: "Copy request",
  复制响应: "Copy response",
  暂无调用: "No calls yet",
  全部来源: "All sources",
  收缩侧边栏: "Collapse sidebar",
  展开侧边栏: "Expand sidebar",
  "切换主题（亮 → 暗 → 跟随系统）": "Cycle theme (light → dark → system)",
  "tool.register_project": "Register/import a project: detect stack and generate lifecycle.toml",
  "tool.configure_service": "Rewrite a service's start command, ready port/pattern and compile commands",
  "tool.list_groups": "List service groups and members",
  "tool.create_group": "Create a service group",
  "tool.update_group": "Update a group's name or members",
  "tool.delete_group": "Delete a service group",
  "tool.start_group": "Start every service in a group",
  "tool.stop_group": "Stop every service in a group",
  "tool.restart_group": "Restart every service in a group",
  分组: "Groups",
};

function stored() {
  try {
    const v = localStorage.getItem(KEY);
    return LANGS.includes(v) ? v : "zh";
  } catch {
    return "zh";
  }
}

let lang = stored();
let state = { lang };
const listeners = new Set();

function emit() {
  state = { lang };
  for (const l of listeners) l();
}
function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

function translate(l, key, vars) {
  let s = l === "en" ? (EN[key] ?? key) : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/// 非组件场景（toast / 回调）用当前语言翻译。
export function t(key, vars) {
  return translate(lang, key, vars);
}

export function useI18n() {
  const s = useSyncExternalStore(subscribe, () => state);
  return {
    lang: s.lang,
    t: (key, vars) => translate(s.lang, key, vars),
    setLang,
  };
}

export function currentLang() {
  return lang;
}

export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // ignore
  }
  document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
  emit();
}

/// 启动时采纳后端持久化语言，不回写。
export function adoptLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // ignore
  }
  document.documentElement.lang = next === "zh" ? "zh-CN" : "en";
  emit();
}

export async function persistLang() {
  const settings = await api("/api/settings");
  await api("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ ...settings, language: lang }),
  });
}

export function initLang() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
}
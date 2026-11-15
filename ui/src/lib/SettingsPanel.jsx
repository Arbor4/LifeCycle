import { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import { pushToast } from "./toast.js";
import { adoptTheme, persistTheme, setTheme, useTheme } from "./theme.js";
import { persistLang, useI18n } from "./i18n.js";
import Icon from "./Icon.jsx";
import Switch from "./Switch.jsx";
import Segmented from "./Segmented.jsx";

const DEFAULTS = {
  editor_command: "code -g {file}:{line}",
  notifications: true,
  log_lines: 5000,
  ready_timeout_ms: 120000,
  compile_timeout_ms: 300000,
  theme: "system",
  language: "zh",
};

function Section({ icon, title, desc, children, tone = "blu" }) {
  return (
    <div className="panel p-4">
      <div className="flex items-start gap-3">
        <span
          className="flex h-8 w-8 flex-none items-center justify-center rounded-lg"
          style={{ background: `color-mix(in oklab, var(--${tone}) 14%, transparent)`, color: `var(--${tone})` }}
        >
          <Icon name={icon} size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          {desc && <p className="mt-0.5 text-xs leading-5 text-[var(--dim)]">{desc}</p>}
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPanel() {
  const { t, lang, setLang } = useI18n();
  const [settings, setSettings] = useState(null);
  const [saved, setSaved] = useState(null);
  const [saving, setSaving] = useState(false);
  const { mode } = useTheme();

  useEffect(() => {
    api("/api/settings")
      .then((s) => {
        setSettings(s);
        setSaved(s);
      })
      .catch((e) => pushToast(e.message, { kind: "error" }));
  }, []);

  const dirty = useMemo(() => JSON.stringify(settings) !== JSON.stringify(saved), [settings, saved]);

  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
      setSaved(settings);
      pushToast(t("设置已保存"), { kind: "success" });
    } catch (e) {
      pushToast(e.message, { kind: "error" });
    } finally {
      setSaving(false);
    }
  }

  function changeTheme(v) {
    setTheme(v);
    set("theme", v);
    persistTheme().catch(() => {});
  }

  function changeLang(v) {
    setLang(v);
    set("language", v);
    persistLang().catch(() => {});
  }

  if (!settings) {
    return <div className="flex h-full items-center justify-center bg-[var(--bg0)] text-[var(--dim)]">{t("加载中…")}</div>;
  }

  return (
    <div className="view flex h-full min-h-0 flex-col bg-[var(--bg0)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[var(--line)] bg-[var(--bg1)] px-4 py-3">
        <h1 className="flex items-center gap-2 text-base font-semibold">
          <Icon name="settings" size={16} className="text-[var(--amb)]" />
          {t("全局设置")}
        </h1>
        <span className="text-xs text-[var(--mut)]">{t("作用于整个 LifeCycle，与具体服务无关")}</span>
        <span className="flex-1" />
        <span className="chip mono cursor-default" title="settings.json">
          <Icon name="config" size={12} />
          ~/.lifecycle/settings.json
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-2xl space-y-3">
          <Section icon="sun" title={t("外观")} desc={t("主题立即生效，并持久化到 ~/.lifecycle/settings.json。")} tone="amb">
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                value={mode}
                onChange={changeTheme}
                options={[
                  { value: "light", label: t("亮色"), icon: "sun" },
                  { value: "dark", label: t("暗色"), icon: "moon" },
                  { value: "system", label: t("跟随系统"), icon: "monitor" },
                ]}
              />
              <span className="text-xs text-[var(--dim)]">{t("亮暗两套配色均针对长时间盯日志做了对比度调校。")}</span>
            </div>
          </Section>

          <Section icon="link" title={t("语言")} desc={t("界面语言立即生效，并随设置持久化。")} tone="cyn">
            <Segmented
              value={lang}
              onChange={changeLang}
              options={[
                { value: "zh", label: "中文", title: "简体中文" },
                { value: "en", label: "English", title: "English" },
              ]}
            />
          </Section>

          <Section icon="warn" title={t("通知")} desc={t("进程意外退出或编译失败时推送系统通知。")} tone="red">
            <label className="flex cursor-pointer items-center gap-3">
              <Switch checked={settings.notifications} onChange={(v) => set("notifications", v)} label={t("通知")} />
              <span className="text-sm">{t("崩溃 / 编译失败系统通知")}</span>
            </label>
          </Section>

          <Section icon="open" title={t("编辑器跳转")} desc={t("点击编译错误时用该命令打开文件，支持 {file} / {line} / {col} 占位。")} tone="blu">
            <input
              className="input mono w-full"
              value={settings.editor_command}
              onChange={(e) => set("editor_command", e.target.value)}
              placeholder="code -g {file}:{line}"
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[
                ["VS Code", "code -g {file}:{line}"],
                ["Cursor", "cursor -g {file}:{line}"],
                ["IntelliJ", "idea --line {line} {file}"],
                ["Vim", "vim +{line} {file}"],
              ].map(([label, cmd]) => (
                <button key={label} className="chip" onClick={() => set("editor_command", cmd)}>
                  {label}
                </button>
              ))}
            </div>
          </Section>

          <Section icon="logs" title={t("日志与超时")} desc={t("实际超时以 lifecycle.toml 中的配置为准，这里只是默认值。")} tone="cyn">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="field-label">{t("日志缓冲行数")}</span>
                <input
                  type="number"
                  className="input w-full"
                  min={100}
                  value={settings.log_lines}
                  onChange={(e) => set("log_lines", Number(e.target.value))}
                />
              </label>
              <label className="block">
                <span className="field-label">{t("就绪超时 (ms)")}</span>
                <input
                  type="number"
                  className="input w-full"
                  min={1000}
                  step={1000}
                  value={settings.ready_timeout_ms}
                  onChange={(e) => set("ready_timeout_ms", Number(e.target.value))}
                />
              </label>
              <label className="block">
                <span className="field-label">{t("编译超时 (ms)")}</span>
                <input
                  type="number"
                  className="input w-full"
                  min={1000}
                  step={1000}
                  value={settings.compile_timeout_ms}
                  onChange={(e) => set("compile_timeout_ms", Number(e.target.value))}
                />
              </label>
            </div>
          </Section>

          <p className="px-1 text-xs text-[var(--dim)]">
            {t("设置持久化于 {a}；分组保存在 {b}。", { a: "~/.lifecycle/settings.json", b: "~/.lifecycle/groups.json" })}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 border-t border-[var(--line)] bg-[var(--bg1)] px-4 py-2.5">
        {dirty ? (
          <>
            <span className="dot dot-starting" />
            <span className="text-sm">{t("有未保存的更改")}</span>
          </>
        ) : (
          <>
            <Icon name="check" size={14} className="text-[var(--grn)]" />
            <span className="text-sm text-[var(--mut)]">{t("已保存")}</span>
          </>
        )}
        <span className="flex-1" />
        <button
          className="btn btn-sm"
          onClick={() => {
            setSettings({ ...DEFAULTS, theme: mode, language: lang });
            setTheme(DEFAULTS.theme);
          }}
        >
          <Icon name="undo" size={12} />
          {t("恢复默认")}
        </button>
        <button className="btn btn-sm btn-primary" disabled={!dirty || saving} onClick={save}>
          {saving ? <span className="spinner" /> : <Icon name="save" size={12} />}
          {t("保存设置")}
        </button>
      </div>
    </div>
  );
}
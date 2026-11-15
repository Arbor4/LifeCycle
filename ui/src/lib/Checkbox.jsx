const TONES = {
  blu: "var(--blu)",
  grn: "var(--grn)",
  vio: "var(--vio)",
  amb: "var(--amb)",
  red: "var(--red)",
  cyn: "var(--cyn)",
};

export default function Checkbox({
  checked = false,
  indeterminate = false,
  disabled = false,
  size = "md",
  tone = "blu",
  label,
  title,
  className = "",
  onChange,
  children,
}) {
  const sizeClass = size === "sm" ? "cb-sm" : size === "lg" ? "cb-lg" : "";
  return (
    <label
      className={`cb ${sizeClass} ${className}`}
      style={{ "--c": TONES[tone] ?? TONES.blu }}
      title={title}
      data-disabled={disabled || undefined}
    >
      <span className="cb-wrap">
        <input
          className="cb-input"
          type="checkbox"
          checked={checked}
          disabled={disabled}
          ref={(el) => {
            if (el) el.indeterminate = indeterminate && !checked;
          }}
          aria-label={typeof label === "string" ? label : title}
          onChange={(e) => onChange?.(e.target.checked)}
        />
        <span className="cb-box">
          <svg className="cb-mark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 12.5l5 5L20 6.5" />
          </svg>
          <span className="cb-dash" />
        </span>
      </span>
      {(children || label) && <span className="cb-label">{children ?? label}</span>}
    </label>
  );
}
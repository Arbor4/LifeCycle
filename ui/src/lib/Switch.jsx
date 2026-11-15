const TONES = {
  grn: "var(--acc-grn)",
  blu: "var(--acc-blu)",
  vio: "var(--acc-vio)",
  amb: "var(--acc-amb)",
};

export default function Switch({ checked = false, disabled = false, tone = "grn", label, className = "", onChange }) {
  return (
    <label className={`sw ${className}`} style={{ "--c": TONES[tone] ?? TONES.grn }} title={label}>
      <input
        className="sw-input"
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span className="sw-knob" />
    </label>
  );
}
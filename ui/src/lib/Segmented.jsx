import Icon from "./Icon.jsx";

export default function Segmented({ options, value, onChange, className = "" }) {
  return (
    <div className={`seg ${className}`} role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className="seg-item"
          data-active={value === o.value}
          title={o.title ?? o.label}
          aria-pressed={value === o.value}
          onClick={() => value !== o.value && onChange?.(o.value)}
        >
          {o.icon && <Icon name={o.icon} size={13} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
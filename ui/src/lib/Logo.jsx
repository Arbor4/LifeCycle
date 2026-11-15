import { useId } from "react";

/// 与 docs/logo.svg / 应用图标同源的「循环 + 播放」标记。
export default function Logo({ size = 28, className = "" }) {
  const uid = useId().replace(/[:]/g, "");
  const a = `lg-a-${uid}`;
  const b = `lg-b-${uid}`;
  const c = `lg-c-${uid}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      className={className}
      role="img"
      aria-label="LifeCycle"
    >
      <defs>
        <linearGradient id={a} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1fb583" />
          <stop offset="1" stopColor="#2f7fe0" />
        </linearGradient>
        <linearGradient id={b} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#2f7fe0" />
          <stop offset="1" stopColor="#39c6e0" />
        </linearGradient>
        <linearGradient id={c} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#31d49f" />
          <stop offset="1" stopColor="#4da3ff" />
        </linearGradient>
      </defs>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="7.5">
        <path stroke={`url(#${a})`} d="M12 48a36 36 0 0 1 36-36 39 39 0 0 1 26.96 10.96L84 32" />
        <path stroke={`url(#${a})`} d="M84 12v20h-20" />
        <path stroke={`url(#${b})`} d="M84 48a36 36 0 0 1-36 36 39 39 0 0 1-26.96-10.96L12 64" />
        <path stroke={`url(#${b})`} d="M32 64H12v20" />
      </g>
      <path fill={`url(#${c})`} d="M40 33.5 63 48 40 62.5Z" />
    </svg>
  );
}
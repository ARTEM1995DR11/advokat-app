import type { CSSProperties } from "react";

export interface IconProps {
  className?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}

const base = (className?: string, style?: CSSProperties) => ({
  className,
  style,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export function Home({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5" />
    </svg>
  );
}

export function Tasks({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <rect x="4" y="3.5" width="16" height="17" rx="2.5" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

export function Cases({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

export function Calendar({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17M8 3.5v3.5M16 3.5v3.5" />
    </svg>
  );
}

export function More({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <circle cx="5" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="19" cy="12" r="1.4" />
    </svg>
  );
}

export function Bell({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10.5 20a1.8 1.8 0 0 0 3 0" />
    </svg>
  );
}

export function Search({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}

export function Plus({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ChevronRight({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function ChevronLeft({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

export function Check({ className, strokeWidth = 2.2, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <path d="m5 12.5 4.5 4.5L19 6.5" />
    </svg>
  );
}

export function Alert({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <path d="M12 3 2 20h20L12 3Z" />
      <path d="M12 10v4M12 17h.01" />
    </svg>
  );
}

export function Clock({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function Pin({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function Shield({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" />
    </svg>
  );
}

export function CheckShield({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <path d="M12 3 5 6v5c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" />
      <path d="m9 11.5 2 2 4-4" />
    </svg>
  );
}

export function Lock({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

export function Sparkle({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <path d="M12 3v18M3 12h18M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function Chart({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <path d="M4 20h16" />
      <path d="M7 20v-6M12 20V8M17 20v-9" />
    </svg>
  );
}

export function Cpu({ className, strokeWidth = 1.7, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3" />
    </svg>
  );
}

export function Scales({ className, strokeWidth = 1.6, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <path d="M12 3v18M7 21h10M12 6l7 2-7-2-7 2 7-2Z" />
      <path d="M5 8 2.5 14a2.5 2.5 0 0 0 5 0L5 8ZM19 8l-2.5 6a2.5 2.5 0 0 0 5 0L19 8Z" />
    </svg>
  );
}

export function Dots({ className, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={1.7}>
      <circle cx="5" cy="12" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="19" cy="12" r="1.3" />
    </svg>
  );
}

export function Sun({ className, strokeWidth = 1.8, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

export function Moon({ className, strokeWidth = 1.8, style }: IconProps) {
  return (
    <svg {...base(className, style)} strokeWidth={strokeWidth}>
      <path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z" />
    </svg>
  );
}

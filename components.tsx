import type { ReactNode } from "react";
import { cn } from "./utils/cn";
import { Home, Tasks, Cases, Calendar, More } from "./icons";

/* ---------------- Status Bar ---------------- */
export function StatusBar() {
  return (
    <div className="flex items-center justify-between px-6 pt-3 pb-1 text-[13px] font-semibold" style={{ color: "var(--text)" }}>
      <span>9:41</span>
      <div className="flex items-center gap-1.5">
        {/* signal */}
        <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor">
          <rect x="0" y="7" width="3" height="4" rx="1" />
          <rect x="4.5" y="5" width="3" height="6" rx="1" />
          <rect x="9" y="2.5" width="3" height="8.5" rx="1" />
          <rect x="13.5" y="0" width="3" height="11" rx="1" />
        </svg>
        {/* wifi */}
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor">
          <path d="M8 11.5 5.7 8.9a3.4 3.4 0 0 1 4.6 0L8 11.5Z" />
          <path d="M8 4.2c2 0 3.9.8 5.3 2.1l1.4-1.6A9.6 9.6 0 0 0 8 1.6 9.6 9.6 0 0 0 1.3 4.7l1.4 1.6A7.6 7.6 0 0 1 8 4.2Z" opacity="0.9" />
        </svg>
        {/* battery */}
        <svg width="26" height="12" viewBox="0 0 26 12" fill="none">
          <rect x="0.5" y="0.5" width="22" height="11" rx="3" stroke="currentColor" opacity="0.5" />
          <rect x="2" y="2" width="18" height="8" rx="1.8" fill="currentColor" />
          <rect x="24" y="4" width="1.5" height="4" rx="0.75" fill="currentColor" opacity="0.6" />
        </svg>
      </div>
    </div>
  );
}

/* ---------------- Screen header ---------------- */
export function ScreenHeader({
  title,
  subtitle,
  right,
  left,
  center,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  left?: ReactNode;
  center?: boolean;
}) {
  return (
    <div className="flex items-center justify-between px-5 pt-2 pb-3">
      {left ? <div className="w-9">{left}</div> : center ? <div className="w-9" /> : null}
      <div className={cn(center && "flex-1 text-center")}>
        <h1
          className={cn("font-semibold tracking-tight", center ? "text-[19px]" : "text-[27px]")}
          style={{ color: "var(--text-strong)" }}
        >
          {title}
        </h1>
        {subtitle && (
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--muted)" }}>
            {subtitle}
          </p>
        )}
      </div>
      {right ? <div className="flex items-center gap-3">{right}</div> : center ? <div className="w-9" /> : null}
    </div>
  );
}

/* ---------------- Card ---------------- */
export function Card({
  children,
  className,
  onClick,
  tone,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  tone?: "default" | "danger";
}) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-2xl border transition-colors",
        onClick && "cursor-pointer active:scale-[0.99]",
        className
      )}
      style={{
        background: tone === "danger" ? "var(--red-bg)" : "var(--card)",
        borderColor: tone === "danger" ? "rgba(226,96,96,0.25)" : "var(--border)",
      }}
    >
      {children}
    </div>
  );
}

/* ---------------- Section title ---------------- */
export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="px-1 pt-4 pb-2 text-[15px] font-semibold" style={{ color: "var(--text-strong)" }}>
      {children}
    </h2>
  );
}

/* ---------------- Status badge ---------------- */
export function Badge({ tone, children }: { tone: "active" | "prep" | "archive"; children: ReactNode }) {
  const map = {
    active: { bg: "rgba(106,155,222,0.15)", color: "var(--blue)" },
    prep: { bg: "rgba(201,162,74,0.16)", color: "var(--gold-2)" },
    archive: { bg: "var(--chip)", color: "var(--muted)" },
  }[tone];
  return (
    <span
      className="rounded-full px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap"
      style={{ background: map.bg, color: map.color }}
    >
      {children}
    </span>
  );
}

/* ---------------- Bottom Nav ---------------- */
const navItems = [
  { id: "today", label: "Сегодня", icon: Home },
  { id: "tasks", label: "Задачи", icon: Tasks },
  { id: "cases", label: "Дела", icon: Cases },
  { id: "calendar", label: "Календарь", icon: Calendar },
  { id: "more", label: "Ещё", icon: More },
] as const;

export function BottomNav({
  active,
  onChange,
}: {
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      className="absolute inset-x-0 bottom-0 z-20 border-t px-2 pt-2 pb-6 backdrop-blur-xl"
      style={{
        background: "color-mix(in srgb, var(--phone-bg) 82%, transparent)",
        borderColor: "var(--border-soft)",
      }}
    >
      <div className="flex items-end justify-around">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className="flex flex-1 flex-col items-center gap-1 py-1"
              style={{ color: isActive ? "var(--gold-2)" : "var(--muted)" }}
            >
              <Icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2 : 1.7} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* helper to color active nav icon */
export function NavIconColor({ active }: { active: boolean }) {
  return active ? "var(--gold-2)" : "var(--muted)";
}

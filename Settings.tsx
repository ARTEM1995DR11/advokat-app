import { Card, ScreenHeader } from "../components";
import { ChevronRight, Bell, Clock, Tasks, Sparkle, Shield, Lock, CheckShield, Cpu, Chart, Sun, Moon } from "../icons";
import type { ThemeMode } from "../theme";
import type { ComponentType } from "react";
import type { IconProps } from "../icons";

type Icon = ComponentType<IconProps>;

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative h-6.5 w-11 rounded-full transition-colors"
      style={{
        width: 44,
        height: 26,
        background: on ? "linear-gradient(135deg,var(--gold-2),var(--gold-deep))" : "var(--muted-2)",
      }}
    >
      <span
        className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all"
        style={{ left: on ? 21 : 3 }}
      />
    </button>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  toggle,
  on,
  onToggle,
  last,
}: {
  icon: Icon;
  label: string;
  value?: string;
  toggle?: boolean;
  on?: boolean;
  onToggle?: () => void;
  last?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-3 px-3.5 py-3"
      style={{ borderBottom: last ? "none" : "1px solid var(--border-soft)" }}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: "var(--chip)" }}
      >
        <Icon className="h-4.5 w-4.5" style={{ color: "var(--gold-2)", width: 18, height: 18 }} />
      </div>
      <span className="flex-1 text-[14px] font-medium" style={{ color: "var(--text-strong)" }}>
        {label}
      </span>
      {toggle ? (
        <Toggle on={!!on} onClick={onToggle!} />
      ) : (
        <div className="flex items-center gap-1.5">
          {value && (
            <span className="text-[13px]" style={{ color: "var(--muted)" }}>
              {value}
            </span>
          )}
          <ChevronRight className="h-4 w-4" style={{ color: "var(--muted-2)" }} />
        </div>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <h2 className="px-1 pb-2 text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        {title}
      </h2>
      <Card>{children}</Card>
    </div>
  );
}

export default function Settings({
  theme,
  onToggleTheme,
}: {
  theme: ThemeMode;
  onToggleTheme: () => void;
}) {
  return (
    <div className="px-4 pb-4">
      <ScreenHeader title="Настройки" />

      <Group title="Оформление">
        <div className="flex items-center gap-3 px-3.5 py-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--chip)" }}>
            {theme === "dark" ? (
              <Moon className="h-4.5 w-4.5" style={{ color: "var(--gold-2)", width: 18, height: 18 }} />
            ) : (
              <Sun className="h-4.5 w-4.5" style={{ color: "var(--gold-2)", width: 18, height: 18 }} />
            )}
          </div>
          <div className="flex-1">
            <p className="text-[14px] font-medium" style={{ color: "var(--text-strong)" }}>
              Тема оформления
            </p>
            <p className="text-[12px]" style={{ color: "var(--muted)" }}>
              {theme === "dark" ? "Тёмная" : "Светлая"}
            </p>
          </div>
          {/* segmented */}
          <div className="flex rounded-full p-0.5" style={{ background: "var(--chip)" }}>
            <button
              onClick={() => theme !== "light" && onToggleTheme()}
              className="flex h-7 w-9 items-center justify-center rounded-full"
              style={{
                background: theme === "light" ? "linear-gradient(135deg,var(--gold-2),var(--gold-deep))" : "transparent",
                color: theme === "light" ? "#1a1405" : "var(--muted)",
              }}
            >
              <Sun className="h-4 w-4" />
            </button>
            <button
              onClick={() => theme !== "dark" && onToggleTheme()}
              className="flex h-7 w-9 items-center justify-center rounded-full"
              style={{
                background: theme === "dark" ? "linear-gradient(135deg,var(--gold-2),var(--gold-deep))" : "transparent",
                color: theme === "dark" ? "#1a1405" : "var(--muted)",
              }}
            >
              <Moon className="h-4 w-4" />
            </button>
          </div>
        </div>
      </Group>

      <Group title="Уведомления и напоминания">
        <Row icon={Bell} label="Уведомления" value="Включены" />
        <Row icon={Clock} label="Напоминания о заседаниях" value="За 1 день" />
        <Row icon={Tasks} label="Напоминания о задачах" value="За 2 часа" />
        <Row icon={Sparkle} label="Проверить звук и уведомление" last />
      </Group>

      <SecuritySection />

      <Group title="Данные и резервное копирование">
        <Row icon={CheckShield} label="Резервное копирование" value="Включено" />
        <Row icon={Chart} label="Восстановление данных" last />
      </Group>

      <Group title="О приложении">
        <Row icon={Sparkle} label="Справка и поддержка" />
        <Row icon={Cpu} label="Оценить приложение" />
        <Row icon={Shield} label="Версия" value="2.1.0" last />
      </Group>

      <p className="mt-6 text-center text-[12px]" style={{ color: "var(--muted-2)" }}>
        Ежедневник адвоката · 2.1.0
      </p>
    </div>
  );
}

import { useState } from "react";
function SecuritySection() {
  const [faceId, setFaceId] = useState(true);
  return (
    <Group title="Безопасность">
      <Row icon={Lock} label="Защита приложения" value="PIN-код" />
      <Row icon={Lock} label="Сменить PIN-код" />
      <Row icon={Shield} label="Разблокировка по Face ID" toggle on={faceId} onToggle={() => setFaceId((v) => !v)} />
      <Row icon={Clock} label="Автоблокировка" value="5 минут" last />
    </Group>
  );
}

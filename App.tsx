import { useState, useMemo } from "react";
import { themes, type ThemeMode } from "./theme";
import { tasks as initialTasks, features, type CaseItem } from "./data";
import {
  Scales,
  Sun,
  Moon,
  Shield,
  Sparkle,
  Lock,
  Chart,
  Cpu,
  CheckShield,
} from "./icons";
import PhoneFrame from "./screens/PhoneFrame";
import Today from "./screens/Today";
import TasksScreen from "./screens/TasksScreen";
import CasesScreen from "./screens/CasesScreen";
import CalendarScreen from "./screens/CalendarScreen";
import CaseCard from "./screens/CaseCard";
import Settings from "./screens/Settings";

const featureIcons: Record<string, typeof Shield> = {
  shield: Shield,
  sparkle: Sparkle,
  lock: Lock,
  chart: Chart,
  cpu: Cpu,
  "check-shield": CheckShield,
};

export default function App() {
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [tab, setTab] = useState("today");
  const [openCase, setOpenCase] = useState<CaseItem | null>(null);
  const [tasks, setTasks] = useState(initialTasks);

  const toggleTask = (id: string) =>
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));

  const themeVars = useMemo(() => themes[theme] as React.CSSProperties, [theme]);

  const handleTab = (id: string) => {
    setOpenCase(null);
    setTab(id);
  };

  const renderScreen = () => {
    if (openCase) return <CaseCard item={openCase} onBack={() => setOpenCase(null)} />;
    switch (tab) {
      case "today":
        return <Today tasks={tasks} onToggleTask={toggleTask} />;
      case "tasks":
        return <TasksScreen tasks={tasks} onToggleTask={toggleTask} />;
      case "cases":
        return <CasesScreen onOpenCase={(c) => setOpenCase(c)} />;
      case "calendar":
        return <CalendarScreen />;
      case "more":
        return <Settings theme={theme} onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} />;
      default:
        return <Today tasks={tasks} onToggleTask={toggleTask} />;
    }
  };

  return (
    <div
      className="min-h-screen w-full"
      style={{
        ...themeVars,
        background: "radial-gradient(120% 90% at 50% -10%, var(--app-bg-2), var(--app-bg) 60%)",
        color: "var(--text)",
      }}
    >
      {/* Top bar */}
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 pt-6">
        <div className="flex items-center gap-2">
          <Scales className="h-6 w-6" style={{ color: "var(--gold-2)" }} />
          <span className="text-[15px] font-semibold tracking-wide" style={{ color: "var(--text-strong)" }}>
            LEX
          </span>
        </div>
        <button
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          className="flex items-center gap-2 rounded-full border px-3.5 py-2 text-[13px] font-medium transition-colors"
          style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--text)" }}
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {theme === "dark" ? "Светлая тема" : "Тёмная тема"}
        </button>
      </div>

      {/* Hero */}
      <div className="px-5 pt-8 text-center">
        <div className="flex items-center justify-center gap-4">
          <Scales className="h-11 w-11" style={{ color: "var(--gold-2)" }} />
          <h1
            className="text-4xl font-semibold tracking-tight sm:text-5xl"
            style={{ color: "var(--text-strong)" }}
          >
            Ежедневник адвоката
          </h1>
        </div>
        <p className="mt-3 text-[15px]" style={{ color: "var(--muted)" }}>
          Технологичность. Статус. Контроль над делами.
        </p>
      </div>

      {/* Phone */}
      <div className="flex justify-center px-5 pt-10 pb-6">
        <PhoneFrame activeTab={tab} onTabChange={handleTab}>
          {renderScreen()}
        </PhoneFrame>
      </div>

      {/* Features */}
      <div className="mx-auto max-w-5xl px-5 pb-16 pt-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => {
            const Icon = featureIcons[f.icon];
            return (
              <div
                key={f.title}
                className="flex gap-3.5 rounded-2xl border p-4"
                style={{ background: "var(--card)", borderColor: "var(--border)" }}
              >
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: "var(--chip)" }}
                >
                  <Icon className="h-5 w-5" style={{ color: "var(--gold-2)" }} />
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold" style={{ color: "var(--text-strong)" }}>
                    {f.title}
                  </h3>
                  <p className="mt-0.5 text-[13px] leading-snug" style={{ color: "var(--muted)" }}>
                    {f.text}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

import { Card, ScreenHeader, SectionTitle } from "../components";
import { Alert, Check, ChevronRight, Plus } from "../icons";
import { overdueDeadlines, type TaskItem } from "../data";
import { useState } from "react";

function FilterChip({
  label,
  count,
  active,
  onClick,
  countTone,
}: {
  label: string;
  count: number;
  active?: boolean;
  onClick?: () => void;
  countTone?: "red";
}) {
  return (
    <button
      onClick={onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-medium"
      style={{
        background: active ? "var(--chip-active)" : "var(--chip)",
        color: active ? "var(--gold-2)" : "var(--muted)",
        border: active ? "1px solid var(--border)" : "1px solid transparent",
      }}
    >
      {label}
      <span
        className="rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none"
        style={{
          background: countTone === "red" ? "var(--red-bg)" : "rgba(255,255,255,0.08)",
          color: countTone === "red" ? "var(--red)" : "inherit",
        }}
      >
        {count}
      </span>
    </button>
  );
}

export default function TasksScreen({
  tasks,
  onToggleTask,
}: {
  tasks: TaskItem[];
  onToggleTask: (id: string) => void;
}) {
  const [filter, setFilter] = useState("all");
  const todayTasks = tasks.filter((t) => t.group === "today");
  const upcoming = tasks.filter((t) => t.group === "upcoming");

  return (
    <div className="relative px-4 pb-4">
      <ScreenHeader title="Задачи" />

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <FilterChip label="Все" count={12} active={filter === "all"} onClick={() => setFilter("all")} />
        <FilterChip label="Срочные" count={2} active={filter === "urgent"} onClick={() => setFilter("urgent")} countTone="red" />
        <FilterChip label="Просроченные" count={2} active={filter === "overdue"} onClick={() => setFilter("overdue")} countTone="red" />
        <FilterChip label="На сегодня" count={5} active={filter === "today"} onClick={() => setFilter("today")} />
      </div>

      {/* Overdue deadlines */}
      <SectionTitle>Просроченные сроки</SectionTitle>
      <div className="space-y-2.5">
        {overdueDeadlines.map((d) => (
          <Card key={d.id} tone="danger" onClick={() => {}}>
            <div className="flex items-center gap-3 p-3.5">
              <Alert className="h-5 w-5 shrink-0" style={{ color: "var(--red)" }} />
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold" style={{ color: "var(--text-strong)" }}>
                  {d.title}
                </p>
                <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                  {d.caseNo}
                </p>
                <p className="mt-0.5 text-[12px] font-medium" style={{ color: "var(--red)" }}>
                  {d.status}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0" style={{ color: "var(--muted-2)" }} />
            </div>
          </Card>
        ))}
      </div>

      {/* Today tasks */}
      <SectionTitle>Задачи на сегодня</SectionTitle>
      <Card>
        <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
          {todayTasks.map((t) => (
            <div key={t.id} className="flex items-center gap-3 p-3.5">
              <button
                onClick={() => onToggleTask(t.id)}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                style={{
                  background: t.done ? "var(--gold)" : "transparent",
                  borderColor: t.done ? "var(--gold)" : "var(--muted-2)",
                  color: "#1a1405",
                }}
              >
                {t.done && <Check className="h-3.5 w-3.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium" style={{ color: "var(--text-strong)" }}>
                  {t.title}
                </p>
                <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                  {t.sub}
                </p>
              </div>
              <span className="text-[13px] font-medium" style={{ color: "var(--muted)" }}>
                {t.time}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* Upcoming tasks */}
      <SectionTitle>Предстоящие задачи</SectionTitle>
      <Card>
        <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
          {upcoming.map((t) => (
            <div key={t.id} className="flex items-center gap-3 p-3.5">
              <button
                onClick={() => onToggleTask(t.id)}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
                style={{
                  background: t.done ? "var(--gold)" : "transparent",
                  borderColor: t.done ? "var(--gold)" : "var(--muted-2)",
                  color: "#1a1405",
                }}
              >
                {t.done && <Check className="h-3.5 w-3.5" />}
              </button>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium" style={{ color: "var(--text-strong)" }}>
                  {t.title}
                </p>
                <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                  {t.sub}
                </p>
              </div>
              <span className="text-[13px] font-medium" style={{ color: "var(--muted)" }}>
                {t.time}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {/* FAB */}
      <button
        className="absolute bottom-2 right-5 flex h-13 w-13 items-center justify-center rounded-full shadow-lg"
        style={{
          background: "linear-gradient(135deg,var(--gold-2),var(--gold-deep))",
          color: "#1a1405",
          width: "52px",
          height: "52px",
          boxShadow: "0 8px 24px -6px rgba(201,162,74,0.6)",
        }}
      >
        <Plus className="h-6 w-6" strokeWidth={2.2} />
      </button>
    </div>
  );
}

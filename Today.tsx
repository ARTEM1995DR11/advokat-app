import { Card, ScreenHeader, SectionTitle } from "../components";
import { Bell, Alert, Check, ChevronRight } from "../icons";
import { overdueDeadlines, todayHearings, upcomingHearings, type TaskItem } from "../data";

function Stat({ label, value, active }: { label: string; value: number; active?: boolean }) {
  return (
    <div
      className="flex flex-1 flex-col items-center rounded-2xl border py-2.5"
      style={{
        background: active ? "var(--red-bg)" : "var(--card)",
        borderColor: active ? "rgba(226,96,96,0.3)" : "var(--border)",
      }}
    >
      <span
        className="text-[10.5px] font-medium"
        style={{ color: active ? "var(--red)" : "var(--muted)" }}
      >
        {label}
      </span>
      <span
        className="mt-1 text-[22px] font-semibold leading-none"
        style={{ color: active ? "var(--red)" : "var(--text-strong)" }}
      >
        {value}
      </span>
    </div>
  );
}

export default function Today({
  tasks,
  onToggleTask,
}: {
  tasks: TaskItem[];
  onToggleTask: (id: string) => void;
}) {
  const todayTasks = tasks.filter((t) => t.group === "today").slice(0, 2);
  return (
    <div className="px-4 pb-4">
      <ScreenHeader
        title="Сегодня"
        subtitle="20 мая, понедельник"
        right={<Bell className="h-6 w-6" style={{ color: "var(--gold-2)" }} />}
      />

      {/* Stats */}
      <div className="flex gap-2.5">
        <Stat label="Просрочено" value={2} active />
        <Stat label="Заседания" value={3} />
        <Stat label="Задачи" value={5} />
        <Stat label="Ближайшие" value={4} />
      </div>

      {/* Overdue */}
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

      {/* Hearings */}
      <SectionTitle>Заседания сегодня</SectionTitle>
      <Card>
        <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
          {todayHearings.map((h) => (
            <div key={h.id} className="flex items-stretch gap-3 p-3.5">
              <div className="w-1 rounded-full" style={{ background: "var(--blue)" }} />
              <div className="w-12 shrink-0">
                <span className="text-[14px] font-semibold" style={{ color: "var(--text-strong)" }}>
                  {h.time}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold" style={{ color: "var(--text-strong)" }}>
                  {h.caseNo}
                </p>
                <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                  {h.place}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 self-center" style={{ color: "var(--muted-2)" }} />
            </div>
          ))}
        </div>
      </Card>

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

      {/* Upcoming hearings */}
      <SectionTitle>Ближайшие заседания</SectionTitle>
      <Card>
        <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
          {upcomingHearings.map((u) => (
            <div key={u.id} className="flex items-center gap-3 p-3.5">
              <span className="w-20 shrink-0 text-[12px] font-medium" style={{ color: "var(--muted)" }}>
                {u.date}
              </span>
              <span className="w-11 shrink-0 text-[13px] font-semibold" style={{ color: "var(--gold-2)" }}>
                {u.time}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold" style={{ color: "var(--text-strong)" }}>
                  {u.caseNo}
                </p>
                <p className="text-[11.5px] truncate" style={{ color: "var(--muted)" }}>
                  {u.place}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

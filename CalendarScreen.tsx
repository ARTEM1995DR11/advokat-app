import { Card, ScreenHeader } from "../components";
import { ChevronLeft, ChevronRight } from "../icons";
import { calMonday, calTuesday, type CalDay } from "../data";
import { useState } from "react";

const weekDays = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const grid = [
  [29, 30, 1, 2, 3, 4, 5],
  [6, 7, 8, 9, 10, 11, 12],
  [13, 14, 15, 16, 17, 18, 19],
  [20, 21, 22, 23, 24, 25, 26],
  [27, 28, 29, 30, 31, 1, 2],
];
// days belonging to other months (dimmed)
const outside = new Set(["0-0", "0-1", "4-5", "4-6"]);
const eventDays = new Set([20, 21, 22, 23]);

function DaySchedule({ day, weekday, items }: { day: string; weekday: string; items: CalDay[] }) {
  return (
    <div className="mt-4">
      <h3 className="px-1 pb-2 text-[14px] font-semibold" style={{ color: "var(--text-strong)" }}>
        {weekday}, {day}
      </h3>
      <Card>
        <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
          {items.map((it, i) => (
            <div key={i} className="flex items-stretch gap-3 p-3.5">
              <div className="w-1 rounded-full" style={{ background: "var(--blue)" }} />
              <span className="w-12 shrink-0 text-[14px] font-semibold" style={{ color: "var(--text-strong)" }}>
                {it.time}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold" style={{ color: "var(--text-strong)" }}>
                  {it.caseNo}
                </p>
                <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                  {it.place}
                </p>
                {it.type && (
                  <p className="text-[11.5px]" style={{ color: "var(--gold-2)" }}>
                    {it.type}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export default function CalendarScreen() {
  const [selected, setSelected] = useState(20);
  return (
    <div className="px-4 pb-4">
      <ScreenHeader title="Календарь" />

      <Card>
        <div className="p-3.5">
          {/* Month nav */}
          <div className="flex items-center justify-between px-1">
            <button className="p-1">
              <ChevronLeft className="h-5 w-5" style={{ color: "var(--gold-2)" }} />
            </button>
            <span className="text-[15px] font-semibold" style={{ color: "var(--text-strong)" }}>
              Май 2024
            </span>
            <button className="p-1">
              <ChevronRight className="h-5 w-5" style={{ color: "var(--gold-2)" }} />
            </button>
          </div>

          {/* Weekday header */}
          <div className="mt-3 grid grid-cols-7 gap-1">
            {weekDays.map((w) => (
              <div key={w} className="text-center text-[11px] font-medium" style={{ color: "var(--muted-2)" }}>
                {w}
              </div>
            ))}
          </div>

          {/* Days */}
          <div className="mt-1.5 grid grid-cols-7 gap-1">
            {grid.map((row, r) =>
              row.map((d, c) => {
                const key = `${r}-${c}`;
                const isOutside = outside.has(key);
                const isSelected = d === selected && !isOutside;
                const hasEvent = eventDays.has(d) && !isOutside;
                return (
                  <button
                    key={key}
                    onClick={() => !isOutside && setSelected(d)}
                    className="relative flex aspect-square items-center justify-center rounded-full text-[13px] font-medium"
                    style={{
                      background: isSelected ? "linear-gradient(135deg,var(--gold-2),var(--gold-deep))" : "transparent",
                      color: isSelected
                        ? "#1a1405"
                        : isOutside
                          ? "var(--muted-2)"
                          : "var(--text)",
                      fontWeight: isSelected ? 700 : 500,
                    }}
                  >
                    {d}
                    {hasEvent && !isSelected && (
                      <span
                        className="absolute bottom-1 h-1 w-1 rounded-full"
                        style={{ background: "var(--gold-2)" }}
                      />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      </Card>

      <DaySchedule day="20 мая" weekday="Понедельник" items={calMonday} />
      <DaySchedule day="21 мая" weekday="Вторник" items={calTuesday} />
    </div>
  );
}

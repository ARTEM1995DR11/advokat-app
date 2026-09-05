import { Card, Badge } from "../components";
import { ChevronLeft, Dots, Calendar, Clock, Pin } from "../icons";
import type { CaseItem } from "../data";

const details = [
  ["Категория дела", "Взыскание задолженности"],
  ["Сумма иска", "2 450 000 ₽"],
  ["Статья", "ст. 395 ГК РФ"],
  ["Стадия", "Судебное разбирательство"],
  ["Судья", "Соколова А.В."],
  ["Истец", "ООО «СтройИнвест»"],
  ["Ответчик", "ООО «Монолит»"],
];

const timeline = [
  { date: "15.05.2024", title: "Подано ходатайство", sub: "о приобщении документов", active: true },
  { date: "10.05.2024", title: "Ответ на отзыв", sub: "", active: false },
  { date: "01.05.2024", title: "Отзыв на иск", sub: "", active: false },
];

export default function CaseCard({ item, onBack }: { item: CaseItem; onBack: () => void }) {
  return (
    <div className="px-4 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pt-2 pb-3">
        <button onClick={onBack} className="flex h-9 w-9 items-center justify-center">
          <ChevronLeft className="h-6 w-6" style={{ color: "var(--gold-2)" }} />
        </button>
        <h1 className="text-[19px] font-semibold" style={{ color: "var(--text-strong)" }}>
          Карточка дела
        </h1>
        <button className="flex h-9 w-9 items-center justify-center">
          <Dots className="h-6 w-6" style={{ color: "var(--gold-2)" }} />
        </button>
      </div>

      {/* Case header */}
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="text-[22px] font-semibold tracking-tight" style={{ color: "var(--text-strong)" }}>
          {item.caseNo}
        </span>
        <Badge tone={item.statusTone}>{item.status}</Badge>
      </div>
      <p className="mt-1 px-1 text-[14px] font-medium" style={{ color: "var(--text)" }}>
        {item.client}
      </p>
      <p className="px-1 text-[12.5px]" style={{ color: "var(--muted)" }}>
        {item.court}
      </p>

      {/* Next hearing */}
      <Card className="mt-3">
        <div className="p-3.5">
          <p className="text-[13px] font-semibold" style={{ color: "var(--gold-2)" }}>
            Следующее заседание
          </p>
          <div className="mt-2.5 flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <Calendar className="h-4 w-4" style={{ color: "var(--muted)" }} />
              <span className="text-[13px]" style={{ color: "var(--text)" }}>20 мая</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock className="h-4 w-4" style={{ color: "var(--muted)" }} />
              <span className="text-[13px]" style={{ color: "var(--text)" }}>10:30</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Pin className="h-4 w-4" style={{ color: "var(--muted)" }} />
              <span className="text-[13px]" style={{ color: "var(--text)" }}>Зал 3</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Details */}
      <Card className="mt-3">
        <div className="divide-y" style={{ borderColor: "var(--border-soft)" }}>
          {details.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
              <span className="text-[13px]" style={{ color: "var(--muted)" }}>{k}</span>
              <span className="text-right text-[13px] font-medium" style={{ color: "var(--text-strong)" }}>{v}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Timeline */}
      <Card className="mt-3">
        <div className="p-3.5">
          <p className="pb-1 text-[13px] font-semibold" style={{ color: "var(--gold-2)" }}>
            Недавние действия
          </p>
          <div className="mt-2">
            {timeline.map((t, i) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className="mt-1 h-2.5 w-2.5 rounded-full"
                    style={{ background: t.active ? "var(--gold-2)" : "var(--muted-2)" }}
                  />
                  {i < timeline.length - 1 && (
                    <span className="w-px flex-1" style={{ background: "var(--border-soft)" }} />
                  )}
                </div>
                <div className="pb-3.5">
                  <p className="text-[11.5px]" style={{ color: "var(--muted)" }}>{t.date}</p>
                  <p className="text-[13.5px] font-medium" style={{ color: "var(--text-strong)" }}>{t.title}</p>
                  {t.sub && (
                    <p className="text-[12px]" style={{ color: "var(--muted)" }}>{t.sub}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Actions */}
      <button
        className="mt-4 w-full rounded-2xl py-3.5 text-[15px] font-semibold"
        style={{ background: "linear-gradient(135deg,var(--gold-2),var(--gold-deep))", color: "#1a1405" }}
      >
        Заседание завершено
      </button>
      <button
        className="mt-2.5 w-full rounded-2xl border py-3.5 text-[15px] font-semibold"
        style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--card)" }}
      >
        Действия по делу
      </button>
    </div>
  );
}

import { Card, ScreenHeader, Badge } from "../components";
import { Search, Plus, ChevronRight } from "../icons";
import { cases, type CaseItem } from "../data";
import { useState } from "react";

function Tab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 rounded-xl py-2 text-[13.5px] font-medium transition-colors"
      style={{
        background: active ? "var(--card)" : "transparent",
        color: active ? "var(--text-strong)" : "var(--muted)",
        boxShadow: active ? "0 1px 6px rgba(0,0,0,0.25)" : "none",
      }}
    >
      {label}
    </button>
  );
}

function Chip({ label, count, active, onClick }: { label: string; count?: number; active?: boolean; onClick?: () => void }) {
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
      {count !== undefined && (
        <span className="text-[11px] font-semibold" style={{ opacity: 0.85 }}>
          {count}
        </span>
      )}
    </button>
  );
}

export default function CasesScreen({ onOpenCase }: { onOpenCase: (c: CaseItem) => void }) {
  const [tab, setTab] = useState("cases");
  const [chip, setChip] = useState("all");

  return (
    <div className="px-4 pb-4">
      <ScreenHeader
        title="Дела"
        right={
          <>
            <Search className="h-6 w-6" style={{ color: "var(--gold-2)" }} />
            <Plus className="h-6 w-6" style={{ color: "var(--gold-2)" }} strokeWidth={2} />
          </>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 rounded-2xl p-1" style={{ background: "var(--chip)" }}>
        <Tab label="Дела" active={tab === "cases"} onClick={() => setTab("cases")} />
        <Tab label="Доверители" active={tab === "clients"} onClick={() => setTab("clients")} />
      </div>

      {/* Search */}
      <div
        className="mt-3 flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        <Search className="h-4.5 w-4.5" style={{ color: "var(--muted)", width: 18, height: 18 }} />
        <span className="text-[13.5px]" style={{ color: "var(--muted)" }}>
          Поиск по делам
        </span>
      </div>

      {/* Chips */}
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Chip label="Все" count={18} active={chip === "all"} onClick={() => setChip("all")} />
        <Chip label="В производстве" count={10} active={chip === "active"} onClick={() => setChip("active")} />
        <Chip label="Архив" count={8} active={chip === "archive"} onClick={() => setChip("archive")} />
      </div>

      {/* Cases list */}
      <div className="mt-3 space-y-2.5">
        {cases.map((c) => (
          <Card key={c.id} onClick={() => onOpenCase(c)}>
            <div className="p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold" style={{ color: "var(--text-strong)" }}>
                  {c.caseNo}
                </span>
                <Badge tone={c.statusTone}>{c.status}</Badge>
              </div>
              <p className="mt-1.5 text-[13px] font-medium" style={{ color: "var(--text)" }}>
                {c.client}
              </p>
              <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                {c.court}
              </p>
              <p className="text-[12px]" style={{ color: "var(--muted)" }}>
                {c.subject}
              </p>
              <p className="mt-1 text-[12px] font-medium" style={{ color: "var(--gold-2)" }}>
                {c.claim}
              </p>
              <div
                className="mt-2 flex items-center justify-between border-t pt-2"
                style={{ borderColor: "var(--border-soft)" }}
              >
                <span className="text-[11.5px]" style={{ color: "var(--muted)" }}>
                  {c.next}
                </span>
                <ChevronRight className="h-4 w-4" style={{ color: "var(--muted-2)" }} />
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

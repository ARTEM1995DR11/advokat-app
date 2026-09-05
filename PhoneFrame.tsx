import type { ReactNode } from "react";
import { StatusBar, BottomNav } from "../components";

export default function PhoneFrame({
  children,
  activeTab,
  onTabChange,
}: {
  children: ReactNode;
  activeTab: string;
  onTabChange: (id: string) => void;
}) {
  return (
    <div
      className="relative shrink-0 rounded-[3rem] p-[3px]"
      style={{ background: "var(--frame)", boxShadow: "var(--shadow)" }}
    >
      <div
        className="relative overflow-hidden rounded-[2.85rem] border"
        style={{
          width: 360,
          height: 760,
          background: "linear-gradient(180deg,var(--phone-bg),var(--phone-bg-2))",
          borderColor: "var(--frame-edge)",
        }}
      >
        {/* Notch */}
        <div className="absolute left-1/2 top-2 z-30 -translate-x-1/2">
          <div className="h-6 w-32 rounded-full bg-black" />
        </div>

        <StatusBar />

        {/* Scrollable content */}
        <div
          className="absolute inset-x-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ top: 44, bottom: 0, paddingBottom: 90 }}
        >
          {children}
        </div>

        <BottomNav active={activeTab} onChange={onTabChange} />
      </div>
    </div>
  );
}

"use client";

import { cn } from "@/lib/cn";

type Tab = { id: string; label: string };

type TabsProps = {
  tabs: Tab[];
  value: string;
  onValueChange: (id: string) => void;
  className?: string;
};

export function Tabs({ tabs, value, onValueChange, className }: TabsProps) {
  return (
    <div className={cn("flex items-center gap-6 border-b border-slate-200", className)} role="tablist">
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(tab.id)}
            className={cn(
              "-mb-px border-b-2 pb-3 text-sm font-semibold transition",
              active ? "border-primary text-primary" : "border-transparent text-slate-500 hover:text-slate-800"
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

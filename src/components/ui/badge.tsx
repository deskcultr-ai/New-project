import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "primary" | "success" | "warning" | "danger" | "info" | "neutral";

const tones: Record<Tone, string> = {
  primary: "bg-primary-light text-primary",
  success: "bg-success-light text-success",
  warning: "bg-warning-light text-amber-600",
  danger: "bg-danger-light text-danger",
  info: "bg-info-light text-info",
  neutral: "bg-slate-100 text-slate-600",
};

type BadgeProps = HTMLAttributes<HTMLSpanElement> & { tone?: Tone };

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone], className)}
      {...props}
    />
  );
}

type ChipProps = {
  children: ReactNode;
  tone?: Tone;
  onRemove?: () => void;
  className?: string;
};

export function Chip({ children, tone = "neutral", onRemove, className }: ChipProps) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", tones[tone], className)}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove"
          className="grid h-4 w-4 place-items-center rounded-full text-current/70 transition hover:bg-black/5 hover:text-current"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-3 w-3">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </span>
  );
}

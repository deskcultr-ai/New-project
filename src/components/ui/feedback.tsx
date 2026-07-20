import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "success" | "warning" | "danger" | "info";

const alertTones: Record<Tone, { wrap: string; icon: string; path: ReactNode }> = {
  success: {
    wrap: "border-success/20 bg-success-light text-emerald-800",
    icon: "text-success",
    path: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  },
  warning: {
    wrap: "border-warning/20 bg-warning-light text-amber-800",
    icon: "text-warning",
    path: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m0 3.75h.008M10.34 3.94 1.7 18.5A1.5 1.5 0 0 0 3 20.75h18a1.5 1.5 0 0 0 1.3-2.25L13.66 3.94a1.5 1.5 0 0 0-2.6 0Z" />,
  },
  danger: {
    wrap: "border-danger/20 bg-danger-light text-red-800",
    icon: "text-danger",
    path: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m0 3.75h.008M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  },
  info: {
    wrap: "border-info/20 bg-info-light text-blue-800",
    icon: "text-info",
    path: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.25 11.25h.75v4.5h.75M12 8.25h.008M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />,
  },
};

type AlertProps = {
  tone?: Tone;
  children: ReactNode;
  onClose?: () => void;
  className?: string;
};

export function Alert({ tone = "info", children, onClose, className }: AlertProps) {
  const config = alertTones[tone];
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border p-4 text-sm font-medium", config.wrap, className)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className={cn("mt-0.5 h-5 w-5 shrink-0", config.icon)}>
        {config.path}
      </svg>
      <span className="flex-1">{children}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Dismiss" className="shrink-0 opacity-60 transition hover:opacity-100">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}
    </div>
  );
}

type ProgressBarProps = {
  value: number;
  className?: string;
  showLabel?: boolean;
};

export function ProgressBar({ value, className, showLabel }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={className}>
      {showLabel && (
        <div className="mb-2 flex justify-between text-xs font-semibold text-slate-500">
          <span>Progress</span>
          <span>{clamped}%</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-violet-500 transition-[width]"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

type ProgressCircleProps = {
  value: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  label?: ReactNode;
};

export function ProgressCircle({ value, size = 120, strokeWidth = 12, color = "var(--color-primary)", label }: ProgressCircleProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e2e8f0" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset]"
        />
      </svg>
      <span className="absolute text-lg font-black text-slate-900">{label ?? `${clamped}%`}</span>
    </div>
  );
}

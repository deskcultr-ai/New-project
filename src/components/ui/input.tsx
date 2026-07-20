"use client";

import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

const fieldBase =
  "h-11 w-full rounded-xl border border-[var(--glass-border-soft)] bg-[var(--glass-bg-strong)] text-sm text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-tertiary)] focus:border-[#8b5cf6] disabled:cursor-not-allowed disabled:opacity-60 backdrop-blur-xl";

type InputProps = InputHTMLAttributes<HTMLInputElement> & { icon?: ReactNode };

export function Input({ icon, className, ...props }: InputProps) {
  return (
    <div className="relative">
      {icon && (
        <span className="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 text-slate-400">
          {icon}
        </span>
      )}
      <input className={cn(fieldBase, "px-3.5", icon ? "pl-10" : undefined, className)} {...props} />
    </div>
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select className={cn(fieldBase, "cursor-pointer appearance-none px-3.5 pr-10", className)} {...props}>
        {children}
      </select>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
}

type CheckboxProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode };

export function Checkbox({ label, className, ...props }: CheckboxProps) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" className={cn("h-4 w-4 rounded border-slate-300 accent-primary", className)} {...props} />
      {label}
    </label>
  );
}

type RadioProps = InputHTMLAttributes<HTMLInputElement> & { label?: ReactNode };

export function Radio({ label, className, ...props }: RadioProps) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-slate-700">
      <input type="radio" className={cn("h-4 w-4 border-slate-300 accent-primary", className)} {...props} />
      {label}
    </label>
  );
}

type ToggleProps = {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  "aria-label"?: string;
};

export function Toggle({ checked, onChange, disabled, ...props }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50",
        checked ? "bg-primary" : "bg-slate-300"
      )}
      {...props}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition",
          checked ? "translate-x-5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

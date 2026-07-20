import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "lg" | "md" | "sm";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-light disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-gradient-to-r from-[#8b5cf6] to-[#ec4899] text-white shadow-[0_4px_14px_rgba(139,92,246,0.3)] hover:brightness-110 hover:shadow-[0_4px_16px_rgba(139,92,246,0.45)]",
  secondary: "border border-[var(--glass-border-soft)] bg-[var(--glass-bg-strong)] text-[var(--text-primary)] hover:bg-[var(--surface-med)]",
  ghost: "text-[var(--text-secondary)] hover:bg-[var(--surface-soft)] hover:text-[var(--text-primary)]",
  danger: "bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-[0_4px_14px_rgba(239,68,68,0.25)] hover:brightness-110",
};

const sizes: Record<Size, string> = {
  lg: "h-12 px-6 text-sm",
  md: "h-10 px-4 text-sm",
  sm: "h-8 px-3 text-xs",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  return <button className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}

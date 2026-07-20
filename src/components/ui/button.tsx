import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "lg" | "md" | "sm";

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-light disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-white shadow-ds-sm hover:bg-primary-dark",
  secondary: "border border-primary/25 bg-primary-light text-primary hover:bg-primary/15",
  ghost: "text-slate-600 hover:bg-slate-100",
  danger: "bg-danger text-white shadow-ds-sm hover:brightness-95",
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

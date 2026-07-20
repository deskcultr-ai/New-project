import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type CardProps = HTMLAttributes<HTMLDivElement> & { hover?: boolean };

export function Card({ hover, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-slate-200 bg-white p-6 shadow-ds-sm",
        hover && "transition hover:-translate-y-1 hover:shadow-ds-md",
        className
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-bold text-slate-900", className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm leading-6 text-slate-600", className)} {...props} />;
}

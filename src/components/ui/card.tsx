import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type CardProps = HTMLAttributes<HTMLDivElement> & { hover?: boolean };

export function Card({ hover, className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "glass-panel p-6 transition-all duration-300",
        hover && "hover:-translate-y-1 hover:brightness-105",
        className
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-bold text-[var(--text-primary)]", className)} {...props} />;
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm leading-6 text-[var(--text-secondary)]", className)} {...props} />;
}

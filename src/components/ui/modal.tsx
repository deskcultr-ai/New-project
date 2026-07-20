"use client";

import { useEffect } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function Modal({ open, onClose, title, children, footer, className }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-ds-lg",
          className
        )}
      >
        {title && (
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-h4 text-slate-900">{title}</h2>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="h-5 w-5">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        )}
        <div className="text-sm leading-6 text-slate-600">{children}</div>
        {footer && <div className="mt-6 flex items-center justify-end gap-3">{footer}</div>}
      </div>
    </div>
  );
}

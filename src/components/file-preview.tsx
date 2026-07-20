"use client";

import { useState } from "react";
import { Modal } from "@/components/ui";

export type PreviewTarget = { url: string; name: string; contentType?: string | null } | null;

export function useFilePreview() {
  const [target, setTarget] = useState<PreviewTarget>(null);
  return { target, open: setTarget, close: () => setTarget(null) };
}

function isImage(contentType?: string | null, name?: string) {
  if (contentType?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|svg)$/i.test(name ?? "");
}

function isPdf(contentType?: string | null, name?: string) {
  if (contentType === "application/pdf") return true;
  return /\.pdf$/i.test(name ?? "");
}

export function FilePreviewModal({ target, onClose }: { target: PreviewTarget; onClose: () => void }) {
  if (!target) return null;
  const previewImage = isImage(target.contentType, target.name);
  const previewPdf = isPdf(target.contentType, target.name);

  return (
    <Modal
      open={!!target}
      onClose={onClose}
      title={target.name}
      footer={
        <a href={target.url} target="_blank" rel="noopener noreferrer" className="text-sm font-bold text-primary hover:underline">
          Open / Download
        </a>
      }
    >
      {previewImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={target.url} alt={target.name} className="max-h-[70vh] w-full rounded-lg object-contain" />
      )}
      {previewPdf && <iframe src={target.url} className="h-[70vh] w-full rounded-lg border border-slate-200" title={target.name} />}
      {!previewImage && !previewPdf && <p className="text-sm text-slate-500">No in-browser preview for this file type -- use Open / Download below.</p>}
    </Modal>
  );
}

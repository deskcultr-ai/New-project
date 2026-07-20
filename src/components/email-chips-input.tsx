"use client";

import { useState, useRef, KeyboardEvent, ClipboardEvent } from "react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface EmailChipsInputProps {
  emails: string[];
  onChange: (emails: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function EmailChipsInput({ emails, onChange, placeholder = "Add email addresses...", disabled }: EmailChipsInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function addEmail(raw: string) {
    const email = raw.trim().toLowerCase();
    if (!email) return;
    if (!EMAIL_RE.test(email)) {
      setInvalid(true);
      setTimeout(() => setInvalid(false), 800);
      return;
    }
    if (emails.includes(email)) {
      setInputValue("");
      return;
    }
    onChange([...emails, email]);
    setInputValue("");
  }

  function removeEmail(index: number) {
    onChange(emails.filter((_, i) => i !== index));
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (["Enter", ",", " ", "Tab"].includes(e.key)) {
      e.preventDefault();
      addEmail(inputValue);
    } else if (e.key === "Backspace" && !inputValue && emails.length > 0) {
      removeEmail(emails.length - 1);
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text");
    const parts = pasted.split(/[\s,;]+/).filter(Boolean);
    const valid: string[] = [];
    for (const part of parts) {
      const email = part.trim().toLowerCase();
      if (EMAIL_RE.test(email) && !emails.includes(email)) {
        valid.push(email);
      }
    }
    if (valid.length > 0) onChange([...emails, ...valid]);
  }

  function handleBlur() {
    if (inputValue.trim()) addEmail(inputValue);
  }

  const initials = (email: string) => email.slice(0, 2).toUpperCase();
  const chipColors = [
    "bg-purple-500", "bg-pink-500", "bg-indigo-500",
    "bg-violet-500", "bg-fuchsia-500", "bg-sky-500",
  ];

  return (
    <div
      className={`email-chips-container ${invalid ? "shake-invalid" : ""}`}
      onClick={() => inputRef.current?.focus()}
    >
      {emails.map((email, i) => (
        <span key={email} className="email-chip">
          <span className={`chip-avatar ${chipColors[i % chipColors.length]}`}>
            {initials(email)}
          </span>
          <span className="chip-label">{email}</span>
          {!disabled && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeEmail(i); }}
              className="chip-remove"
              aria-label={`Remove ${email}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3 w-3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={handleBlur}
        placeholder={emails.length === 0 ? placeholder : ""}
        disabled={disabled}
        className="chips-inner-input"
        aria-label="Add email address"
      />
    </div>
  );
}

export type ConversationType = "department_channel" | "announcement" | "dm";

export type Conversation = {
  id: string;
  organization_id: string;
  type: ConversationType;
  department_id: string | null;
  dm_profile_a: string | null;
  dm_profile_b: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  author_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  deleted_for_everyone: boolean;
};

const TASK_TOKEN_RE = /\[\[task:([0-9a-f-]{36})\]\]/gi;

/** Splits a message body into plain-text and task-reference segments. */
export function parseMessageBody(body: string): Array<{ type: "text"; value: string } | { type: "task"; id: string }> {
  const segments: Array<{ type: "text"; value: string } | { type: "task"; id: string }> = [];
  let lastIndex = 0;
  for (const match of body.matchAll(TASK_TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) segments.push({ type: "text", value: body.slice(lastIndex, index) });
    segments.push({ type: "task", id: match[1] });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < body.length) segments.push({ type: "text", value: body.slice(lastIndex) });
  return segments;
}

export function taskToken(id: string): string {
  return `[[task:${id}]]`;
}

export const REACTION_EMOJI = ["👍", "❤️", "😂", "🎉", "👀"];

/** "Today" / "Yesterday" / a localized date, for date-separator rows in a message list. */
export function formatDayLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

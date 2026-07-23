export type TaskStatus = "todo" | "in_progress" | "in_review" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskType = "one_time" | "daily_recurring";

export type Task = {
  id: string;
  organization_id: string;
  department_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  is_blocked: boolean;
  priority: TaskPriority;
  task_type: TaskType;
  due_date: string | null;
  created_by: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
};

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  one_time: "One-time",
  daily_recurring: "Daily Recurring",
};

export const STATUS_ORDER: TaskStatus[] = ["todo", "in_progress", "in_review", "done"];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const PRIORITY_TONE: Record<TaskPriority, "neutral" | "info" | "warning" | "danger"> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  urgent: "danger",
};

export type DueUrgency = "overdue" | "soon";

/** Overdue: past due and not done. Soon: due within 2 days and not done. Otherwise null (no badge needed). */
export function getDueUrgency(dueDate: string | null, status: TaskStatus): DueUrgency | null {
  if (!dueDate || status === "done") return null;
  // dueDate is a date-only string ("YYYY-MM-DD"), which the Date
  // constructor parses as UTC midnight -- read it back with UTC getters so
  // "July 20" means July 20 for every viewer, regardless of timezone.
  // (Previously this mutated the UTC-parsed instant with local-time
  // setHours(), which silently shifted the effective due date back a day
  // in any timezone behind UTC.)
  const due = new Date(dueDate);
  const dueUTC = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const now = new Date();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = (dueUTC - todayUTC) / 86400000;
  if (diffDays < 0) return "overdue";
  if (diffDays <= 2) return "soon";
  return null;
}

export const DUE_URGENCY_LABEL: Record<DueUrgency, string> = {
  overdue: "Overdue",
  soon: "Due soon",
};

export const DUE_URGENCY_TONE: Record<DueUrgency, "danger" | "warning"> = {
  overdue: "danger",
  soon: "warning",
};

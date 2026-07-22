import { describe, expect, it, vi, afterEach } from "vitest";
import { getDueUrgency } from "./tasks";

describe("getDueUrgency", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when there's no due date", () => {
    expect(getDueUrgency(null, "todo")).toBeNull();
  });

  it("returns null for a done task, even if overdue", () => {
    expect(getDueUrgency("2020-01-01", "done")).toBeNull();
  });

  it("returns 'overdue' for a past due date on an unfinished task", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T12:00:00Z"));
    expect(getDueUrgency("2026-07-20", "in_progress")).toBe("overdue");
  });

  it("returns 'soon' for a due date within the next 2 days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T12:00:00Z"));
    expect(getDueUrgency("2026-07-23", "todo")).toBe("soon");
    expect(getDueUrgency("2026-07-24", "todo")).toBe("soon");
  });

  it("returns null for a due date more than 2 days out", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T12:00:00Z"));
    expect(getDueUrgency("2026-07-25", "todo")).toBeNull();
  });

  it("treats today as 'soon', not 'overdue'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T23:00:00Z"));
    expect(getDueUrgency("2026-07-22", "in_review")).toBe("soon");
  });
});

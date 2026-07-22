import { describe, expect, it } from "vitest";
import { parseMessageBody, taskToken } from "./messaging";

describe("parseMessageBody", () => {
  it("returns a single text segment for a plain message", () => {
    expect(parseMessageBody("hello team")).toEqual([{ type: "text", value: "hello team" }]);
  });

  it("extracts a single task token", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(parseMessageBody(taskToken(id))).toEqual([{ type: "task", id }]);
  });

  it("keeps surrounding text around a task token", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    const body = `see ${taskToken(id)} please`;
    expect(parseMessageBody(body)).toEqual([
      { type: "text", value: "see " },
      { type: "task", id },
      { type: "text", value: " please" },
    ]);
  });

  it("handles multiple adjacent task tokens with no text between them", () => {
    const idA = "11111111-1111-1111-1111-111111111111";
    const idB = "22222222-2222-2222-2222-222222222222";
    const body = `${taskToken(idA)}${taskToken(idB)}`;
    expect(parseMessageBody(body)).toEqual([
      { type: "task", id: idA },
      { type: "task", id: idB },
    ]);
  });

  it("returns an empty array for an empty body", () => {
    expect(parseMessageBody("")).toEqual([]);
  });

  it("ignores malformed task tokens (wrong id shape)", () => {
    const body = "see [[task:not-a-uuid]] please";
    expect(parseMessageBody(body)).toEqual([{ type: "text", value: body }]);
  });
});

describe("taskToken", () => {
  it("round-trips through parseMessageBody", () => {
    const id = "33333333-3333-3333-3333-333333333333";
    expect(parseMessageBody(taskToken(id))).toEqual([{ type: "task", id }]);
  });
});

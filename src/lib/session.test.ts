import { describe, expect, it } from "vitest";
import { displayName, handleName, isAdmin, isSuperAdmin, type Profile } from "./session";

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "p1",
    organization_id: "o1",
    department_id: null,
    email: "jane.doe@example.com",
    full_name: "Jane Doe",
    username: null,
    bio: null,
    avatar_url: null,
    role: "employee",
    status: "active",
    ...overrides,
  };
}

describe("isAdmin / isSuperAdmin", () => {
  it("null profile is neither", () => {
    expect(isAdmin(null)).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
  });

  it("employee is neither", () => {
    const p = makeProfile({ role: "employee" });
    expect(isAdmin(p)).toBe(false);
    expect(isSuperAdmin(p)).toBe(false);
  });

  it("admin is an admin but not a super admin", () => {
    const p = makeProfile({ role: "admin" });
    expect(isAdmin(p)).toBe(true);
    expect(isSuperAdmin(p)).toBe(false);
  });

  it("super_admin counts as both", () => {
    const p = makeProfile({ role: "super_admin" });
    expect(isAdmin(p)).toBe(true);
    expect(isSuperAdmin(p)).toBe(true);
  });
});

describe("displayName", () => {
  it("falls back to 'there' when there's no profile", () => {
    expect(displayName(null)).toBe("there");
  });

  it("prefers username", () => {
    expect(displayName(makeProfile({ username: "janedoe" }))).toBe("janedoe");
  });

  it("falls back to full_name when there's no username", () => {
    expect(displayName(makeProfile({ username: null, full_name: "Jane Doe" }))).toBe("Jane Doe");
  });

  it("falls back to the email prefix when there's no username or name", () => {
    expect(displayName(makeProfile({ username: null, full_name: null, email: "jane.doe@example.com" }))).toBe("jane.doe");
  });
});

describe("handleName", () => {
  it("returns 'Unknown' when there's no profile", () => {
    expect(handleName(null)).toBe("Unknown");
  });

  it("prefixes username with @", () => {
    expect(handleName({ username: "janedoe" })).toBe("@janedoe");
  });

  it("falls back to full_name when there's no username", () => {
    expect(handleName({ username: null, full_name: "Jane Doe" })).toBe("Jane Doe");
  });

  it("falls back to the email prefix as a last resort", () => {
    expect(handleName({ username: null, full_name: null, email: "jane.doe@example.com" })).toBe("jane.doe");
  });
});

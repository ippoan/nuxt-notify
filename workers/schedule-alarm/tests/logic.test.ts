import { describe, expect, it } from "vitest";
import {
  backoffMs,
  classifyFireStatus,
  constantTimeEqualStr,
  isValidUuid,
  MAX_ATTEMPTS,
  parseFireAt,
} from "../src/logic";

describe("isValidUuid", () => {
  it("accepts canonical uuid", () => {
    expect(isValidUuid("61cf27f0-b192-4ca4-a608-1cc1b24f45c3")).toBe(true);
    expect(isValidUuid("61CF27F0-B192-4CA4-A608-1CC1B24F45C3")).toBe(true);
  });
  it("rejects non-uuid", () => {
    expect(isValidUuid("")).toBe(false);
    expect(isValidUuid("not-a-uuid")).toBe(false);
    expect(isValidUuid("61cf27f0b1924ca4a6081cc1b24f45c3")).toBe(false);
    expect(isValidUuid("61cf27f0-b192-4ca4-a608-1cc1b24f45c3/../x")).toBe(false);
  });
});

describe("parseFireAt", () => {
  it("parses RFC3339", () => {
    expect(parseFireAt("2026-07-10T03:00:00Z")).toBe(Date.parse("2026-07-10T03:00:00Z"));
  });
  it("rejects invalid input", () => {
    expect(parseFireAt("")).toBeNull();
    expect(parseFireAt("tomorrow")).toBeNull();
    expect(parseFireAt(123)).toBeNull();
    expect(parseFireAt(undefined)).toBeNull();
  });
});

describe("constantTimeEqualStr", () => {
  it("matches equal strings", () => {
    expect(constantTimeEqualStr("abc", "abc")).toBe(true);
  });
  it("rejects different strings and lengths", () => {
    expect(constantTimeEqualStr("abc", "abd")).toBe(false);
    expect(constantTimeEqualStr("abc", "abcd")).toBe(false);
    expect(constantTimeEqualStr("", "x")).toBe(false);
  });
});

describe("backoffMs", () => {
  it("escalates and clamps", () => {
    expect(backoffMs(1)).toBe(60_000);
    expect(backoffMs(2)).toBe(300_000);
    expect(backoffMs(5)).toBe(3_600_000);
    expect(backoffMs(99)).toBe(3_600_000);
    expect(backoffMs(0)).toBe(60_000);
  });
});

describe("classifyFireStatus", () => {
  it("2xx and 404 are done", () => {
    expect(classifyFireStatus(200)).toBe("done");
    expect(classifyFireStatus(204)).toBe("done");
    expect(classifyFireStatus(404)).toBe("done");
  });
  it("auth/server errors retry", () => {
    expect(classifyFireStatus(401)).toBe("retry");
    expect(classifyFireStatus(403)).toBe("retry");
    expect(classifyFireStatus(500)).toBe("retry");
    expect(classifyFireStatus(502)).toBe("retry");
  });
});

describe("MAX_ATTEMPTS", () => {
  it("is a small positive bound", () => {
    expect(MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(MAX_ATTEMPTS).toBeLessThanOrEqual(10);
  });
});

import { describe, expect, it } from "vitest";
import { resolveSecret } from "../src/secret";

describe("resolveSecret (SOURCE-MIRROR: auth-worker src/lib/secret.ts)", () => {
  it("undefined / falsy は null", async () => {
    expect(await resolveSecret(undefined)).toBeNull();
    expect(await resolveSecret("")).toBeNull();
  });

  it("string (vitest / wrangler dev) はそのまま", async () => {
    expect(await resolveSecret("plain")).toBe("plain");
  });

  it("SecretsStoreSecret (.get()) は解決して返す", async () => {
    expect(await resolveSecret({ get: async () => "resolved" } as any)).toBe("resolved");
  });

  it(".get() が空文字なら null", async () => {
    expect(await resolveSecret({ get: async () => "" } as any)).toBeNull();
  });

  it(".get() throw は null (fail-closed)", async () => {
    expect(
      await resolveSecret({
        get: async () => {
          throw new Error("boom");
        },
      } as any),
    ).toBeNull();
  });
});

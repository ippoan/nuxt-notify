import { describe, it, expect } from "vitest";
import { checkBroadcastAuth, constantTimeEqualStr } from "../src/auth";

describe("checkBroadcastAuth", () => {
  it("一致すれば ok", () => {
    expect(checkBroadcastAuth("s3cret", "s3cret")).toBe("ok");
  });

  it("Secrets Store の値が取れない (null・空) なら secret_unset", () => {
    expect(checkBroadcastAuth("s3cret", null)).toBe("secret_unset");
    expect(checkBroadcastAuth("", "")).toBe("secret_unset");
  });

  it("値が違う・ヘッダーが無い・長さが違うなら mismatch", () => {
    expect(checkBroadcastAuth("wrong!", "s3cret")).toBe("mismatch");
    expect(checkBroadcastAuth("", "s3cret")).toBe("mismatch");
    // 期待値の末尾に改行がある場合 (送る側のヘッダーは Fetch の Headers が前後の空白を落とす) も一致しない
    expect(checkBroadcastAuth("s3cret", "s3cret\n")).toBe("mismatch");
  });
});

describe("constantTimeEqualStr", () => {
  it("長さ込みで完全一致のときだけ true", () => {
    expect(constantTimeEqualStr("abc", "abc")).toBe(true);
    expect(constantTimeEqualStr("abc", "abd")).toBe(false);
    expect(constantTimeEqualStr("abc", "abcd")).toBe(false);
    expect(constantTimeEqualStr("", "")).toBe(true);
  });
});

import { describe, expect, test } from "vitest";
import { redactSecrets } from "../../src/secure/redact.js";

describe("redactSecrets", () => {
  test("masks API keys, GitHub tokens, AWS keys and PEM bodies but keeps the recognisable prefix", () => {
    expect(redactSecrets("key sk-ant-api03-abcdefghijklmnop1234 here")).toBe("key sk-ant-… here");
    expect(redactSecrets(`const t = "ghp_${"a".repeat(36)}"`)).toBe('const t = "ghp_…"');
    expect(redactSecrets("id AKIAABCDEFGHIJKLMNOP")).toBe("id AKIA…");
    expect(redactSecrets("-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nabc\n-----END RSA PRIVATE KEY-----")).toBe("-----BEGIN RSA PRIVATE KEY-----\n…\n-----END RSA PRIVATE KEY-----");
  });

  test("masks the value of secret-looking assignments and leaves ordinary text alone", () => {
    expect(redactSecrets("API_KEY=supersecretvalue123")).toBe("API_KEY=…");
    expect(redactSecrets('password: "hunter2hunter2"')).toBe('password: "…"');
    expect(redactSecrets("The token is validated upstream.")).toBe("The token is validated upstream.");
    expect(redactSecrets("nothing to hide")).toBe("nothing to hide");
  });
});

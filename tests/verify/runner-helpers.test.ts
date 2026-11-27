import { describe, expect, test } from "vitest";
import { expectedText, resolveUrl, urlMatches } from "../../src/verify/runner.js";

describe("urlMatches", () => {
  test("a bare slash only matches the home page", () => {
    expect(urlMatches("/", "http://x/")).toBe(true);
    expect(urlMatches("/", "http://x/?q=1")).toBe(true);
    expect(urlMatches("/", "http://x/checkout")).toBe(false);
  });

  test("a path matches itself and its children, not siblings with the same prefix", () => {
    expect(urlMatches("/checkout", "http://x/checkout")).toBe(true);
    expect(urlMatches("/checkout/", "http://x/checkout/confirmation?o=1")).toBe(true);
    expect(urlMatches("/checkout", "http://x/checkouts")).toBe(false);
    expect(urlMatches("http://x/a", "http://x/a?b=1")).toBe(true);
  });
});

describe("expectedText", () => {
  test("reads the text from value or from a text target", () => {
    expect(expectedText({ action: "expect_text", value: "Charged $80.00" })).toBe("Charged $80.00");
    expect(expectedText({ action: "expect_not_text", target: { text: "Discount" } })).toBe("Discount");
    expect(() => expectedText({ action: "expect_not_text" })).toThrow(/text/);
  });
});

describe("resolveUrl", () => {
  test("resolves paths against the base URL and refuses every other origin", () => {
    expect(resolveUrl("http://127.0.0.1:3000", "/a")).toBe("http://127.0.0.1:3000/a");
    expect(resolveUrl("http://127.0.0.1:3000/", "a?b=1")).toBe("http://127.0.0.1:3000/a?b=1");
    expect(resolveUrl("http://127.0.0.1:3000", "http://127.0.0.1:3000/x")).toBe("http://127.0.0.1:3000/x");
    expect(() => resolveUrl("http://127.0.0.1:3000", "http://169.254.169.254/latest/meta-data")).toThrow(/origin/);
    expect(() => resolveUrl("http://127.0.0.1:3000", "http://127.0.0.1:3001/")).toThrow(/origin/);
  });
});

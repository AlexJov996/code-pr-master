import { describe, expect, test } from "vitest";
import { createDemoShop } from "../../src/verify/demo-app.js";

async function form(app: ReturnType<typeof createDemoShop>, path: string, body: Record<string, string>, cookie?: string) {
  const res = await app.request(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(body).toString(), redirect: "manual" });
  return res;
}

describe("demo shop", () => {
  test("home page lists a product and a coupon form", async () => {
    const app = createDemoShop();
    const html = await (await app.request("/")).text();
    expect(html).toContain("Canvas tote");
    expect(html).toContain('aria-label="Coupon code"');
  });

  test("applying SAVE20 shows the discount but records a full-price charge (the planted bug)", async () => {
    const app = createDemoShop();
    const add = await form(app, "/cart/add", { sku: "tote" });
    const cookie = add.headers.get("set-cookie")!.split(";")[0]!;
    await form(app, "/coupon", { code: "SAVE20" }, cookie);
    const cart = await (await app.request("/", { headers: { cookie } })).text();
    expect(cart).toContain("−$20.00");
    expect(cart).toContain("$80.00");
    const order = await form(app, "/checkout", {}, cookie);
    expect(order.status).toBe(302);
    const confirmation = await (await app.request(order.headers.get("location")!, { headers: { cookie } })).text();
    expect(confirmation).toContain("Order total $80.00");
    expect(confirmation).toContain("Charged $100.00");
  });

  test("rejects an invalid coupon", async () => {
    const app = createDemoShop();
    const add = await form(app, "/cart/add", { sku: "tote" });
    const cookie = add.headers.get("set-cookie")!.split(";")[0]!;
    await form(app, "/coupon", { code: "NOPE" }, cookie);
    const cart = await (await app.request("/", { headers: { cookie } })).text();
    expect(cart).toContain("Invalid coupon");
  });

  test("the coupon silently expires after a short window, so a reload loses it (the second planted bug)", async () => {
    const app = createDemoShop({ couponTtlMs: 0 });
    const add = await form(app, "/cart/add", { sku: "tote" });
    const cookie = add.headers.get("set-cookie")!.split(";")[0]!;
    await form(app, "/coupon", { code: "SAVE20" }, cookie);
    const later = await (await app.request("/", { headers: { cookie } })).text();
    expect(later).not.toContain("−$20.00");
    expect(later).toContain("$100.00");
  });
});

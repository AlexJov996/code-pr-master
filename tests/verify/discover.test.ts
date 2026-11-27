import { describe, expect, test } from "vitest";
import { discoverJourneys } from "../../src/verify/discover.js";
import type { JourneysOutput } from "../../src/verify/schema.js";

const files = [
  { path: "app/page.tsx", content: "<h1>Shop</h1><form action=\"/cart/add\"><button>Add to cart</button></form>" },
  { path: "app/checkout/page.tsx", content: "<form><input aria-label=\"Coupon code\" /><button>Apply</button></form>" },
  { path: "app/api/orders/route.ts", content: "export async function POST() {}" },
  { path: "README.md", content: "# Acme shop\nCustomers add a tote, apply SAVE20 and check out." },
];

describe("discoverJourneys", () => {
  test("without a model, proposes smoke journeys for every page and marks interactive pages", async () => {
    const r = await discoverJourneys(files);
    expect(r.routes.map((x) => x.path)).toEqual(["/", "/api/orders", "/checkout"]);
    expect(r.journeys.map((j) => j.id)).toEqual(["smoke-root", "smoke-checkout"]);
    expect(r.journeys.every((j) => j.source === "generated")).toBe(true);
  });

  test("with a model, sends routes and the readme and returns its journeys plus the smoke checks", async () => {
    const seen: string[] = [];
    const out: JourneysOutput = { journeys: [{ id: "checkout-with-coupon", title: "Checkout with a coupon", goal: "g", expected: "e", steps: [{ action: "goto", url: "/" }, { action: "click", target: { role: "button", name: "Add to cart" } }] }] };
    const r = await discoverJourneys(files, async (_s, user) => { seen.push(user); return out; });
    expect(seen[0]).toContain("GET /checkout (page, interactive");
    expect(seen[0]).toContain("apply SAVE20");
    expect(r.journeys.map((j) => j.id)).toEqual(["checkout-with-coupon", "smoke-root", "smoke-checkout"]);
  });
});

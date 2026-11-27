import { describe, expect, test } from "vitest";
import { journeyFromYaml, journeysToYaml, parseJourneys, StepSchema } from "../../src/verify/journeys.js";

const yaml = `
journeys:
  - id: checkout-coupon
    title: Checkout with a coupon
    goal: Complete an order with a valid discount.
    expected: The order total and the recorded charge both equal $80.
    steps:
      - goto: /
      - click: { role: button, name: Add to cart }
      - fill: { label: Coupon code, value: SAVE20 }
      - click: { text: Apply }
      - expect_text: "-$20.00"
      - click: { role: button, name: Place order }
      - expect_url: /checkout/confirmation
      - expect_text: "Charged $80.00"
  - id: invalid-coupon
    title: Reject an invalid coupon
    goal: An invalid code is refused.
    steps:
      - goto: /
      - fill: { label: Coupon code, value: NOPE }
      - click: { text: Apply }
      - expect_text: Invalid coupon
`;

describe("parseJourneys", () => {
  test("parses the shorthand step syntax into typed steps", () => {
    const js = parseJourneys(yaml);
    expect(js).toHaveLength(2);
    const [a] = js;
    expect(a!.id).toBe("checkout-coupon");
    expect(a!.steps[0]).toEqual({ action: "goto", url: "/" });
    expect(a!.steps[1]).toEqual({ action: "click", target: { role: "button", name: "Add to cart" } });
    expect(a!.steps[2]).toEqual({ action: "fill", target: { label: "Coupon code" }, value: "SAVE20" });
    expect(a!.steps[3]).toEqual({ action: "click", target: { text: "Apply" } });
    expect(a!.steps[4]).toEqual({ action: "expect_text", value: "-$20.00" });
    expect(a!.steps[6]).toEqual({ action: "expect_url", value: "/checkout/confirmation" });
    expect(a!.source).toBe("saved");
  });

  test("rejects unknown actions and missing ids with a readable error", () => {
    expect(() => parseJourneys("journeys:\n  - id: x\n    title: X\n    goal: g\n    steps:\n      - dance: now\n")).toThrow(/dance/);
    expect(() => parseJourneys("journeys:\n  - title: X\n    goal: g\n    steps: []\n")).toThrow(/id/);
  });

  test("round-trips through YAML", () => {
    const js = parseJourneys(yaml);
    const again = parseJourneys(journeysToYaml(js));
    expect(again).toEqual(js);
  });

  test("StepSchema accepts the long form too", () => {
    expect(StepSchema.parse({ action: "press", target: { placeholder: "Search" }, value: "Enter" }).action).toBe("press");
    expect(journeyFromYaml({ id: "a", title: "A", goal: "g", steps: [{ action: "wait", value: "500" }] }).steps[0]).toEqual({ action: "wait", value: "500" });
  });
});

import type { Journey } from "./schema.js";

/** Journeys for the demo shop. Two find the planted bugs; one passes. */
export const DEMO_JOURNEYS: Journey[] = [
  {
    id: "apply-discount-at-checkout", title: "Apply the discount at checkout", goal: "Complete an order with a valid discount.",
    expected: "The order total and the recorded charge both equal $80.", source: "generated",
    steps: [
      { action: "goto", url: "/" },
      { action: "click", target: { role: "button", name: "Add to cart" } },
      { action: "fill", target: { label: "Coupon code" }, value: "SAVE20" },
      { action: "click", target: { role: "button", name: "Apply" } },
      { action: "expect_text", value: "−$20.00" },
      { action: "click", target: { role: "button", name: "Place order" } },
      { action: "expect_url", value: "/checkout/confirmation" },
      { action: "expect_text", value: "Order total $80.00" },
      { action: "expect_text", value: "Charged $80.00" },
    ],
  },
  {
    id: "keep-discount-after-refresh", title: "Keep the discount after refresh", goal: "An applied coupon survives a page reload.",
    expected: "After reloading the cart, the SAVE20 discount is still applied.", source: "generated",
    steps: [
      { action: "goto", url: "/" },
      { action: "click", target: { role: "button", name: "Add to cart" } },
      { action: "fill", target: { label: "Coupon code" }, value: "SAVE20" },
      { action: "click", target: { role: "button", name: "Apply" } },
      { action: "expect_text", value: "−$20.00" },
      { action: "wait", value: "1800" },
      { action: "goto", url: "/" },
      { action: "expect_text", value: "−$20.00" },
    ],
  },
  {
    id: "reject-invalid-coupon", title: "Reject an invalid coupon", goal: "An invalid code is refused with a message.",
    expected: "The cart shows 'Invalid coupon' and no discount.", source: "generated",
    steps: [
      { action: "goto", url: "/" },
      { action: "click", target: { role: "button", name: "Add to cart" } },
      { action: "fill", target: { label: "Coupon code" }, value: "NOPE" },
      { action: "click", target: { role: "button", name: "Apply" } },
      { action: "expect_text", value: "Invalid coupon" },
      { action: "expect_not_text", value: "−$20.00" },
    ],
  },
];

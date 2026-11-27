import { Hono } from "hono";

interface Session { items: string[]; coupon?: { code: string; appliedAt: number }; error?: string }
interface Order { id: string; total: number; charged: number; discount: number; subtotal: number }

const PRODUCTS: Record<string, { name: string; price: number }> = { tote: { name: "Canvas tote", price: 100 } };
const money = (n: number) => `$${n.toFixed(2)}`;

export interface DemoShopOptions {
  /** How long an applied coupon stays valid; the planted bug is that it silently expires. */
  couponTtlMs?: number;
}

/**
 * A tiny shop with two planted functional bugs for Verify to find:
 * 1. the confirmation shows the discounted total but the recorded charge is the full price;
 * 2. an applied coupon silently expires after a short window, so a reload loses the discount.
 */
export function createDemoShop(opts: DemoShopOptions = {}) {
  const ttl = opts.couponTtlMs ?? 1500;
  const sessions = new Map<string, Session>();
  const orders = new Map<string, Order>();
  let seq = 0;
  const app = new Hono();

  const sid = (cookie: string | undefined) => cookie?.match(/(?:^|;\s*)sid=([^;]+)/)?.[1];
  const session = (c: { req: { header: (n: string) => string | undefined } }): { id: string; s: Session; fresh: boolean } => {
    let id = sid(c.req.header("cookie"));
    let fresh = false;
    if (!id || !sessions.has(id)) { id = `s${++seq}${Date.now().toString(36)}`; sessions.set(id, { items: [] }); fresh = true; }
    return { id, s: sessions.get(id)!, fresh };
  };
  const couponValid = (s: Session) => Boolean(s.coupon && Date.now() - s.coupon.appliedAt < ttl);
  const totals = (s: Session) => {
    const subtotal = s.items.reduce((n, sku) => n + (PRODUCTS[sku]?.price ?? 0), 0);
    const discount = couponValid(s) ? Math.round(subtotal * 0.2 * 100) / 100 : 0;
    return { subtotal, discount, total: subtotal - discount };
  };
  const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} · Acme Shop</title><style>body{font:16px system-ui;margin:40px auto;max-width:640px}form{display:inline}dl{display:grid;grid-template-columns:1fr auto;gap:4px 16px}.err{color:#b00020}.ok{color:#0a7}</style></head><body><h1>Acme Shop</h1>${body}</body></html>`;

  app.get("/", (c) => {
    const { id, s, fresh } = session(c);
    if (fresh) c.header("set-cookie", `sid=${id}; Path=/; HttpOnly`);
    const error = s.error; s.error = undefined;
    if (s.coupon && !couponValid(s)) s.coupon = undefined; // the coupon quietly disappears
    const t = totals(s);
    const items = s.items.map((sku) => `<li>${PRODUCTS[sku]!.name} <span>1 × ${money(PRODUCTS[sku]!.price)}</span></li>`).join("");
    return c.html(page("Cart", `
      <section><h2>Products</h2><p>Canvas tote — ${money(100)} <form method="post" action="/cart/add"><input type="hidden" name="sku" value="tote"><button type="submit">Add to cart</button></form></p></section>
      <section><h2>Cart</h2>${s.items.length ? `<ul>${items}</ul>` : "<p>Your cart is empty.</p>"}
      <form method="post" action="/coupon"><input name="code" aria-label="Coupon code" placeholder="Coupon code" value=""><button type="submit">Apply</button></form>
      ${error ? `<p class="err" role="alert">${error}</p>` : ""}${s.coupon && t.discount ? `<p class="ok">Coupon ${s.coupon.code} applied</p>` : ""}
      <dl><dt>Subtotal</dt><dd>${money(t.subtotal)}</dd>${t.discount ? `<dt>${s.coupon!.code} discount</dt><dd>−${money(t.discount)}</dd>` : ""}<dt>Order total</dt><dd>${money(t.total)}</dd></dl>
      <form method="post" action="/checkout"><button type="submit" ${s.items.length ? "" : "disabled"}>Place order</button></form></section>`));
  });

  app.post("/cart/add", async (c) => {
    const { id, s, fresh } = session(c);
    const body = await c.req.parseBody();
    const sku = String(body.sku ?? "");
    if (PRODUCTS[sku]) s.items.push(sku);
    if (fresh) c.header("set-cookie", `sid=${id}; Path=/; HttpOnly`);
    return c.redirect("/", 302);
  });

  app.post("/coupon", async (c) => {
    const { id, s, fresh } = session(c);
    const body = await c.req.parseBody();
    const code = String(body.code ?? "").trim().toUpperCase();
    if (code === "SAVE20") s.coupon = { code, appliedAt: Date.now() };
    else { s.coupon = undefined; s.error = "Invalid coupon"; }
    if (fresh) c.header("set-cookie", `sid=${id}; Path=/; HttpOnly`);
    return c.redirect("/", 302);
  });

  app.post("/checkout", (c) => {
    const { s } = session(c);
    const t = totals(s);
    const order: Order = { id: `o${++seq}`, ...t, charged: t.subtotal }; // bug 1: the charge ignores the discount
    orders.set(order.id, order);
    s.items = []; s.coupon = undefined;
    return c.redirect(`/checkout/confirmation?order=${order.id}`, 302);
  });

  app.get("/checkout/confirmation", (c) => {
    const o = orders.get(c.req.query("order") ?? "");
    if (!o) return c.html(page("Not found", "<p>Order not found.</p>"), 404);
    return c.html(page("Order confirmed", `<h2>Order confirmed</h2><dl><dt>Subtotal</dt><dd>${money(o.subtotal)}</dd>${o.discount ? `<dt>Discount</dt><dd>−${money(o.discount)}</dd>` : ""}<dt>Order total</dt><dd>${money(o.total)}</dd></dl><p>Order total ${money(o.total)}</p><p>Charged ${money(o.charged)}</p>`));
  });

  return app;
}

import { describe, expect, test } from "vitest";
import { discoverRoutes } from "../../src/verify/routes.js";

describe("discoverRoutes", () => {
  test("finds Next.js app router pages and API routes from paths", () => {
    const r = discoverRoutes([
      { path: "app/page.tsx", content: "export default function Home() {}" },
      { path: "app/checkout/page.tsx", content: "" },
      { path: "app/account/[id]/settings/page.tsx", content: "" },
      { path: "app/api/orders/route.ts", content: "export async function POST() {}" },
      { path: "app/layout.tsx", content: "" },
      { path: "pages/signup.tsx", content: "" },
      { path: "pages/api/health.ts", content: "" },
    ]);
    expect(r.map((x) => [x.method, x.path, x.kind])).toEqual(expect.arrayContaining([
      ["GET", "/", "page"], ["GET", "/checkout", "page"], ["GET", "/account/:id/settings", "page"], ["POST", "/api/orders", "api"], ["GET", "/signup", "page"], ["GET", "/api/health", "api"],
    ]));
    expect(r.some((x) => x.path.includes("layout"))).toBe(false);
  });

  test("finds express, hono and fastify handlers from code", () => {
    const r = discoverRoutes([
      { path: "src/server.ts", content: "app.get('/', home)\nrouter.post(\"/invitations/accept\", accept)\napp.route('/cart').get(list).post(add)\nfastify.delete('/items/:id', remove)\n" },
    ]);
    expect(r.map((x) => `${x.method} ${x.path}`)).toEqual(expect.arrayContaining(["GET /", "POST /invitations/accept", "DELETE /items/:id"]));
    expect(r.find((x) => x.path === "/")!.file).toBe("src/server.ts");
  });

  test("finds react-router and vue-router paths", () => {
    const r = discoverRoutes([{ path: "src/App.tsx", content: '<Route path="/login" element={<Login />} />\n{ path: "/orders/:id", component: Orders }' }]);
    expect(r.map((x) => x.path)).toEqual(expect.arrayContaining(["/login", "/orders/:id"]));
  });

  test("deduplicates and sorts, and classifies form-bearing pages as interactive", () => {
    const r = discoverRoutes([
      { path: "app/checkout/page.tsx", content: "<form><input name=\"coupon\" /><button>Apply</button></form>" },
      { path: "src/server.ts", content: "app.get('/checkout', h)\napp.get('/checkout', h2)" },
    ]);
    expect(r.filter((x) => x.path === "/checkout")).toHaveLength(1);
    expect(r.find((x) => x.path === "/checkout")!.interactive).toBe(true);
  });
});

export interface Route {
  method: string;
  path: string;
  kind: "page" | "api";
  file: string;
  /** The page renders a form or input, so it is worth a journey beyond a smoke check. */
  interactive: boolean;
}

export interface SourceFile { path: string; content: string }

const INTERACTIVE = /<form|<input|<textarea|<select|onSubmit|<button/i;
const NEXT_SPECIAL = /^(layout|loading|error|template|not-found|global-error|default|_app|_document|_error)$/;

function nextPath(segments: string[]): string {
  const parts = segments
    .filter((s) => !/^\(.*\)$/.test(s) && !/^@/.test(s))
    .map((s) => s.replace(/^\[\.\.\.(.+)\]$/, ":$1*").replace(/^\[\[\.\.\.(.+)\]\]$/, ":$1*").replace(/^\[(.+)\]$/, ":$1"));
  return "/" + parts.join("/");
}

/** Static route discovery for common frameworks: Next.js file routes, Express/Hono/Fastify handlers, react-router and vue-router paths. */
export function discoverRoutes(files: readonly SourceFile[]): Route[] {
  const found = new Map<string, Route>();
  const add = (r: Route) => {
    const key = `${r.method} ${r.path}`;
    const prev = found.get(key);
    if (prev) prev.interactive = prev.interactive || r.interactive;
    else found.set(key, r);
  };

  for (const f of files) {
    const p = f.path.replace(/^src\//, "");
    const interactive = INTERACTIVE.test(f.content);

    let m = p.match(/^app\/(?:(.*)\/)?page\.(tsx|jsx|ts|js|mdx)$/);
    if (m) { add({ method: "GET", path: nextPath(m[1] ? m[1].split("/") : []), kind: "page", file: f.path, interactive }); continue; }
    m = p.match(/^app\/(?:(.*)\/)?route\.(ts|js)$/);
    if (m) {
      const methods = [...f.content.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g)].map((x) => x[1]!);
      for (const method of methods.length ? methods : ["GET"]) add({ method, path: nextPath(m[1] ? m[1].split("/") : []), kind: "api", file: f.path, interactive: false });
      continue;
    }
    m = p.match(/^pages\/(.*)\.(tsx|jsx|ts|js|mdx)$/);
    if (m) {
      const segs = m[1]!.split("/");
      const last = segs[segs.length - 1]!;
      if (NEXT_SPECIAL.test(last)) continue;
      if (last === "index") segs.pop();
      const isApi = segs[0] === "api";
      add({ method: "GET", path: nextPath(segs), kind: isApi ? "api" : "page", file: f.path, interactive });
      continue;
    }

    for (const h of f.content.matchAll(/\b[\w.]+\.(get|post|put|patch|delete|all|options|head)\s*\(\s*["'`]([^"'`]+)["'`]/gi)) {
      const method = h[1]!.toUpperCase() === "ALL" ? "GET" : h[1]!.toUpperCase();
      add({ method, path: h[2]!, kind: "api", file: f.path, interactive });
    }
    for (const h of f.content.matchAll(/\.route\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) add({ method: "GET", path: h[1]!, kind: "api", file: f.path, interactive });
    for (const h of f.content.matchAll(/\bpath\s*[:=]\s*["'`](\/[^"'`]*)["'`]/g)) add({ method: "GET", path: h[1]!, kind: "page", file: f.path, interactive });
  }

  // Handler-discovered pages: a GET handler whose file renders HTML counts as a page.
  for (const r of found.values()) if (r.kind === "api" && r.method === "GET" && r.interactive) r.kind = "page";
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

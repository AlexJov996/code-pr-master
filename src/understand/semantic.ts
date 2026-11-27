import type { DiffLine, FileDiff } from "../core/diff.js";

export type SymbolKind = "function" | "class" | "model" | "import" | "type" | "interface" | "enum" | "const" | "method";

export interface SemanticChange {
  kind: "added" | "removed" | "modified";
  symbolKind: SymbolKind;
  symbol: string;
  /** New-side line (or, for removals, the new-side line where the removal sits). */
  line: number;
  exported: boolean;
}

interface Decl { symbolKind: SymbolKind; symbol: string; exported: boolean }

const DOCS = /\.(md|mdx|rst|txt|adoc|json|lock|ya?ml|toml|ini|svg|png|jpg|gif)$/i;

/** Declaration patterns by file extension family. */
function declaration(path: string, text: string): Decl | undefined {
  const t = text.trimEnd();
  if (/\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i.test(path)) {
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^\s*import\s+(?:[\w*{}\s,]+\s+from\s+)?["']([^"']+)["']/))) return { symbolKind: "import", symbol: m[1]!, exported: false };
    if ((m = t.match(/^\s*(export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/))) return { symbolKind: "function", symbol: m[2]!, exported: Boolean(m[1]) };
    if ((m = t.match(/^\s*(export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/))) return { symbolKind: "class", symbol: m[2]!, exported: Boolean(m[1]) };
    if ((m = t.match(/^\s*(export\s+)?interface\s+(\w+)/))) return { symbolKind: "interface", symbol: m[2]!, exported: Boolean(m[1]) };
    if ((m = t.match(/^\s*(export\s+)?type\s+(\w+)\s*=/))) return { symbolKind: "type", symbol: m[2]!, exported: Boolean(m[1]) };
    if ((m = t.match(/^\s*(export\s+)?(?:const\s+)?enum\s+(\w+)/))) return { symbolKind: "enum", symbol: m[2]!, exported: Boolean(m[1]) };
    if ((m = t.match(/^\s*(export\s+)?(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(.*)$/))) {
      const isFn = /^(async\s*)?\(|^\w+\s*=>|^function\b|^async\s+function\b/.test(m[3]!);
      if (isFn) return { symbolKind: "function", symbol: m[2]!, exported: Boolean(m[1]) };
      if (m[1]) return { symbolKind: "const", symbol: m[2]!, exported: true };
      return undefined;
    }
    return undefined;
  }
  if (/\.prisma$/i.test(path)) {
    const m = t.match(/^(model|enum|type)\s+(\w+)\s*\{/);
    if (m) return { symbolKind: m[1] === "model" ? "model" : m[1] === "enum" ? "enum" : "type", symbol: m[2]!, exported: true };
    return undefined;
  }
  if (/\.py$/i.test(path)) {
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^\s*(?:from\s+(\S+)\s+import|import\s+(\S+))/))) return { symbolKind: "import", symbol: (m[1] ?? m[2])!, exported: false };
    if ((m = t.match(/^(\s*)(?:async\s+)?def\s+(\w+)/))) return { symbolKind: m[1] ? "method" : "function", symbol: m[2]!, exported: !m[2]!.startsWith("_") };
    if ((m = t.match(/^\s*class\s+(\w+)/))) return { symbolKind: "class", symbol: m[1]!, exported: !m[1]!.startsWith("_") };
    return undefined;
  }
  if (/\.go$/i.test(path)) {
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^func\s+(?:\([^)]*\)\s*)?(\w+)/))) return { symbolKind: "function", symbol: m[1]!, exported: /^[A-Z]/.test(m[1]!) };
    if ((m = t.match(/^type\s+(\w+)\s+(struct|interface)/))) return { symbolKind: m[2] === "struct" ? "class" : "interface", symbol: m[1]!, exported: /^[A-Z]/.test(m[1]!) };
    return undefined;
  }
  if (/\.(java|kt|cs|swift|rs|rb|php)$/i.test(path)) {
    let m: RegExpMatchArray | null;
    if ((m = t.match(/^\s*(?:(public|pub|export)\s+)?(?:static\s+|final\s+|abstract\s+|open\s+)*(?:class|struct|enum|interface|trait|module)\s+(\w+)/))) return { symbolKind: "class", symbol: m[2]!, exported: Boolean(m[1]) || /^[A-Z]/.test(m[2]!) };
    if ((m = t.match(/^\s*(?:(pub|public)\s+)?(?:async\s+)?(?:fn|def|function|func)\s+(\w+)/))) return { symbolKind: "function", symbol: m[2]!, exported: Boolean(m[1]) };
    return undefined;
  }
  return undefined;
}

/** Symbol-level view of one file's diff: declarations added or removed, and existing symbols whose body changed. */
export function semanticChanges(file: FileDiff): SemanticChange[] {
  if (DOCS.test(file.path)) return [];
  const out: SemanticChange[] = [];
  const seen = new Set<string>();
  const push = (c: SemanticChange) => {
    const key = `${c.kind}:${c.symbolKind}:${c.symbol}`;
    if (!seen.has(key)) { seen.add(key); out.push(c); }
  };
  const addedSymbols = new Set<string>();

  for (const hunk of file.hunks) {
    let enclosing: { decl: Decl; line: number; added: boolean } | undefined;
    let lastNewLine = hunk.newStart;
    for (const l of hunk.lines as DiffLine[]) {
      if (l.newLine !== undefined) lastNewLine = l.newLine;
      const decl = declaration(file.path, l.content);
      if (decl) {
        if (decl.symbolKind !== "import") enclosing = { decl, line: l.newLine ?? lastNewLine, added: l.type === "add" };
        if (l.type === "add") { push({ kind: "added", symbolKind: decl.symbolKind, symbol: decl.symbol, line: l.newLine!, exported: decl.exported }); addedSymbols.add(decl.symbol); }
        else if (l.type === "del") push({ kind: "removed", symbolKind: decl.symbolKind, symbol: decl.symbol, line: lastNewLine, exported: decl.exported });
        continue;
      }
      if ((l.type === "add" || l.type === "del") && enclosing && !enclosing.added && l.content.trim() !== "") {
        push({ kind: "modified", symbolKind: enclosing.decl.symbolKind, symbol: enclosing.decl.symbol, line: enclosing.line, exported: enclosing.decl.exported });
      }
    }
  }
  // A symbol both removed and re-added is a modification of that symbol.
  return out.filter((c) => !(c.kind === "removed" && addedSymbols.has(c.symbol))).map((c) => (c.kind === "added" && out.some((o) => o.kind === "removed" && o.symbol === c.symbol) ? { ...c, kind: "modified" as const } : c));
}

export function semanticChangesForDiff(files: readonly FileDiff[]): Record<string, SemanticChange[]> {
  const out: Record<string, SemanticChange[]> = {};
  for (const f of files) {
    const changes = semanticChanges(f);
    if (changes.length) out[f.path] = changes;
  }
  return out;
}

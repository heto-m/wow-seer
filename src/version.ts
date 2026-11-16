import fs from "node:fs";

export const VERSION: string = JSON.parse(
  fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
).version;

export function compareVersions(a: string, b: string): number | null {
  const parse = (v: string) => (/^\d+(\.\d+)*$/.test(v.trim()) ? v.trim().split(".").map(Number) : null);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

const series = (v: string) => v.trim().split(".").slice(0, 2).join(".");

export function versionWarning(addon: unknown): string | null {
  const order = typeof addon === "string" ? compareVersions(series(addon), series(VERSION)) : null;
  if (order === 0) return null;
  if (order === 1) {
    return `Seer addon ${addon} is newer than wow-seer ${VERSION}: update the MCP server (npx -y wow-seer@latest).`;
  }
  return `Seer addon ${addon || "unknown"} does not match wow-seer ${VERSION}: ` +
    `close the game and run "npx -y wow-seer install".`;
}

import { spawnSync } from "node:child_process";

function isLua51(bin: string): boolean {
  const r = spawnSync(bin, ["-v"], { encoding: "utf8" });
  return !r.error && /Lua 5\.1|LuaJIT/.test(r.stdout + r.stderr);
}

const wanted = process.env.SEER_LUA;
if (wanted && !isLua51(wanted)) throw new Error(`SEER_LUA=${wanted} is not a working Lua 5.1 or LuaJIT`);

export const LUA = wanted || ["lua5.1", "luajit", "lua"].find(isLua51);

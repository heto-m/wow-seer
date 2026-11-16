import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export function sharedDir(): string {
  let dir = process.env.WOW_SEER_DIR;
  if (!dir) {
    if (process.platform === "darwin") dir = path.join(os.homedir(), "Library", "Caches", "wow-seer");
    else if (process.platform === "win32") dir = path.join(process.env.LOCALAPPDATA || os.homedir(), "wow-seer");
    else dir = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache"), "wow-seer");
  }
  fs.mkdirSync(path.join(dir, "requests"), { recursive: true });
  return dir;
}

// A listening socket is the lock: the OS frees it when the process dies, and Node has no flock.
export class LeaderLock {
  readonly address: string;
  private server: net.Server | null = null;

  constructor(folder: string) {
    this.address = process.platform === "win32"
      ? "\\\\.\\pipe\\wow-seer-" + createHash("sha1").update(path.resolve(folder).toLowerCase()).digest("hex").slice(0, 16)
      : path.join(folder, "leader.sock");
  }

  get held(): boolean {
    return this.server !== null;
  }

  async acquire(): Promise<boolean> {
    if (this.server) return true;
    if (await this.listen()) return true;
    if (process.platform === "win32" || (await this.alive())) return false;
    try {
      fs.unlinkSync(this.address);
    } catch {
      return false;
    }
    return this.listen();
  }

  release(): Promise<void> {
    const server = this.server;
    this.server = null;
    return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
  }

  private listen(): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer((socket) => socket.destroy());
      server.once("error", () => resolve(false));
      server.listen(this.address, () => {
        server.unref();
        this.server = server;
        resolve(true);
      });
    });
  }

  private alive(): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect(this.address);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    });
  }
}

const BUSY = new Set(["EPERM", "EACCES", "EBUSY"]);

export function replaceFile(tmp: string, file: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      // Windows refuses to replace a file another process has open; readers hold it only briefly.
      if (process.platform !== "win32" || attempt >= 10 || !BUSY.has((e as NodeJS.ErrnoException).code ?? "")) {
        fs.rmSync(tmp, { force: true });
        throw e;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10 * attempt);
    }
  }
}

export function writeJson(file: string, data: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data), "utf8");
  replaceFile(tmp, file);
}

export function readJson(file: string): any {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

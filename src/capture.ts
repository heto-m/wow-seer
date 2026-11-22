import { Raw } from "./frame.js";

const TITLE = "World of Warcraft";
const CROP_W = 1200, CROP_H = 160;
const FIND_EVERY = 5000;

export interface Capturer {
  grab(): Promise<Raw | null>;
}

// node-screenshots is optional: without it, or without a window it can read, the addon keeps using Screenshot().
export async function loadCapturer(): Promise<Capturer | string> {
  if (process.env.WOW_SEER_CAPTURE === "0") return "turned off by WOW_SEER_CAPTURE=0";
  let lib: any;
  try {
    const name = "node-screenshots";
    lib = await import(name);
  } catch (e) {
    return `node-screenshots not available: ${(e as Error).message}`;
  }
  const Window = lib.Window ?? lib.default?.Window;
  if (!Window) return "node-screenshots has no Window API";
  let windows: any[] = [];
  let foundAt = -Infinity;
  const find = () => {
    if (Date.now() - foundAt < FIND_EVERY) return;
    foundAt = Date.now();
    try {
      windows = Window.all().filter((w: any) => w.title() === TITLE);
    } catch {
      windows = [];
    }
  };
  return {
    async grab() {
      find();
      for (const w of windows) {
        try {
          if (w.isMinimized()) continue;
          const img = await w.captureImage();
          const crop = await img.crop(0, 0, Math.min(CROP_W, img.width), Math.min(CROP_H, img.height));
          const raw: Buffer = await crop.toRaw();
          return new Raw(raw, crop.width, crop.height);
        } catch (e) {
          foundAt = -Infinity;
          if (process.env.WOW_SEER_DEBUG) process.stderr.write(`wow-seer: capture error ${(e as Error).message}\n`);
        }
      }
      return null;
    },
  };
}

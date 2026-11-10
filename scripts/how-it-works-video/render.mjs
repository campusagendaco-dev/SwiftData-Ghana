// Renders the How It Works videos from scene.html using headless Chrome and ffmpeg.
//   node scripts/how-it-works-video/render.mjs                 render all three
//   node scripts/how-it-works-video/render.mjs --stills <dir>  write one test frame per scene
//   node scripts/how-it-works-video/render.mjs --audio         replace only the sound on existing videos
// Text and timing come from src/lib/howItWorks.ts, so the page and the videos stay in step.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { buildTrack } from "./audio.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const require = createRequire(join(root, "package.json"));
const WebSocket = require("ws");
const esbuild = require("esbuild");

const FPS = 30;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9344;
const stillsIndex = process.argv.indexOf("--stills");
const stillsDir = stillsIndex > -1 ? resolve(process.argv[stillsIndex + 1]) : null;
const audioOnly = process.argv.includes("--audio");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const work = mkdtempSync(join(tmpdir(), "how-it-works-"));
const compiled = join(work, "howItWorks.mjs");
esbuild.buildSync({ entryPoints: [join(root, "src/lib/howItWorks.ts")], outfile: compiled, format: "esm", bundle: true });
const { HOW_IT_WORKS_PATHS, VIDEO_INTRO_SECONDS, VIDEO_STEP_SECONDS } = await import(pathToFileURL(compiled).href);

const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--remote-debugging-port=${PORT}`, "--allow-file-access-from-files", `--user-data-dir=${join(work, "profile")}`, "about:blank"], { stdio: "ignore" });

let target;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(500);
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page"); } catch { /* still starting */ }
}
if (!target) throw new Error("Chrome did not start");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.on("open", r));
let nextId = 0;
const pending = new Map();
ws.on("message", (raw) => {
  const msg = JSON.parse(raw);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result ?? msg.error); pending.delete(msg.id); }
});
const send = (method, params = {}) => new Promise((r) => { const id = ++nextId; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
const capture = async () => Buffer.from((await send("Page.captureScreenshot", { format: "jpeg", quality: 92, clip: { x: 0, y: 0, width: 1080, height: 1080, scale: 1 } })).data, "base64");

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1080, height: 1080, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: pathToFileURL(join(here, "scene.html")).href });
await sleep(2500);
await evaluate("Promise.all(['500','600','700','800','900'].map(w=>document.fonts.load(w+' 40px Poppins'))).then(()=>document.fonts.ready).then(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))))");

const out = join(root, "public/videos");
mkdirSync(out, { recursive: true });
if (stillsDir) mkdirSync(stillsDir, { recursive: true });

const ffmpeg = (args) => {
  const result = spawnSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { shell: true, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "ffmpeg failed");
};

for (const path of HOW_IT_WORKS_PATHS) {
  const duration = await evaluate(`setup(${JSON.stringify(path)}, ${VIDEO_INTRO_SECONDS}, ${VIDEO_STEP_SECONDS})`);
  const video = join(root, "public", path.video);
  const addSound = async () => {
    const events = await evaluate("audioEvents()");
    const wav = join(work, `${path.id}.wav`);
    const mixed = `${video}.tmp.mp4`;
    writeFileSync(wav, buildTrack(duration, events, path.id));
    ffmpeg(["-i", `"${video}"`, "-i", `"${wav}"`, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-af", "loudnorm=I=-17:TP=-2:LRA=9", "-ar", "44100", "-c:a", "aac", "-b:a", "112k", "-t", String(duration), "-movflags", "+faststart", `"${mixed}"`]);
    renameSync(mixed, video);
    console.log(`${path.id}: sound added, ${events.length} effects, ${(statSync(video).size / 1048576).toFixed(1)} MB`);
  };
  if (audioOnly) {
    await addSound();
    continue;
  }
  if (stillsDir) {
    const times = [1.5, ...path.steps.map((s) => s.start + VIDEO_STEP_SECONDS * 0.65), duration - 1.5];
    for (const [i, t] of times.entries()) {
      await evaluate(`seek(${t})`);
      await sleep(60);
      writeFileSync(join(stillsDir, `${path.id}-${i}.jpg`), await capture());
    }
    continue;
  }
  const frames = join(work, path.id);
  mkdirSync(frames, { recursive: true });
  const count = Math.round(duration * FPS);
  for (let f = 0; f < count; f++) {
    await evaluate(`seek(${f / FPS})`);
    writeFileSync(join(frames, `${String(f).padStart(5, "0")}.jpg`), await capture());
    if (f % 300 === 0) console.log(`${path.id}: frame ${f}/${count}`);
  }
  ffmpeg(["-framerate", String(FPS), "-i", `"${join(frames, "%05d.jpg")}"`, "-vf", "scale=in_range=full:out_range=tv,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "25", "-color_range", "tv", "-movflags", "+faststart", "-an", `"${video}"`]);
  await addSound();
  const posterFrame = Math.round((path.steps[0].start + VIDEO_STEP_SECONDS * 0.65) * FPS);
  const poster = join(out, `how-it-works-${path.id}.webp`);
  ffmpeg(["-i", `"${join(frames, `${String(posterFrame).padStart(5, "0")}.jpg`)}"`, "-vf", "scale=720:720", "-c:v", "libwebp", "-quality", "78", `"${poster}"`]);
  console.log(`${path.id}: ${(statSync(video).size / 1048576).toFixed(1)} MB, ${duration}s, poster ${existsSync(poster)}`);
}

ws.close();
chrome.kill();
await sleep(1500);
try { rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* Chrome may still hold its temp profile */ }
process.exit(0);

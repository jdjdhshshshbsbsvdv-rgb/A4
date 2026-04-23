import fs from "node:fs";
import path from "node:path";
import { execSync, execFileSync, spawn } from "node:child_process";
import axios from "axios";
import FormData from "form-data";
import { GoogleGenAI, Modality } from "@google/genai";
import { createCanvas } from "@napi-rs/canvas";
import { Jimp } from "jimp";
import gplay from "google-play-scraper";
import yts from "yt-search";
import crypto from "node:crypto";

export const IMAGES_DIR = path.resolve("images");
export const VIDEOS_DIR = path.resolve("videos");
export const AUDIO_DIR = path.resolve("audio");
export const DOWNLOADS_DIR = path.resolve("downloads");
export const APKS_DIR = path.resolve("apks");
export const CODE_DIR = path.resolve("code");
for (const d of [IMAGES_DIR, VIDEOS_DIR, AUDIO_DIR, DOWNLOADS_DIR, APKS_DIR, CODE_DIR]) fs.mkdirSync(d, { recursive: true });

const CODE_EXT_MAP = {
  javascript: "js", js: "js", node: "js",
  typescript: "ts", ts: "ts",
  jsx: "jsx", tsx: "tsx",
  python: "py", py: "py",
  java: "java",
  kotlin: "kt", kt: "kt",
  swift: "swift",
  c: "c",
  "c++": "cpp", cpp: "cpp", cxx: "cpp",
  "c#": "cs", csharp: "cs", cs: "cs",
  go: "go", golang: "go",
  rust: "rs", rs: "rs",
  ruby: "rb", rb: "rb",
  php: "php",
  perl: "pl",
  bash: "sh", shell: "sh", sh: "sh", zsh: "sh",
  powershell: "ps1", ps1: "ps1",
  batch: "bat", bat: "bat",
  html: "html", htm: "html",
  css: "css", scss: "scss", less: "less",
  sql: "sql",
  json: "json",
  yaml: "yml", yml: "yml",
  xml: "xml",
  toml: "toml",
  ini: "ini",
  markdown: "md", md: "md",
  dart: "dart",
  scala: "scala",
  lua: "lua",
  r: "r",
  matlab: "m",
  vue: "vue",
  svelte: "svelte",
  graphql: "graphql", gql: "gql",
  dockerfile: "Dockerfile",
  makefile: "Makefile",
  text: "txt", txt: "txt", plain: "txt",
};

export async function runCode({ code, language, stdin }) {
  if (!code || !String(code).trim()) return { ok: false, error: "empty code" };
  const lang = String(language || "").toLowerCase().trim();
  const langMap = {
    python: { ext: "py", cmd: "python3" }, py: { ext: "py", cmd: "python3" }, python3: { ext: "py", cmd: "python3" },
    javascript: { ext: "js", cmd: "node" }, js: { ext: "js", cmd: "node" }, node: { ext: "js", cmd: "node" }, nodejs: { ext: "js", cmd: "node" },
    bash: { ext: "sh", cmd: "bash" }, sh: { ext: "sh", cmd: "bash" }, shell: { ext: "sh", cmd: "bash" },
  };
  const cfg = langMap[lang];
  if (!cfg) return { ok: false, error: `unsupported language '${lang}'. Use python, javascript, or bash.` };
  const runDir = path.join(process.cwd(), "code_runs");
  if (!fs.existsSync(runDir)) fs.mkdirSync(runDir, { recursive: true });
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const file = path.join(runDir, `${id}.${cfg.ext}`);
  fs.writeFileSync(file, String(code));
  return new Promise((resolve) => {
    const proc = spawn(cfg.cmd, [file], {
      cwd: runDir,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUNBUFFERED: "1" },
      timeout: 20000,
    });
    let stdout = "", stderr = "", killed = false;
    const MAX = 8000;
    proc.stdout.on("data", (d) => { if (stdout.length < MAX) stdout += d.toString(); });
    proc.stderr.on("data", (d) => { if (stderr.length < MAX) stderr += d.toString(); });
    if (stdin) { try { proc.stdin.write(String(stdin)); proc.stdin.end(); } catch {} }
    const timer = setTimeout(() => { killed = true; try { proc.kill("SIGKILL"); } catch {} }, 20000);
    proc.on("close", (codeExit) => {
      clearTimeout(timer);
      try { fs.unlinkSync(file); } catch {}
      const truncate = (s) => s.length >= MAX ? s.slice(0, MAX) + "\n…[truncated]" : s;
      resolve({
        ok: !killed && codeExit === 0,
        language: lang,
        exitCode: codeExit,
        stdout: truncate(stdout) || "(no output)",
        stderr: truncate(stderr) || "",
        timedOut: killed,
      });
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      try { fs.unlinkSync(file); } catch {}
      resolve({ ok: false, error: `spawn failed: ${e.message}` });
    });
  });
}

export async function carbonCode({ code, language, filename, theme, background }) {
  if (!code || !String(code).trim()) return { ok: false, error: "empty code" };
  const safe = String(filename || "code").replace(/[^a-zA-Z0-9_\-]/g, "").slice(0, 40) || "code";
  const out = path.join(IMAGES_DIR, `${safe}_carbon.png`);
  const themes = ["dracula", "monokai", "nord", "one-dark", "synthwave-84", "night-owl", "panda-syntax", "shades-of-purple", "vscode", "material", "oceanic-next"];
  const chosenTheme = themes.includes(String(theme || "").toLowerCase()) ? String(theme).toLowerCase() : "dracula";
  try {
    const r = await axios.post("https://carbonara.solopov.dev/api/cook", {
      code: String(code),
      backgroundColor: background || "#1F816D",
      theme: chosenTheme,
      fontSize: "14px",
      language: language || "auto",
      windowControls: true,
      paddingVertical: "48px",
      paddingHorizontal: "48px",
      lineNumbers: true,
      dropShadow: true,
      widthAdjustment: true,
    }, {
      responseType: "arraybuffer",
      timeout: 45000,
      headers: { "content-type": "application/json" },
    });
    if (!r.data || r.data.byteLength < 1000) return { ok: false, error: "carbon api returned empty" };
    fs.writeFileSync(out, Buffer.from(r.data));
    return { ok: true, path: rel(out), theme: chosenTheme };
  } catch (e) {
    return { ok: false, error: `carbon failed: ${e.response?.status || e.message}` };
  }
}

export async function sendCodeFile({ code, language, filename }) {
  if (!code || !String(code).trim()) return { ok: false, error: "empty code" };
  const lang = String(language || "text").toLowerCase().trim();
  const ext = CODE_EXT_MAP[lang] || "txt";
  const isSpecialName = ext === "Dockerfile" || ext === "Makefile";
  const safe = String(filename || "snippet").replace(/[^a-zA-Z0-9_\-]/g, "").slice(0, 40) || "snippet";
  const name = isSpecialName ? ext : `${safe}.${ext}`;
  const out = path.join(CODE_DIR, name);
  fs.writeFileSync(out, String(code), "utf8");
  return { ok: true, path: rel(out), language: lang, ext };
}

const APKEEP_BIN = path.resolve("bin/apkeep");

let _ai = null;
function getAI() {
  if (_ai) return _ai;
  if (!process.env.AI_INTEGRATIONS_GEMINI_API_KEY) return null;
  _ai = new GoogleGenAI({
    apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
    httpOptions: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL
      ? { apiVersion: "", baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL }
      : undefined,
  });
  return _ai;
}

const safeName = (s, fallback) =>
  String(s || fallback).replace(/[^a-zA-Z0-9]/g, "").slice(0, 40) || `out${Date.now()}`;

const rel = (p) => path.relative(process.cwd(), p);

const FIREWORKS_KEY = Buffer.from("ZndfM1pRTVh3RHdxM2paODg0SnkyQUVyZGl5", "base64").toString("utf8");
const FW_BASE = "https://api.fireworks.ai/inference/v1/workflows/accounts/fireworks/models";

async function fwPoll(model, id) {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { data } = await axios.post(`${FW_BASE}/${model}/get_result`, { id }, {
      headers: { Authorization: `Bearer ${FIREWORKS_KEY}` },
      timeout: 30000,
    });
    const state = data.status?.state ?? data.status;
    if (["Ready", "SUCCESS", "COMPLETE", "succeeded"].includes(state) || data.result) return data;
    if (["FAILED", "ERROR", "failed"].includes(state)) throw new Error(`fireworks failed: ${JSON.stringify(data.status)}`);
  }
  throw new Error("fireworks polling timeout");
}

export async function nanoBananaImage({ prompt, filename }) {
  try {
    const r = await axios.post(
      `${FW_BASE}/flux-1-schnell-fp8/text_to_image`,
      { prompt },
      {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${FIREWORKS_KEY}`, Accept: "image/jpeg" },
        responseType: "arraybuffer",
        timeout: 60000,
      }
    );
    const file = path.join(IMAGES_DIR, `${safeName(filename, "image")}.jpg`);
    fs.writeFileSync(file, Buffer.from(r.data));
    return { ok: true, path: rel(file) };
  } catch (e) {
    const msg = e.response?.data ? Buffer.from(e.response.data).toString().slice(0, 200) : e.message;
    return { ok: false, error: `fireworks T2I failed: ${msg}` };
  }
}

export async function editImage({ input, prompt, filename }) {
  try {
    if (!input || !fs.existsSync(input)) return { ok: false, error: "input image path missing or not found" };
    if (!prompt) return { ok: false, error: "prompt required" };
    const b64 = fs.readFileSync(input).toString("base64");
    const model = "flux-kontext-pro";
    const init = await axios.post(
      `${FW_BASE}/${model}`,
      { prompt, input_image: b64 },
      { headers: { "Content-Type": "application/json", Authorization: `Bearer ${FIREWORKS_KEY}` }, timeout: 60000 }
    );
    const taskId = init.data.id || init.data.request_id;
    if (!taskId) return { ok: false, error: "no task id from fireworks" };
    const result = await fwPoll(model, taskId);
    const res = result.result || {};
    let buf;
    if (res.sample) {
      const dl = await axios.get(res.sample, { responseType: "arraybuffer", timeout: 60000 });
      buf = Buffer.from(dl.data);
    } else if (res.base64) {
      buf = Buffer.from(res.base64, "base64");
    } else {
      return { ok: false, error: "no image in fireworks response" };
    }
    const file = path.join(IMAGES_DIR, `${safeName(filename, "edit")}.jpg`);
    fs.writeFileSync(file, buf);
    return { ok: true, path: rel(file) };
  } catch (e) {
    const msg = e.response?.data ? (Buffer.isBuffer(e.response.data) ? e.response.data.toString() : JSON.stringify(e.response.data)).slice(0, 200) : e.message;
    return { ok: false, error: `fireworks I2I failed: ${msg}` };
  }
}

const AILABS_CIPHER = "hbMcgZLlzvghRlLbPcTbCpfcQKM0PcU0zhPcTlOFMxBZ1oLmruzlVp9remPgi0QWP0QW";
const dec = (t, s) =>
  [...t].map((c) =>
    /[a-z]/.test(c) ? String.fromCharCode(((c.charCodeAt(0) - 97 - s + 26) % 26) + 97)
    : /[A-Z]/.test(c) ? String.fromCharCode(((c.charCodeAt(0) - 65 - s + 26) % 26) + 65)
    : c
  ).join("");
const AILABS_TOKEN = dec(AILABS_CIPHER, 3);
const AILABS_HEADERS = {
  "user-agent": "NB Android/1.0.0",
  "accept-encoding": "gzip",
  authorization: AILABS_TOKEN,
};

export async function aiLabsImage({ prompt, filename }) {
  const f = new FormData();
  f.append("prompt", prompt);
  f.append("token", AILABS_TOKEN);
  const r = await axios.post("https://text2video.aritek.app/text2img", f, {
    headers: { ...AILABS_HEADERS, ...f.getHeaders() },
    timeout: 30000,
  });
  if (r.data?.code !== 0 || !r.data?.url) return { ok: false, error: "aiLabs failed" };
  const img = await axios.get(r.data.url.trim(), { responseType: "arraybuffer", timeout: 30000 });
  const ext = (r.data.url.split(".").pop() || "jpg").split("?")[0];
  const file = path.join(IMAGES_DIR, `${safeName(filename, "alimage")}.${ext}`);
  fs.writeFileSync(file, Buffer.from(img.data));
  return { ok: true, path: rel(file) };
}

function colorize(ctx, width, colors) {
  if (Array.isArray(colors)) {
    const g = ctx.createLinearGradient(0, 0, width, 0);
    const step = 1 / (colors.length - 1);
    colors.forEach((c, i) => g.addColorStop(i * step, c));
    return g;
  }
  return colors;
}

async function renderTextFrame(text, opts) {
  const W = 512, H = 512, margin = 20, wordSpacing = 25;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = colorize(ctx, W, opts.background) || "white";
  ctx.fillRect(0, 0, W, H);
  let fontSize = 150;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `${fontSize}px Sans-serif`;
  const words = text.split(" ");
  const colors = words.map(() => opts.color || "black");
  let lines = [];
  const rebuild = () => {
    lines = [];
    let cur = "";
    for (const w of words) {
      if (ctx.measureText(w).width > W - 2 * margin) {
        fontSize -= 2; ctx.font = `${fontSize}px Sans-serif`; return rebuild();
      }
      const test = cur ? `${cur} ${w}` : w;
      const tw = ctx.measureText(test).width + (cur.split(" ").length - 1) * wordSpacing;
      if (tw < W - 2 * margin) cur = test; else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
  };
  rebuild();
  while (lines.length * fontSize * 1.3 > H - 2 * margin) {
    fontSize -= 2; ctx.font = `${fontSize}px Sans-serif`; rebuild();
  }
  const lineH = fontSize * 1.3;
  let y = margin, idx = 0;
  for (const line of lines) {
    const ws = line.split(" ");
    let x = margin;
    const sp = (W - 2 * margin - ctx.measureText(ws.join("")).width) / Math.max(1, ws.length - 1);
    for (const w of ws) {
      ctx.fillStyle = colorize(ctx, ctx.measureText(w).width, colors[idx]);
      ctx.fillText(w, x, y);
      x += ctx.measureText(w).width + sp;
      idx++;
    }
    y += lineH;
  }
  let buf = canvas.toBuffer("image/png");
  if (opts.blur) {
    const im = await Jimp.read(buf);
    im.blur(opts.blur);
    buf = await im.getBuffer("image/png");
  }
  return buf;
}

export async function bratVideo({ text, filename, speed = "normal" }) {
  const out = path.join(VIDEOS_DIR, `${safeName(filename, "brat")}.mp4`);
  const tmp = fs.mkdtempSync(path.join(VIDEOS_DIR, "brat"));
  const words = text.split(" ");
  const frames = [];
  for (let i = 0; i < words.length; i++) {
    const partial = words.slice(0, i + 1).join(" ");
    const buf = await renderTextFrame(partial, { background: "white", color: ["#ff0066", "#00ccff"], blur: 1 });
    const fp = path.join(tmp, `f${i}.png`);
    fs.writeFileSync(fp, buf);
    frames.push(fp);
  }
  const dur = { fast: 0.4, normal: 1, slow: 1.6 }[speed] || 1;
  const list = path.join(tmp, "list.txt");
  let txt = "";
  for (const f of frames) txt += `file '${f}'\nduration ${dur}\n`;
  txt += `file '${frames[frames.length - 1]}'\nduration 2\n`;
  fs.writeFileSync(list, txt);
  execSync(`ffmpeg -y -f concat -safe 0 -i "${list}" -vf "fps=30,format=yuv420p" "${out}"`, { stdio: "ignore" });
  fs.rmSync(tmp, { recursive: true, force: true });
  return { ok: true, path: rel(out) };
}

const YT_URL_RE = /^((?:https?:)?\/\/)?((?:www|m|music)\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(?:embed\/)?(?:v\/)?(?:shorts\/)?([a-zA-Z0-9_-]{11})/;

const SAVETUBE_KEY_HEX = "C5D58EF67A7584E4A29F6C35BBC4EB12";
const savetubeAxios = axios.create({
  headers: {
    "content-type": "application/json",
    origin: "https://yt.savetube.me",
    "user-agent": "Mozilla/5.0 (Android 15; Mobile)",
  },
  timeout: 60000,
});
function decryptSavetube(b64) {
  const buf = Buffer.from(b64, "base64");
  const key = Buffer.from(SAVETUBE_KEY_HEX, "hex");
  const iv = buf.slice(0, 16);
  const data = buf.slice(16);
  const dec = crypto.createDecipheriv("aes-128-cbc", key, iv);
  return JSON.parse(Buffer.concat([dec.update(data), dec.final()]).toString());
}
async function savetubeDownloadUrl(videoId, downloadType, quality) {
  const cdn = (await savetubeAxios.get("https://media.savetube.vip/api/random-cdn")).data.cdn;
  const info = await savetubeAxios.post(`https://${cdn}/v2/info`, { url: `https://www.youtube.com/watch?v=${videoId}` });
  if (!info.data?.data) throw new Error(info.data?.message || "savetube info failed");
  const dec = decryptSavetube(info.data.data);
  const dl = await savetubeAxios.post(`https://${cdn}/download`, { id: videoId, downloadType, quality, key: dec.key });
  if (!dl.data?.data?.downloadUrl) throw new Error("savetube download url missing");
  return { downloadUrl: dl.data.data.downloadUrl, title: dec.title, duration: dec.duration };
}
async function downloadToFile(url, outPath) {
  const r = await axios.get(url, { responseType: "stream", timeout: 300000 });
  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(outPath);
    r.data.pipe(w);
    r.data.on("error", reject);
    w.on("finish", resolve);
    w.on("error", reject);
  });
}
async function ytdlpDownload(url, outBase, type) {
  const args = ["--no-warnings", "--no-playlist", "--restrict-filenames", "-o", `${outBase}.%(ext)s`];
  if (type === "audio") {
    // Avoid HLS which breaks ffmpeg extraction; prefer m4a/webm direct streams
    args.push(
      "-f", "bestaudio[protocol^=https][ext=m4a]/bestaudio[protocol^=https][ext=webm]/bestaudio[protocol^=https]/bestaudio",
      "-x", "--audio-format", "mp3", "--audio-quality", "0",
    );
  } else {
    args.push("-f", "bv*[ext=mp4][protocol^=https]+ba[protocol^=https]/b[ext=mp4]/best", "--merge-output-format", "mp4");
  }
  args.push(url);
  execFileSync("yt-dlp", args, { stdio: "pipe", timeout: 180000 });
  const dir = path.dirname(outBase);
  const prefix = path.basename(outBase);
  const found = fs.readdirSync(dir).filter((f) => f.startsWith(prefix + ".")).sort().pop();
  if (!found) throw new Error("no file produced");
  return path.join(dir, found);
}

export async function socialDownload({ url, type = "video", filename }) {
  if (!url || !/^https?:\/\//.test(url)) return { ok: false, error: "invalid url" };
  const base = path.join(DOWNLOADS_DIR, safeName(filename, "media"));
  const ytMatch = url.match(YT_URL_RE);
  const errors = [];

  // For YouTube, prefer SaveTube (audio) or yt-dlp (video) — yt-dlp HLS audio is broken on YouTube
  if (ytMatch) {
    const videoId = ytMatch[3];
    if (type === "audio") {
      try {
        const { downloadUrl } = await savetubeDownloadUrl(videoId, "audio", "128");
        const out = `${base}.mp3`;
        await downloadToFile(downloadUrl, out);
        return { ok: true, path: rel(out) };
      } catch (e) { errors.push(`savetube: ${e.message}`); }
      try {
        const { downloadUrl } = await savetubeDownloadUrl(videoId, "audio", "320");
        const out = `${base}.mp3`;
        await downloadToFile(downloadUrl, out);
        return { ok: true, path: rel(out) };
      } catch (e) { errors.push(`savetube-320: ${e.message}`); }
    } else {
      try {
        const { downloadUrl } = await savetubeDownloadUrl(videoId, "video", "720");
        const out = `${base}.mp4`;
        await downloadToFile(downloadUrl, out);
        return { ok: true, path: rel(out) };
      } catch (e) { errors.push(`savetube-vid: ${e.message}`); }
    }
  }

  // Fallback / non-YouTube: yt-dlp
  try {
    const file = await ytdlpDownload(url, base, type);
    return { ok: true, path: rel(file) };
  } catch (e) {
    errors.push(`yt-dlp: ${(e.stderr || e.stdout || e.message).toString().slice(-200)}`);
  }
  return { ok: false, error: `download failed — ${errors.join(" | ")}` };
}

export async function toSticker({ input, filename, animated }) {
  if (!input || !fs.existsSync(input)) return { ok: false, error: "input file not found" };
  const isVideo = /\.(mp4|mov|webm|gif|mkv|avi)$/i.test(input);
  const useAnimated = animated ?? isVideo;
  const out = path.join(IMAGES_DIR, `${safeName(filename, "sticker")}.webp`);
  const vf = "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=#00000000,format=rgba";
  const cmd = useAnimated
    ? `ffmpeg -y -t 6 -i "${input}" -vf "${vf},fps=15" -loop 0 -an -c:v libwebp -lossless 0 -compression_level 6 -q:v 50 -preset default "${out}"`
    : `ffmpeg -y -i "${input}" -vf "${vf}" -vframes 1 -c:v libwebp -lossless 0 -q:v 80 "${out}"`;
  try { execSync(cmd, { stdio: "pipe", timeout: 60000 }); }
  catch (e) { return { ok: false, error: `sticker failed: ${(e.stderr || e.message).toString().slice(-200)}` }; }
  return { ok: true, path: rel(out) };
}

function pcmToWav(pcm, sampleRate = 24000, channels = 1, bits = 16) {
  const byteRate = sampleRate * channels * bits / 8;
  const blockAlign = channels * bits / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function detectLang(text) {
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh";
  if (/[\u0400-\u04FF]/.test(text)) return "ru";
  if (/[éèêàâçùîôœ]/i.test(text)) return "fr";
  if (/[áéíóúñ¿¡]/i.test(text)) return "es";
  return "en";
}
function chunkText(text, max = 190) {
  const chunks = [];
  let cur = "";
  for (const word of text.split(/(\s+)/)) {
    if ((cur + word).length > max && cur) { chunks.push(cur); cur = word; }
    else cur += word;
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}
export async function textToSpeech({ text, lang, filename }) {
  if (!text) return { ok: false, error: "empty text" };
  const tl = lang || detectLang(text);
  const chunks = chunkText(text);
  const tmpDir = fs.mkdtempSync(path.join(AUDIO_DIR, "tts"));
  const partFiles = [];
  try {
    for (let i = 0; i < chunks.length; i++) {
      const u = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunks[i])}&tl=${tl}&client=tw-ob&total=${chunks.length}&idx=${i}&textlen=${chunks[i].length}`;
      const r = await axios.get(u, { responseType: "arraybuffer", timeout: 30000, headers: { "user-agent": "Mozilla/5.0", referer: "https://translate.google.com/" } });
      if (!r.data || r.data.byteLength < 200) throw new Error("empty audio chunk");
      const fp = path.join(tmpDir, `p${i}.mp3`);
      fs.writeFileSync(fp, Buffer.from(r.data));
      partFiles.push(fp);
    }
    const mp3Out = path.join(tmpDir, "merged.mp3");
    if (partFiles.length === 1) fs.copyFileSync(partFiles[0], mp3Out);
    else {
      const list = path.join(tmpDir, "list.txt");
      fs.writeFileSync(list, partFiles.map((f) => `file '${f}'`).join("\n"));
      execSync(`ffmpeg -y -f concat -safe 0 -i "${list}" -c copy "${mp3Out}"`, { stdio: "pipe" });
    }
    const out = path.join(AUDIO_DIR, `${safeName(filename, "speech")}.ogg`);
    execSync(`ffmpeg -y -i "${mp3Out}" -c:a libopus -b:a 48k -ac 1 -ar 48000 "${out}"`, { stdio: "pipe" });
    if (!fs.existsSync(out) || fs.statSync(out).size < 200) throw new Error("opus encode failed");
    return { ok: true, path: rel(out) };
  } catch (e) {
    return { ok: false, error: `tts failed: ${e.response?.status || e.message}` };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const KNOWN_PACKAGES = {
  whatsapp: "com.whatsapp",
  "whatsapp business": "com.whatsapp.w4b",
  telegram: "org.telegram.messenger",
  "telegram x": "org.thunderdog.challegram",
  signal: "org.thoughtcrime.securesms",
  instagram: "com.instagram.android",
  facebook: "com.facebook.katana",
  messenger: "com.facebook.orca",
  twitter: "com.twitter.android",
  x: "com.twitter.android",
  tiktok: "com.zhiliaoapp.musically",
  snapchat: "com.snapchat.android",
  youtube: "com.google.android.youtube",
  "youtube music": "com.google.android.apps.youtube.music",
  spotify: "com.spotify.music",
  netflix: "com.netflix.mediaclient",
  shazam: "com.shazam.android",
  vlc: "org.videolan.vlc",
  chrome: "com.android.chrome",
  firefox: "org.mozilla.firefox",
  opera: "com.opera.browser",
  brave: "com.brave.browser",
  duckduckgo: "com.duckduckgo.mobile.android",
  zoom: "us.zoom.videomeetings",
  discord: "com.discord",
  reddit: "com.reddit.frontpage",
  pinterest: "com.pinterest",
  linkedin: "com.linkedin.android",
  uber: "com.ubercab",
  careem: "com.careem.acma",
  inDriver: "sinet.startup.inDriver",
  indrive: "sinet.startup.inDriver",
  "google maps": "com.google.android.apps.maps",
  waze: "com.waze",
  paypal: "com.paypal.android.p2pmobile",
  amazon: "com.amazon.mShop.android.shopping",
  aliexpress: "com.alibaba.aliexpresshd",
  jumia: "com.jumia.android",
  shein: "com.zzkko",
  temu: "com.einnovation.temu",
  cashplus: "ma.cashplus.cashplus",
  capcut: "com.lemon.lvoverseas",
  canva: "com.canva.editor",
  duolingo: "com.duolingo",
  shahid: "net.mbc.shahidTV",
  "yango": "com.yandex.yango",
  yango: "com.yandex.yango",
  "google translate": "com.google.android.apps.translate",
  translate: "com.google.android.apps.translate",
  gmail: "com.google.android.gm",
  "google drive": "com.google.android.apps.docs",
  "google photos": "com.google.android.apps.photos",
  pubg: "com.tencent.ig",
  "pubg mobile": "com.tencent.ig",
  "free fire": "com.dts.freefireth",
  freefire: "com.dts.freefireth",
  minecraft: "com.mojang.minecraftpe",
  "clash of clans": "com.supercell.clashofclans",
  "clash royale": "com.supercell.clashroyale",
  "candy crush": "com.king.candycrushsaga",
  termux: "com.termux",
  "kine master": "com.nexstreaming.app.kinemasterfree",
  kinemaster: "com.nexstreaming.app.kinemasterfree",
  "alight motion": "com.alightcreative.motion",
  picsart: "com.picsart.studio",
  vsco: "com.vsco.cam",
  lightroom: "com.adobe.lrmobile",
  "imo": "com.imo.android.imoim",
  imo: "com.imo.android.imoim",
};

function isPkgId(s) {
  return /^[a-z][\w]*(\.[a-z][\w]*)+$/i.test(String(s || "").trim());
}

async function searchApkPurePackage(query) {
  const q = String(query).trim();
  if (isPkgId(q)) return q;
  const known = KNOWN_PACKAGES[q.toLowerCase()];
  if (known) return known;

  // Primary: Google Play search (most reliable source for app IDs)
  try {
    const results = await gplay.search({ term: q, num: 5, throttle: 5 });
    if (results && results.length) {
      const exact = results.find(r => r.title?.toLowerCase() === q.toLowerCase());
      const pick = exact || results[0];
      if (pick?.appId) return pick.appId;
    }
  } catch (e) {
    console.error("gplay search failed:", e.message);
  }

  // Try DuckDuckGo HTML to find an apkpure page revealing the package id
  try {
    const r = await axios.get("https://html.duckduckgo.com/html/", {
      params: { q: `${q} apkpure site:apkpure.com OR site:apkpure.net` },
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
      },
      timeout: 20000,
    });
    const html = String(r.data || "");
    const re = /apkpure\.(?:com|net)\/[^\/"\s]+\/([a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+)/g;
    let m;
    while ((m = re.exec(html))) {
      const pkg = m[1];
      if (pkg.split(".").length >= 2 && !/^apkpure/i.test(pkg)) return pkg;
    }
  } catch {}

  // Fallback: Google search result snippet
  try {
    const r = await axios.get("https://www.google.com/search", {
      params: { q: `${q} android package id site:apkpure.com OR site:play.google.com` },
      headers: {
        "user-agent": "Mozilla/5.0 (Linux; Android 10; SM-A205U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
      },
      timeout: 20000,
      validateStatus: s => s < 500,
    });
    const html = String(r.data || "");
    const re = /(?:id=|apkpure\.(?:com|net)\/[^\/"\s]+\/)([a-z][\w]*(?:\.[a-z][\w]*)+)/gi;
    let m;
    while ((m = re.exec(html))) {
      const pkg = m[1];
      if (pkg.split(".").length >= 2 && !/^apkpure/i.test(pkg)) return pkg;
    }
  } catch {}

  return null;
}

const UA_DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function resolveApkUrl(pkg) {
  const url = `https://d.apkpure.com/b/APK/${encodeURIComponent(pkg)}?version=latest`;
  // Use curl because apkpure blocks Node's TLS fingerprint with 403
  let headers = "";
  try {
    headers = execFileSync("curl", [
      "-sIL",
      "-A", UA_DESKTOP,
      "-H", "accept-language: en-US,en;q=0.9",
      "-H", "referer: https://apkpure.com/",
      "--max-time", "30",
      url,
    ], { timeout: 35000 }).toString();
  } catch (e) {
    throw new Error(`apkpure resolve failed: ${e.message}`);
  }
  let filename = `${pkg}.apk`;
  let size = 0;
  // Parse last response block
  const blocks = headers.split(/\r?\n\r?\n/).filter(Boolean);
  const last = blocks[blocks.length - 1] || headers;
  const cdMatch = last.match(/content-disposition:\s*[^\r\n]*filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i);
  if (cdMatch) filename = decodeURIComponent(cdMatch[1]).replace(/[\/\\]/g, "_").trim();
  const clMatch = last.match(/content-length:\s*(\d+)/i);
  if (clMatch) size = parseInt(clMatch[1], 10);

  // Find final URL after redirects
  let finalUrl = url;
  const locMatches = [...headers.matchAll(/^location:\s*(\S+)/gim)];
  if (locMatches.length) finalUrl = locMatches[locMatches.length - 1][1].trim();

  return { url: finalUrl, filename, size };
}

function downloadWithAria2(url, outDir, filename) {
  execFileSync("aria2c", [
    "-x", "16",
    "-s", "16",
    "-j", "1",
    "--min-split-size=1M",
    "--max-tries=3",
    "--retry-wait=2",
    "--connect-timeout=20",
    "--timeout=60",
    "--allow-overwrite=true",
    "--auto-file-renaming=false",
    "--quiet=true",
    "--user-agent=" + UA_DESKTOP,
    "--header=Accept-Language: en-US,en;q=0.9",
    "-d", outDir,
    "-o", filename,
    url,
  ], { stdio: "pipe", timeout: 600000 });
  return path.join(outDir, filename);
}

export async function getApk({ query }) {
  if (!query || !query.trim()) return { ok: false, error: "empty query" };
  let pkg;
  try { pkg = await searchApkPurePackage(query); }
  catch (e) { return { ok: false, error: `search failed: ${e.message}` }; }
  if (!pkg) return { ok: false, error: "app not found on APKPure" };

  const outDir = fs.mkdtempSync(path.join(APKS_DIR, "dl"));
  try {
    const { url, filename } = await resolveApkUrl(pkg);
    const filePath = downloadWithAria2(url, outDir, filename);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 10240) {
      throw new Error("downloaded file missing or too small");
    }
    const finalPath = path.join(APKS_DIR, filename);
    fs.renameSync(filePath, finalPath);
    fs.rmSync(outDir, { recursive: true, force: true });
    return { ok: true, path: rel(finalPath), pkg, name: filename };
  } catch (e) {
    fs.rmSync(outDir, { recursive: true, force: true });
    if (fs.existsSync(APKEEP_BIN)) {
      try {
        const fbDir = fs.mkdtempSync(path.join(APKS_DIR, "fb"));
        execFileSync(APKEEP_BIN, ["-a", pkg, "-d", "apk-pure", fbDir], { stdio: "pipe", timeout: 240000 });
        const files = fs.readdirSync(fbDir).filter(f => /\.(apk|xapk)$/i.test(f));
        if (files.length) {
          const finalPath = path.join(APKS_DIR, files[0]);
          fs.renameSync(path.join(fbDir, files[0]), finalPath);
          fs.rmSync(fbDir, { recursive: true, force: true });
          return { ok: true, path: rel(finalPath), pkg, name: files[0] };
        }
        fs.rmSync(fbDir, { recursive: true, force: true });
      } catch {}
    }
    const msg = (e.stderr || e.stdout || e.message || "").toString().slice(-300);
    return { ok: false, error: `download failed: ${msg}` };
  }
}

export async function fetchUrl({ url }) {
  if (!url || !/^https?:\/\//.test(url)) return { ok: false, error: "invalid url" };
  try {
    const r = await axios.get(url, {
      timeout: 25000,
      maxRedirects: 5,
      responseType: "text",
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "accept-language": "ar,en;q=0.9,fr;q=0.8",
      },
      validateStatus: (s) => s < 500,
    });
    let html = String(r.data || "");
    const pickMeta = (re) => { const m = html.match(re); return m ? m[1].trim() : ""; };
    const title = pickMeta(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const ogTitle = pickMeta(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
    const ogDesc = pickMeta(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    const metaDesc = pickMeta(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
    const keywords = pickMeta(/<meta[^>]+name=["']keywords["'][^>]+content=["']([^"']+)["']/i);

    let ytExtra = "";
    if (/youtube\.com|youtu\.be/i.test(url)) {
      const sd = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
      const vt = html.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/);
      const ch = html.match(/"author":"((?:[^"\\]|\\.)*)"/);
      const vs = html.match(/"viewCount":"(\d+)"/);
      const decode = s => s ? s.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/\\u([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))) : "";
      ytExtra = [vt && `العنوان: ${decode(vt[1])}`, ch && `القناة: ${decode(ch[1])}`, vs && `المشاهدات: ${vs[1]}`, sd && `الوصف:\n${decode(sd[1])}`].filter(Boolean).join("\n");
    }

    html = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ");
    const bodyText = html
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
    const meta = [ogTitle && `OG Title: ${ogTitle}`, ogDesc && `OG Desc: ${ogDesc}`, metaDesc && `Meta Desc: ${metaDesc}`, keywords && `Keywords: ${keywords}`].filter(Boolean).join("\n");
    const summary = [meta, ytExtra, bodyText].filter(Boolean).join("\n\n").slice(0, 8000);
    return { ok: true, summary, title, url };
  } catch (e) {
    return { ok: false, error: `fetch failed: ${e.message}` };
  }
}

const stripHtml = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

async function searchDDG(query, kl, acceptLang) {
  // POST is more reliable for html.duckduckgo.com
  const r = await axios.post(
    "https://html.duckduckgo.com/html/",
    new URLSearchParams({ q: query, kl, b: "", df: "" }).toString(),
    {
      headers: {
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        "accept-language": acceptLang,
        "content-type": "application/x-www-form-urlencoded",
        referer: "https://html.duckduckgo.com/",
        origin: "https://html.duckduckgo.com",
      },
      timeout: 15000,
    },
  );
  const html = r.data;
  const results = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && results.length < 6) {
    let url = m[1];
    try {
      const u = new URL(url, "https://duckduckgo.com");
      if (u.searchParams.get("uddg")) url = decodeURIComponent(u.searchParams.get("uddg"));
    } catch {}
    results.push({ title: stripHtml(m[2]), url, snippet: stripHtml(m[3]) });
  }
  return results;
}

async function searchYahoo(query) {
  const r = await axios.get("https://search.yahoo.com/search", {
    params: { p: query, ei: "UTF-8" },
    headers: {
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
    },
    timeout: 15000,
  });
  const html = r.data;
  const results = [];
  // Yahoo result blocks: <div class="dd algo ...">...<h3 class="title"><a href="...">title</a></h3>...<div class="compText...">snippet</div>
  const blockRe = /<div class="(?:dd algo|algo)[^"]*"[\s\S]*?<h3[^>]*class="[^"]*title[^"]*"[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<div[^>]+class="[^"]*compText[^"]*"[^>]*>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = blockRe.exec(html)) && results.length < 6) {
    let url = m[1];
    // Yahoo wraps real URL in /RU=https%3a%2f%2f...%2f/RK=
    const ru = url.match(/\/RU=([^/]+)\//);
    if (ru) { try { url = decodeURIComponent(ru[1]); } catch {} }
    results.push({ title: stripHtml(m[2]), url, snippet: stripHtml(m[3]) });
  }
  return results;
}

export async function webSearch({ query, lang }) {
  if (!query) return { ok: false, error: "empty query" };
  const isArabic = /[\u0600-\u06FF]/.test(query);
  const kl = lang || (isArabic ? "xa-ar" : "wt-wt");
  const acceptLang = isArabic ? "ar,ar-MA;q=0.9,en;q=0.6" : "en-US,en;q=0.9";
  const errors = [];
  // Try DDG twice (anti-bot may pass on retry), then fall back to Yahoo
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const results = await searchDDG(query, kl, acceptLang);
      if (results.length) return { ok: true, results };
      errors.push(`ddg attempt ${attempt + 1}: 0 results`);
    } catch (e) { errors.push(`ddg attempt ${attempt + 1}: ${e.message}`); }
    if (attempt === 0) await new Promise((r) => setTimeout(r, 1500));
  }
  try {
    const results = await searchYahoo(query);
    if (results.length) return { ok: true, results };
    errors.push("yahoo: 0 results");
  } catch (e) { errors.push(`yahoo: ${e.message}`); }
  return { ok: false, error: `no results — ${errors.join(" | ")}` };
}

export async function youtubeSearch({ query }) {
  if (!query) return { ok: false, error: "empty query" };
  try {
    const r = await yts(query);
    const vids = (r.videos || []).slice(0, 8);
    if (!vids.length) return { ok: false, error: "no youtube results" };
    const results = vids.map((v) => ({
      title: v.title,
      url: v.url,
      duration: v.timestamp,
      views: v.views,
      channel: v.author?.name,
      published: v.ago,
    }));
    return { ok: true, results, top: results[0].url };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export async function lyrics({ artist, title }) {
  if (!artist || !title) return { ok: false, error: "need artist and title" };
  try {
    const r = await axios.get(`https://api.lyrics.ovh/v1/${encodeURIComponent(artist)}/${encodeURIComponent(title)}`, { timeout: 15000 });
    if (!r.data?.lyrics) return { ok: false, error: "lyrics not found" };
    return { ok: true, lyrics: r.data.lyrics.trim() };
  } catch (e) { return { ok: false, error: e.response?.status === 404 ? "not found" : e.message }; }
}

export async function weather({ location }) {
  try {
    const r = await axios.get(`https://wttr.in/${encodeURIComponent(location || "")}?format=j1`, {
      headers: { "user-agent": "curl/8.0" }, timeout: 15000,
    });
    const cur = r.data.current_condition?.[0];
    const area = r.data.nearest_area?.[0];
    if (!cur) return { ok: false, error: "no weather" };
    return {
      ok: true,
      location: area ? `${area.areaName?.[0]?.value}, ${area.country?.[0]?.value}` : location,
      tempC: cur.temp_C, feelsLikeC: cur.FeelsLikeC,
      description: cur.lang_ar?.[0]?.value || cur.weatherDesc?.[0]?.value,
      humidity: cur.humidity, windKmh: cur.windspeedKmph,
      forecast: r.data.weather?.slice(0, 3).map((d) => ({ date: d.date, maxC: d.maxtempC, minC: d.mintempC })),
    };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function aljazeeraNews() {
  try {
    const r = await axios.get("https://www.aljazeera.net/", {
      timeout: 20000,
      headers: {
        "user-agent": "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36",
        "accept-language": "ar,en;q=0.9",
        "accept": "text/html,application/xhtml+xml",
      },
    });
    const html = String(r.data || "");
    const out = { mainHeadline: null, liveUpdates: [], liveUrl: null };

    const mainRe = /عاجل[\s\S]{0,300}?<h[123][^>]*>\s*([\s\S]+?)\s*<\/h[123]>/;
    const mainMatch = html.match(mainRe);
    if (mainMatch) {
      out.mainHeadline = mainMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    }
    if (!out.mainHeadline) {
      const altRe = /href="([^"]*liveblog[^"]*)"[^>]*>[\s\S]{0,200}?<h[123][^>]*>([\s\S]+?)<\/h[123]>/;
      const m = html.match(altRe);
      if (m) {
        out.mainHeadline = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        out.liveUrl = "https://www.aljazeera.net" + m[1];
      }
    }
    if (!out.liveUrl) {
      const m = html.match(/href="(\/news\/liveblog\/[^"]+)"/);
      if (m) out.liveUrl = "https://www.aljazeera.net" + m[1].split("?")[0];
    }
    const updateRe = /<h[34][^>]*>\s*<a[^>]*href="([^"]*liveblog[^"]*)"[^>]*>([\s\S]+?)<\/a>\s*<\/h[34]>/g;
    let m;
    while ((m = updateRe.exec(html)) !== null && out.liveUpdates.length < 8) {
      const t = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (t && t.length > 10) out.liveUpdates.push(t);
    }
    if (!out.liveUpdates.length) {
      const block = html.match(/تغطية مباشرة[\s\S]{0,5000}?(?=اختيارات المحررين|class="article-card)/)?.[0];
      if (block) {
        const itemRe = /<h[34][^>]*>([\s\S]+?)<\/h[34]>/g;
        let mm;
        while ((mm = itemRe.exec(block)) !== null && out.liveUpdates.length < 8) {
          const t = mm[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
          if (t && t.length > 10) out.liveUpdates.push(t);
        }
      }
    }

    const headlineRe = /<h3[^>]*class="[^"]*gc__title[^"]*"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>\s*<span[^>]*>([\s\S]+?)<\/span>/g;
    const headlines = [];
    let h;
    while ((h = headlineRe.exec(html)) !== null && headlines.length < 8) {
      const title = h[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      const link = h[1].startsWith("http") ? h[1] : "https://www.aljazeera.net" + h[1];
      if (title.length > 10) headlines.push({ title, link });
    }

    if (!out.mainHeadline && !out.liveUpdates.length && !headlines.length) {
      return { ok: false, error: "no news parsed" };
    }
    return { ok: true, ...out, headlines, source: "aljazeera.net" };
  } catch (e) {
    return { ok: false, error: `aljazeera fetch failed: ${e.message}` };
  }
}

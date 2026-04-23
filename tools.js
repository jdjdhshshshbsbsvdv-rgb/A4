import fs from "node:fs";
import path from "node:path";
import { execSync, execFileSync } from "node:child_process";
import axios from "axios";
import FormData from "form-data";
import { GoogleGenAI, Modality } from "@google/genai";
import { createCanvas } from "@napi-rs/canvas";
import { Jimp } from "jimp";

export const IMAGES_DIR = path.resolve("images");
export const VIDEOS_DIR = path.resolve("videos");
export const AUDIO_DIR = path.resolve("audio");
export const DOWNLOADS_DIR = path.resolve("downloads");
export const APKS_DIR = path.resolve("apks");
for (const d of [IMAGES_DIR, VIDEOS_DIR, AUDIO_DIR, DOWNLOADS_DIR, APKS_DIR]) fs.mkdirSync(d, { recursive: true });

const APKEEP_BIN = path.resolve("bin/apkeep");

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: { apiVersion: "", baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL },
});

const safeName = (s, fallback) =>
  String(s || fallback).replace(/[^a-zA-Z0-9]/g, "").slice(0, 40) || `out${Date.now()}`;

const rel = (p) => path.relative(process.cwd(), p);

export async function nanoBananaImage({ prompt, filename }) {
  const r = await ai.models.generateContent({
    model: "gemini-3-pro-image-preview",
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    config: { responseModalities: [Modality.IMAGE] },
  });
  const parts = r.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    if (p.inlineData) {
      const ext = (p.inlineData.mimeType.split("/")[1] || "png").replace("jpeg", "jpg");
      const file = path.join(IMAGES_DIR, `${safeName(filename, "image")}.${ext}`);
      fs.writeFileSync(file, Buffer.from(p.inlineData.data, "base64"));
      return { ok: true, path: rel(file) };
    }
  }
  return { ok: false, error: "no image returned" };
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

export async function socialDownload({ url, type = "video", filename }) {
  if (!url || !/^https?:\/\//.test(url)) return { ok: false, error: "invalid url" };
  const base = path.join(DOWNLOADS_DIR, safeName(filename, "media"));
  const args = ["--no-warnings", "--no-playlist", "--restrict-filenames", "-o", `${base}.%(ext)s`];
  if (type === "audio") args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
  else args.push("-f", "bv*[ext=mp4]+ba/b[ext=mp4]/best", "--merge-output-format", "mp4");
  args.push(url);
  try {
    execFileSync("yt-dlp", args, { stdio: "pipe", timeout: 180000 });
  } catch (e) {
    return { ok: false, error: `download failed: ${(e.stderr || e.stdout || e.message).toString().slice(-300)}` };
  }
  const dir = path.dirname(base);
  const prefix = path.basename(base);
  const found = fs.readdirSync(dir).filter((f) => f.startsWith(prefix + ".")).sort().pop();
  if (!found) return { ok: false, error: "no file produced" };
  return { ok: true, path: rel(path.join(dir, found)) };
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

async function searchApkPurePackage(query) {
  if (/^[a-z][\w]*(\.[a-z][\w]*)+$/i.test(query.trim())) return query.trim();
  const r = await axios.get("https://apkpure.net/search", {
    params: { q: query },
    timeout: 20000,
    headers: {
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
    },
    maxRedirects: 5,
  });
  const html = String(r.data || "");
  const matches = [...html.matchAll(/href="\/([^\/"]+)\/([a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+)(?:\/|")/g)];
  for (const m of matches) {
    const pkg = m[2];
    if (pkg.split(".").length >= 2 && !pkg.startsWith("apkpure")) return pkg;
  }
  return null;
}

const UA_DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function resolveApkUrl(pkg) {
  const url = `https://d.apkpure.com/b/APK/${encodeURIComponent(pkg)}?version=latest`;
  const head = await axios.head(url, {
    maxRedirects: 5,
    timeout: 30000,
    headers: { "user-agent": UA_DESKTOP, "accept-language": "en-US,en;q=0.9" },
    validateStatus: s => s >= 200 && s < 400,
  });
  let filename = `${pkg}.apk`;
  const cd = head.headers["content-disposition"];
  if (cd) {
    const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
    if (m) filename = decodeURIComponent(m[1]).replace(/[\/\\]/g, "_").trim();
  }
  return { url, filename, size: parseInt(head.headers["content-length"] || "0", 10) };
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

export async function webSearch({ query, lang }) {
  if (!query) return { ok: false, error: "empty query" };
  const isArabic = /[\u0600-\u06FF]/.test(query);
  const kl = lang || (isArabic ? "xa-ar" : "wt-wt");
  const acceptLang = isArabic ? "ar,ar-MA;q=0.9,en;q=0.6" : "en-US,en;q=0.9";
  try {
    const r = await axios.get("https://html.duckduckgo.com/html/", {
      params: { q: query, kl },
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "accept-language": acceptLang,
      },
      timeout: 20000,
    });
    const html = r.data;
    const results = [];
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && results.length < 6) {
      const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
      let url = m[1];
      const u = new URL(url, "https://duckduckgo.com");
      if (u.searchParams.get("uddg")) url = decodeURIComponent(u.searchParams.get("uddg"));
      results.push({ title: strip(m[2]), url, snippet: strip(m[3]) });
    }
    if (!results.length) return { ok: false, error: "no results" };
    return { ok: true, results };
  } catch (e) { return { ok: false, error: e.message }; }
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

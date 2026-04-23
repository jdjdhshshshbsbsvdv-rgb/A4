import baileysPkg from "@whiskeysockets/baileys";
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
  downloadMediaMessage,
  jidNormalizedUser,
} = baileysPkg;
import pino from "pino";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import fs from "node:fs";
import path from "node:path";
import { runTurn } from "./agent.js";

const SESSION_DIR = "auth_session";
const SESSIONS = new Map();
const MAX_HISTORY = 30;
const SEND_DELAY_MS = 1500;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const C = { cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", magenta: "\x1b[35m", dim: "\x1b[2m", reset: "\x1b[0m" };
const logger = pino({ level: "silent" });

let BOT_JID = null;

async function ask(q) {
  const rl = readline.createInterface({ input, output });
  const a = await rl.question(q);
  rl.close();
  return a.trim();
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: false,
    auth: state,
    browser: Browsers.macOS("Safari"),
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  if (!sock.authState.creds.registered) {
    let phone = process.env.WA_PHONE_NUMBER;
    if (!phone) {
      console.log(`${C.magenta}WhatsApp Pairing${C.reset}`);
      phone = await ask("Enter your WhatsApp number with country code (digits only): ");
    }
    phone = phone.replace(/[^0-9]/g, "");
    if (!phone) { console.error("Invalid phone number."); process.exit(1); }
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phone);
        const pretty = code.match(/.{1,4}/g)?.join("-") || code;
        console.log(`\n${C.green}Pairing code:${C.reset} ${C.yellow}${pretty}${C.reset}`);
        console.log(`${C.dim}WhatsApp → Linked devices → Link with phone number → enter the code.${C.reset}\n`);
      } catch (e) { console.error("Pairing error:", e.message); }
    }, 3000);
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (u) => {
    const { connection, lastDisconnect } = u;
    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log(`${C.yellow}Connection closed${C.reset} (reason: ${reason})`);
      if (reason === DisconnectReason.loggedOut || reason === 401) {
        console.log(`${C.yellow}⚠ Logged out by WhatsApp (likely anti-spam after sending too many large files too fast).${C.reset}`);
        console.log("Clearing session and re-pairing...");
        try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch {}
        setTimeout(start, 5000);
      } else setTimeout(start, 3000);
    } else if (connection === "open") {
      BOT_JID = jidNormalizedUser(sock.user?.id);
      console.log(`${C.green}WhatsApp connected${C.reset} as ${BOT_JID}`);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) {
      try { await handleMessage(sock, m); }
      catch (e) { console.error("handle error:", e.message); }
    }
  });
}

function extractText(msg) {
  if (!msg) return "";
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    ""
  );
}

function isMentionedOrReplied(m, msg) {
  const ctx = msg?.extendedTextMessage?.contextInfo;
  if (!ctx) return false;
  const mentions = ctx.mentionedJid || [];
  if (BOT_JID && mentions.includes(BOT_JID)) return true;
  const botBare = BOT_JID?.split("@")[0]?.split(":")[0];
  if (botBare && mentions.some(j => j.split("@")[0].split(":")[0] === botBare)) return true;
  if (ctx.participant && BOT_JID) {
    const a = ctx.participant.split("@")[0].split(":")[0];
    const b = BOT_JID.split("@")[0].split(":")[0];
    if (a === b) return true;
  }
  return false;
}

const GEMINI_INLINE_MIMES = new Set([
  "image/png","image/jpeg","image/jpg","image/webp","image/gif","image/heic","image/heif",
  "audio/wav","audio/mp3","audio/mpeg","audio/aac","audio/ogg","audio/opus","audio/flac",
  "video/mp4","video/mpeg","video/mov","video/avi","video/x-flv","video/mpg","video/webm","video/wmv","video/3gpp","video/quicktime",
  "application/pdf",
]);

const TEXT_LIKE_MIMES = /^(text\/|application\/(json|xml|x-yaml|yaml|javascript|x-javascript|typescript|x-typescript|x-sh|x-shellscript|x-python|x-php|x-ruby|x-perl|sql|graphql))/i;

const TEXT_LIKE_EXTS = new Set([
  "txt","md","markdown","csv","tsv","log","json","xml","yaml","yml","html","htm","css","scss","less",
  "js","mjs","cjs","jsx","ts","tsx","py","rb","php","go","rs","java","kt","kts","swift","c","h","cpp","hpp","cc","cs",
  "sh","bash","zsh","fish","ps1","bat","cmd","sql","graphql","gql","env","ini","toml","conf","cfg","properties",
  "vue","svelte","astro","r","lua","dart","scala","pl","pm","ex","exs","erl","clj","hs","ml","fs","jl","nim","zig",
]);

function extOf(name = "") {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

async function extractIncomingMedia(m) {
  const msg = m.message;
  const media = msg?.imageMessage || msg?.videoMessage || msg?.audioMessage || msg?.stickerMessage || msg?.documentMessage;
  if (!media) return null;
  const fileName = media.fileName || media.title || "";
  let mimeType = media.mimetype || "application/octet-stream";
  if (mimeType.includes(";")) mimeType = mimeType.split(";")[0].trim();
  let buf;
  try {
    buf = await downloadMediaMessage(m, "buffer", {}, { logger, reuploadRequest: undefined });
  } catch (e) {
    console.error("media dl failed:", e.message);
    return { textOnly: `(تعذّر تحميل المرفق${fileName ? `: ${fileName}` : ""})` };
  }
  const ext = extOf(fileName);
  const isTextLike = TEXT_LIKE_MIMES.test(mimeType) || TEXT_LIKE_EXTS.has(ext);
  if (isTextLike) {
    let txt = "";
    try { txt = buf.toString("utf8"); } catch {}
    if (txt.length > 60000) txt = txt.slice(0, 60000) + "\n... (مقطوع)";
    const header = `[ملف نصي${fileName ? ` "${fileName}"` : ""} ${mimeType || ""}]`;
    return { textOnly: `${header}\n\`\`\`\n${txt}\n\`\`\`` };
  }
  if (GEMINI_INLINE_MIMES.has(mimeType.toLowerCase())) {
    return { inline: { data: buf.toString("base64"), mimeType } };
  }
  // Unsupported binary doc — describe instead of sending bytes
  const sizeKb = Math.round(buf.length / 1024);
  return { textOnly: `(المستخدم بعت ملف${fileName ? ` "${fileName}"` : ""} نوع ${mimeType}, حجم ${sizeKb}KB — غير مدعوم للقراءة المباشرة)` };
}

async function handleMessage(sock, m) {
  if (m.key.fromMe) return;
  const jid = m.key.remoteJid;
  if (!jid) return;
  if (jid.endsWith("@broadcast") || jid.endsWith("@newsletter") || jid === "status@broadcast") return;

  const msg = m.message;
  if (!msg) return;
  const text = extractText(msg);
  const isGroup = jid.endsWith("@g.us");

  if (isGroup) {
    if (!isMentionedOrReplied(m, msg)) return;
  }

  const extracted = await extractIncomingMedia(m);
  if (!text.trim() && !extracted) return;

  const sender = m.key.participant || jid;
  const tag = extracted?.inline ? `[+${extracted.inline.mimeType}]` : extracted?.textOnly ? "[+text]" : "";
  console.log(`${C.cyan}${sender}:${C.reset} ${text} ${tag}`);

  const history = SESSIONS.get(jid) || [];

  await sock.sendPresenceUpdate("composing", jid).catch(() => {});

  const userParts = [];
  if (text.trim()) {
    let cleaned = text;
    if (BOT_JID) {
      const botBare = BOT_JID.split("@")[0].split(":")[0];
      cleaned = cleaned.replace(new RegExp(`@${botBare}`, "g"), "").trim();
    }
    userParts.push({ text: cleaned || text });
  }
  if (extracted?.textOnly) userParts.push({ text: extracted.textOnly });
  if (extracted?.inline) userParts.push({ inlineData: extracted.inline });
  if (!userParts.length) userParts.push({ text: "(رسالة فارغة)" });

  let outputs;
  try {
    outputs = await runTurn(history, userParts, (ev) => {
      if (ev.type === "tool") console.log(`${C.dim}  → tool: ${ev.name}${C.reset}`);
      if (ev.type === "model") console.log(`${C.dim}  → model: ${ev.name}${C.reset}`);
    });
  } catch (e) {
    console.error("turn error:", e);
    await sock.sendMessage(jid, { text: `خطأ: ${e.message}` }, { quoted: m });
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});
    return;
  }

  if (history.length > MAX_HISTORY * 2) history.splice(0, history.length - MAX_HISTORY * 2);
  SESSIONS.set(jid, history);

  const sentFiles = [];
  for (let i = 0; i < outputs.length; i++) {
    const o = outputs[i];
    try {
      if (o.type === "text" && o.text.trim()) {
        await sock.sendMessage(jid, { text: o.text }, { quoted: m });
      } else if (o.type === "media") {
        const ok = await sendMedia(sock, jid, o, m);
        if (ok) sentFiles.push(o.path);
      }
    } catch (e) {
      console.error("send error:", e.message);
      try { await sock.sendMessage(jid, { text: `(خطأ ف الإرسال: ${e.message})` }, { quoted: m }); } catch {}
    }
    if (i < outputs.length - 1) await sleep(SEND_DELAY_MS);
  }

  // Cleanup generated/downloaded files so they don't pile up
  for (const p of sentFiles) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  }

  await sock.sendPresenceUpdate("paused", jid).catch(() => {});
}

const MAX_FILE_SIZE = 500 * 1024 * 1024;

async function sendMedia(sock, jid, o, quoted) {
  const p = o.path;
  if (!fs.existsSync(p)) {
    await sock.sendMessage(jid, { text: `(الملف ضايع: ${p})` }, { quoted });
    return false;
  }
  const stat = fs.statSync(p);
  if (stat.size > MAX_FILE_SIZE) {
    const mb = (stat.size / 1024 / 1024).toFixed(1);
    await sock.sendMessage(jid, { text: `الملف كبير بزاف (${mb} MB). الحد الأقصى ديال البوت هو 500 MB.` }, { quoted });
    return false;
  }
  const ext = path.extname(p).toLowerCase();
  const abs = path.resolve(p);
  // Use file path form — baileys handles streaming/uploading natively and reliably for large files
  const src = { url: abs };

  if (o.tool === "toSticker" || ext === ".webp") {
    await sock.sendMessage(jid, { sticker: src });
  } else if ([".jpg", ".jpeg", ".png", ".gif"].includes(ext)) {
    await sock.sendMessage(jid, { image: src }, { quoted });
  } else if ([".mp4", ".mov", ".webm", ".mkv"].includes(ext)) {
    await sock.sendMessage(jid, { video: src, mimetype: "video/mp4" }, { quoted });
  } else if (ext === ".ogg" || ext === ".opus") {
    await sock.sendMessage(jid, { audio: src, mimetype: "audio/ogg; codecs=opus", ptt: true }, { quoted });
  } else if (ext === ".mp3" || ext === ".m4a" || ext === ".aac") {
    await sock.sendMessage(jid, { audio: src, mimetype: "audio/mpeg" }, { quoted });
  } else if (ext === ".wav") {
    await sock.sendMessage(jid, { audio: src, mimetype: "audio/wav" }, { quoted });
  } else if (ext === ".apk" || ext === ".xapk") {
    await sock.sendMessage(jid, { document: src, mimetype: "application/vnd.android.package-archive", fileName: path.basename(p) }, { quoted });
  } else {
    const docMime = guessDocMime(ext);
    await sock.sendMessage(jid, { document: src, mimetype: docMime, fileName: path.basename(p) }, { quoted });
  }
  return true;
}

const DOC_MIME_MAP = {
  ".js": "text/javascript", ".mjs": "text/javascript", ".cjs": "text/javascript",
  ".ts": "text/x-typescript", ".tsx": "text/x-typescript", ".jsx": "text/jsx",
  ".py": "text/x-python",
  ".java": "text/x-java-source",
  ".kt": "text/x-kotlin", ".kts": "text/x-kotlin",
  ".swift": "text/x-swift",
  ".c": "text/x-c", ".h": "text/x-c",
  ".cpp": "text/x-c++", ".hpp": "text/x-c++", ".cc": "text/x-c++", ".cxx": "text/x-c++",
  ".cs": "text/x-csharp",
  ".go": "text/x-go",
  ".rs": "text/x-rust",
  ".rb": "text/x-ruby",
  ".php": "application/x-httpd-php",
  ".pl": "text/x-perl", ".pm": "text/x-perl",
  ".sh": "application/x-sh", ".bash": "application/x-sh", ".zsh": "application/x-sh",
  ".ps1": "application/x-powershell",
  ".bat": "application/x-bat", ".cmd": "application/x-bat",
  ".html": "text/html", ".htm": "text/html",
  ".css": "text/css", ".scss": "text/x-scss", ".less": "text/x-less",
  ".sql": "application/sql",
  ".json": "application/json",
  ".yaml": "application/x-yaml", ".yml": "application/x-yaml",
  ".xml": "application/xml",
  ".toml": "application/toml",
  ".ini": "text/plain", ".env": "text/plain", ".conf": "text/plain", ".cfg": "text/plain",
  ".md": "text/markdown", ".markdown": "text/markdown",
  ".dart": "application/dart",
  ".scala": "text/x-scala",
  ".lua": "text/x-lua",
  ".r": "text/x-r",
  ".m": "text/x-matlab",
  ".vue": "text/x-vue",
  ".svelte": "text/x-svelte",
  ".graphql": "application/graphql", ".gql": "application/graphql",
  ".txt": "text/plain", ".log": "text/plain", ".csv": "text/csv", ".tsv": "text/tab-separated-values",
  ".zip": "application/zip", ".tar": "application/x-tar", ".gz": "application/gzip",
};

function guessDocMime(ext) {
  if (DOC_MIME_MAP[ext]) return DOC_MIME_MAP[ext];
  return "text/plain";
}

console.log(`${C.magenta}عمر — WhatsApp Bot (Baileys)${C.reset}`);
start().catch((e) => { console.error("fatal:", e); process.exit(1); });

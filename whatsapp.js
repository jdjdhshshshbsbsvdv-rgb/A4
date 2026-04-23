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

async function downloadIncomingMedia(m) {
  const msg = m.message;
  const media = msg?.imageMessage || msg?.videoMessage || msg?.audioMessage || msg?.stickerMessage || msg?.documentMessage;
  if (!media) return null;
  try {
    const buf = await downloadMediaMessage(m, "buffer", {}, { logger, reuploadRequest: undefined });
    let mimeType = media.mimetype || "application/octet-stream";
    if (mimeType.includes(";")) mimeType = mimeType.split(";")[0].trim();
    return { data: buf.toString("base64"), mimeType };
  } catch (e) {
    console.error("media dl failed:", e.message);
    return null;
  }
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

  const mediaPart = await downloadIncomingMedia(m);
  if (!text.trim() && !mediaPart) return;

  const sender = m.key.participant || jid;
  console.log(`${C.cyan}${sender}:${C.reset} ${text}${mediaPart ? ` [+${mediaPart.mimeType}]` : ""}`);

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
  if (mediaPart) userParts.push({ inlineData: mediaPart });

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

  for (let i = 0; i < outputs.length; i++) {
    const o = outputs[i];
    if (o.type === "text" && o.text.trim()) {
      await sock.sendMessage(jid, { text: o.text }, { quoted: m });
    } else if (o.type === "media") {
      await sendMedia(sock, jid, o, m);
    }
    if (i < outputs.length - 1) await sleep(SEND_DELAY_MS);
  }

  await sock.sendPresenceUpdate("paused", jid).catch(() => {});
}

const MAX_FILE_SIZE = 500 * 1024 * 1024;

async function sendMedia(sock, jid, o, quoted) {
  const p = o.path;
  if (!fs.existsSync(p)) {
    await sock.sendMessage(jid, { text: `(الملف ضايع: ${p})` }, { quoted });
    return;
  }
  const stat = fs.statSync(p);
  if (stat.size > MAX_FILE_SIZE) {
    const mb = (stat.size / 1024 / 1024).toFixed(1);
    await sock.sendMessage(jid, { text: `الملف كبير بزاف (${mb} MB). الحد الأقصى ديال البوت هو 500 MB.` }, { quoted });
    return;
  }
  const ext = path.extname(p).toLowerCase();

  const useStream = stat.size > 20 * 1024 * 1024;
  const payload = useStream ? { stream: fs.createReadStream(p) } : { buffer: fs.readFileSync(p) };
  const src = useStream ? payload.stream : payload.buffer;

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
    await sock.sendMessage(jid, { document: src, fileName: path.basename(p) }, { quoted });
  }
}

console.log(`${C.magenta}عمر — WhatsApp Bot (Baileys)${C.reset}`);
start().catch((e) => { console.error("fatal:", e); process.exit(1); });

import {
  nanoBananaImage, aiLabsImage, editImage,
  socialDownload, toSticker, textToSpeech,
  webSearch, youtubeSearch, lyrics, weather, fetchUrl, getApk, aljazeeraNews,
  sendCodeFile, carbonCode, runCode,
} from "./tools.js";
import { geminiAsk } from "./geminiScraper.js";
import fs from "node:fs";
import path from "node:path";

export const PERSONA = `أنت عمر، شاب مغربي ودود وذكي من الدار البيضاء. كتجمع روح جيميني الفضولية مع كاع القدرات الإبداعية والعملية.
أسلوبك مرح وذكي. تتقن عدة لغات ودائما تجاوب بلغة واحدة فقط حسب لغة المستخدم بدون خلط.
- جاوب دائماً بنفس لغة المستخدم بشكل صارم.
- لا تستعمل أبداً الشرطة السفلية ولا الشرطة العادية داخل أي كلمة.
- لا تنادي أي أداة إلا إذا كانت ضرورية فعلاً.`;

// Tool registry
const TOOLS = {
  nanoBananaImage: { fn: nanoBananaImage, desc: "Generate (imagine) an image from text. Args: {prompt: detailed English description, filename: short ascii name}.", needs: ["prompt", "filename"] },
  aiLabsImage:     { fn: aiLabsImage,     desc: "Backup image generator if nanoBananaImage fails. Args: {prompt, filename}.", needs: ["prompt", "filename"] },
  editImage:       { fn: editImage,       desc: "Edit/transform an EXISTING image using a text prompt (image-to-image). Use when the user sent an image and asks to modify it (change background, restyle, add/remove things). Args: {input: file path of the user's image, prompt: English description of the change, filename}.", needs: ["input", "prompt", "filename"] },
  socialDownload:  { fn: socialDownload,  desc: "Download video/audio from a social URL (YouTube, TikTok, Instagram, FB, X, Reddit, SoundCloud). Args: {url, type: 'video'|'audio' (default video), filename}.", needs: ["url"] },
  toSticker:       { fn: toSticker,       desc: "Convert an existing image/video file path to a WhatsApp sticker. Args: {input: file path, filename, animated?: bool}.", needs: ["input"] },
  textToSpeech:    { fn: textToSpeech,    desc: "Speak short text (<150 chars) as voice note. Args: {text, lang?: 'ar'|'en'|'fr'|'es', filename?}.", needs: ["text"] },
  webSearch:       { fn: webSearch,       desc: "Search the live web for current info, news, prices. Args: {query}.", needs: ["query"] },
  youtubeSearch:   { fn: youtubeSearch,   desc: "Search YouTube and return real watch URLs. Use this (not webSearch) for video/song requests without a link. The 'top' field is the best URL — pass it to socialDownload. Args: {query: descriptive English keywords}.", needs: ["query"] },
  lyrics:          { fn: lyrics,          desc: "Get song lyrics. Args: {artist, title} (English/Latin chars).", needs: ["artist", "title"] },
  weather:         { fn: weather,         desc: "Current weather for a city. Args: {location}.", needs: ["location"] },
  fetchUrl:        { fn: fetchUrl,        desc: "Fetch readable text from any URL (articles, YT pages). Use before answering questions about a URL. Args: {url}.", needs: ["url"] },
  getApk:          { fn: getApk,          desc: "Download an Android APK by app name or package id. Args: {query: e.g. 'WhatsApp' or 'com.whatsapp'}.", needs: ["query"] },
  aljazeeraNews:   { fn: aljazeeraNews,   desc: "Latest Arabic breaking news from Al Jazeera. No args.", needs: [] },
  sendCodeFile:    { fn: sendCodeFile,    desc: "Send code as a properly named file (use for >5 lines or any complete script). Args: {code, language, filename: ascii base name}.", needs: ["code", "language", "filename"] },
  carbonCode:      { fn: carbonCode,      desc: "Render code as a syntax-highlighted image (carbon style). Use ONLY when user asks for a code screenshot/image. Args: {code, language, filename, theme?, background?}.", needs: ["code", "filename"] },
  runCode:         { fn: runCode,         desc: "Execute code (python|javascript|bash) and return stdout/stderr. 20s timeout. Args: {code, language, stdin?}.", needs: ["code", "language"] },
};

function toolsManual() {
  return Object.entries(TOOLS).map(([name, t]) => `• ${name} — ${t.desc}`).join("\n");
}

const TOOL_INSTRUCTIONS = `
You have access to these tools:
${toolsManual()}

To call a tool, output ONE JSON block on its own line wrapped exactly like this (and NOTHING else in that line):
<<TOOL>>{"name":"toolName","args":{"key":"value"}}<<END>>

You may include a short text reply BEFORE the tool call. After tools run, you'll receive results as:
<<RESULT name="toolName">> {...json...} <<ENDRESULT>>
Then continue: either call another tool the same way, or write the final answer to the user as plain text (no <<TOOL>> markers).

Rules:
- Only call a tool when truly necessary. For pure chat/explanations, just reply as text.
- For YouTube video/song requests without a link: call youtubeSearch first, then socialDownload on the 'top' URL. type='audio' for songs/MP3.
- For URL summaries: call fetchUrl ONCE, then summarize from its result.
- Don't repeat the same tool call. Never invent file paths.
- Final user-facing reply must be plain text only (no JSON, no markers).
`.trim();

const TOOL_RE = /<<TOOL>>\s*(\{[\s\S]*?\})\s*<<END>>/;

function fmtHistory(history) {
  // history: [{role:'user'|'model', content:string}]
  return history.map((h) => `${h.role === "user" ? "USER" : "ASSISTANT"}:\n${h.content}`).join("\n\n");
}

function buildPrompt(history, userText) {
  return [
    PERSONA,
    "",
    TOOL_INSTRUCTIONS,
    "",
    "--- CONVERSATION SO FAR ---",
    fmtHistory(history),
    "",
    "USER:",
    userText,
    "",
    "ASSISTANT:",
  ].join("\n");
}

const SESSION_IDS = new WeakMap(); // history array → opaque gemini session id

function summarizeToolResult(name, out) {
  // Compact summary back to model
  if (!out || typeof out !== "object") return JSON.stringify(out);
  const compact = {
    ok: out.ok,
    error: out.error,
    path: out.path,
    summary: out.summary?.slice ? out.summary.slice(0, 1500) : out.summary,
    title: out.title,
    top: out.top,
    results: out.results?.slice ? out.results.slice(0, 5) : out.results,
    location: out.location,
    tempC: out.tempC,
    description: out.description,
    lyrics: out.lyrics?.slice ? out.lyrics.slice(0, 1500) : out.lyrics,
  };
  return JSON.stringify(compact);
}

function emitTextEvents(text, outputs) {
  const t = text.trim();
  if (t) outputs.push({ type: "text", text: t });
}

export async function runTurn(history, userParts, onEvent) {
  // Flatten user parts → text-only prompt (scraper has no multimodal)
  const parts = Array.isArray(userParts) ? userParts : [{ text: String(userParts) }];
  let userText = "";
  for (const p of parts) {
    if (p.text) userText += p.text + "\n";
    else if (p.inlineData) userText += `(المستخدم بعت ملف ${p.inlineData.mimeType} — لا يمكن قراءته بصرياً، اعتمد على النص فقط)\n`;
  }
  userText = userText.trim() || "(رسالة فارغة)";

  history.push({ role: "user", content: userText });
  const outputs = [];
  onEvent?.({ type: "model", name: "gemini-scraper" });

  const callCounts = {};
  const MAX_ITER = 6;
  let iter = 0;
  let pendingPrompt = buildPrompt(history.slice(0, -1), userText);
  let sessionId = SESSION_IDS.get(history) || null;

  while (true) {
    if (++iter > MAX_ITER) {
      outputs.push({ type: "text", text: "ما قدرتش نكمل العملية، عاود المحاولة بطريقة أخرى." });
      return outputs;
    }

    let resp;
    try {
      resp = await geminiAsk(pendingPrompt, sessionId);
    } catch (e) {
      // session may be stale → retry once with fresh cookie
      try { resp = await geminiAsk(pendingPrompt, null); sessionId = null; }
      catch (e2) { outputs.push({ type: "text", text: `خطأ من جيميني: ${e2.message}` }); return outputs; }
    }
    sessionId = resp.id;
    SESSION_IDS.set(history, sessionId);
    let text = resp.text;

    const m = text.match(TOOL_RE);
    if (!m) {
      // Final answer
      emitTextEvents(text, outputs);
      history.push({ role: "model", content: text.trim() });
      if (!outputs.length) outputs.push({ type: "text", text: "..." });
      return outputs;
    }

    // Pre-tool text (anything before the tool marker)
    const preText = text.slice(0, m.index).trim();
    if (preText) emitTextEvents(preText, outputs);

    let call;
    try { call = JSON.parse(m[1]); }
    catch (e) {
      // Malformed tool call → ask model to retry as plain text
      pendingPrompt = `Your previous tool call had invalid JSON: ${e.message}. Reply to the user as plain text instead.`;
      history.push({ role: "model", content: text.trim() });
      continue;
    }

    const name = call.name;
    const args = call.args || {};
    if (!TOOLS[name]) {
      pendingPrompt = `Tool '${name}' does not exist. Available: ${Object.keys(TOOLS).join(", ")}. Try again or reply as text.`;
      history.push({ role: "model", content: text.trim() });
      continue;
    }

    onEvent?.({ type: "tool", name });
    callCounts[name] = (callCounts[name] || 0) + 1;
    let out;
    if (callCounts[name] > 3) {
      out = { ok: false, error: `tool '${name}' called too many times. stop and reply with text.` };
    } else {
      try { out = await TOOLS[name].fn(args); }
      catch (e) { out = { ok: false, error: String(e.message || e) }; }
    }

    if (out?.ok) {
      if (out.path) outputs.push({ type: "media", path: out.path, tool: name });
      if (out.lyrics) outputs.push({ type: "text", text: out.lyrics });
      if (out.results && name === "webSearch") {
        outputs.push({ type: "text", text: out.results.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet || ""}`).join("\n\n") });
      }
    }

    // Feed result back to model and ask for next step
    history.push({ role: "model", content: text.trim() });
    const resultBlock = `<<RESULT name="${name}">> ${summarizeToolResult(name, out)} <<ENDRESULT>>`;
    pendingPrompt = `${resultBlock}\n\nContinue. Either call another tool with <<TOOL>>...<<END>> or give the final user-facing answer as plain text (no markers).`;
    history.push({ role: "user", content: resultBlock });
  }
}

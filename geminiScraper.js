// Cookie-based scraper for gemini.google.com — no API key.
// Loads user cookies from cookie.txt (Netscape format OR raw Cookie header line).
// Falls back to anonymous bootstrap cookie if user cookies fail.
// Supports text + optional image upload (multimodal).
import fs from "node:fs";
import path from "node:path";

const COOKIE_FILE = path.resolve("cookie.txt");
let CACHED_USER_COOKIE = null;
let CACHED_USER_COOKIE_AT = 0;

function loadUserCookieFromFile() {
  try {
    if (!fs.existsSync(COOKIE_FILE)) return null;
    const raw = fs.readFileSync(COOKIE_FILE, "utf8").trim();
    if (!raw) return null;
    // Netscape format → join into a Cookie header
    if (raw.startsWith("# Netscape") || /\t/.test(raw.split("\n")[0])) {
      const pairs = [];
      for (const line of raw.split("\n")) {
        if (!line || line.startsWith("#")) continue;
        const cols = line.split("\t");
        if (cols.length >= 7) pairs.push(`${cols[5]}=${cols[6]}`);
      }
      return pairs.join("; ") || null;
    }
    // Single Cookie header line
    return raw.replace(/\n/g, "; ").replace(/\s*;\s*/g, "; ").trim();
  } catch (e) {
    console.error("[geminiScraper] cookie load failed:", e.message);
    return null;
  }
}

function getUserCookie() {
  // Cache for 60s and re-read so user can update file live
  if (CACHED_USER_COOKIE && Date.now() - CACHED_USER_COOKIE_AT < 60_000) return CACHED_USER_COOKIE;
  CACHED_USER_COOKIE = loadUserCookieFromFile();
  CACHED_USER_COOKIE_AT = Date.now();
  return CACHED_USER_COOKIE;
}

async function getAnonCookie() {
  const r = await fetch(
    "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=maGuAc&source-path=%2F&bl=boq_assistant-bard-web-server_20250814.06_p1&f.sid=-7816331052118000090&hl=en-US&_reqid=173780&rt=c",
    {
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: 'f.req=%5B%5B%5B%22maGuAc%22%2C%22%5B0%5D%22%2Cnull%2C%22generic%22%5D%5D%5D&',
      method: "POST",
    },
  );
  const ck = r.headers.get("set-cookie");
  if (!ck) throw new Error("anon cookie fetch failed");
  return ck.split(";")[0];
}

async function ensureCookie() {
  return getUserCookie() || (await getAnonCookie());
}

// Fetch SNlM0e token (only needed for authenticated endpoints / uploads)
let CACHED_SNLM = null;
let CACHED_SNLM_COOKIE = null;
async function getSnlmToken(cookie) {
  if (CACHED_SNLM && CACHED_SNLM_COOKIE === cookie) return CACHED_SNLM;
  const r = await fetch("https://gemini.google.com/app", {
    headers: {
      cookie,
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
  });
  const html = await r.text();
  const m = html.match(/"SNlM0e":"([^"]+)"/);
  if (m) {
    CACHED_SNLM = m[1];
    CACHED_SNLM_COOKIE = cookie;
    return m[1];
  }
  return null;
}

/**
 * Upload an image to Gemini's push storage. Returns the upload id (string)
 * to be referenced in StreamGenerate body. Requires authenticated cookie.
 */
export async function uploadImage(filePath, cookie) {
  const buf = fs.readFileSync(filePath);
  const fname = path.basename(filePath);
  // multipart/form-data with single field "file"
  const boundary = "----geminiUpload" + Math.random().toString(36).slice(2);
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([head, buf, tail]);
  const r = await fetch("https://content-push.googleusercontent.com/upload/", {
    method: "POST",
    headers: {
      cookie,
      "Push-ID": "feeds-muppet-frontend-20180805",
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
    body,
  });
  if (!r.ok) throw new Error(`upload failed ${r.status} ${r.statusText}`);
  const id = (await r.text()).trim();
  if (!id) throw new Error("empty upload id");
  return { uploadId: id, filename: fname };
}

export async function geminiAsk(prompt, previousId = null, opts = {}) {
  if (typeof prompt !== "string" || !prompt.trim().length) throw new Error("Empty prompt");
  let resumeArray = null;
  let cookie = null;
  if (previousId) {
    try {
      const j = JSON.parse(Buffer.from(previousId, "base64").toString());
      resumeArray = j.newResumeArray;
      cookie = j.cookie;
    } catch {}
  }
  if (!cookie) cookie = await ensureCookie();

  const headers = {
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    "x-goog-ext-525001261-jspb": '[1,null,null,null,"9ec249fc9ad08861",null,null,null,[4]]',
    cookie,
    "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  };

  // Optional file attachments [{path}] → upload and embed
  let attachments = null;
  if (opts.imagePaths && opts.imagePaths.length) {
    try {
      attachments = [];
      for (const p of opts.imagePaths) {
        const u = await uploadImage(p, cookie);
        attachments.push([[u.uploadId, 1], u.filename]);
      }
    } catch (e) {
      console.error("[geminiScraper] image upload failed, continuing text-only:", e.message);
      attachments = null;
    }
  }

  // Body shape — with attachments: [[prompt,0,null,attachments],["en-US"],resumeArray]
  // Text-only: [[prompt],["en-US"],resumeArray]
  const innerArr = attachments
    ? [[prompt, 0, null, attachments], ["en-US"], resumeArray]
    : [[prompt], ["en-US"], resumeArray];
  const body = new URLSearchParams({ "f.req": JSON.stringify([null, JSON.stringify(innerArr)]) });

  const response = await fetch(
    "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=boq_assistant-bard-web-server_20250729.06_p0&f.sid=4206607810970164620&hl=en-US&_reqid=2813378&rt=c",
    { headers, body, method: "post" },
  );
  if (!response.ok) {
    // If user cookie failed (401/403), retry once with a fresh anon cookie
    if (cookie === getUserCookie() && [401, 403, 400].includes(response.status)) {
      const anon = await getAnonCookie();
      headers.cookie = anon;
      const retry = await fetch(response.url, { headers, body, method: "post" });
      if (!retry.ok) throw new Error(`gemini ${retry.status} ${retry.statusText}`);
      return parseGeminiResponse(await retry.text(), anon);
    }
    throw new Error(`gemini ${response.status} ${response.statusText} ${(await response.text()).slice(0, 200)}`);
  }
  return parseGeminiResponse(await response.text(), cookie);
}

function parseGeminiResponse(data, cookie) {
  const chunks = Array.from(data.matchAll(/^\d+\n(.+?)\n/gm), (m) => m[1]);
  for (const chunk of chunks.reverse()) {
    try {
      const real = JSON.parse(chunk);
      const parsed = JSON.parse(real[0][2]);
      if (parsed && parsed[4] && parsed[4][0] && parsed[4][0][1] && typeof parsed[4][0][1][0] === "string") {
        const text = parsed[4][0][1][0];
        const newResumeArray = [...parsed[1], parsed[4][0][0]];
        const id = Buffer.from(JSON.stringify({ newResumeArray, cookie })).toString("base64");
        return { text, id };
      }
    } catch {}
  }
  throw new Error("Failed to parse gemini response (structure changed?)");
}

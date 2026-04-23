// Cookie-based scraper for gemini.google.com — no API key required.
// Auto-fetches a fresh cookie. Multi-turn via opaque session id (newResumeArray + cookie).
// Based on: github.com/noureddineouafy/silana-lite-ofc/blob/master/plugins/gemini.js

async function getNewCookie() {
  const r = await fetch(
    "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=maGuAc&source-path=%2F&bl=boq_assistant-bard-web-server_20250814.06_p1&f.sid=-7816331052118000090&hl=en-US&_reqid=173780&rt=c",
    {
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: 'f.req=%5B%5B%5B%22maGuAc%22%2C%22%5B0%5D%22%2Cnull%2C%22generic%22%5D%5D%5D&',
      method: "POST",
    },
  );
  const cookieHeader = r.headers.get("set-cookie");
  if (!cookieHeader) throw new Error('No "set-cookie" header from gemini.google.com');
  return cookieHeader.split(";")[0];
}

export async function geminiAsk(prompt, previousId = null) {
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
  const headers = {
    "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
    "x-goog-ext-525001261-jspb": '[1,null,null,null,"9ec249fc9ad08861",null,null,null,[4]]',
    cookie: cookie || (await getNewCookie()),
  };
  const inner = JSON.stringify([[prompt], ["en-US"], resumeArray]);
  const outer = JSON.stringify([null, inner]);
  const body = new URLSearchParams({ "f.req": outer });
  const response = await fetch(
    "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?bl=boq_assistant-bard-web-server_20250729.06_p0&f.sid=4206607810970164620&hl=en-US&_reqid=2813378&rt=c",
    { headers, body, method: "post" },
  );
  if (!response.ok) {
    throw new Error(`gemini ${response.status} ${response.statusText} ${(await response.text()).slice(0, 200)}`);
  }
  const data = await response.text();
  const chunks = Array.from(data.matchAll(/^\d+\n(.+?)\n/gm), (m) => m[1]);
  for (const chunk of chunks.reverse()) {
    try {
      const real = JSON.parse(chunk);
      const parsed = JSON.parse(real[0][2]);
      if (parsed && parsed[4] && parsed[4][0] && parsed[4][0][1] && typeof parsed[4][0][1][0] === "string") {
        const text = parsed[4][0][1][0];
        const newResumeArray = [...parsed[1], parsed[4][0][0]];
        const id = Buffer.from(JSON.stringify({ newResumeArray, cookie: headers.cookie })).toString("base64");
        return { text, id };
      }
    } catch {}
  }
  throw new Error("Failed to parse gemini response (structure changed?)");
}

import { GoogleGenAI, Type } from "@google/genai";
import {
  nanoBananaImage, aiLabsImage,
  socialDownload, toSticker, textToSpeech,
  webSearch, lyrics, weather, fetchUrl, getApk, aljazeeraNews,
  sendCodeFile, carbonCode, runCode,
} from "./tools.js";

if (!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL || !process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
  console.error("Missing Gemini env vars."); process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: { apiVersion: "", baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL },
});

export const PERSONA = `أنت عمر، شاب مغربي ودود وذكي من الدار البيضاء. كتجمع روح جيميني الفضولية مع كاع القدرات الإبداعية والعملية.
أسلوبك مرح وذكي. تتقن عدة لغات ودائما تجاوب بلغة واحدة فقط حسب لغة المستخدم بدون خلط.
قواعد مهمة:
- جاوب دائماً بنفس لغة المستخدم بشكل صارم (دارجة، فصحى، فرنسية، إنجليزية، إسبانية...). ممنوع منعا باتا تخلط لغات فنفس الجواب: إيلا المستخدم هضر بالإنجليزية، جاوب بالإنجليزية فقط (بلا أي كلمة دارجة بحال "wach"، "hadchi"، "khoya"، "yallah"، "inshallah"...)، إيلا هضر بالدارجة جاوب بالدارجة فقط، إيلا هضر بالفرنسية جاوب بالفرنسية فقط. شخصيتك المغربية كتبان فالأسلوب والحس الفكاهي، ماشي فخلط الكلمات. حدد اللغة من آخر رسالة ديال المستخدم وزكي معاها.
- لا تستعمل أبداً الشرطة السفلية ولا الشرطة العادية داخل أي كلمة.
- لا تنادي أي أداة إلا إذا كانت ضرورية فعلاً للطلب. إذا المستخدم غير كيهضر معاك أو كيعلق، جاوبه بنص فقط.
- إيلا المستخدم لصق رابط (يوتيوب، تيكتوك، إنستا، فيسبوك، تويتر، رديت، ساوندكلاود...) وطلب صراحة "نزّل" أو "حمّل" أو "ابعث الفيديو/الصوت": استعمل socialDownload.
- قاعدة مهمة جدا: إيلا المستخدم طلب منك فيديو/أغنية/صوت من غير ما يعطيك رابط (مثلا "جيب ليا فيديو ديال صوت المطر"، "بغيت أغنية فلانة"، "بعت ليا فيديو ديال X")، خاصك أنت تقلب فيوتيوب بنفسك بهاد الخطوات بالضبط: 1) استعمل webSearch مرة وحدة بـ "site:youtube.com <الموضوع>". 2) خود أول رابط يبدا بـ youtube.com/watch أو youtu.be من النتائج. 3) مباشرة ناد socialDownload على ديك الرابط. ممنوع تعاود webSearch مرة أخرى ولا تخدم بأكثر من بحث واحد. ممنوع تقول للمستخدم "بعت ليا الرابط" أو "ما عنديش فيديوهات" — أنت كتقدر تقلب وتحمل بنفسك. إيلا طلب صوت فقط (أغنية، MP3)، عطي type="audio" لـ socialDownload. إيلا webSearch فشل ولا ما لقا والو، قول للمستخدم بصراحة وحط اقتراحات.
- إيلا المستخدم لصق أي رابط (يوتيوب بما فيه) وطلب ملخص، شرح، تحليل، ولا سؤال على المحتوى: استعمل fetchUrl مرة وحدة فقط، ثم لخص بنفسك على أساس النتيجة. حتى لو النتيجة قصيرة، خدم بيها وما تناديش webSearch ولا أي أداة أخرى.
- ممنوع تنادي webSearch لتلخيص رابط. webSearch غير لمّا ما كاينش رابط أصلاً.
- nanoBananaImage: للصور (وصف إنجليزي مفصل). إذا المستخدم بعت ليك صورة وطلب تعديل، شوف الصورة فالمحادثة وأعد توليد بوصف يطابق التعديل.
- aiLabsImage: بديل مجاني للصور لمّا الأولى تفشل أو نمط مختلف.
- toSticker: لمّا المستخدم يطلب ستيكر، استعملها على آخر صورة/فيديو ولّدتي ولا حملتي (عطيها المسار).
- textToSpeech: لمّا المستخدم يطلب صوت، نطق، أو "قول هاد النص". النص خاصو يكون قصير (أقل من 150 حرف) باش الصوت يخرج مزيان.
- webSearch: لمّا تحتاج أخبار، أسعار، نتائج، حقائق حالية بدون رابط معين. الاستعلام كيخصو يكون بنفس لغة المستخدم (إيلا هضر بالعربية ابعث الاستعلام بالعربية).
- lyrics: كلمات أغنية (اسم الفنان والأغنية بالإنجليزية).
- weather: الطقس فمدينة معينة.
- fetchUrl: لقراءة محتوى أي رابط ويب (مقالات، صفحات، يوتيوب...). استعملها قبل ما تجاوب على أسئلة على روابط.
- getApk: لمّا المستخدم يطلب تطبيق أندرويد (APK)، مثلاً "بعت ليا واتساب" أو "تيليجرام apk" أو "حمل ليا تطبيق X". تقدر تعطيها اسم التطبيق بالإنجليزية أو معرف الباكدج (com.example.app). كتجيب APK من APKPure مباشرة بدون حساب جوجل.
- aljazeeraNews: لمّا المستخدم يطلب أخبار عاجلة، الأخبار العربية، أخبار الشرق الأوسط، أو يقول "الجزيرة"، "أش الجديد"، "آخر الأخبار". كتجيب العناوين العاجلة والتغطية المباشرة من aljazeera.net مباشرة. بعد ما تستعملها، لخص الأخبار للمستخدم بالدارجة بشكل واضح ومرتب.
- sendCodeFile: قاعدة مهمة جدا — كل مرة كتبغي تبعث كود برمجة (أكثر من 5 أسطر، أو أي ملف كامل، أو أي script)، خاصك تستعمل هاد الأداة وتبعتو كملف بالامتداد المناسب حسب اللغة (js, py, java, html, css, sql, sh, json...). متبعتش الكود فالنص العادي. غير الأمثلة القصيرة (سطر ولا سطرين) ممكن تبعتهم inline. عطي اسم ملف وصفي قصير (snake_case أو camelCase). بعد ما تبعت الملف، تقدر تزيد شرح قصير بالنص.
- runCode: لمّا المستخدم يطلب تخدم/تنفذ شي كود (Python، JavaScript، Bash)، أو يقول "خدمو"، "شوف النتيجة"، "حسب ليا"، "run"، "execute"، أو يعطيك مسألة خاصها حساب/algorithm وتبغي تتأكد من الجواب. كتولي ترجع stdout و stderr. كاين timeout 20 ثانية. استعملها باش تختبر الكود قبل ما تعطيه للمستخدم، أو باش تجاوب على أسئلة حسابية معقدة بـ Python.
- carbonCode: لمّا المستخدم يطلب صراحة "صورة كود" أو "carbon" أو "اعمل ليا الكود فصورة" أو "screenshot ديال الكود"، استعمل هاد الأداة باش تولّد صورة جميلة ديال الكود (بحال carbon.now.sh). اختار theme مناسب: dracula (افتراضي)، monokai، nord، one-dark، synthwave-84، night-owl، vscode، material. متستعملهاش لإرسال الكود العادي — للكود العادي خدم بـ sendCodeFile.
المنطق فوق كل شيء: فكر شنو طلب المستخدم بالضبط، واختار الأداة المناسبة، أو ماتستعمل حتى وحدة وجاوب بنص فقط. تذكر السياق ديال المحادثة وما تعاودش نفس الأداة بدون داعي.`;

export const tools = [{
  functionDeclarations: [
    { name: "nanoBananaImage", description: "Generate a high quality photoreal or artistic image. Use only when user explicitly asks for an image.",
      parameters: { type: Type.OBJECT, properties: {
        prompt: { type: Type.STRING, description: "Detailed English visual description." },
        filename: { type: Type.STRING, description: "Short ascii letters only, no extension." },
      }, required: ["prompt", "filename"] } },
    { name: "aiLabsImage", description: "Free alternative image generator. Fallback only.",
      parameters: { type: Type.OBJECT, properties: {
        prompt: { type: Type.STRING, description: "English visual description." },
        filename: { type: Type.STRING, description: "Short ascii letters only, no extension." },
      }, required: ["prompt", "filename"] } },
    { name: "socialDownload", description: "Download a video or audio from a social media URL (YouTube, TikTok, Instagram, Facebook, X, Reddit, SoundCloud).",
      parameters: { type: Type.OBJECT, properties: {
        url: { type: Type.STRING, description: "Full http(s) URL." },
        type: { type: Type.STRING, description: "video (default) or audio (mp3)." },
        filename: { type: Type.STRING, description: "Short ascii letters only." },
      }, required: ["url"] } },
    { name: "toSticker", description: "Convert an existing image/video file path into a WhatsApp sticker.",
      parameters: { type: Type.OBJECT, properties: {
        input: { type: Type.STRING, description: "Path to existing image or video file." },
        filename: { type: Type.STRING, description: "Short ascii letters only." },
        animated: { type: Type.BOOLEAN, description: "True for animated webp from a video." },
      }, required: ["input"] } },
    { name: "textToSpeech", description: "Speak short text (under 150 chars) as a WhatsApp voice note.",
      parameters: { type: Type.OBJECT, properties: {
        text: { type: Type.STRING, description: "The text to speak. Keep it short." },
        lang: { type: Type.STRING, description: "Language code: ar, en, fr, es..." },
        filename: { type: Type.STRING, description: "Short ascii letters only." },
      }, required: ["text"] } },
    { name: "webSearch", description: "Search the live web for current info, news, prices, facts.",
      parameters: { type: Type.OBJECT, properties: {
        query: { type: Type.STRING, description: "Search query." },
      }, required: ["query"] } },
    { name: "lyrics", description: "Get the lyrics of a song.",
      parameters: { type: Type.OBJECT, properties: {
        artist: { type: Type.STRING, description: "Artist name." },
        title: { type: Type.STRING, description: "Song title." },
      }, required: ["artist", "title"] } },
    { name: "weather", description: "Current weather and short forecast for a city.",
      parameters: { type: Type.OBJECT, properties: {
        location: { type: Type.STRING, description: "City or location." },
      }, required: ["location"] } },
    { name: "fetchUrl", description: "Fetch readable text content from any web URL (articles, pages, YouTube descriptions). Use before answering questions about a URL.",
      parameters: { type: Type.OBJECT, properties: {
        url: { type: Type.STRING, description: "Full http(s) URL." },
      }, required: ["url"] } },
    { name: "getApk", description: "Download an Android app (APK) from APKPure by app name or package id. Works for any user, no Google account needed.",
      parameters: { type: Type.OBJECT, properties: {
        query: { type: Type.STRING, description: "App name in English (e.g. 'WhatsApp') or package id (e.g. 'com.whatsapp')." },
      }, required: ["query"] } },
    { name: "aljazeeraNews", description: "Fetch the latest Arabic breaking news from Al Jazeera (aljazeera.net): main headline, live blog updates, and top headlines. Use when the user asks about current Arab world / Middle East news, breaking news, ash-sharq al-awsat, akhbar, ajial, jazeera, etc. No parameters needed.",
      parameters: { type: Type.OBJECT, properties: {} } },
    { name: "sendCodeFile", description: "Send programming code as a properly named file with the correct extension based on language (js, ts, py, java, html, css, sql, sh, json, etc). REQUIRED whenever returning code longer than ~5 lines or any complete script/file. Do NOT paste long code in plain text — always use this tool.",
      parameters: { type: Type.OBJECT, properties: {
        code: { type: Type.STRING, description: "The full source code as plain text." },
        language: { type: Type.STRING, description: "Programming language name: javascript, typescript, python, java, kotlin, swift, c, cpp, csharp, go, rust, ruby, php, bash, powershell, html, css, sql, json, yaml, xml, dart, lua, r, vue, svelte, dockerfile, makefile, etc." },
        filename: { type: Type.STRING, description: "Short descriptive base name without extension, ascii letters/digits/underscore only (e.g. hello_world, app, server)." },
      }, required: ["code", "language", "filename"] } },
    { name: "runCode", description: "Execute code in a sandboxed subprocess and return stdout/stderr. Supports python, javascript (node), and bash. 20 second timeout. Use to verify code works, compute heavy math, run algorithms, test snippets, or answer 'what does this code output?' questions.",
      parameters: { type: Type.OBJECT, properties: {
        code: { type: Type.STRING, description: "The full source code to execute." },
        language: { type: Type.STRING, description: "One of: python | javascript | bash" },
        stdin: { type: Type.STRING, description: "Optional standard input to feed the program." },
      }, required: ["code", "language"] } },
    { name: "carbonCode", description: "Render programming code as a beautiful syntax-highlighted image (carbon.now.sh style). Use ONLY when the user explicitly asks for a code screenshot/image/picture, says 'carbon', 'صورة كود', or wants the code as an image. For normal code delivery use sendCodeFile.",
      parameters: { type: Type.OBJECT, properties: {
        code: { type: Type.STRING, description: "The source code to render." },
        language: { type: Type.STRING, description: "Language hint for syntax highlighting (javascript, python, etc) or 'auto'." },
        filename: { type: Type.STRING, description: "Short ascii base name for the output image." },
        theme: { type: Type.STRING, description: "Color theme: dracula | monokai | nord | one-dark | synthwave-84 | night-owl | vscode | material. Default dracula." },
        background: { type: Type.STRING, description: "CSS background color, e.g. '#1F816D' or '#1a1b26'. Optional." },
      }, required: ["code", "filename"] } },
  ],
}];

const impl = { nanoBananaImage, aiLabsImage, socialDownload, toSticker, textToSpeech, webSearch, lyrics, weather, fetchUrl, getApk, aljazeeraNews, sendCodeFile, carbonCode, runCode };

const PRO_TRIGGERS = /(حلل|اشرح|فسر|قارن|كود|برمج|debug|analyze|reasoning|explain|why|كيفاش|علاش|why|compare|solve|حل|رياضيات|math|algorithm|خوارزمي|architect|design)/i;

function pickModel(parts, history) {
  const text = parts.filter(p => p.text).map(p => p.text).join(" ");
  const hasMedia = parts.some(p => p.inlineData);
  if (hasMedia) return "gemini-3.1-pro-preview";
  if (text.length > 220) return "gemini-3.1-pro-preview";
  if (PRO_TRIGGERS.test(text)) return "gemini-3.1-pro-preview";
  if (history.length > 16) return "gemini-3.1-pro-preview";
  return "gemini-3-flash-preview";
}

import fs from "node:fs";
import path from "node:path";

function fileToInlinePart(p) {
  try {
    const data = fs.readFileSync(p).toString("base64");
    const ext = path.extname(p).toLowerCase().slice(1);
    const mimeMap = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", mp4: "video/mp4", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg" };
    const mimeType = mimeMap[ext] || "application/octet-stream";
    if (!mimeType.startsWith("image/")) return null;
    return { inlineData: { data, mimeType } };
  } catch { return null; }
}

export async function runTurn(history, userParts, onEvent) {
  const parts = Array.isArray(userParts) ? userParts : [{ text: String(userParts) }];
  history.push({ role: "user", parts });
  const outputs = [];
  const model = pickModel(parts, history);
  onEvent?.({ type: "model", name: model });

  let iter = 0;
  const MAX_ITER = 6;
  const callCounts = {};
  while (true) {
    if (++iter > MAX_ITER) {
      outputs.push({ type: "text", text: "ما قدرتش نكمل العملية، عاود المحاولة بطريقة أخرى." });
      return outputs;
    }
    const res = await ai.models.generateContent({
      model,
      contents: history,
      config: { systemInstruction: PERSONA, tools, maxOutputTokens: 8192 },
    });
    const respParts = res.candidates?.[0]?.content?.parts ?? [];
    const calls = respParts.filter((p) => p.functionCall);
    const text = respParts.filter((p) => p.text).map((p) => p.text).join("");
    if (text) outputs.push({ type: "text", text });
    if (calls.length === 0) {
      history.push({ role: "model", parts: respParts });
      if (outputs.length === 0) {
        outputs.push({ type: "text", text: "..." });
      }
      return outputs;
    }
    history.push({ role: "model", parts: respParts });
    const responses = [];
    for (const c of calls) {
      const fc = c.functionCall;
      onEvent?.({ type: "tool", name: fc.name });
      callCounts[fc.name] = (callCounts[fc.name] || 0) + 1;
      let out;
      if (callCounts[fc.name] > 3) {
        out = { ok: false, error: `tool '${fc.name}' called too many times. stop and reply with text or try a different approach.` };
      } else {
        try { out = await impl[fc.name](fc.args || {}); }
        catch (e) { out = { ok: false, error: String(e.message || e) }; }
      }
      if (out.ok) {
        if (out.path) outputs.push({ type: "media", path: out.path, tool: fc.name });
        if (out.results) outputs.push({ type: "text", text: out.results.map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n") });
        if (out.lyrics) outputs.push({ type: "text", text: out.lyrics });
      }
      const compact = { ok: out.ok, error: out.error, path: out.path, summary: out.summary, results: out.results?.slice(0, 5), lyrics: out.lyrics, location: out.location, tempC: out.tempC, description: out.description };
      responses.push({ functionResponse: { name: fc.name, response: compact } });
    }
    history.push({ role: "user", parts: responses });

    const imgParts = [];
    for (const r of responses) {
      const p = r.functionResponse?.response?.path;
      if (p && /\.(png|jpg|jpeg|webp|gif)$/i.test(p)) {
        const ip = fileToInlinePart(p);
        if (ip) imgParts.push(ip);
      }
    }
    if (imgParts.length) {
      history.push({ role: "user", parts: [{ text: "(الصور المولّدة فوق متاحة لك للرجوع إليها)" }, ...imgParts] });
    }
  }
}

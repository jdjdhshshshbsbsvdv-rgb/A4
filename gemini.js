import { GoogleGenAI, Type } from "@google/genai";
import readline from "node:readline";
import {
  nanoBananaImage, aiLabsImage, bratVideo,
  socialDownload, toSticker, textToSpeech,
  webSearch, lyrics, weather,
} from "./tools.js";

if (!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL || !process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
  console.error("Missing Gemini env vars."); process.exit(1);
}

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: { apiVersion: "", baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL },
});

const C = { cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m", magenta: "\x1b[35m", dim: "\x1b[2m", reset: "\x1b[0m" };

const PERSONA = `أنت عمر، شاب مغربي ودود وذكي من الدار البيضاء. كتجمع روح جيميني الفضولية مع كاع القدرات الإبداعية والعملية.
أسلوبك مرح، خليط بين الدارجة المغربية والفصحى، والإنجليزية فقط عند الحاجة.
لا تستعمل أبداً الشرطة السفلية ولا الشرطة العادية داخل أي كلمة في ردودك.
عندك بزاف ديال الأدوات، كتختار وحدة (أو أكثر) تلقائياً بدون انتظار أي أمر صريح:
- nanoBananaImage: للصور الواقعية أو الفنية الراقية، عطيها وصف إنجليزي مفصل.
- aiLabsImage: بديل مجاني للصور لمّا المستخدم يطلب نمط مختلف أو لمّا الأولى تفشل.
- bratVideo: مني المستخدم يعطيك نص قصير وتحس أنه يستحق فيديو نصي متحرك بألوان، استعمله مباشرة.
- socialDownload: لمّا المستخدم يلصق رابط (تيكتوك، إنستا، يوتيوب، فيسبوك، تويتر، رديت...) أو يطلب تنزيل أغنية أو فيديو، استعملها. type=audio إيلا بغا غير الصوت، video إيلا بغا الفيديو.
- toSticker: لمّا المستخدم يبغي يحول صورة أو فيديو لستيكر واتساب. عطيها مسار الملف لي ولّدتيه ولا لي حملتيه.
- textToSpeech: لمّا المستخدم يطلب منك تتكلم بصوت ولا تقرا حاجة بصوت ولا تحول النص لصوتي. النص خاصو يكون قصير وواضح. الأصوات: Kore (افتراضي)، Puck، Charon، Aoede، Fenrir.
- webSearch: لمّا تحتاج معلومات حالية أو حقائق ما عندكش فالذاكرة (أخبار، أسعار، نتائج رياضية...).
- lyrics: لمّا المستخدم يطلب كلمات أغنية معينة (يعطي اسم الفنان والأغنية بالإنجليزية).
- weather: لمّا المستخدم يسأل على الطقس فبلاد ولا مدينة معينة.
نادي الأدوات تلقائياً بدون ما تسول، وبعد كل ناتج علق بجملة قصيرة بأسلوبك المغربي. كتقدر تنادي عدة أدوات فنفس الجواب (مثلاً تنزّل فيديو ثم تحوله لستيكر، ولا تولد صورة ثم تتكلم عليها).`;

const tools = [{
  functionDeclarations: [
    {
      name: "nanoBananaImage",
      description: "Photoreal or artistic image via nano banana (best quality).",
      parameters: { type: Type.OBJECT, properties: {
        prompt: { type: Type.STRING, description: "Detailed English visual description." },
        filename: { type: Type.STRING, description: "Short ascii letters only, no extension." },
      }, required: ["prompt", "filename"] },
    },
    {
      name: "aiLabsImage",
      description: "Free alternative image generator. Use for variety or as fallback.",
      parameters: { type: Type.OBJECT, properties: {
        prompt: { type: Type.STRING, description: "English visual description, ascii only." },
        filename: { type: Type.STRING, description: "Short ascii letters only, no extension." },
      }, required: ["prompt", "filename"] },
    },
    {
      name: "bratVideo",
      description: "Animated brat-style text video (typewriter + colors). Use when user gives a short phrase that suits a text video.",
      parameters: { type: Type.OBJECT, properties: {
        text: { type: Type.STRING, description: "Short text to animate." },
        filename: { type: Type.STRING, description: "Short ascii letters only, no extension." },
        speed: { type: Type.STRING, description: "fast | normal | slow" },
      }, required: ["text", "filename"] },
    },
    {
      name: "socialDownload",
      description: "Download video or audio from any social media or video site (TikTok, Instagram, YouTube, Facebook, Twitter/X, Reddit, SoundCloud, etc). Returns file path.",
      parameters: { type: Type.OBJECT, properties: {
        url: { type: Type.STRING, description: "Full http(s) URL to the post or video." },
        type: { type: Type.STRING, description: "video (default) or audio (mp3 only)." },
        filename: { type: Type.STRING, description: "Short ascii letters only, no extension." },
      }, required: ["url"] },
    },
    {
      name: "toSticker",
      description: "Convert an existing image or short video file into a WhatsApp sticker (webp). Use after generating or downloading media.",
      parameters: { type: Type.OBJECT, properties: {
        input: { type: Type.STRING, description: "Path to existing image or video file." },
        filename: { type: Type.STRING, description: "Short ascii letters only, no extension." },
        animated: { type: Type.BOOLEAN, description: "True for animated webp from a video, false for static." },
      }, required: ["input"] },
    },
    {
      name: "textToSpeech",
      description: "Convert text into spoken audio (mp3). Supports Arabic, English, French, etc.",
      parameters: { type: Type.OBJECT, properties: {
        text: { type: Type.STRING, description: "The text to speak (any language)." },
        voice: { type: Type.STRING, description: "Kore | Puck | Charon | Aoede | Fenrir." },
        filename: { type: Type.STRING, description: "Short ascii letters only, no extension." },
      }, required: ["text"] },
    },
    {
      name: "webSearch",
      description: "Search the live web for current info, news, prices, facts.",
      parameters: { type: Type.OBJECT, properties: {
        query: { type: Type.STRING, description: "Search query in any language." },
      }, required: ["query"] },
    },
    {
      name: "lyrics",
      description: "Get the lyrics of a song.",
      parameters: { type: Type.OBJECT, properties: {
        artist: { type: Type.STRING, description: "Artist name in English/Latin chars." },
        title: { type: Type.STRING, description: "Song title in English/Latin chars." },
      }, required: ["artist", "title"] },
    },
    {
      name: "weather",
      description: "Current weather and short forecast for a city or location.",
      parameters: { type: Type.OBJECT, properties: {
        location: { type: Type.STRING, description: "City or location, e.g. 'Casablanca' or 'Paris'." },
      }, required: ["location"] },
    },
  ],
}];

const impl = { nanoBananaImage, aiLabsImage, bratVideo, socialDownload, toSticker, textToSpeech, webSearch, lyrics, weather };
const labels = {
  nanoBananaImage: "صورة (نانو بانا)", aiLabsImage: "صورة (أيلابز)", bratVideo: "فيديو (برات)",
  socialDownload: "تنزيل من السوشيال", toSticker: "تحويل لستيكر", textToSpeech: "صوت",
  webSearch: "بحث ويب", lyrics: "كلمات أغنية", weather: "الطقس",
};

const history = [];

async function turn(userText) {
  history.push({ role: "user", parts: [{ text: userText }] });
  while (true) {
    const res = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: history,
      config: { systemInstruction: PERSONA, tools, maxOutputTokens: 8192 },
    });
    const parts = res.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((p) => p.functionCall);
    const text = parts.filter((p) => p.text).map((p) => p.text).join("");
    if (text) console.log(`${C.cyan}عمر:${C.reset} ${text}`);
    if (calls.length === 0) { history.push({ role: "model", parts }); return; }
    history.push({ role: "model", parts });
    const responses = [];
    for (const c of calls) {
      const fc = c.functionCall;
      console.log(`${C.dim}(${labels[fc.name] || fc.name} ...)${C.reset}`);
      try {
        const out = await impl[fc.name](fc.args || {});
        if (out.ok) {
          if (out.path) console.log(`${C.green}ملف:${C.reset} ${out.path}`);
          else console.log(`${C.green}تم${C.reset}`);
        } else console.log(`${C.yellow}تعذر:${C.reset} ${out.error}`);
        responses.push({ functionResponse: { name: fc.name, response: out } });
      } catch (e) {
        console.log(`${C.yellow}خطأ:${C.reset} ${e.message}`);
        responses.push({ functionResponse: { name: fc.name, response: { ok: false, error: String(e.message || e) } } });
      }
    }
    history.push({ role: "user", parts: responses });
  }
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
console.log(`${C.magenta}عمر — Gemini × Nano Banana × Tools${C.reset}\n${C.dim}كتب أي شي: نص، رابط سوشيال، طلب فيديو/صورة/ستيكر/صوت...${C.reset}\n`);
rl.setPrompt(`${C.green}أنت:${C.reset} `);
rl.prompt();
rl.on("line", async (line) => {
  const input = line.trim();
  if (!input) return rl.prompt();
  rl.pause();
  try { await turn(input); } catch (e) { console.error(`${C.yellow}خطأ:${C.reset} ${e.message}`); }
  rl.resume(); rl.prompt();
});
rl.on("close", () => process.exit(0));

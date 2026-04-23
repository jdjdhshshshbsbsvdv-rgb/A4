# Gemini CLI (Omar)

Arabic-language conversational CLI that wraps Gemini with auto-selected creative tools.

## Run
- Workflow `Start application` runs `node gemini.js` (console).
- Requires env vars `AI_INTEGRATIONS_GEMINI_BASE_URL` and `AI_INTEGRATIONS_GEMINI_API_KEY` (provided by Replit AI Integrations for Gemini).

## Tools registered in `tools.js`
- `nanoBananaImage` — Gemini `gemini-2.5-flash-image` image generation.
- `aiLabsImage` — free fallback image generator (aritek text2img).
- `soraVideo` — text-to-video via `https://fast-api-ochre.vercel.app/api/sora` (from the MAD-MAX `sora.js` plugin). NOTE: at last test the upstream Vercel deployment returned 404 for every route; the tool will surface the error until the upstream is restored.
- `bratVideo` — local typewriter brat-style text video built with `@napi-rs/canvas` + ffmpeg.

## Layout
- `gemini.js` — chat loop, persona, tool declarations, function-call dispatch.
- `tools.js` — tool implementations, output dirs `images/` and `videos/`.
- `_d.mjs` — scripted smoke driver (sends two test prompts).

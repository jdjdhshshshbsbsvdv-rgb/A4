import axios from "axios";
import crypto from "node:crypto";
const COOKIE = "webid=1776941875581cyaokuxv; __locale=en; usertoken=eyJhbGciOiJIUzI1NiJ9.eyJtb2JpbGUiOiIiLCJuaWNrbmFtZSI6Ik9NQVIgISIsImF2YXRhciI6IiIsInVzZXJJZCI6MTU0MTYyMTksInV1aWQiOiJhNGQ0MzI3YzIwOTY0Yzc4OTEyMTc4NDFkNWQ3N2NmMSIsImVtYWlsIjoiamF1cmVzLmV4QGdtYWlsLmNvbSIsImNyZWF0ZUF0IjoxNzc2OTQyMDAxMDAwLCJqdGkiOiJtelY5bmhOWk00Iiwic3ViIjoiT01BUiAhIiwiaWF0IjoxNzc2OTQyMDAxLCJpc3MiOiJsb3ZhcnQtYXV0aCIsImV4cCI6MTc3NzU0NjgwMX0.lIslVrZaA091K6NburqaRqokUIiaALZ9Ytti8WmvNTg; useruuid=a4d4327c20964c7891217841d5d77cf1";
const TOKEN = COOKIE.match(/usertoken=([^;]+)/)[1];
const H = () => ({
  "user-agent":"Mozilla/5.0", cookie: COOKIE, token: TOKEN, language:"en","x-language":"en",
  "x-trace-id": crypto.randomUUID().replace(/-/g,""),
  origin:"https://www.lovart.ai", referer:"https://www.lovart.ai/tools/wan2.6",
  "content-type":"application/json",
});
async function J(method, path, data) {
  const r = await axios({ method, url:"https://www.lovart.ai"+path, headers: H(), data, timeout:30000, validateStatus:()=>true });
  return r;
}
const FREE = ["wan/wan-2-6","seedance/seedance-1-5-pro","minimax/minimax-hailuo-2-3","vidu/vidu-q2","fal/ltxv"];
const body = { prompt: "a cute cat dancing in a sunny field" };
const variations = [
  // Match openapi paths directly (without /generators/tasks prefix)
  (m)=>["POST", `/api/canva/agent/v1/${m}`, body],
  (m)=>["POST", `/api/canva/agent/v1/generators/${m}`, body],
  (m)=>["POST", `/api/canva/agent/v1/generators/tasks/${m}`, body],
  // With mode field
  (m)=>["POST", `/api/canva/agent/v1/${m}`, { ...body, mode:"text-to-video" }],
  // Maybe POST tasks with model nested
  (m)=>["POST", `/api/canva/agent/v1/generators/tasks`, { generator_name: m, mode:"text-to-video", input: body }],
  (m)=>["POST", `/api/canva/agent/v1/generators/tasks`, { model: m, prompt: body.prompt }],
  (m)=>["POST", `/api/canva/agent/v1/generators/tasks`, { name: m, prompt: body.prompt }],
];
for (const m of [FREE[0]]) { // first try only with wan2.6
  for (const v of variations) {
    const [method, path, data] = v(m);
    const r = await J(method, path, data);
    console.log(method, path, "body:", JSON.stringify(data).slice(0,90));
    console.log("  ->", r.status, JSON.stringify(r.data).slice(0,250));
  }
}

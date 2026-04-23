import { spawn } from "node:child_process";
const c = spawn("node", ["gemini.js"], { stdio: ["pipe", "inherit", "inherit"] });
const send = (s, t) => setTimeout(() => c.stdin.write(s + "\n"), t);
send("ولد ليا تصويرة بنمط مختلف عن نانو بانا، قطة فضائية ف سوق مغربي", 800);
send("سيلانا بوت", 75000);
setTimeout(() => c.stdin.end(), 150000);
c.on("exit", () => process.exit(0));

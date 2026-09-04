// A stand-in for an OpenAI-compatible chat-completions endpoint, started by
// the Playwright config so the fight specs exercise the real LLM path of the
// coordinator (request shape, JSON parsing, storyboard storage, UI) without
// a network or a key. Deterministic: the longer attack wins, 20 damage.
//
// If either attack contains the token "GARBAGE", the reply is not JSON, so
// the coordinator must fall back — that exercises the fallback path too.
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_LLM_PORT ?? 3211);

createServer((req, res) => {
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("mock llm ok");
    return;
  }
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const user = JSON.parse(body).messages.find((m) => m.role === "user").content;
    const attacks = [...user.matchAll(/this round's attack: "([^"]*)"/g)].map((m) => m[1]);
    const [a = "", b = ""] = attacks;
    let content;
    if (/GARBAGE/.test(a + b)) {
      content = "Sorry, I cannot help with that.";
    } else {
      const aWins = a.length >= b.length;
      content = JSON.stringify({
        winner: aWins ? "A" : "B",
        damage: { A: aWins ? 0 : 20, B: aWins ? 20 : 0 },
        narration: `MOCK JUDGE: ${aWins ? "A" : "B"} takes the exchange.`,
        setting: "a neon-lit test arena with a wet concrete floor",
        shots: [
          { prompt: "Hard cut to a wide shot of a neon-lit test arena. MOCK SHOT ONE.", seconds: 6 },
          { prompt: "Hard cut to a low angle close on the impact. MOCK SHOT TWO.", seconds: 7.5 },
        ],
      });
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
  });
}).listen(PORT, () => console.log(`mock llm listening on ${PORT}`));

// Vercel Function: POST /api/ask  (GET /api/ask tells you whether the AI is switched on)
// Switch the AI on with ONE of these environment variables (Vercel > Project > Settings > Environment Variables), then redeploy:
//   ANTHROPIC_API_KEY                           -> uses Claude (optional variable MODEL)
//   CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN -> uses Cloudflare Workers AI (has a free allowance)
const SYSTEM = `You are the assistant on Aerial's MM2 Values, a values site for the Roblox game Murder Mystery 2 (MM2). Talk naturally and warmly, like a helpful friend: reply to thanks, greetings and small talk in kind (if someone says thank you, say you're welcome), remember what was said earlier in the conversation, and answer general questions helpfully and honestly.
For MM2 questions use ONLY the item data supplied with each question. Numbers are values (higher = worth more); in the full list each entry reads "name value/dN" where N is demand from 1 to 10 (higher = more people want it, so it trades faster); text values such as "x4 T1 Legendaries" are relative and cannot be added up. For a trade, add up both sides and say clearly whether the user is overpaying or underpaying and by how much (for example "You're overpaying by 5"). For "what's my next step" questions, use the progression candidates provided: suggest the next items up in the same rarity, with their values. If an item has no value in the data, say so instead of guessing, and never invent MM2 values. Demand and stability can shift real trades. Keep answers short (a few sentences) unless asked for more.`;

module.exports = async function handler(req, res) {
  const key = process.env.ANTHROPIC_API_KEY, cfId = process.env.CLOUDFLARE_ACCOUNT_ID, cfToken = process.env.CLOUDFLARE_API_TOKEN;
  const provider = key ? "claude" : (cfId && cfToken ? "cloudflare" : "none");
  if (req.method === "GET") return res.status(200).json({ ready: provider !== "none", provider });
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: "Forbidden" }); } catch (e) { return res.status(403).json({ error: "Forbidden" }); } }
  if (provider === "none") return res.status(501).json({ error: "The AI isn't switched on for this Vercel deployment: ANTHROPIC_API_KEY is not set. In Vercel open Settings, Environment Variables, add it for Production, then redeploy. (Free option: set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN instead.)" });

  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const question = String(body.question || "").slice(0, 500);
  if (!question) return res.status(400).json({ error: "Bad request" });
  const facts = String(body.facts || "").slice(0, 16000);
  const history = (Array.isArray(body.history) ? body.history : []).slice(-10)
    .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 600) }));
  while (history.length && history[0].role !== "user") history.shift();
  const prompt = `Item data from the site:\n${facts || "(none matched)"}\n\nQuestion: ${question}`;

  let answer = "", err = "";
  try {
    if (provider === "claude") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: process.env.MODEL || "claude-haiku-5-5", max_tokens: 400, system: SYSTEM, messages: [...history, { role: "user", content: prompt }] }),
      });
      if (!r.ok) err = "Claude API returned " + r.status + (r.status === 401 ? " (the API key looks wrong)" : "");
      else { const data = await r.json(); answer = (data.content || []).filter(c => c.type === "text").map(c => c.text).join("\n").trim(); }
    } else {
      for (const m of [process.env.CF_MODEL, "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-3.1-8b-instruct"].filter(Boolean)) {
        const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfId}/ai/run/${m}`, {
          method: "POST", headers: { Authorization: "Bearer " + cfToken, "content-type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "system", content: SYSTEM }, ...history, { role: "user", content: prompt }], max_tokens: 400 }),
        });
        if (!r.ok) { err = "Cloudflare Workers AI returned " + r.status; continue; }
        const data = await r.json(); answer = String((data.result && data.result.response) || "").trim();
        if (answer) break;
      }
    }
  } catch (e) { err = "The AI request failed"; }
  if (!answer) return res.status(502).json({ error: err || "The AI gave no answer" });
  return res.status(200).json({ answer });
};

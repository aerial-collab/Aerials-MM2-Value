// Vercel Function: POST /api/ask  (used when the site is hosted on Vercel)
// Needs the environment variable ANTHROPIC_API_KEY (Vercel > Project > Settings > Environment Variables). Optional: MODEL.
const SYSTEM = `You are the assistant on Aerial's MM2 Values, a values site for the Roblox game Murder Mystery 2 (MM2). Talk naturally and warmly, like a helpful friend: reply to thanks, greetings and small talk in kind (if someone says thank you, say you're welcome), remember what was said earlier in the conversation, and answer general questions helpfully and honestly.
For MM2 questions use ONLY the item data supplied with each question. Numbers are values (higher = worth more); in the full list each entry reads "name value/dN" where N is demand from 1 to 10 (higher = more people want it, so it trades faster); text values such as "x4 T1 Legendaries" are relative and cannot be added up. For a trade, add up both sides and say clearly whether the user is overpaying or underpaying and by how much (for example "You're overpaying by 5"). For "what's my next step" questions, use the progression candidates provided: suggest the next items up in the same rarity, with their values. If an item has no value in the data, say so instead of guessing, and never invent MM2 values. Demand and stability can shift real trades. Keep answers short (a few sentences) unless asked for more.`;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  const origin = req.headers.origin;
  if (origin) { try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: "Forbidden" }); } catch (e) { return res.status(403).json({ error: "Forbidden" }); } }
  if (!process.env.ANTHROPIC_API_KEY) return res.status(501).json({ error: "AI not configured" });

  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const question = String(body.question || "").slice(0, 500);
  if (!question) return res.status(400).json({ error: "Bad request" });
  const facts = String(body.facts || "").slice(0, 16000);
  const history = (Array.isArray(body.history) ? body.history : []).slice(-10)
    .map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 600) }));
  while (history.length && history[0].role !== "user") history.shift();

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.MODEL || "claude-haiku-5-5", max_tokens: 400, system: SYSTEM,
        messages: [...history, { role: "user", content: `Item data from the site:\n${facts || "(none matched)"}\n\nQuestion: ${question}` }] }),
    });
    if (!r.ok) return res.status(502).json({ error: "Claude API returned " + r.status });
    const data = await r.json();
    const answer = (data.content || []).filter(c => c.type === "text").map(c => c.text).join("\n").trim();
    if (!answer) return res.status(502).json({ error: "The AI gave no answer" });
    return res.status(200).json({ answer });
  } catch (e) { return res.status(502).json({ error: "Claude API error" }); }
};

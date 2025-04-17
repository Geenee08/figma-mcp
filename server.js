// server.js

// ——————————————————————————————————————————
// 1) Imports & Env‑variable logging
// ——————————————————————————————————————————
const express = require('express');
const cors    = require('cors');
const { OpenAI } = require('openai');

const FIGMA_TOKEN    = process.env.FIGMA_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

console.log(
  "🔐 Using Figma Token:   ",
  FIGMA_TOKEN    ? FIGMA_TOKEN.slice(0,10)    + "..." : "Missing!"
);
console.log(
  "🧠 Using OpenAI Token: ",
  OPENAI_API_KEY ? OPENAI_API_KEY.slice(0,10) + "..." : "Missing!"
);

// ——————————————————————————————————————————
// 2) OpenAI client
// ——————————————————————————————————————————
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY
});

// ——————————————————————————————————————————
// 3) Express app + CORS
// ——————————————————————————————————————————
const app = express();
app.use(express.json());
app.use(cors());
app.options('*', cors());

// ——————————————————————————————————————————
// 4) Root route (sanity check)
// ——————————————————————————————————————————
app.get('/', (_req, res) => {
  res.send('Hello from your MCP!');
});

// ——————————————————————————————————————————
// 5) (Optional) existing conversational‑search routes
//     e.g. app.post('/search', …)
// ——————————————————————————————————————————

// ——————————————————————————————————————————
// 6) Flow‑Analyzer endpoint with updated user‑journey prompt
// ——————————————————————————————————————————
app.post('/flow-analyze', async (req, res) => {
  const { diagramPayload } = req.body;
  if (!diagramPayload) {
    return res.status(400).json({ error: 'No diagramPayload provided' });
  }

  // Telemetry: log counts only
  const t0 = Date.now();
  console.log(
    `[${new Date().toISOString()}] analyse ➜`,
    {
      steps:      diagramPayload.steps.length,
      connectors: diagramPayload.connectors.length,
      freeText:   diagramPayload.freeText.length
    }
  );

  // Build the updated prompt
  const systemMsg = [
    "You are a senior UX researcher.",
    "THIS IS A USER‑JOURNEY DIAGRAM (sequence of user actions and decisions), not a UI wireframe.",
    "Focus exclusively on the user's motivations, emotional arc, and high‑level goal."
  ].join(' ');

  const userMsg = `
Here is a user‑journey diagram as JSON (up to 50 steps):

${JSON.stringify(diagramPayload, null, 2)}

TASK 1: Summarise **what the user is trying to achieve** (their goal) and their emotional arc in 2–3 sentences.

TASK 2: Identify pain‑points in their motivation (e.g. friction, confusion, anxiety) and opportunities to improve their experience, using any relevant UX or psychology principles from Growth.Design.

For each insight, provide:
- stepId (or null for flow‑level)
- brief description of the pain‑point
- principle name and a one‑line blurb
- severity (high/medium/low)

OUTPUT **strictly** as JSON:
{
  "overview": "…",
  "insights": [
    {
      "stepId":   "123",
      "pain":     "…",
      "principle": { "name":"…", "blurb":"…" },
      "severity": "high"
    },
    …
  ]
}
`.trim();

  // Helper to strip code fences if present
  function stripFences(raw) {
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (m && m[1]) return m[1].trim();
    return raw.replace(/`/g, '').trim();
  }

  try {
    const aiRes = await openai.chat.completions.create({
      model:       'gpt-4o-mini',
      temperature: 0.2,
      max_tokens:  1000,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user',   content: userMsg   }
      ]
    });

    const raw     = aiRes.choices?.[0]?.message?.content || '';
    const cleaned = stripFences(raw);

    let json;
    try {
      json = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('JSON.parse failed:', parseErr);
      console.error('Raw LLM output:', raw);
      return res
        .status(502)
        .json({ error: 'Invalid JSON from LLM, please retry.' });
    }

    res.json(json);

    console.log(
      `…GPT ok (${((Date.now() - t0)/1000).toFixed(1)}s, `
      + `${aiRes.usage.total_tokens} tok)`
    );
  } catch (err) {
    console.error('LLM call failed:', err);
    res
      .status(502)
      .json({ error: 'LLM analysis failed, please retry.' });
  }
});

// ——————————————————————————————————————————
// 7) Start the server
// ——————————————————————————————————————————
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP listening on port ${PORT}`);
});

module.exports = app;

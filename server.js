// server.js

// ——————————————————————————
// 1) Env & token logging
// ——————————————————————————
const express = require('express');
const cors    = require('cors');
const { OpenAI } = require('openai');

const FIGMA_TOKEN     = process.env.FIGMA_TOKEN;
const OPENAI_API_KEY  = process.env.OPENAI_API_KEY;

console.log(
  "🔐 Using Figma Token:", 
  FIGMA_TOKEN     ? FIGMA_TOKEN.slice(0,10) + "..." : "Missing!"
);
console.log(
  "🧠 Using OpenAI Token:", 
  OPENAI_API_KEY  ? OPENAI_API_KEY.slice(0,10) + "..." : "Missing!"
);

// ——————————————————————————
// 2) OpenAI client
// ——————————————————————————
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY
});

// ——————————————————————————
// 3) Express setup
// ——————————————————————————
const app = express();
app.use(express.json());
app.use(cors());  // adds Access‑Control‑Allow‑Origin: *

// ——————————————————————————
// 4) Root route (sanity check)
// ——————————————————————————
app.get('/', (_req, res) => {
  res.send('Hello from your MCP!');
});

// ——————————————————————————
// 5) (Optional) Your existing conversational-search routes
//    e.g. app.post('/search', …)
// ——————————————————————————

// ——————————————————————————
// 6) Flow‑Analyzer endpoint
// ——————————————————————————
app.post('/flow-analyze', async (req, res) => {
  const { diagramPayload } = req.body;
  if (!diagramPayload) {
    return res.status(400).json({ error: 'No diagramPayload provided' });
  }

  // Telemetry: log only counts
  const t0 = Date.now();
  console.log(
    `[${new Date().toISOString()}] analyse ➜`,
    {
      steps:      diagramPayload.steps.length,
      connectors: diagramPayload.connectors.length,
      freeText:   diagramPayload.freeText.length
    }
  );

  // Build the LLM prompt
  const systemMsg = 'You are a senior UX researcher analysing user‑journey diagrams.';
  const userMsg   =
`Here is a user‑journey diagram as JSON:

${JSON.stringify(diagramPayload, null, 2)}

TASKS
1. Summarise the overall flow in 2‑3 sentences.
2. Identify pain‑points and opportunities using any relevant UX / psychology
   principles from Growth.Design (full catalogue).
3. Rate severity (high / medium / low) and include a one‑line blurb of the principle.

OUTPUT STRICTLY AS JSON WITH THIS SHAPE:
{
  "overview": "…",
  "insights": [
    {
      "stepId": "123",          // or null for flow‑level
      "pain": "…",
      "principle": {
        "name":  "Zeigarnik Effect",
        "blurb": "People remember incomplete tasks…"
      },
      "severity": "high"
    }
  ]
}`;

// Helper to strip ``` fences
function stripFences(raw) {
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (m && m[1]) return m[1].trim();
  // fallback: remove any backticks
  return raw.replace(/`/g, '').trim();
}

try {
  // Call OpenAI
  const aiRes = await openai.chat.completions.create({
    model:       'gpt-4o-mini',
    temperature: 0.2,
    max_tokens:  1000,
    messages: [
      { role: 'system', content: systemMsg },
      { role: 'user',   content: userMsg   }
    ]
  });

  // Extract & clean
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

  // Return the insights
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

// ——————————————————————————
// 7) Start server
// ——————————————————————————
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP listening on port ${PORT}`);
});

module.exports = app;

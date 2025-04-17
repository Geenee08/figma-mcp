// server.js

// 1) Imports & Env‑variable logging
const express = require('express');
const cors    = require('cors');
const { OpenAI } = require('openai');

const FIGMA_TOKEN    = process.env.FIGMA_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

console.log(
  '🔐 Using Figma Token:   ',
  FIGMA_TOKEN    ? FIGMA_TOKEN.slice(0,10)    + '...' : 'Missing!'
);
console.log(
  '🧠 Using OpenAI Token: ',
  OPENAI_API_KEY ? OPENAI_API_KEY.slice(0,10) + '...' : 'Missing!'
);

// 2) OpenAI client
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// 3) Express app + CORS
const app = express();
app.use(express.json());
app.use(cors());
app.options('*', cors());

// 4) Root route (sanity check)
app.get('/', (_req, res) => res.send('Hello from your MCP!'));

// 5) (Optional) your existing conversational‑search routes here…

// 6) Flow‑Analyzer endpoint with label‑anchored context inference
app.post('/flow-analyze', async (req, res) => {
  const { diagramPayload } = req.body;
  if (!diagramPayload) {
    return res.status(400).json({ error: 'No diagramPayload provided' });
  }

  // Telemetry
  const t0 = Date.now();
  console.log(
    `[${new Date().toISOString()}] analyse →`,
    {
      steps:      diagramPayload.steps.length,
      connectors: diagramPayload.connectors.length,
      freeText:   diagramPayload.freeText.length
    }
  );

  // 7) Build the updated prompt
  const systemMsg = [
    "You are a senior UX researcher analyzing user-journey diagrams.",
    "You receive a set of labeled steps and directed edges (connectors).",
    "Examine each step's `label` value to find domain clues (e.g. 'food delivery', 'cab booking', 'meeting').",
    "From those labels, extract:",
    "  • the domain context",
    "  • the user's primary goal",
    "  • a related sub-goal.",
    "Optionally list any keywords you spotted.",
    "Then focus exclusively on user motivations and emotional arcs."
  ].join(' ');

  const userMsg = `
Here is a user-journey diagram as JSON (up to 50 steps):

${JSON.stringify(diagramPayload, null, 2)}

TASK 1: Extract:
  • "context" (e.g. "Food-delivery app onboarding")
  • "goal" (primary user objective)
  • "subGoal" (secondary benefit or intent)
  • "extractedKeywords" (optional array of domain words)

TASK 2: Provide a 2–3 sentence "overview" that weaves in the context, goal, and emotional arc.

TASK 3: For each step, identify:
  • A pain-point in the user's motivation.
  • One bullet "suggestion" to improve that step, grounded in a UX/psychology principle from Growth.Design.
  • The principle name and a one-line blurb.
  • A "severity" (high/medium/low).
  • **Include** the original "label" for clarity.

TASK 4: List "keyTakeaways" for the overall flow (flow-level insights).

OUTPUT strictly as JSON following this schema:
{
  "context": "...",
  "goal": "...",
  "subGoal": "...",
  "extractedKeywords": ["...", ...],
  "overview": "...",
  "steps": [
    {
      "stepId":    "...",
      "label":     "...",
      "pain":      "...",
      "suggestion":"...",
      "principle": { "name":"...", "blurb":"..." },
      "severity":  "high"
    }
    // …
  ],
  "keyTakeaways": [
    { "message":"...", "severity":"medium" }
    // …
  ]
}
`.trim();

  // Helper to strip markdown fences
  function stripFences(raw) {
    const m = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (m && m[1]) return m[1].trim();
    return raw.replace(/`/g, '').trim();
  }

  try {
    // 8) Call the LLM
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

    let result;
    try {
      result = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('JSON.parse failed:', parseErr);
      console.error('Raw LLM output:', raw);
      return res
        .status(502)
        .json({ error: 'Invalid JSON from LLM, please retry.' });
    }

    // 9) Return structured insights
    res.json(result);

    console.log(
      `... GPT ok (${((Date.now() - t0)/1000).toFixed(1)}s, `
      + `${aiRes.usage.total_tokens} tok)`
    );
  } catch (err) {
    console.error('LLM call failed:', err);
    res
      .status(502)
      .json({ error: 'LLM analysis failed, please retry.' });
  }
});

// 10) Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP listening on port ${PORT}`);
});

module.exports = app;

// server.js

const express = require('express');
const cors    = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(express.json());
app.use(cors());
app.options('*', cors());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Sanity check
app.get('/', (_req, res) => res.send('MCP is up'));

// Flow‑Analyzer endpoint — minimal re‑prompt
app.post('/flow-analyze', async (req, res) => {
  const { diagramPayload } = req.body;
  if (!diagramPayload) {
    return res.status(400).json({ error: 'No diagramPayload provided' });
  }

  // Build a simple list of labels + connectors
  const labelsText = diagramPayload.steps
    .map((s,i) => `${i+1}. ${s.label}`)
    .join('\n');
  const connsText = diagramPayload.connectors
    .map(c => `${c.from}→${c.to}`)
    .join(', ');

  // Prompt
  const userPrompt = `
User‑journey steps:
${labelsText}

Connectors: ${connsText}

TASKS:
1. In 1–2 sentences, say what this journey is about (the context).
2. In 1–2 sentences, state the user’s main goal.
3. For each step, give:
   • The step label
   • One pain‑point (what might frustrate the user)
   • One suggestion to improve it (1–2 sentences).
4. Finally, list 2–3 key takeaways for the overall flow.

Respond strictly in JSON:
{
  "context": "...",
  "goal": "...",
  "steps": [
    {
      "label": "...",
      "pain": "...",
      "suggestion": "..."
    }
    // …
  ],
  "keyTakeaways": [
    "…",
    "…"
  ]
}
`.trim();

  try {
    const aiRes = await openai.chat.completions.create({
      model:       'gpt-4o-mini',
      temperature: 0.3,
      max_tokens:  1000,
      messages: [
        { role: 'user', content: userPrompt }
      ]
    });

    const raw = aiRes.choices?.[0]?.message?.content || '';
    // strip fences
    const cleaned = raw.replace(/^```json\s*/, '').replace(/```$/, '').trim();

    let json;
    try {
      json = JSON.parse(cleaned);
    } catch (e) {
      console.error('Parse error:', e, 'raw:', raw);
      return res.status(502).json({ error: 'Invalid JSON from LLM' });
    }

    res.json(json);
  } catch (err) {
    console.error('LLM call failed:', err);
    res.status(502).json({ error: 'LLM analysis failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`MCP listening on ${PORT}`));
module.exports = app;

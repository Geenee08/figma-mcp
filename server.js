const express = require('express');
const cors    = require('cors');
const { OpenAI } = require('openai');

const app = express();
app.use(express.json());
app.use(cors());
app.options('*', cors());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.get('/', (_req, res) => res.send('Server up'));

app.post('/flow-analyze', async (req, res) => {
  const { diagramPayload } = req.body;
  if (!diagramPayload) return res.status(400).json({ error: 'Missing diagramPayload' });

  const stepList = diagramPayload.steps
    .map((s, i) =>
      `${i + 1}. ${s.label}` + (s.goalBlurb ? `\n   Goal: ${s.goalBlurb}` : '')
    )
    .join('\n');

  const connList = diagramPayload.connectors
    .map(c => `${c.from} → ${c.to}`)
    .join(', ');

  const prompt = `
Here is a user journey made of labeled steps. Each step may have a user motivation or emotional goal.

Steps:
${stepList}

Connectors:
${connList}

TASKS:
1. Summarize what this journey is about (context).
2. Describe what the user is trying to achieve (goal).
3. For each step, write:
   - label
   - if present, summarize the goalBlurb
   - 1 sentence pain-point
   - 1–2 sentence suggestion
4. Then share 2–3 overall takeaways.

Respond in this JSON shape:
{
  "context": "...",
  "goal": "...",
  "steps": [
    {
      "label": "...",
      "goalBlurb": "...",
      "pain": "...",
      "suggestion": "..."
    }
  ],
  "keyTakeaways": [ "...", "..." ]
}
`.trim();

  try {
    const aiRes = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = aiRes.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/^```json\s*/, '').replace(/```$/, '').trim();

    let json;
    try {
      json = JSON.parse(cleaned);
    } catch (e) {
      console.error('Parse failed:', raw);
      return res.status(502).json({ error: 'Invalid JSON from GPT' });
    }

    res.json(json);
  } catch (err) {
    console.error('LLM error:', err);
    res.status(502).json({ error: 'GPT failed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Listening on ${PORT}`));

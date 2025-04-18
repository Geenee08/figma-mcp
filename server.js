// server.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Configuration, OpenAIApi } = require('openai');

const app = express();
// Enable CORS for all origins
app.use(cors({ origin: '*' }));
// Handle preflight requests
app.options('*', cors({ origin: '*' }));
app.use(bodyParser.json());

const configuration = new Configuration({ apiKey: process.env.OPENAI_API_KEY });
const openai = new OpenAIApi(configuration);

// Updated route to match plugin fetch endpoint
app.post('/flow-analyze', async (req, res) => {
  const { flow, connections } = req.body;
  const steps = flow.map(f => ({ stepId: f.id, name: f.name, text: f.text }));

  const prompt = `You are a senior UX researcher. Given these steps:
${JSON.stringify(steps, null, 2)}
For each step:
1. Identify 1–2 user pain points.
2. Recommend one Growth.Design principle.
3. Provide a one-sentence rationale.
Return strictly valid JSON array of objects: { stepId, principle, rationale }.`;

  try {
    const completion = await openai.createCompletion({
      model: 'gpt-4o-mini',
      prompt,
      max_tokens: 500,
      temperature: 0.7
    });
    const raw = completion.data.choices[0].text.trim();
    let insights;
    try {
      insights = JSON.parse(raw);
    } catch (e) {
      console.error('JSON parse error:', e);
      return res.status(500).json({ error: 'Invalid JSON from AI.' });
    }
    res.json(insights);
  } catch (error) {
    console.error('OpenAI error:', error);
    res.status(500).json({ error: 'Analysis failed.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
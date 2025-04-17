const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fetch = require('node-fetch');
const { OpenAI } = require('openai'); 
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY      // set in Railway vars
});

const app = express();
app.use(express.json());
app.get('/', (req, res) => {
  res.send('Hello from your MCP!');
});
app.use(cors());
app.use(bodyParser.json());

const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

console.log("🔐 Using Figma Token:", FIGMA_TOKEN ? FIGMA_TOKEN.slice(0, 10) + "..." : "Missing!");
console.log("🧠 Using OpenAI Token:", OPENAI_API_KEY ? OPENAI_API_KEY.slice(0, 10) + "..." : "Missing!");

app.post('/search', async (req, res) => {
  const { query, fileKey } = req.body;
  console.log("📩 Received fileKey:", fileKey);

  try {
    // Fetch file from Figma
    const figmaRes = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
      headers: { 'X-Figma-Token': FIGMA_TOKEN }
    });

    if (!figmaRes.ok) {
      const errorText = await figmaRes.text();
      console.error(`❌ Figma API error ${figmaRes.status}: ${errorText}`);
      return res.status(figmaRes.status).send(`Failed to fetch file data from Figma: ${errorText}`);
    }

    const figmaData = await figmaRes.json();

    if (!figmaData || !figmaData.document) {
      console.error("❌ Invalid Figma file data:", figmaData);
      return res.status(500).send("Figma API did not return expected document structure.");
    }

    const frames = [];

    // Extract relevant data from frames
    const walk = (node) => {
      if (node.type === 'FRAME') {
        const texts = [];

        const extractText = (n) => {
          if (n.type === 'TEXT') texts.push(n.characters || '');
          if (n.children) n.children.forEach(extractText);
        };
        extractText(node);

        frames.push({
          name: node.name,
          text: texts.join(' '),
          width: node.absoluteBoundingBox?.width || null,
          height: node.absoluteBoundingBox?.height || null,
          x: node.absoluteBoundingBox?.x || null,
          y: node.absoluteBoundingBox?.y || null,
          type: node.type,
          childCount: node.children?.length || 0
        });
      }

      if (node.children) node.children.forEach(walk);
    };

    walk(figmaData.document);

    // Call OpenAI with prompt + frame data
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: `
You are a design reasoning assistant.

The user will give you a natural language query like "show me permission modals" or "find onboarding screens". Your job is to review a list of Figma frames and return only the ones that best match the intent — even if the match is not explicit.

Each frame includes:
- name
- visible text content
- width and height
- x and y position
- node type (e.g., FRAME)
- number of children (childCount)

Your task is to:
1. Infer semantic intent from the user's query
2. Match based on meaning, not just keywords. Look for synonyms, context, UI language, and structure.
3. Use layout info: small centered frames may be modals; large frames with intro text may be onboarding.
4. Return a reason explaining your logic in plain English
5. Rate your confidence: High / Medium / Low

Return a JSON array like this:

[
  {
    "name": "Invite Modal",
    "reason": "Text includes 'invite', frame is small and centered, likely a permission modal.",
    "confidence": "High"
  }
]

If no match, return an empty array: []
`
          },
          {
            role: 'user',
            content: `User query: "${query}"\n\nFrames:\n${JSON.stringify(frames)}`
          }
        ]
      })
    });

    const aiResult = await openaiRes.json();
    const text = aiResult.choices[0].message.content;
    console.log("🧠 GPT raw response:\n", text);

    let matches = [];
    try {
      const cleaned = text.replace(/```json|```/g, '').trim();
      matches = JSON.parse(cleaned);

      if (!Array.isArray(matches)) {
        throw new Error("Parsed result is not an array");
      }
    } catch (e) {
      console.warn("⚠️ Failed to parse GPT response as JSON:", text);
      return res.status(200).json([
        {
          name: "Error",
          reason: "Could not parse GPT response. Check system prompt or formatting.",
          confidence: "Low"
        }
      ]);
    }

    res.json(matches);
  } catch (err) {
    console.error('❌ Error in /search:', err);
    res.status(500).send('Internal Server Error');
  }
});

const PORT = process.env.PORT || 8080;

// Flow Analyzer route
/* ----------------------------------------------------
 * Iteration A: just echo counts back to the plugin
 * -------------------------------------------------- */
app.post('/flow-analyze', async (req, res) => {
  const { diagramPayload } = req.body;
  if (!diagramPayload)
    return res.status(400).json({ error: 'No diagramPayload provided' });

  /* 1  Lightweight telemetry (counts only) */
  const t0 = Date.now();
  const counts = {
    steps:       diagramPayload.steps.length,
    connectors:  diagramPayload.connectors.length,
    freeText:    diagramPayload.freeText.length
  };
  console.log(`[${new Date().toISOString()}] analyse req —`, counts);

  /* 2  Craft prompt */
  const prompt = [
    {
      role: 'system',
      content:
        'You are a senior UX researcher analysing user‑journey diagrams.'
    },
    {
      role: 'user',
      content:
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
      "stepId": "123"   // or null for flow‑level
      "pain":     "…",
      "principle": {
        "name": "Zeigarnik Effect",
        "blurb": "People remember incomplete tasks…"
      },
      "severity": "high"
    }
  ]
}`
    }
  ];

  /* 3  Call OpenAI */
  try {
    const aiRes = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      max_tokens: 1000,
      messages: prompt
    });

    const raw = aiRes.choices?.[0]?.message?.content || '{}';
    const json = JSON.parse(raw);

    /* 4  Return insights */
    res.json(json);

    console.log(
      `…GPT ok (${((Date.now() - t0) / 1000).toFixed(1)} s, ` +
      `${aiRes.usage.total_tokens} tok)`
    );
  } catch (err) {
    console.error('GPT error:', err);
    res.status(502).json({ error: 'LLM analysis failed, please retry.' });
  }
});



app.listen(PORT, () => {
  console.log(`✅ MCP server running on port ${PORT}`);
});

module.exports = app;

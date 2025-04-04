const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
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
    // Fetch file data from Figma REST API
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

    // Walk through frames and collect text
    const frames = [];

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
          text: texts.join(' ')
        });
      }

      if (node.children) node.children.forEach(walk);
    };

    walk(figmaData.document);

    // Send frames + query to OpenAI (GPT-4)
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
            content: 'You are a design assistant. Based on the user\'s query and frame data, return a JSON array of matching frames.'
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
      // Remove markdown formatting if GPT included it
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
          reason: "Could not parse GPT response. Check system prompt or frame data.",
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
app.listen(PORT, () => {
  console.log(`✅ MCP server running on port ${PORT}`);
});

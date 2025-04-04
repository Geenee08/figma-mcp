const express = require('express');
const bodyParser = require('body-parser');
const fetch = require('node-fetch');

const app = express();
const cors = require('cors');
app.use(cors());
app.use(bodyParser.json());

// ✅ Use Railway environment variables
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
// Debug log: Confirm we are reading the right token from Railway
console.log("🔐 Using Figma Token:", FIGMA_TOKEN ? FIGMA_TOKEN.slice(0, 10) + "..." : "Missing!");
console.log("🧠 Using OpenAI Token:", OPENAI_API_KEY ? OPENAI_API_KEY.slice(0, 10) + "..." : "Missing!");

app.post('/search', async (req, res) => {
  const { query, fileKey } = req.body;

  console.log("📩 Received fileKey:", fileKey);


  try {
    // 1. Fetch Figma file JSON
    const figmaRes = await fetch(`https://api.figma.com/v1/files/${fileKey}`, {
      headers: { 'X-Figma-Token': FIGMA_TOKEN }
    });
    const figmaData = await figmaRes.json();

    // 2. Extract frames and their text content
    const frames = [];

    const walk = (node) => {
        if (node.type === 'FRAME') {
          const texts = [];
      
          const extractText = (n) => {
            if (n.type === 'TEXT') texts.push(n.characters || '');
            if (n.children) n.children.forEach(extractText);
          };
          extractText(node);
      
          const metadata = {
            name: node.name,
            text: texts.join(' '),
            width: node.absoluteBoundingBox?.width || null,
            height: node.absoluteBoundingBox?.height || null,
            x: node.absoluteBoundingBox?.x || null,
            y: node.absoluteBoundingBox?.y || null,
            type: node.type,
            childCount: node.children?.length || 0
          };
      
          frames.push(metadata);
        }
      
        if (node.children) node.children.forEach(walk);
      };
      


    if (figmaData && figmaData.document) {
        walk(figmaData.document);
      } else {
        console.error("❌ Invalid Figma file data:", figmaData);
        return res.status(500).send("Failed to fetch valid file data from Figma.");
      }
      

    // 3. Call OpenAI to match relevant frames
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
            content: 'You are a design assistant. Based on the user\'s query and frame data, return a JSON array of matching frames. Each frame should include name and a short reason for match.'
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

    let matches = [];
    try {
      matches = JSON.parse(text); // Expecting GPT to return JSON array
    } catch (e) {
      console.warn('GPT response could not be parsed:', text);
      matches = [];
    }

    res.json(matches);
  } catch (err) {
    console.error('Error in /search:', err);
    res.status(500).send('Internal Server Error');
  }
});

// ✅ For Railway, start listening on the default port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`MCP server running on port ${PORT}`);
});

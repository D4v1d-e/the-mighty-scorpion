const SYSTEM_PROMPT = `You are Scorpion, Johnson's personal AI assistant. You are sharp, direct, and intelligent. Keep responses concise and clear, suitable to be spoken out loud.

You have two kinds of tools:
1. search_web — use this for anything live or time-sensitive: news, prices, weather, sports scores, current events, or anything you are not certain is still true.
2. list_my_files / read_my_data — use these when Johnson asks about his own notes, trading logs, or project files stored in his personal data folder.

Only use a tool when the question actually requires it. For normal conversation, casual questions, or general knowledge you already know, just answer directly without calling any tool.`;

const TOOLS = [
  {
    name: 'search_web',
    description: 'Search the live internet for current, real-time, or recent information - news, prices, scores, weather, or anything that could have changed recently. Do NOT use this for general knowledge or casual conversation.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' }
      },
      required: ['query']
    }
  },
  {
    name: 'list_my_files',
    description: "List the filenames available in Johnson's personal data folder (trading notes, logs, project files). Call this first if you don't know the exact filename you need.",
    parameters: { type: 'object', properties: {} }
  },
  {
    name: 'read_my_data',
    description: "Read the full text content of a specific file from Johnson's personal data folder by exact filename.",
    parameters: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Exact filename to read, e.g. genesis_notes.md' }
      },
      required: ['filename']
    }
  }
];

async function searchWeb(query) {
  const TAVILY_KEY = process.env.TAVILY_API_KEY;
  if (!TAVILY_KEY) return { error: 'Tavily key not configured on server' };

  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: TAVILY_KEY,
      query: query,
      max_results: 4,
      include_answer: true
    })
  });

  const t = await r.text();
  let d;
  try { d = JSON.parse(t); } catch(e) {
    return { error: 'Tavily bad response: ' + t.slice(0, 200) };
  }
  if (d.error) return { error: d.error };

  return {
    answer: d.answer || null,
    results: (d.results || []).map(x => ({ title: x.title, url: x.url, content: x.content }))
  };
}

async function listMyFiles() {
  const r = await fetch('https://api.github.com/repos/D4v1d-e/the-mighty-scorpion/contents/data');
  if (!r.ok) return { error: 'Could not list files, status ' + r.status + ' (does the data folder exist?)' };
  const d = await r.json();
  if (!Array.isArray(d)) return { error: 'data folder not found or empty' };
  return { files: d.map(f => f.name) };
}

async function readMyData(filename) {
  const safe = (filename || '').replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safe) return { error: 'Invalid filename' };

  const r = await fetch(`https://raw.githubusercontent.com/D4v1d-e/the-mighty-scorpion/main/data/${safe}`);
  if (!r.ok) return { error: 'File not found: ' + safe };

  const content = await r.text();
  return { filename: safe, content: content.slice(0, 8000) };
}

async function executeTool(name, args) {
  try {
    if (name === 'search_web') return await searchWeb(args.query);
    if (name === 'list_my_files') return await listMyFiles();
    if (name === 'read_my_data') return await readMyData(args.filename);
    return { error: 'Unknown tool: ' + name };
  } catch(e) {
    return { error: e.message };
  }
}

export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not found in environment' });

    const MODEL = 'gemini-2.5-flash';
    const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_KEY}`;

    let contents = [
      { role: 'user', parts: [{ text: prompt }] }
    ];

    let finalText = null;
    let rounds = 0;

    while (rounds < 4 && finalText === null) {
      rounds++;

      const response = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: contents,
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          tools: [{ functionDeclarations: TOOLS }]
        })
      });

      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch(e) {
        return res.status(500).json({ error: 'Bad Gemini response: ' + text.slice(0, 300) });
      }

      if (data.error) {
        return res.status(500).json({ error: data.error.message || JSON.stringify(data.error) });
      }

      const candidate = data.candidates && data.candidates[0];
      if (!candidate || !candidate.content) {
        return res.status(500).json({ error: 'No candidate from Gemini: ' + JSON.stringify(data) });
      }

      const parts = candidate.content.parts || [];
      const functionCallPart = parts.find(p => p.functionCall);

      if (functionCallPart) {
        contents.push({ role: 'model', parts: parts });

        const { name, args } = functionCallPart.functionCall;
        const result = await executeTool(name, args || {});

        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: name,
              response: { content: result }
            }
          }]
        });
        // loop continues - feed result back to Gemini

      } else {
        const textPart = parts.find(p => p.text);
        finalText = textPart ? textPart.text : '(no text response)';
      }
    }

    if (finalText === null) {
      finalText = "I looked into that but couldn't finish in time - try asking again.";
    }

    return res.status(200).json({ reply: finalText });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

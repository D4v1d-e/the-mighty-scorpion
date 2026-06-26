export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'No prompt provided' });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not found' });

    // confirmed free models June 2026 - tries each one until one works
    const models = [
      'google/gemma-4-31b-it:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'openai/gpt-oss-120b:free',
      'google/gemma-4-26b-a4b-it:free'
    ];

    let lastError = '';

    for (const model of models) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + apiKey,
            'HTTP-Referer': 'https://the-mighty-scorpion.vercel.app',
            'X-Title': 'Scorpion AI'
          },
          body: JSON.stringify({
            model: model,
            messages: [
              {
                role: 'system',
                content: 'You are Scorpion, a powerful personal AI assistant. Sharp, direct, intelligent. Keep responses concise and clear.'
              },
              { role: 'user', content: prompt }
            ]
          })
        });

        const text = await response.text();
        let data;

        try {
          data = JSON.parse(text);
        } catch(e) {
          lastError = 'Bad JSON from ' + model;
          continue;
        }

        if (data.error) {
          lastError = data.error.message || JSON.stringify(data.error);
          continue; // try next model
        }

        if (!data.choices || !data.choices[0]) {
          lastError = 'No choices from ' + model;
          continue;
        }

        const reply = data.choices[0].message.content;
        return res.status(200).json({ reply, model_used: model });

      } catch(e) {
        lastError = e.message;
        continue; // try next model
      }
    }

    // all models failed
    return res.status(500).json({ error: 'All models failed. Last error: ' + lastError });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

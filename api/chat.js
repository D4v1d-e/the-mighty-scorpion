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
    if (!apiKey) return res.status(500).json({ error: 'API key not found in environment' });

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'HTTP-Referer': 'https://the-mighty-scorpion.vercel.app',
        'X-Title': 'Scorpion AI'
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-3.3-70b-instruct:free',
        messages: [
          {
            role: 'system',
            content: 'You are Scorpion, a powerful personal AI assistant. Sharp, direct, intelligent. Keep responses concise.'
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
      return res.status(500).json({ error: 'OpenRouter raw response: ' + text });
    }

    if (data.error) return res.status(500).json({ error: data.error.message || JSON.stringify(data.error) });

    const reply = data.choices[0].message.content;
    return res.status(200).json({ reply });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

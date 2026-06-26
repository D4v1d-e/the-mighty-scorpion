// SCORPION AI - Secure Backend
// This file runs on Vercel server - key is never visible to anyone

export default async function handler(req, res) {
  
  // allow your site to call this
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { prompt } = req.body;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + process.env.OPENROUTER_API_KEY,
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

  const data = await response.json();
  const reply = data.choices[0].message.content;
  
  res.status(200).json({ reply });
}

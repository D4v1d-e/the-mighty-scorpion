export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });

    const response = await fetch('https://freetts.org/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text,
        voice: 'en-US-GuyNeural',
        rate: '-5%',
        pitch: '-10%'
      })
    });

    const data = await response.json();

    if (!data.file_id) {
      return res.status(500).json({ error: 'TTS failed: ' + JSON.stringify(data) });
    }

    return res.status(200).json({
      audio_url: `https://freetts.org/api/audio/${data.file_id}`
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

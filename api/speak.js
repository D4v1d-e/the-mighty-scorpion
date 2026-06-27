export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'No text provided' });

    // Step 1 - generate TTS
    const ttsResponse = await fetch('https://freetts.org/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text.slice(0, 1000),
        voice: 'en-US-GuyNeural',
        rate: '-5%',
        pitch: '-10%'
      })
    });

    const ttsText = await ttsResponse.text();
    let ttsData;
    try {
      ttsData = JSON.parse(ttsText);
    } catch(e) {
      return res.status(500).json({ error: 'FreeTTS bad response: ' + ttsText });
    }

    if (!ttsData.file_id) {
      return res.status(500).json({ error: 'No file_id returned: ' + JSON.stringify(ttsData) });
    }

    // Step 2 - fetch audio and stream back
    const audioResponse = await fetch(`https://freetts.org/api/audio/${ttsData.file_id}`);

    if (!audioResponse.ok) {
      return res.status(500).json({ error: 'Audio fetch failed: ' + audioResponse.status });
    }

    const audioBuffer = await audioResponse.arrayBuffer();

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', audioBuffer.byteLength);
    res.status(200).send(Buffer.from(audioBuffer));

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

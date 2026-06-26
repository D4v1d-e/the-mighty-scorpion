// SCORPION AI - AI BRAIN ENGINE
// Uses OpenRouter API - free models, no login needed

const AI = {

  think: async function(prompt) {
    try {
      setOrbState('thinking', 'THINKING...');

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + window.SCORPION_KEY,
          'HTTP-Referer': 'https://the-mighty-scorpion.vercel.app',
          'X-Title': 'Scorpion AI'
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.3-70b-instruct:free',
          messages: [
            {
              role: 'system',
              content: 'You are Scorpion, a powerful personal AI assistant. You are sharp, direct, and intelligent. Keep responses clear and concise.'
            },
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      });

      const data = await response.json();
      const reply = data.choices[0].message.content;

      document.getElementById('output').innerText = '🦂 ' + reply;
      setOrbState('speaking', 'SCORPION SPEAKING...');
      VoiceOutput.speak(reply);

    } catch(e) {
      setOrbState('', 'ERROR - TAP ORB TO RETRY');
      document.getElementById('output').innerText = 'ERROR: ' + e.message;
    }
  }

};

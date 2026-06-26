// SCORPION AI - AI BRAIN WITH STREAMING
// Words appear instantly as they are generated

const AI = {

  think: async function(prompt) {
    try {
      setOrbState('thinking', 'THINKING...');
      document.getElementById('output').innerText = '🦂 ';

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt })
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';

      setOrbState('thinking', 'SCORPION RESPONDING...');

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n').filter(l => l.trim() !== '');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                fullText += parsed.text;
                document.getElementById('output').innerText = '🦂 ' + fullText;
              }
            } catch(e) {}
          }
        }
      }

      // speak full response after streaming done
      setOrbState('speaking', 'SCORPION SPEAKING...');
      VoiceOutput.speak(fullText);

    } catch(e) {
      setOrbState('', 'ERROR - TAP ORB TO RETRY');
      document.getElementById('output').innerText = '❌ ERROR: ' + e.message;
    }
  }

};

const AI = {

  think: async function(prompt) {
    try {
      setOrbState('thinking', 'THINKING...');

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt })
      });

      const data = await response.json();

      if (data.error) {
        setOrbState('', 'ERROR - TAP ORB TO RETRY');
        document.getElementById('output').innerText = '❌ ERROR: ' + data.error;
        return;
      }

      const reply = data.reply;
      document.getElementById('output').innerText = '🦂 ' + reply;
      setOrbState('speaking', 'SCORPION SPEAKING...');
      VoiceOutput.speak(reply);

    } catch(e) {
      setOrbState('', 'ERROR - TAP ORB TO RETRY');
      document.getElementById('output').innerText = '❌ ERROR: ' + e.message;
    }
  }

};

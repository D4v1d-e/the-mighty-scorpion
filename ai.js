// SCORPION AI - AI BRAIN ENGINE
// Uses Puter.js - 100% free, no API key needed

const AI = {

  think: async function(prompt) {
    try {
      document.getElementById('orb-status').innerText = 'THINKING...';
      
      const response = await puter.ai.chat(prompt);
      
      document.getElementById('orb-status').innerText = 'RESPONSE READY';
      document.getElementById('output').innerText = '🦂 ' + response;
      
      // send response to voice output
      VoiceOutput.speak(response);

    } catch(e) {
      document.getElementById('orb-status').innerText = 'ERROR - RETRYING...';
      document.getElementById('output').innerText = 'ERROR: ' + e.message;
    }
  }

};

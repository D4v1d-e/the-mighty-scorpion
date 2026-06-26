// SCORPION AI - VOICE OUTPUT ENGINE
// Uses Web Speech Synthesis API - 100% free, built into Chrome
// No API key needed

const VoiceOutput = {

  speak: function(text) {
    // stop any current speech first
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    
    // voice settings
    utterance.lang = 'en-US';
    utterance.pitch = 0.8;      // slightly deep voice
    utterance.rate = 0.95;      // slightly slower - clear and smooth
    utterance.volume = 1.0;     // full volume

    // pick best available voice
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(v => 
      v.name.includes('Google') || 
      v.name.includes('Daniel') || 
      v.name.includes('Alex')
    );
    if (preferred) utterance.voice = preferred;

    // update UI while speaking
    utterance.onstart = function() {
      document.getElementById('orb-status').innerText = 'SCORPION SPEAKING...';
    };

    utterance.onend = function() {
      document.getElementById('orb-status').innerText = 'AWAITING YOUR COMMAND...';
    };

    utterance.onerror = function(e) {
      document.getElementById('orb-status').innerText = 'VOICE OUTPUT ERROR';
    };

    window.speechSynthesis.speak(utterance);
  },

  stop: function() {
    window.speechSynthesis.cancel();
    document.getElementById('orb-status').innerText = 'AWAITING YOUR COMMAND...';
  }

};

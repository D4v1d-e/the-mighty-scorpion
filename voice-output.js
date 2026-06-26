// SCORPION AI - VOICE OUTPUT ENGINE
// Uses Puter.js → ElevenLabs - 100% free, no API key needed
// Quality: Studio realistic human voice

const VoiceOutput = {

  isSpeaking: false,
  currentAudio: null,

  speak: async function(text) {
    try {
      // stop any current speech first
      this.stop();

      this.isSpeaking = true;
      setOrbState('speaking', 'SCORPION SPEAKING...');

      // clean the text - remove markdown symbols that sound weird
      const cleanText = text
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/#{1,6}/g, '')
        .replace(/`/g, '')
        .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
        .trim();

      // use Puter.js to access ElevenLabs for free
      const audio = await puter.ai.txt2speech(cleanText, {
        provider: 'elevenlabs',
        voice: '21m00Tcm4TlvDq8ikWAM', // Rachel - clear, professional female voice
        model: 'eleven_multilingual_v2'
      });

      this.currentAudio = audio;

      audio.onended = () => {
        this.isSpeaking = false;
        setOrbState('', 'AWAITING YOUR COMMAND...');
      };

      audio.onerror = () => {
        this.isSpeaking = false;
        setOrbState('', 'AWAITING YOUR COMMAND...');
        // fallback to browser voice if ElevenLabs fails
        VoiceOutput.fallbackSpeak(cleanText);
      };

      audio.play();

    } catch(e) {
      console.error('ElevenLabs voice error:', e);
      this.isSpeaking = false;
      // fallback to browser voice
      this.fallbackSpeak(text);
    }
  },

  // backup voice if ElevenLabs fails
  fallbackSpeak: function(text) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-US';
      utterance.pitch = 0.8;
      utterance.rate = 0.95;
      utterance.volume = 1.0;

      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v =>
        v.name.includes('Google') ||
        v.name.includes('Daniel') ||
        v.name.includes('Alex')
      );
      if (preferred) utterance.voice = preferred;

      utterance.onstart = () => setOrbState('speaking', 'SCORPION SPEAKING...');
      utterance.onend = () => setOrbState('', 'AWAITING YOUR COMMAND...');

      window.speechSynthesis.speak(utterance);
    } catch(e) {
      setOrbState('', 'AWAITING YOUR COMMAND...');
    }
  },

  stop: function() {
    try {
      if (this.currentAudio) {
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        this.currentAudio = null;
      }
      window.speechSynthesis.cancel();
      this.isSpeaking = false;
      setOrbState('', 'AWAITING YOUR COMMAND...');
    } catch(e) {
      console.error('Stop error:', e);
    }
  }

};

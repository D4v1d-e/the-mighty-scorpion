// ══════════════════════════════════════════════════════════════════
//  SCORPION AI — CHAT.JS (No Study Mode)
//  Single output display with in-place TTS word highlighting
// ══════════════════════════════════════════════════════════════════

// ── CORE STATE ──
let state = 'idle';
let alwaysOn = false;
let recognition = null;
let audioUnlocked = false;
let processingCmd = false;
let conversationHistory = [];
const MAX_HISTORY = 20;

// ── TTS STATE ──
let _currentAudio = null;
let _ttsWordTimers = [];
let _ttsWordSpans = [];

// ══════════════════════════════════════════════════════════════════
//  IN-PLACE WORD HIGHLIGHT ENGINE
//  Wraps the response text directly inside #output as word spans.
//  No secondary overlay — one display, one truth.
// ══════════════════════════════════════════════════════════════════

function clearTTSHighlight() {
  _ttsWordTimers.forEach(clearTimeout);
  _ttsWordTimers = [];
  _ttsWordSpans.forEach(s => s.classList.remove('tts-active'));
  _ttsWordSpans = [];
}

/**
 * Renders text into #output as tts-word spans, ready for highlighting.
 * Returns the array of word spans built.
 * prefix: optional leading emoji/text to prepend as plain text (e.g. '🦂 ')
 */
function renderOutputWithSpans(text, prefix) {
  clearTTSHighlight();
  const out = document.getElementById('output');
  out.className = '';
  out.innerHTML = '';

  // Leading prefix (scorpion emoji etc) — not highlighted
  if (prefix) {
    const pre = document.createElement('span');
    pre.textContent = prefix;
    pre.style.userSelect = 'none';
    out.appendChild(pre);
  }

  // Tokenize: words + whitespace tokens
  const tokens = text.split(/(\s+)/);
  _ttsWordSpans = [];

  tokens.forEach(token => {
    if (/^\s+$/.test(token)) {
      out.appendChild(document.createTextNode(token));
    } else if (token) {
      const sp = document.createElement('span');
      sp.className = 'tts-word';
      sp.textContent = token;
      _ttsWordSpans.push(sp);
      out.appendChild(sp);
    }
  });

  out.scrollTop = 0;
  return _ttsWordSpans;
}

/**
 * Timer-based word advancement synced to audio playback.
 * ~145 wpm average, ~55ms per character, minimum 180ms per word.
 */
function runTimerHighlight(audio, spans) {
  const msPerChar = 55;
  const minMs = 180;
  let elapsed = 0;

  spans.forEach((sp, i) => {
    const duration = Math.max(minMs, sp.textContent.length * msPerChar);

    const t = setTimeout(() => {
      if (_currentAudio && audio !== _currentAudio) return;
      spans.forEach(s => s.classList.remove('tts-active'));
      sp.classList.add('tts-active');
      sp.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, elapsed);

    _ttsWordTimers.push(t);
    elapsed += duration;
  });

  // Clear last highlight
  _ttsWordTimers.push(setTimeout(() => {
    spans.forEach(s => s.classList.remove('tts-active'));
  }, elapsed + 400));
}

function stopAllSpeech() {
  if (_currentAudio) {
    _currentAudio.pause();
    _currentAudio.src = '';
    _currentAudio = null;
  }
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  clearTTSHighlight();
}

// ══════════════════════════════════════════════════════════════════
//  SPEAK REPLY — drives in-place word highlighting
// ══════════════════════════════════════════════════════════════════
async function speakReply(text) {
  stopAllSpeech();
  if (!text || !text.trim()) return;

  const clean = text
    .replace(/\*\*/g, '').replace(/\*/g, '').replace(/#{1,6}\s/g, '')
    .replace(/`/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n+/g, ' ').trim();

  // Render text with word spans IN-PLACE inside #output
  // (already rendered by caller — just get the spans)
  // The spans are already set by renderOutputWithSpans() before this is called

  setOrbState('speaking', 'READING ALOUD… TALK TO INTERRUPT');

  const afterSpeech = () => {
    clearTTSHighlight();
    if (state === 'speaking') {
      setOrbState(
        alwaysOn ? 'listening' : 'idle',
        alwaysOn ? 'ALWAYS ON — SPEAK ANYTIME' : 'TAP TO ACTIVATE ALWAYS-ON MODE'
      );
    }
  };

  // Try EdgeTTS
  try {
    const response = await fetch('/api/speaker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean.slice(0, 4000) })
    });
    if (!response.ok) throw new Error('Speaker API ' + response.status);

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    _currentAudio = audio;

    audio.onplay = () => {
      runTimerHighlight(audio, _ttsWordSpans);
    };
    audio.onended = () => {
      URL.revokeObjectURL(url);
      _currentAudio = null;
      afterSpeech();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      _currentAudio = null;
      fallbackSpeak(clean, afterSpeech);
    };

    await audio.play();

  } catch (e) {
    _currentAudio = null;
    fallbackSpeak(clean, afterSpeech);
  }
}

// Browser SpeechSynthesis fallback with boundary events
function fallbackSpeak(text, onDone) {
  if (!window.speechSynthesis) { if (onDone) onDone(); return; }
  window.speechSynthesis.cancel();

  const utt = new SpeechSynthesisUtterance(text.slice(0, 4000));
  utt.lang = 'en-US'; utt.pitch = 0.85; utt.rate = 1.1; utt.volume = 1;

  const voices = window.speechSynthesis.getVoices();
  const v = voices.find(v => v.name.includes('Google US English')) ||
    voices.find(v => v.name.includes('Daniel')) ||
    voices.find(v => v.lang === 'en-US') || voices[0] || null;
  if (v) utt.voice = v;

  // Boundary-based highlighting (Chrome)
  let charOffset = 0;
  utt.onboundary = (evt) => {
    if (evt.name !== 'word') return;
    const charIdx = evt.charIndex;
    let pos = 0;
    for (let i = 0; i < _ttsWordSpans.length; i++) {
      const word = _ttsWordSpans[i].textContent;
      const wordStart = text.indexOf(word, pos);
      if (wordStart !== -1 && charIdx >= wordStart && charIdx < wordStart + word.length) {
        _ttsWordSpans.forEach(s => s.classList.remove('tts-active'));
        _ttsWordSpans[i].classList.add('tts-active');
        _ttsWordSpans[i].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        pos = wordStart;
        break;
      }
      pos = Math.max(pos, wordStart + word.length);
    }
  };

  const after = () => { clearTTSHighlight(); if (onDone) onDone(); };
  utt.onend = after;
  utt.onerror = after;
  setTimeout(() => window.speechSynthesis.speak(utt), 80);
}

// ══════════════════════════════════════════════════════════════════
//  ORB STATE
// ══════════════════════════════════════════════════════════════════
function setOrbState(newState, statusText) {
  state = newState;
  document.getElementById('orb-stage').className = newState;
  document.getElementById('orb-status').innerText = statusText;
  document.getElementById('m-st').textContent = newState.toUpperCase();
  document.getElementById('d-mic').textContent =
    newState === 'listening' ? 'ACTIVE' :
    newState === 'speaking' ? 'PLAYBACK' : 'STANDBY';
  document.querySelectorAll('.vb').forEach(b =>
    b.classList.toggle('on', newState === 'listening' || newState === 'speaking')
  );
  const matrixMsgs = {
    idle: 'SYSTEM STATUS: OPTIMAL // CONSCIOUSNESS MATRIX STABLE',
    listening: 'NEURAL RECEPTORS ACTIVE // AWAITING VOICE INPUT',
    thinking: 'QUANTUM PROCESSING // CALCULATING OPTIMAL RESPONSE',
    speaking: 'VOCAL SYNTHESIS ACTIVE // NEURAL OUTPUT STREAM',
  };
  document.getElementById('matrix-status').textContent = matrixMsgs[newState] || '';
}

// ══════════════════════════════════════════════════════════════════
//  AUDIO UNLOCK + TONES
// ══════════════════════════════════════════════════════════════════
function unlockAudio() {
  if (audioUnlocked) return;
  try {
    new Audio("data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA")
      .play().catch(() => {});
    audioUnlocked = true;
  } catch (e) {}
}

function playTone(f1, f2, dur, vol, delay) {
  setTimeout(() => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(f1, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(f2, ctx.currentTime + dur);
      gain.gain.setValueAtTime(vol || 0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur + 0.05);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + dur + 0.1);
    } catch (e) {}
  }, delay || 0);
}

function playActivationSound() { playTone(200, 600, 0.3, 0.3, 0); playTone(880, 880, 0.15, 0.2, 350); }
function playInterruptSound() { playTone(800, 300, 0.15, 0.2, 0); }
function playStopSound() { playTone(500, 150, 0.25, 0.25, 0); }

// ══════════════════════════════════════════════════════════════════
//  ORB TAP — voice mode toggle
// ══════════════════════════════════════════════════════════════════
function orbTapped() {
  unlockAudio();
  if (!alwaysOn) {
    alwaysOn = true;
    document.getElementById('m-vc').textContent = 'ON';
    playActivationSound();
    initAndStartListening();
  } else {
    alwaysOn = false;
    document.getElementById('m-vc').textContent = 'OFF';
    stopAllSpeech();
    stopRecognition();
    processingCmd = false;
    playStopSound();
    setOrbState('idle', 'TAP TO ACTIVATE ALWAYS-ON MODE');
  }
}

function initAndStartListening() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    setOrbState('idle', 'VOICE NOT SUPPORTED — USE CHROME');
    alwaysOn = false; return;
  }
  if (recognition) { try { recognition.abort(); } catch (e) {} recognition = null; }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = function (event) {
    let finalText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        finalText += event.results[i][0].transcript;
      } else {
        const interim = event.results[i][0].transcript;
        document.getElementById('d-conf').textContent =
          Math.floor((event.results[i][0].confidence || 0.85) * 100) + '%';
        // Interrupt speaking
        if (state === 'speaking' && interim.length > 2) {
          stopAllSpeech();
          playInterruptSound();
          setOrbState('listening', 'INTERRUPTED — LISTENING...');
        }
      }
    }
    if (finalText.trim() && !processingCmd) {
      const cmd = finalText.trim();
      if (document.activeElement === document.getElementById('cmd')) return;
      document.getElementById('cmd').value = cmd;
      routeCommand(cmd);
    }
  };

  recognition.onerror = function (e) {
    if (e.error === 'aborted' || e.error === 'no-speech') return;
    if (e.error === 'not-allowed') {
      alwaysOn = false;
      setOrbState('idle', 'MIC BLOCKED — CHECK PERMISSIONS');
    }
  };

  recognition.onend = function () {
    if (alwaysOn) setTimeout(() => {
      if (alwaysOn && recognition) try { recognition.start(); } catch (e) {}
    }, 150);
  };

  setOrbState('listening', 'ALWAYS ON — SPEAK ANYTIME');
  try { recognition.start(); } catch (e) {}
}

function stopRecognition() {
  if (recognition) { try { recognition.abort(); } catch (e) {} recognition = null; }
}

// ══════════════════════════════════════════════════════════════════
//  COMMAND ROUTER
// ══════════════════════════════════════════════════════════════════
function routeCommand(cmd) {
  const c = cmd.toLowerCase().trim();

  // YouTube
  if (/^(play|put on|i want to (hear|listen to)|search (youtube )?for|youtube|queue|stream)\s+.+/i.test(c)) {
    const q = cmd
      .replace(/^(play|put on|i want to (hear|listen to)|search (youtube )?for|youtube|queue|stream)\s*/i, '')
      .replace(/\s*(on youtube|for me|please|now)\s*/ig, '').trim();
    handleYouTube(q); return;
  }

  // Weather
  if (/\b(weather|temperature|forecast|raining|rain|sunny|humidity|wind speed)\b/i.test(c)) {
    handleWeather(cmd); return;
  }

  // YouTube controls
  if (/\b(next|skip|next song|next track|skip this)\b/i.test(c)) { ytNext(); return; }
  if (/\b(previous|prev|go back|last song|back)\b/i.test(c)) { ytPrev(); return; }
  if (/\b(pause)\b/i.test(c) && ytResults.length) { ytPause(); return; }
  if (/\b(resume|unpause|continue|play again|keep playing)\b/i.test(c) && ytResults.length) { ytResume(); return; }
  if (/\b(mute|silence (the music|it))\b/i.test(c)) { ytMute(); return; }
  if (/\b(unmute|restore (sound|audio))\b/i.test(c)) { ytUnmute(); return; }
  if (/\b(volume up|louder|increase volume|turn it up)\b/i.test(c)) { ytVolumeUp(); return; }
  if (/\b(volume down|quieter|lower volume|turn it down)\b/i.test(c)) { ytVolumeDown(); return; }
  if (/\b(close (youtube|player|music)|stop (youtube|video|music|playing))\b/i.test(c)) { ytClose(); return; }

  // Stop speech
  if (/^(stop|quiet|silence|shut up|enough|stop talking|be quiet)$/i.test(c)) {
    stopAllSpeech();
    setOrbState(
      alwaysOn ? 'listening' : 'idle',
      alwaysOn ? 'ALWAYS ON — SPEAK ANYTIME' : 'TAP TO ACTIVATE'
    );
    return;
  }

  // Default: AI chat
  setOrbState('thinking', 'HEARD: ' + cmd.toUpperCase().slice(0, 45));
  sendCmdText(cmd);
}

// ══════════════════════════════════════════════════════════════════
//  AI CHAT — single output path
// ══════════════════════════════════════════════════════════════════
async function sendCmdText(val) {
  processingCmd = true;
  const out = document.getElementById('output');
  out.className = 'out-think';
  out.innerHTML = '<span style="color:var(--amber)">Processing…</span>';
  addLog('u', val);

  conversationHistory.push({ role: 'user', text: val });
  if (conversationHistory.length > MAX_HISTORY)
    conversationHistory = conversationHistory.slice(-MAX_HISTORY);

  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversationHistory, timezone: tz })
    });
    const data = await response.json();
    processingCmd = false;

    if (data.error) {
      out.className = '';
      out.innerHTML = `<span style="color:var(--red)">⚠ ${data.error}</span>`;
      setOrbState(
        alwaysOn ? 'listening' : 'idle',
        alwaysOn ? 'ALWAYS ON — SPEAK ANYTIME' : 'ERROR — TAP ORB TO RETRY'
      );
      return;
    }

    const brain = data.brain || 'AI';
    const replyText = data.reply || '';

    // ── SINGLE RENDER: word spans in-place, no overlay ──
    renderOutputWithSpans(replyText, '🦂 ');

    document.getElementById('ft-brain').textContent = 'BRAIN: ' + brain + ' // ONLINE';
    document.getElementById('m-brain').textContent = brain;

    conversationHistory.push({ role: 'assistant', text: replyText });
    if (conversationHistory.length > MAX_HISTORY)
      conversationHistory = conversationHistory.slice(-MAX_HISTORY);

    bumpQ();
    addLog('a', replyText, brain);

    // Speak — uses the spans already rendered in #output
    speakReply(replyText);

  } catch (e) {
    processingCmd = false;
    out.className = '';
    out.innerHTML = `<span style="color:var(--red)">⚠ ERROR: ${e.message}</span>`;
    setOrbState(
      alwaysOn ? 'listening' : 'idle',
      alwaysOn ? 'ALWAYS ON — SPEAK ANYTIME' : 'ERROR — TAP ORB TO RETRY'
    );
  }
}

// ══════════════════════════════════════════════════════════════════
//  WEATHER — clean single output
// ══════════════════════════════════════════════════════════════════
async function handleWeather(cmd) {
  processingCmd = true;
  setOrbState('thinking', 'CHECKING WEATHER...');
  addLog('u', cmd);

  const m = cmd.match(/(?:weather|temperature|forecast|rain|sunny|humidity|wind)\s+(?:in|at|for|of)?\s*([a-zA-Z\s]+)/i);
  const city = m ? m[1].trim() : 'Nairobi';

  try {
    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`);
    const geoData = await geoRes.json();

    if (!geoData.results || !geoData.results.length) {
      processingCmd = false;
      document.getElementById('output').className = '';
      document.getElementById('output').textContent = '⚠ Location not found: ' + city;
      setOrbState(alwaysOn ? 'listening' : 'idle', alwaysOn ? 'ALWAYS ON — SPEAK ANYTIME' : 'TAP TO ACTIVATE');
      return;
    }

    const loc = geoData.results[0];
    const wRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
      `&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code,apparent_temperature&timezone=auto`
    );
    const wData = await wRes.json();
    const cur = wData.current;

    const conds = {
      0:'Clear sky', 1:'Mainly clear', 2:'Partly cloudy', 3:'Overcast',
      45:'Foggy', 51:'Light drizzle', 61:'Slight rain', 63:'Moderate rain',
      65:'Heavy rain', 71:'Slight snow', 80:'Rain showers', 95:'Thunderstorm'
    };
    const cond = conds[cur.weather_code] || 'Variable';
    const em = cur.weather_code === 0 ? '☀️' : cur.weather_code <= 2 ? '⛅' :
      cur.weather_code <= 3 ? '☁️' : cur.weather_code <= 48 ? '🌫️' :
      cur.weather_code <= 67 ? '🌧️' : cur.weather_code <= 77 ? '❄️' : '⛈️';

    const reply =
      `${em} ${loc.name}, ${loc.country}\n` +
      `🌡️ ${cur.temperature_2m}°C (feels like ${cur.apparent_temperature}°C)\n` +
      `💧 Humidity: ${cur.relative_humidity_2m}%\n` +
      `💨 Wind: ${cur.wind_speed_10m} km/h\n` +
      `☁️ ${cond}`;

    processingCmd = false;

    // Render weather — plain text (not word-span, as it has emoji/newlines)
    const out = document.getElementById('output');
    out.className = '';
    out.style.whiteSpace = 'pre-line';
    out.textContent = reply;
    // Reset whitespace after a moment (next response will overwrite)
    setTimeout(() => { out.style.whiteSpace = ''; }, 100);

    addLog('a', reply, 'WEATHER');
    bumpQ();
    setOrbState(alwaysOn ? 'listening' : 'idle', alwaysOn ? 'ALWAYS ON — SPEAK ANYTIME' : 'TAP TO ACTIVATE');

    const spokenWeather =
      `Weather in ${loc.name}: ${cur.temperature_2m} degrees, feels like ${cur.apparent_temperature}. ` +
      `${cond}. Humidity ${cur.relative_humidity_2m}%, wind ${cur.wind_speed_10m} kilometres per hour.`;

    // For weather, render spans then speak
    renderOutputWithSpans(reply.replace(/[^\w\s°%,./\n]/g, ' ').replace(/\n/g, '. '), '');
    speakReply(spokenWeather);

  } catch (e) {
    processingCmd = false;
    document.getElementById('output').className = '';
    document.getElementById('output').textContent = '⚠ Weather error: ' + e.message;
    setOrbState(alwaysOn ? 'listening' : 'idle', alwaysOn ? 'ALWAYS ON — SPEAK ANYTIME' : 'TAP TO ACTIVATE');
  }
}

// ══════════════════════════════════════════════════════════════════
//  YOUTUBE ENGINE
// ══════════════════════════════════════════════════════════════════
let ytResults = [], ytIndex = 0, ytPaused = false, ytMuted = false;
let ytPlayer = null, ytPlayerReady = false, ytVolume = 80;

function setYtBadge(s) {
  const b = document.getElementById('yt-status-badge');
  const live = document.getElementById('yt-live-status');
  b.className = s;
  b.textContent = { idle: 'IDLE', playing: 'PLAYING', paused: 'PAUSED', muted: 'MUTED' }[s] || s.toUpperCase();
  if (live) {
    live.textContent = { playing: '▶ PLAYING', paused: '⏸ PAUSED', muted: '🔇 MUTED', idle: '—' }[s] || '';
    live.style.color = s === 'playing' ? 'var(--G)' : s === 'paused' ? 'var(--amber)' : s === 'muted' ? 'var(--red)' : 'var(--muted)';
  }
}

window.onYouTubeIframeAPIReady = function () {
  ytPlayer = new YT.Player('yt-frame', {
    height: '100%', width: '100%',
    playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 },
    events: {
      onReady: (e) => { ytPlayerReady = true; e.target.setVolume(ytVolume); },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.PLAYING) {
          ytPaused = false;
          setYtBadge(ytMuted ? 'muted' : 'playing');
          document.getElementById('yt-pause-btn').textContent = '⏸';
        } else if (e.data === YT.PlayerState.PAUSED) {
          ytPaused = true;
          setYtBadge('paused');
          document.getElementById('yt-pause-btn').textContent = '▶';
        } else if (e.data === YT.PlayerState.ENDED) {
          setTimeout(ytNext, 1500);
        }
      }
    }
  });
};

async function handleYouTube(query) {
  if (!query || !query.trim()) {
    document.getElementById('output').className = '';
    document.getElementById('output').textContent = '⚠ What would you like me to play?';
    return;
  }
  processingCmd = true;
  stopAllSpeech();
  setOrbState('thinking', 'SEARCHING YOUTUBE...');
  document.getElementById('output').className = '';
  document.getElementById('output').textContent = '🔍 Searching: ' + query;
  addLog('u', 'play ' + query);

  try {
    const r = await fetch('/api/youtube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });
    const data = await r.json();
    processingCmd = false;

    if (data.error || !data.results || data.results.length === 0) {
      document.getElementById('output').textContent = '⚠ ' + (data.error || 'No results for: ' + query);
      setOrbState(alwaysOn ? 'listening' : 'idle', alwaysOn ? 'ALWAYS ON — SPEAK ANYTIME' : 'TAP TO ACTIVATE');
      return;
    }

    ytResults = data.results; ytIndex = 0; ytPaused = false; ytMuted = false;
    ytPlayIndex(0);

  } catch (e) {
    processingCmd = false;
    document.getElementById('output').textContent = '⚠ YouTube error: ' + e.message;
    setOrbState(alwaysOn ? 'listening' : 'idle', alwaysOn ? 'ALWAYS ON — SPEAK ANYTIME' : 'TAP TO ACTIVATE');
  }
}

function ytPlayIndex(i) {
  if (!ytResults.length) return;
  const item = ytResults[i];
  document.getElementById('yt-idle').style.display = 'none';
  document.getElementById('yt-active').classList.add('show');
  document.getElementById('yt-title').textContent = item.title;
  document.getElementById('yt-channel').textContent = '📺 ' + item.channel;
  document.getElementById('yt-index').textContent = 'TRACK ' + (i + 1) + ' / ' + ytResults.length;
  document.getElementById('yt-pause-btn').textContent = '⏸';
  document.getElementById('yt-mute-btn').textContent = '🔊';
  document.getElementById('yt-mute-btn').classList.remove('active-mute');
  ytPaused = false; ytMuted = false;

  if (ytPlayerReady && ytPlayer && ytPlayer.loadVideoById) {
    ytPlayer.unMute(); ytPlayer.setVolume(ytVolume); ytPlayer.loadVideoById(item.videoId);
  } else {
    document.getElementById('yt-frame').src =
      'https://www.youtube.com/embed/' + item.videoId + '?autoplay=1&rel=0&modestbranding=1&enablejsapi=1';
  }

  setYtBadge('playing');
  document.getElementById('output').className = '';
  document.getElementById('output').textContent = '🎵 Now playing: ' + item.title + '\n📺 ' + item.channel;
  addLog('a', 'Now playing: ' + item.title, 'YOUTUBE');
  bumpQ();
  setOrbState(alwaysOn ? 'listening' : 'idle', alwaysOn ? 'ALWAYS ON — SPEAK ANYTIME' : 'TAP TO ACTIVATE');
  document.getElementById('ft-brain').textContent = 'BRAIN: YOUTUBE // STREAMING';
}

function ytNext() { if (!ytResults.length) return; ytIndex = (ytIndex + 1) % ytResults.length; ytPlayIndex(ytIndex); }
function ytPrev() { if (!ytResults.length) return; ytIndex = (ytIndex - 1 + ytResults.length) % ytResults.length; ytPlayIndex(ytIndex); }
function ytPause() { if (ytPlayerReady && ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo(); }
function ytResume() { if (ytPlayerReady && ytPlayer && ytPlayer.playVideo) ytPlayer.playVideo(); }
function ytTogglePause() { if (ytPaused) ytResume(); else ytPause(); }
function ytMute() { if (ytPlayerReady && ytPlayer) { ytPlayer.mute(); ytMuted = true; document.getElementById('yt-mute-btn').textContent = '🔇'; document.getElementById('yt-mute-btn').classList.add('active-mute'); setYtBadge('muted'); } }
function ytUnmute() { if (ytPlayerReady && ytPlayer) { ytPlayer.unMute(); ytMuted = false; document.getElementById('yt-mute-btn').textContent = '🔊'; document.getElementById('yt-mute-btn').classList.remove('active-mute'); setYtBadge(ytPaused ? 'paused' : 'playing'); } }
function ytToggleMute() { if (ytMuted) ytUnmute(); else ytMute(); }
function ytSetVolume(v) { ytVolume = parseInt(v); document.getElementById('yt-vol-val').textContent = v; if (ytPlayerReady && ytPlayer && ytPlayer.setVolume) ytPlayer.setVolume(ytVolume); }
function ytVolumeUp() { ytVolume = Math.min(100, ytVolume + 15); document.getElementById('yt-vol-slider').value = ytVolume; ytSetVolume(ytVolume); }
function ytVolumeDown() { ytVolume = Math.max(0, ytVolume - 15); document.getElementById('yt-vol-slider').value = ytVolume; ytSetVolume(ytVolume); }
function ytClose() {
  if (ytPlayerReady && ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
  document.getElementById('yt-frame').src = '';
  document.getElementById('yt-active').classList.remove('show');
  document.getElementById('yt-idle').style.display = '';
  ytResults = []; ytIndex = 0; ytPaused = false; ytMuted = false;
  setYtBadge('idle');
  document.getElementById('output').className = '';
  document.getElementById('output').textContent = 'YouTube closed.';
  document.getElementById('ft-brain').textContent = 'BRAIN: STANDBY';
}

// ══════════════════════════════════════════════════════════════════
//  SEND (keyboard / button)
// ══════════════════════════════════════════════════════════════════
async function sendCmd() {
  unlockAudio();
  const val = document.getElementById('cmd').value.trim();
  if (!val) return;
  document.getElementById('cmd').value = '';
  routeCommand(val);
}
document.getElementById('cmd').addEventListener('keydown', e => { if (e.key === 'Enter') sendCmd(); });

// ══════════════════════════════════════════════════════════════════
//  ACTION LOG
// ══════════════════════════════════════════════════════════════════
let historyCount = 0;

function addLog(role, text, brain) {
  const h = document.getElementById('history');
  const d = document.createElement('div');
  const isYt = brain === 'YOUTUBE';
  d.className = 'hitem ' + (role === 'u' ? 'u' : isYt ? 'yt' : 'a');
  const roleLabel = role === 'u' ? 'YOU' : isYt ? 'YT' : 'SCORP';
  const brainTag = brain && role === 'a'
    ? `<span style="font-size:5.5px;color:var(--muted);margin-left:4px">[${brain}]</span>` : '';
  d.innerHTML = `<div class="hrole">${roleLabel}${brainTag}</div>` +
    `<div class="htext">${text.slice(0, 200)}${text.length > 200 ? '…' : ''}</div>`;
  h.appendChild(d);
  historyCount++;
  document.getElementById('hist-count').textContent = historyCount;
  while (h.children.length > 30) h.removeChild(h.firstChild);
  h.scrollTop = h.scrollHeight;
}

// bumpQ() is defined in index.html as a global — called directly from here

function clearLog() {
  document.getElementById('history').innerHTML = '';
  historyCount = 0;
  document.getElementById('hist-count').textContent = '0';
  document.getElementById('output').className = '';
  document.getElementById('output').textContent = 'SCORPION AI READY.';
  conversationHistory = [];
  document.getElementById('ft-brain').textContent = 'BRAIN: STANDBY';
}

// ══════════════════════════════════════════════════════════════════
//  BOOT GREETING
// ══════════════════════════════════════════════════════════════════
async function bootGreeting() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'greeting', timezone: tz, messages: [{ role: 'user', text: 'greet me' }] })
    });
    const data = await r.json();
    if (data.reply) {
      document.getElementById('m-brain').textContent = data.brain || 'AI';
      // Render with word spans from the start
      renderOutputWithSpans(data.reply, '🦂 ');
      speakReply(data.reply);
    }
  } catch (e) {
    document.getElementById('output').className = '';
    document.getElementById('output').textContent = '🦂 Scorpion AI ready, Sir. All systems online.';
  }
}

setTimeout(bootGreeting, 1500);

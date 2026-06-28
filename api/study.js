// ══ STUDY CONTEXT STATE ══
// Add these variables near the top of your <script> block
// (alongside your existing let state='idle', alwaysOn=false, etc.)

let studyActive = false;
let studyTopic = null;
let studyData = null; // keeps last summary in memory

// ══ PATCH routeCommand ══
// REPLACE your existing routeCommand function with this one
// It checks study context FIRST before falling through to AI chat

function routeCommand(cmd) {
  const c = cmd.toLowerCase().trim();

  // ── YOUTUBE controls (always work regardless of study mode)
  if (/^(play|put on|i want to (hear|listen to)|search (youtube )?for|youtube|queue|stream)\s+.+/i.test(c)) {
    const query = cmd.replace(/^(play|put on|i want to (hear|listen to)|search (youtube )?for|youtube|queue|stream)\s*/i, '').replace(/\s*(on youtube|for me|please|now)\s*/ig, '').trim();
    handleYouTube(query); return;
  }
  if (/\b(next|skip|forward|next song|next track|skip song|skip this)\b/i.test(c)) { ytNext(); return; }
  if (/\b(previous|prev|go back|last song|previous song|back)\b/i.test(c)) { ytPrev(); return; }
  if (/\b(pause|pause (it|music|video|song))\b/i.test(c) && ytResults.length) { ytPause(); return; }
  if (/\b(resume|unpause|continue|play it|play again|keep playing)\b/i.test(c) && ytResults.length) { ytResume(); return; }
  if (/\b(mute|silence (the music|it))\b/i.test(c)) { ytMute(); return; }
  if (/\b(unmute|restore (sound|audio)|turn (sound|audio) (on|back))\b/i.test(c)) { ytUnmute(); return; }
  if (/\b(volume up|louder|increase volume|turn it up)\b/i.test(c)) { ytVolumeUp(); return; }
  if (/\b(volume down|quieter|lower volume|turn it down)\b/i.test(c)) { ytVolumeDown(); return; }
  if (/\b(close (youtube|player|music|video)|stop (youtube|video|music|playing))\b/i.test(c)) { ytClose(); return; }

  // ── STOP SPEAKING
  if (/^(stop|quiet|silence|shut up|enough|stop talking|be quiet)$/i.test(c)) {
    stopSpeaking();
    setOrbState(alwaysOn ? 'listening' : 'idle', alwaysOn ? 'ALWAYS ON — SPEAK ANYTIME' : 'TAP TO ACTIVATE');
    return;
  }

  // ── EXIT STUDY explicitly
  if (/^(exit study|stop study|leave study|close study|exit notes|done studying|end study)$/i.test(c)) {
    exitStudy(); return;
  }

  // ── NEW STUDY TOPIC
  if (/^(study|explain|teach me about|show me|learn about|learn|quiz me on)\s+.+/i.test(c)) {
    const topic = cmd.replace(/^(study|explain|teach me about|show me|learn about|learn|quiz me on)\s*/i, '').trim();
    handleStudyMode(topic); return;
  }

  // ── WEATHER
  if (/\b(weather|temperature|forecast|raining|rain|sunny|humidity|wind speed)\b/i.test(c)) {
    handleWeather(cmd); return;
  }

  // ── SING
  if (/\b(sing|hum|rap|compose a song|write a song)\b/i.test(c)) { handleSing(cmd); return; }

  // ══ STUDY CONTEXT: if study is active, treat all other input as follow-up questions
  if (studyActive && studyTopic) {
    handleStudyFollowUp(cmd); return;
  }

  // ── DEFAULT AI CHAT
  setOrbState('thinking', 'HEARD: ' + cmd.toUpperCase().slice(0, 45));
  sendCmdText(cmd);
}

// ══ STUDY FOLLOW-UP ══
// Called when study is active and user types anything
async function handleStudyFollowUp(question) {
  processingCmd = true;
  stopSpeaking();
  setOrbState('thinking', 'STUDYING: ' + question.toUpperCase().slice(0, 40));
  addLog('u', '[STUDY] ' + question);

  const out = document.getElementById('output');
  out.className = 'out-think';
  out.textContent = '🔬 PROCESSING FOLLOW-UP...';

  // Build context: include the original study summary so AI knows what was covered
  const contextSummary = studyData ? `
Topic studied: ${studyData.title}
Summary: ${studyData.oneLiner || ''}
Key facts covered: ${(studyData.keyFacts || []).join(' | ')}
Must know: ${studyData.mustKnow || ''}
` : `Topic: ${studyTopic}`;

  const messages = [
    {
      role: 'user',
      text: `[STUDY CONTEXT]\n${contextSummary}\n\n[STUDENT QUESTION]\n${question}\n\nAnswer specifically and concisely. Stay focused on the topic. No unnecessary padding.`
    }
  ];

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages })
    });
    const data = await response.json();
    processingCmd = false;

    if (data.error) {
      out.className = '';
      out.innerHTML = `<span style="color:var(--red)">⚠ ${data.error}</span>`;
      setOrbState(alwaysOn ? 'listening' : 'idle', alwaysOn ? 'ALWAYS ON — SPEAK ANYTIME' : 'TAP TO ACTIVATE');
      return;
    }

    out.className = '';
    out.innerHTML = `
      <!-- Study context indicator -->
      <div style="font-family:var(--display);font-size:6px;font-weight:700;letter-spacing:.25em;
                  color:var(--cyan);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border);
                  display:flex;justify-content:space-between;align-items:center">
        <span>📚 ${studyTopic.toUpperCase()} — FOLLOW-UP</span>
        <span style="color:var(--muted)">[${data.brain || 'AI'}]</span>
      </div>

      <div style="font-size:11px;color:var(--amber);font-size:9px;margin-bottom:8px;opacity:.7">
        Q: ${question}
      </div>

      <div style="font-size:12px;color:var(--text);line-height:1.8">${data.reply}</div>

      <div style="display:flex;gap:6px;margin-top:12px;flex-wrap:wrap">
        <button onclick="handleStudyMode('${studyTopic.replace(/'/g,"\\'")}');return false"
          style="background:rgba(0,255,102,.07);border:1px solid rgba(0,255,102,.2);border-radius:3px;
                 color:var(--G);font-family:var(--display);font-size:6.5px;font-weight:700;
                 letter-spacing:.12em;padding:6px 12px;cursor:pointer">← BACK TO NOTES</button>
        <button onclick="exitStudy();return false"
          style="background:rgba(255,170,0,.07);border:1px solid rgba(255,170,0,.2);border-radius:3px;
                 color:var(--amber);font-family:var(--display);font-size:6.5px;font-weight:700;
                 letter-spacing:.12em;padding:6px 12px;cursor:pointer">✕ EXIT STUDY</button>
      </div>
    `;

    bumpQ();
    addLog('a', data.reply, 'STUDY-AI');
    setOrbState(alwaysOn ? 'listening' : 'idle', alwaysOn ? 'ALWAYS ON — SPEAK ANYTIME' : 'TAP TO ACTIVATE');
    speakReply(data.reply);

  } catch (e) {
    processingCmd = false;
    out.className = '';
    out.textContent = '❌ Error: ' + e.message;
    setOrbState(alwaysOn ? 'listening' : 'idle', alwaysOn ? 'ALWAYS ON — SPEAK ANYTIME' : 'TAP TO ACTIVATE');
  }
}

// ══ STUDY MODE ENGINE ══
async function handleStudyMode(topic) {
  processingCmd = true;
  stopSpeaking();
  studyActive = true;
  studyTopic = topic;
  studyData = null;

  setOrbState('thinking', 'LOADING STUDY: ' + topic.toUpperCase());
  addLog('u', 'study: ' + topic);
  document.getElementById('panel-label').textContent = '📚 STUDY — ' + topic.toUpperCase();
  document.getElementById('cmd').placeholder = 'Ask follow-up about ' + topic + '… or type "exit study" to leave';

  const out = document.getElementById('output');
  out.className = 'out-think';
  out.textContent = '📚 BUILDING NOTES: ' + topic.toUpperCase();

  try {
    const response = await fetch('/api/study', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic })
    });
    const data = await response.json();
    processingCmd = false;

    if (data.error) {
      out.className = '';
      out.textContent = '❌ ' + data.error;
      setOrbState(alwaysOn ? 'listening' : 'idle', alwaysOn ? 'ALWAYS ON — SPEAK ANYTIME' : 'TAP TO ACTIVATE');
      return;
    }

    studyData = data; // save in memory for follow-up context
    renderStudySummary(data, topic);

  } catch (e) {
    processingCmd = false;
    out.className = '';
    out.textContent = '❌ Study error: ' + e.message;
    setOrbState(alwaysOn ? 'listening' : 'idle', alwaysOn ? 'ALWAYS ON — SPEAK ANYTIME' : 'TAP TO ACTIVATE');
  }
}

function renderStudySummary(data, topic) {
  const out = document.getElementById('output');
  out.className = '';

  const factsHtml = (data.keyFacts || data.keyPoints || []).map(f => `
    <div style="display:flex;gap:8px;align-items:flex-start;margin-bottom:4px">
      <span style="color:var(--G);flex-shrink:0;font-size:10px">▸</span>
      <span style="font-size:11px;color:var(--text);line-height:1.6">${f}</span>
    </div>`).join('');

  const imagesHtml = (data.imageUrls || []).slice(0, 2).map((url, i) => `
    <img src="${url}" alt="diagram ${i+1}"
      style="flex:1;min-width:100px;max-width:48%;border-radius:4px;
             border:1px solid var(--border);background:var(--deep);object-fit:cover"
      onerror="this.style.display='none'">`).join('');

  // quick table rows if present
  const tableRows = (data.quickTable || []).map(row => `
    <tr>
      <td style="padding:5px 10px;color:var(--muted);font-size:9px;border-bottom:1px solid var(--border);white-space:nowrap">${row.label}</td>
      <td style="padding:5px 10px;color:var(--text);font-size:10px;border-bottom:1px solid var(--border)">${row.value}</td>
    </tr>`).join('');

  out.innerHTML = `
    <!-- HEADER -->
    <div style="font-family:var(--display);font-size:11px;font-weight:900;letter-spacing:.25em;color:var(--G);
                margin-bottom:4px;padding-bottom:8px;border-bottom:1px solid var(--border);
                display:flex;justify-content:space-between;align-items:center">
      <span>📚 ${(data.title || topic).toUpperCase()}</span>
      <span style="font-size:6px;color:var(--cyan);letter-spacing:.15em">STUDY MODE ACTIVE</span>
    </div>

    <!-- CONTEXT HINT -->
    <div style="font-size:8px;color:var(--muted);margin-bottom:8px;padding:4px 8px;
                background:rgba(0,229,255,.04);border-radius:3px;letter-spacing:.05em">
      💡 Type any question about this topic and I'll answer in context. Type "exit study" to leave.
    </div>

    ${data.oneLiner ? `
    <!-- ONE LINER -->
    <div style="font-size:11px;color:var(--amber);font-style:italic;margin-bottom:10px;line-height:1.5;
                padding:6px 10px;background:rgba(255,170,0,.06);border-left:2px solid var(--amber);border-radius:0 3px 3px 0">
      ${data.oneLiner}
    </div>` : ''}

    <!-- KEY FACTS / KEY POINTS -->
    <div style="font-family:var(--display);font-size:6.5px;font-weight:700;letter-spacing:.25em;
                color:var(--Gdim);margin-bottom:6px">KEY FACTS</div>
    <div style="margin-bottom:12px">${factsHtml}</div>

    ${tableRows ? `
    <!-- QUICK TABLE -->
    <div style="font-family:var(--display);font-size:6.5px;font-weight:700;letter-spacing:.25em;
                color:var(--Gdim);margin-bottom:6px">QUICK REFERENCE</div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:12px;background:var(--deep);border-radius:3px;overflow:hidden">
      ${tableRows}
    </table>` : ''}

    ${data.mustKnow ? `
    <!-- MUST KNOW -->
    <div style="margin-bottom:10px;padding:8px 12px;background:rgba(0,255,102,.06);
                border-left:2px solid var(--G);border-radius:0 4px 4px 0">
      <div style="font-family:var(--display);font-size:6px;letter-spacing:.2em;color:var(--G);margin-bottom:3px">⚡ MUST KNOW</div>
      <div style="font-size:11px;color:var(--text);line-height:1.6">${data.mustKnow}</div>
    </div>` : ''}

    ${data.watchOut ? `
    <!-- WATCH OUT -->
    <div style="margin-bottom:10px;padding:8px 12px;background:rgba(255,51,85,.05);
                border-left:2px solid var(--red);border-radius:0 4px 4px 0">
      <div style="font-family:var(--display);font-size:6px;letter-spacing:.2em;color:var(--red);margin-bottom:3px">⚠ WATCH OUT</div>
      <div style="font-size:11px;color:var(--text);line-height:1.6">${data.watchOut}</div>
    </div>` : ''}

    ${data.mnemonic ? `
    <!-- MNEMONIC -->
    <div style="margin-bottom:10px;padding:8px 12px;background:rgba(179,102,255,.06);
                border-left:2px solid var(--purple);border-radius:0 4px 4px 0">
      <div style="font-family:var(--display);font-size:6px;letter-spacing:.2em;color:var(--purple);margin-bottom:3px">🧠 MNEMONIC</div>
      <div style="font-size:11px;color:var(--text);line-height:1.6">${data.mnemonic}</div>
    </div>` : ''}

    ${data.examTip ? `
    <!-- EXAM TIP -->
    <div style="margin-bottom:12px;padding:8px 12px;background:rgba(0,229,255,.05);
                border-left:2px solid var(--cyan);border-radius:0 4px 4px 0">
      <div style="font-family:var(--display);font-size:6px;letter-spacing:.2em;color:var(--cyan);margin-bottom:3px">🎯 EXAM TIP</div>
      <div style="font-size:11px;color:var(--text);line-height:1.6">${data.examTip}</div>
    </div>` : ''}

    ${data.funFact ? `
    <!-- FUN FACT -->
    <div style="margin-bottom:10px;padding:8px 12px;background:rgba(0,255,102,.04);
                border-left:2px solid var(--Gdim);border-radius:0 4px 4px 0">
      <div style="font-family:var(--display);font-size:6px;letter-spacing:.2em;color:var(--Gdim);margin-bottom:3px">💡 FUN FACT</div>
      <div style="font-size:11px;color:var(--text);line-height:1.6">${data.funFact}</div>
    </div>` : ''}

    ${data.wikiSummary ? `
    <!-- WIKI -->
    <div style="margin-bottom:12px;padding:8px 12px;background:rgba(0,100,255,.04);
                border-left:2px solid #4488ff;border-radius:0 4px 4px 0">
      <div style="font-family:var(--display);font-size:6px;letter-spacing:.2em;color:#4488ff;margin-bottom:3px">WIKIPEDIA</div>
      <div style="font-size:10px;color:var(--text);opacity:.8;line-height:1.6">${data.wikiSummary}...</div>
    </div>` : ''}

    ${imagesHtml ? `
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">${imagesHtml}</div>` : ''}

    <!-- ACTION BUTTONS -->
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
      <button onclick="handleYouTube('${(data.youtubeSearch || topic).replace(/'/g,"\\'")}');return false"
        style="background:rgba(255,51,85,.08);border:1px solid rgba(255,51,85,.25);border-radius:3px;
               color:var(--red);font-family:var(--display);font-size:6.5px;font-weight:700;
               letter-spacing:.12em;padding:6px 12px;cursor:pointer">▶ WATCH</button>
      <button onclick="speakStudySummary();return false"
        style="background:rgba(0,255,102,.07);border:1px solid rgba(0,255,102,.2);border-radius:3px;
               color:var(--G);font-family:var(--display);font-size:6.5px;font-weight:700;
               letter-spacing:.12em;padding:6px 12px;cursor:pointer">🔊 READ ALOUD</button>
      <button onclick="exitStudy();return false"
        style="background:rgba(255,170,0,.07);border:1px solid rgba(255,170,0,.2);border-radius:3px;
               color:var(--amber);font-family:var(--display);font-size:6.5px;font-weight:700;
               letter-spacing:.12em;padding:6px 12px;cursor:pointer">✕ EXIT STUDY</button>
    </div>

    <!-- Hidden speech text -->
    <div id="study-speech-text" style="display:none">
      ${data.oneLiner || data.explanation || ''}.
      Key facts: ${(data.keyFacts || data.keyPoints || []).join('. ')}.
      ${data.mustKnow ? 'Most important: ' + data.mustKnow + '.' : ''}
      ${data.watchOut ? 'Watch out for: ' + data.watchOut : ''}
    </div>
  `;

  bumpQ();
  addLog('a', '📚 ' + (data.title || topic), 'STUDY');
  document.getElementById('ft-brain').textContent = 'BRAIN: STUDY // ' + (data.brain || 'AI');
  setOrbState(alwaysOn ? 'listening' : 'idle', alwaysOn ? 'ALWAYS ON — SPEAK ANYTIME' : 'TAP TO ACTIVATE');
  speakReply('Here are your notes on ' + (data.title || topic) + '. ' + (data.oneLiner || data.explanation || '').slice(0, 200));
}

function speakStudySummary() {
  const el = document.getElementById('study-speech-text');
  if (el) speakReply(el.textContent.trim());
}

function exitStudy() {
  studyActive = false;
  studyTopic = null;
  studyData = null;
  document.getElementById('panel-label').textContent = 'SCORPION RESPONSE CORE';
  document.getElementById('output').className = '';
  document.getElementById('output').textContent = 'SCORPION AI READY.';
  document.getElementById('cmd').placeholder = "Type or speak… 'study', 'play', 'weather', ask anything…";
  document.getElementById('ft-brain').textContent = 'BRAIN: STANDBY';
}

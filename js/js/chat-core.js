/* ── SHARED STATE (used across all script files) ── */
let state='idle',alwaysOn=false,recognition=null,audioUnlocked=false,resumeTimer=null,processingCmd=false;

let conversationHistory = [];
const MAX_HISTORY = 20; // keeps last ~10 exchanges so it doesn't grow forever

/* ── SONG REQUEST ── */
function handleSing(cmd){
  processingCmd=true;setOrbState('thinking','COMPOSING A SONG...');
  fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({messages:[{role:'user',text:cmd+' — write exactly 4 short rhyming song lines, plain text only, no numbers, no markdown, no emojis'}]})
  }).then(r=>r.json()).then(data=>{
    processingCmd=false;
    const lyrics=data.reply||'I am Scorpion sharp and bright, here to help you day and night, ask me anything you need, I respond at lightning speed.';
    document.getElementById('output').innerText='🎵 '+lyrics;addLog('a',lyrics);singLines(lyrics);
  }).catch(()=>{processingCmd=false;singLines('I am Scorpion sharp and bright, here to help you day and night.')});
}

/* ── MAIN CHAT CALL (with memory) ── */
async function sendCmdText(val){
  processingCmd=true;document.getElementById('cmd').value='';
  const out=document.getElementById('output');out.className='out-think';out.textContent='NEURAL PROCESSING';
  addLog('u',val);

  conversationHistory.push({ role: 'user', text: val });
  if (conversationHistory.length > MAX_HISTORY) conversationHistory = conversationHistory.slice(-MAX_HISTORY);

  try{
    const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages: conversationHistory})});
    const data=await response.json();processingCmd=false;
    if(data.error){out.className='';out.innerHTML=`<span style="color:var(--red)">⚠ ${data.error}</span>`;setOrbState(alwaysOn?'listening':'idle',alwaysOn?'ALWAYS ON — SPEAK ANYTIME':'ERROR — TAP ORB TO RETRY');return}
    out.className='';out.textContent='🦂 '+data.reply;

    conversationHistory.push({ role: 'assistant', text: data.reply });
    if (conversationHistory.length > MAX_HISTORY) conversationHistory = conversationHistory.slice(-MAX_HISTORY);

    bumpQ();addLog('a',data.reply);speakReply(data.reply);
  }catch(e){
    processingCmd=false;out.className='';out.innerHTML=`<span style="color:var(--red)">⚠ ERROR: ${e.message}</span>`;
    setOrbState(alwaysOn?'listening':'idle',alwaysOn?'ALWAYS ON — SPEAK ANYTIME':'ERROR — TAP ORB TO RETRY');
  }
}

async function sendCmd(){
  unlockAudio();const val=document.getElementById('cmd').value.trim();if(!val)return;
  if(handleLocalAction(val)){return}
  document.getElementById('cmd').value='';
  if(/sing|song|hum|melody/i.test(val)){handleSing(val);return}
  setOrbState('thinking','THINKING...');sendCmdText(val);
}

document.getElementById('cmd').addEventListener('keydown',e=>{if(e.key==='Enter')sendCmd()});

/* ── HISTORY LOG ── */
function addLog(role,text){
  const h=document.getElementById('history');
  const d=document.createElement('div');d.className='hitem '+(role==='u'?'u':'a');
  d.innerHTML=`<div class="hrole">${role==='u'?'YOU':'SCORP'}</div><div class="htext">${text.slice(0,240)}${text.length>240?'…':''}</div>`;
  h.appendChild(d);while(h.children.length>14)h.removeChild(h.firstChild);h.scrollTop=h.scrollHeight;
}

function clearLog(){
  document.getElementById('history').innerHTML='';
  const o=document.getElementById('output');o.className='';o.textContent='SCORPION AI READY.';
  conversationHistory=[];
}

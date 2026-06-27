function unlockAudio(){
  if(audioUnlocked)return;
  try{new Audio("data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA").play().catch(()=>{});audioUnlocked=true;}catch(e){}
}

function playTone(f1,f2,dur,vol,delay){
  setTimeout(()=>{
    try{
      const ctx=new(window.AudioContext||window.webkitAudioContext)();
      const osc=ctx.createOscillator(),gain=ctx.createGain();
      osc.connect(gain);gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(f1,ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(f2,ctx.currentTime+dur);
      gain.gain.setValueAtTime(vol||.25,ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+dur+.05);
      osc.start(ctx.currentTime);osc.stop(ctx.currentTime+dur+.1);
    }catch(e){}
  },delay||0);
}
function playActivationSound(){playTone(200,600,.3,.3,0);playTone(880,880,.15,.2,350)}
function playInterruptSound(){playTone(800,300,.15,.2,0)}
function playStopSound(){playTone(500,150,.25,.25,0)}
function stopSpeaking(){if(resumeTimer){clearInterval(resumeTimer);resumeTimer=null}window.speechSynthesis.cancel()}

function orbTapped(){
  unlockAudio();
  if(!alwaysOn){alwaysOn=true;document.getElementById('m-vc').textContent='ON';playActivationSound();initAndStartListening();}
  else{alwaysOn=false;document.getElementById('m-vc').textContent='OFF';stopSpeaking();stopRecognition();processingCmd=false;playStopSound();setOrbState('idle','TAP TO ACTIVATE ALWAYS-ON MODE');}
}

function initAndStartListening(){
  if(!('webkitSpeechRecognition' in window)&&!('SpeechRecognition' in window)){setOrbState('idle','VOICE NOT SUPPORTED - USE CHROME');alwaysOn=false;return}
  if(recognition){try{recognition.abort()}catch(e){}recognition=null}
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  recognition=new SR();recognition.continuous=true;recognition.interimResults=true;recognition.lang='en-US';
  recognition.onresult=function(event){
    let ft='';
    for(let i=event.resultIndex;i<event.results.length;i++){
      if(event.results[i].isFinal){ft+=event.results[i][0].transcript;}
      else{
        const it=event.results[i][0].transcript;
        document.getElementById('d-conf').textContent=Math.floor((event.results[i][0].confidence||.85)*100)+'%';
        if(state==='speaking'&&it.length>2){stopSpeaking();playInterruptSound();setOrbState('listening','INTERRUPTED — LISTENING...');}
      }
    }
    if(ft.trim()&&!processingCmd){
      const cmd=ft.trim();
      const inputBox=document.getElementById('cmd');
      if(document.activeElement===inputBox)return;
      inputBox.value=cmd;
      if(/^(stop|quiet|silence|shut up|enough)$/i.test(cmd)){stopSpeaking();setOrbState('listening','ALWAYS ON — SPEAK ANYTIME');return}
      if(handleLocalAction(cmd)){setOrbState(alwaysOn?'listening':'idle',alwaysOn?'ALWAYS ON — SPEAK ANYTIME':'TAP TO ACTIVATE ALWAYS-ON MODE');return}
      if(/sing|song|hum|melody/i.test(cmd)){handleSing(cmd);return}
      setOrbState('thinking','HEARD: '+cmd.toUpperCase().slice(0,45));
      sendCmdText(cmd);
    }
  };
  recognition.onerror=function(e){
    if(e.error==='aborted'||e.error==='no-speech')return;
    if(e.error==='not-allowed'){alwaysOn=false;setOrbState('idle','MIC BLOCKED — CHECK SITE PERMISSIONS')}
  };
  recognition.onend=function(){if(alwaysOn)setTimeout(()=>{if(alwaysOn&&recognition)try{recognition.start()}catch(e){}},150)};
  setOrbState('listening','ALWAYS ON — SPEAK ANYTIME');
  try{recognition.start()}catch(e){}
}
function stopRecognition(){if(recognition){try{recognition.abort()}catch(e){}recognition=null}}

function singLines(lyrics){
  stopSpeaking();setOrbState('speaking','🎵 SCORPION SINGING...');
  const lines=lyrics.split(/\n+/).map(l=>l.replace(/^[\d.\-*]+\s*/,'').trim()).filter(l=>l.length>2);
  const pitches=[1.3,1.1,1.5,1.0,1.4,1.2],rates=[.82,.88,.78,.92,.75,.85];let i=0;
  function next(){
    if(i>=lines.length||!alwaysOn){setOrbState(alwaysOn?'listening':'idle',alwaysOn?'ALWAYS ON — SPEAK ANYTIME':'TAP TO ACTIVATE ALWAYS-ON MODE');return}
    const utt=new SpeechSynthesisUtterance(lines[i]);utt.lang='en-US';utt.volume=1;
    utt.pitch=pitches[i%pitches.length];utt.rate=rates[i%rates.length];
    const v=window.speechSynthesis.getVoices().find(v=>v.name.includes('Google US English')||v.name.includes('Daniel')||v.name.includes('Alex'));
    if(v)utt.voice=v;utt.onend=utt.onerror=()=>{i++;setTimeout(next,350)};
    window.speechSynthesis.speak(utt);
  }next();
}

function speakReply(text){
  stopSpeaking();
  const clean=text.replace(/\*\*/g,'').replace(/\*/g,'').replace(/#{1,6}\s/g,'').replace(/`/g,'')
    .replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').replace(/\n+/g,' ').trim();
  setOrbState('speaking','SPEAKING... JUST TALK TO INTERRUPT');
  const utt=new SpeechSynthesisUtterance(clean);utt.lang='en-US';utt.pitch=.85;utt.rate=1.15;utt.volume=1;
  const pref=window.speechSynthesis.getVoices().find(v=>v.name.includes('Google US English')||v.name.includes('Daniel')||v.name.includes('Alex'));
  if(pref)utt.voice=pref;
  const after=()=>{if(resumeTimer){clearInterval(resumeTimer);resumeTimer=null}if(state==='speaking')setOrbState(alwaysOn?'listening':'idle',alwaysOn?'ALWAYS ON — SPEAK ANYTIME':'TAP TO ACTIVATE ALWAYS-ON MODE')};
  utt.onend=utt.onerror=after;
  resumeTimer=setInterval(()=>{if(!window.speechSynthesis.speaking){clearInterval(resumeTimer);resumeTimer=null}else window.speechSynthesis.resume()},8000);
  window.speechSynthesis.speak(utt);
}

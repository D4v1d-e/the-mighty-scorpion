/* ── MATRIX RAIN ── */
(function(){
  const c=document.getElementById('matrix-canvas'),ctx=c.getContext('2d');
  function resize(){c.width=innerWidth;c.height=innerHeight} resize();
  window.addEventListener('resize',resize);
  const ch='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&*アイウエオカキクケコ';
  const sz=13;let drops=[];
  function init(){drops=Array(Math.floor(c.width/sz)).fill(1)}
  init();window.addEventListener('resize',init);
  setInterval(()=>{
    ctx.fillStyle='rgba(0,13,5,.18)';ctx.fillRect(0,0,c.width,c.height);
    ctx.fillStyle='#00ff66';ctx.font=sz+'px Share Tech Mono';
    drops.forEach((y,i)=>{
      ctx.globalAlpha=Math.random()*.7+.2;
      ctx.fillText(ch[Math.floor(Math.random()*ch.length)],i*sz,y*sz);
      if(y*sz>c.height&&Math.random()>.975)drops[i]=0; drops[i]++;
    });
    ctx.globalAlpha=1;
  },55);
})();

/* ── TICK MARKS ── */
(function(){
  const g=document.getElementById('ticks');
  for(let i=0;i<36;i++){
    const a=(i/36)*Math.PI*2-Math.PI/2;
    const r=164,r2=i%3===0?152:156;
    const x1=170+r*Math.cos(a),y1=170+r*Math.sin(a);
    const x2=170+r2*Math.cos(a),y2=170+r2*Math.sin(a);
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',x1);line.setAttribute('y1',y1);
    line.setAttribute('x2',x2);line.setAttribute('y2',y2);
    line.setAttribute('stroke-width',i%3===0?'2':'1');
    line.setAttribute('opacity',i%3===0?'0.8':'0.35');
    g.appendChild(line);
  }
})();

/* ── BARS ── */
function makeBars(id,n){
  const el=document.getElementById(id);
  for(let i=0;i<n;i++){
    const b=document.createElement('div');b.className='bar';
    b.style.height=(Math.random()*18+6)+'px';
    b.style.setProperty('--bd',(Math.random()*.8+.6).toFixed(2)+'s');
    b.style.setProperty('--bdl',(-Math.random()*.5).toFixed(2)+'s');
    el.appendChild(b);
  }
}
makeBars('q-bars',10);makeBars('n-bars',10);makeBars('c-bars',10);

/* ── VIZ BARS ── */
(function(){
  const v=document.getElementById('viz');
  for(let i=0;i<28;i++){
    const b=document.createElement('div');b.className='vb';
    b.style.setProperty('--vd',(Math.random()*.3+.28).toFixed(2)+'s');
    b.style.setProperty('--vdl',(-Math.random()*.5).toFixed(2)+'s');
    b.style.height=(Math.random()*10+2)+'px';
    v.appendChild(b);
  }
})();

/* ── SPARKLINE ── */
(function(){
  const pts=Array(20).fill(0).map(()=>Math.random()*18+4);
  function render(){
    const sl=document.getElementById('sl1'),sf=document.getElementById('sf1');
    if(!sl)return;
    const w=160,h=26,mn=Math.min(...pts),mx=Math.max(...pts),rng=mx-mn||1;
    const c=pts.map((v,i)=>`${(i/(pts.length-1))*w},${h-((v-mn)/rng)*(h-4)-2}`);
    sl.setAttribute('points',c.join(' '));
    sf.setAttribute('points',`0,${h} ${c.join(' ')} ${w},${h}`);
  }
  render();setInterval(()=>{pts.shift();pts.push(Math.random()*18+4);render();},1100);
})();

/* ── CLOCK/UPTIME ── */
const t0=Date.now();
setInterval(()=>{
  const n=new Date();
  document.getElementById('clock').textContent=
    `${n.getHours().toString().padStart(2,'0')}:${n.getMinutes().toString().padStart(2,'0')}:${n.getSeconds().toString().padStart(2,'0')}`;
  const up=Math.floor((Date.now()-t0)/1000);
  const el=document.getElementById('m-up');
  el.innerHTML=up<60?`${up}<span class="met-unit">s</span>`:up<3600?`${Math.floor(up/60)}<span class="met-unit">m</span>`:`${Math.floor(up/3600)}<span class="met-unit">h</span>`;
},1000);

/* ── LIVE METRICS ── */
setInterval(()=>{
  document.getElementById('d-cpu').textContent=(87+Math.random()*11).toFixed(1)+'%';
  document.getElementById('d-lat').textContent=Math.floor(Math.random()*6+2)+'ms';
  document.getElementById('d-ent').textContent=(99+Math.random()*.9).toFixed(2)+'%';
  document.getElementById('d-ul').textContent='↑ '+(7+Math.random()*5).toFixed(1)+'TB';
  document.getElementById('m-sig').innerHTML=Math.floor(95+Math.random()*5)+'<span class="met-unit">%</span>';
},2200);

/* ── COUNTERS ── */
let qcount=0,dcount=0;
function bumpQ(){
  document.getElementById('m-q').textContent=++qcount;
  document.getElementById('d-dec').textContent=++dcount;
}

/* ── ORB STATE RENDERING (shared by voice-engine.js and chat-core.js) ── */
function setOrbState(newState,statusText){
  state=newState;
  document.getElementById('orb-stage').className=newState;
  document.getElementById('orb-status').innerText=statusText;
  document.getElementById('m-st').textContent=newState.toUpperCase();
  document.getElementById('d-mic').textContent=newState==='listening'?'ACTIVE':newState==='speaking'?'PLAYBACK':'STANDBY';
  document.querySelectorAll('.vb').forEach(b=>b.classList.toggle('on',newState==='listening'||newState==='speaking'));
  const ms=document.getElementById('matrix-status');
  ms.textContent={
    idle:'SYSTEM STATUS: OPTIMAL // CONSCIOUSNESS MATRIX STABLE',
    listening:'NEURAL RECEPTORS ACTIVE // AWAITING VOICE INPUT',
    thinking:'QUANTUM PROCESSING // CALCULATING OPTIMAL RESPONSE',
    speaking:'VOCAL SYNTHESIS ACTIVE // NEURAL OUTPUT STREAM',
  }[newState]||'';
}

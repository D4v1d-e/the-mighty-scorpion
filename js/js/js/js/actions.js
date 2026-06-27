/* ── LOCAL BROWSER ACTIONS (open sites/search without calling the AI) ── */
const SITE_MAP = {
  youtube: 'https://www.youtube.com',
  google: 'https://www.google.com',
  gmail: 'https://mail.google.com',
  facebook: 'https://www.facebook.com',
  whatsapp: 'https://web.whatsapp.com',
  twitter: 'https://twitter.com',
  x: 'https://twitter.com',
  instagram: 'https://www.instagram.com',
  spotify: 'https://open.spotify.com',
  github: 'https://github.com',
  wikipedia: 'https://www.wikipedia.org'
};

function matchLocalAction(cmdRaw){
  const c = cmdRaw.trim();

  let m = c.match(/^open\s+youtube\s+and\s+play\s+(.+)$/i) || c.match(/^play\s+(.+?)\s+on\s+youtube$/i);
  if (m) {
    const query = m[1].trim();
    return { url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query),
              reply: `Opening YouTube and searching for "${query}" — tap the top result to play it.` };
  }

  m = c.match(/^open\s+google\s+and\s+search\s+(.+)$/i) || c.match(/^search\s+(.+?)\s+on\s+google$/i);
  if (m) {
    const query = m[1].trim();
    return { url: 'https://www.google.com/search?q=' + encodeURIComponent(query),
              reply: `Opening Google and searching for "${query}".` };
  }

  m = c.match(/^search\s+(?:for\s+)?(.+)$/i);
  if (m) {
    const query = m[1].trim();
    return { url: 'https://www.google.com/search?q=' + encodeURIComponent(query),
              reply: `Searching Google for "${query}".` };
  }

  m = c.match(/^open\s+([a-z]+)\.?$/i);
  if (m && SITE_MAP[m[1].toLowerCase()]) {
    const site = m[1].toLowerCase();
    return { url: SITE_MAP[site], reply: `Opening ${site.charAt(0).toUpperCase()+site.slice(1)} for you.` };
  }

  return null;
}

function handleLocalAction(cmd){
  const action = matchLocalAction(cmd);
  if (!action) return false;

  window.open(action.url, '_blank');
  document.getElementById('cmd').value = '';
  addLog('u', cmd);

  conversationHistory.push({ role: 'user', text: cmd });
  conversationHistory.push({ role: 'assistant', text: action.reply });
  if (conversationHistory.length > MAX_HISTORY) conversationHistory = conversationHistory.slice(-MAX_HISTORY);

  const out = document.getElementById('output');
  out.className = ''; out.textContent = '🦂 ' + action.reply;
  bumpQ(); addLog('a', action.reply); speakReply(action.reply);
  return true;
}

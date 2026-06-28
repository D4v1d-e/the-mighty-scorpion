const brains = [
  {
    name: 'CEREBRAS',
    key: process.env.CEREBRAS_API_KEY,
    url: 'https://api.cerebras.ai/v1/chat/completions',
    model: 'llama3.1-8b',
    headers: k => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k })
  },
  {
    name: 'GROQ',
    key: process.env.GROQ_API_KEY,
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    headers: k => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k })
  },
  {
    name: 'GEMINI',
    key: process.env.GEMINI_API_KEY,
    url: null,
    model: 'gemini-2.0-flash'
  },
  {
    name: 'MISTRAL',
    key: process.env.MISTRAL_API_KEY,
    url: 'https://api.mistral.ai/v1/chat/completions',
    model: 'mistral-large-latest',
    headers: k => ({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + k })
  }
];

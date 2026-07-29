export const config = { runtime: 'edge' };

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  },
});

export default async function handler(req) {
  if (req.method === 'OPTIONS') return json({}, 200);
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) return json({ error: 'GOOGLE_GEMINI_API_KEY is not configured in Vercel.' }, 500);

  try {
    const body = await req.json();
    const mode = body.mode === 'image' ? 'image' : 'chat';

    if (mode === 'image') {
      const prompt = String(body.prompt || '').trim();
      if (!prompt) return json({ error: 'An image prompt is required.' }, 400);

      const allowedRatios = new Set(['1:1', '16:9', '9:16', '4:3', '3:4']);
      const aspectRatio = allowedRatios.has(body.aspectRatio) ? body.aspectRatio : '1:1';
      const response = await fetch('https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-image:generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            responseFormat: { image: { aspectRatio } },
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) return json({ error: data.error?.message || 'Image generation failed.' }, response.status);
      const parts = data.candidates?.[0]?.content?.parts || [];
      const imagePart = [...parts].reverse().find(part => part.inlineData && !part.thought);
      const textPart = parts.find(part => part.text && !part.thought);
      if (!imagePart) return json({ error: 'Gemini did not return an image for this prompt.' }, 502);
      return json({
        text: textPart?.text || 'Here is your generated image.',
        image: { mimeType: imagePart.inlineData.mimeType || 'image/png', data: imagePart.inlineData.data },
        model: 'gemini-3.1-flash-image',
      });
    }

    const message = String(body.message || '').trim();
    if (!message) return json({ error: 'A message is required.' }, 400);
    const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
    const contents = history
      .filter(item => item && ['user', 'assistant'].includes(item.role) && item.content)
      .map(item => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(item.content) }] }));
    if (!contents.length || contents.at(-1)?.parts?.[0]?.text !== message) {
      contents.push({ role: 'user', parts: [{ text: message }] });
    }

    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: 'You are a capable, friendly general assistant. Be accurate, practical, concise by default, and format responses clearly with Markdown when useful.' }] },
      }),
    });

    const data = await response.json();
    if (!response.ok) return json({ error: data.error?.message || 'Gemini request failed.' }, response.status);
    const reply = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('').trim();
    if (!reply) return json({ error: 'Gemini returned an empty response.' }, 502);
    return json({ reply, model: 'gemini-3.6-flash' });
  } catch (error) {
    return json({ error: error?.message || 'Unexpected server error.' }, 500);
  }
}

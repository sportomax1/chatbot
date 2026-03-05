export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    const { message } = await req.json();
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;

    if (!apiKey) {
        return new Response(JSON.stringify({ reply: "Error: API Key is missing." }), { status: 500 });
    }

    // UPDATED MODEL: Using gemini-2.5-flash and the v1 stable endpoint
    const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ 
            parts: [{ text: message }] 
        }]
      })
    });

    const data = await response.json();

    if (data.error) {
        return new Response(JSON.stringify({ reply: `API Error: ${data.error.message}` }), { status: 400 });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I received an empty response.";
    
    return new Response(JSON.stringify({ reply }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ reply: "Connection Error. Please check your network." }), { status: 500 });
  }
}

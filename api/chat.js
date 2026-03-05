export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    const { message } = await req.json();
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;

    if (!apiKey) {
        return new Response(JSON.stringify({ reply: "Error: API Key is missing in Vercel settings." }), { status: 500 });
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ 
            role: "user",
            parts: [{ text: message }] 
        }]
      })
    });

    const data = await response.json();

    // Log error to Vercel console if Google returns one
    if (data.error) {
        console.error("Google API Error:", data.error);
        return new Response(JSON.stringify({ reply: `Google API Error: ${data.error.message}` }), { status: 500 });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I received an empty response from the AI.";
    
    return new Response(JSON.stringify({ reply }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error("Worker Error:", err);
    return new Response(JSON.stringify({ reply: "Internal Server Error. Check Vercel logs." }), { status: 500 });
  }
}

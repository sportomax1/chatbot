export const config = { runtime: 'edge' };

export default async function handler(req) {
  try {
    const { message } = await req.json();
    const apiKey = process.env.GOOGLE_GEMINI_API_KEY;

    if (!apiKey) {
      return new Response(JSON.stringify({ reply: "Error: API Key is missing in Vercel settings." }), { status: 500 });
    }

    // UPDATED: Using the March 2026 stable endpoint and Gemini 3 Flash model
    const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-3-flash-preview:generateContent?key=${apiKey}`, {
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
      console.error("Gemini API Error:", data.error.message);
      return new Response(JSON.stringify({ reply: `API Error: ${data.error.message}` }), { status: 400 });
    }

    // Extract the text from the new JSON structure
    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I received an empty response.";
    
    return new Response(JSON.stringify({ reply }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    return new Response(JSON.stringify({ reply: "Server error. Check your Vercel logs." }), { status: 500 });
  }
}

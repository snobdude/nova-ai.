
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "Nova is running" });
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      try {
        if (!env.GROQ_API_KEY) {
          return Response.json(
            { error: "Groq API key is not configured." },
            { status: 500 }
          );
        }

        const body = await request.json();
        const message = body.message;

        if (!message || typeof message !== "string") {
          return Response.json(
            { error: "Please enter a message." },
            { status: 400 }
          );
        }

        const response = await fetch(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${env.GROQ_API_KEY}`,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              model: "openai/gpt-oss-120b",
              messages: [
                {
                  role: "system",
                  content: "You are Nova, a helpful AI assistant."
                },
                {
                  role: "user",
                  content: message
                }
              ],
              temperature: 0.7
            })
          }
        );

        const data = await response.json();

        if (!response.ok) {
          return Response.json(
            { error: data.error?.message || "AI request failed." },
            { status: response.status }
          );
        }

        return Response.json({
          reply: data.choices?.[0]?.message?.content || "No response received."
        });

      } catch (error) {
        return Response.json(
          { error: "Something went wrong. Please try again." },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/history") {
      return Response.json({ messages: [] });
    }

    return env.ASSETS.fetch(request);
  }
};

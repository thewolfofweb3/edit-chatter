import { createFileRoute } from "@tanstack/react-router";

// Workflow router: an LLM decides whether the user's turn should produce
// a chat reply or trigger the image pipeline (generate vs edit).
// Returns: { action: "chat" | "image", reply?: string, prompt?: string, isEdit?: boolean }

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

type RouteBody = {
  messages: ChatMessage[];
  hasImage: boolean;
  hasMask: boolean;
  mode: "photo" | "video";
};

const ORCHESTRATOR_MODEL = process.env.OPENROUTER_ORCHESTRATOR_MODEL || "google/gemini-2.5-flash";
const HTTP_REFERER = process.env.OPENROUTER_HTTP_REFERER || "http://localhost:8080";
const APP_TITLE = process.env.OPENROUTER_APP_TITLE || "Reel Studio";

export const Route = createFileRoute("/api/orchestrate")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
          status: 405,
          headers: { "Content-Type": "application/json", Allow: "POST, OPTIONS" },
        }),
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS" } }),
      POST: async ({ request }) => {
        const key = process.env.OPENROUTER_API_KEY;
        if (!key) {
          return new Response(JSON.stringify({ error: "Missing OPENROUTER_API_KEY. Add it to .env or Codespaces secrets, then restart the dev server." }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const body = (await request.json()) as RouteBody;
        if (!Array.isArray(body.messages) || body.messages.length === 0) {
          return new Response(JSON.stringify({ error: "messages required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const system = `You are the orchestrator for an AI image & video studio. You decide what the app should DO next based on the user's latest message and the conversation so far.

You must respond with STRICT JSON only (no markdown, no commentary) in this exact schema:
{
  "action": "chat" | "image",
  "reply": string,        // shown to the user. ALWAYS provide a friendly conversational reply.
  "prompt": string,       // ONLY when action="image" — the refined, vivid image prompt to send to the image model.
  "isEdit": boolean       // ONLY when action="image" — true if editing the existing image, false to generate new.
}

Rules:
- Default to action="chat" for greetings, small talk, questions, brainstorming, clarifications, or anything not explicitly asking for a picture.
- Use action="image" ONLY when the user clearly asks to create, generate, draw, render, make, paint, or produce an image/photo/picture/illustration — OR to modify/edit/change/fix/replace something in the current image.
- If hasImage=true AND hasMask=true AND the user is asking for a change, set isEdit=true. Otherwise isEdit=false.
- When action="image", "prompt" should be a refined, descriptive prompt suitable for an image model (expand vague wording, keep user intent). "reply" should be a brief acknowledgement like "Generating that now…".
- When action="chat", omit "prompt" and "isEdit" (or set them null). Just be a helpful, intelligent assistant. Answer questions, discuss ideas, help plan the shot.
- Never invent image requests the user didn't make. "hello" → chat. "what can you do" → chat.

Context: mode=${body.mode}, hasImage=${body.hasImage}, hasMask=${body.hasMask}.`;

        const messages: ChatMessage[] = [
          { role: "system", content: system },
          ...body.messages,
        ];

        const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "HTTP-Referer": HTTP_REFERER,
            "X-Title": APP_TITLE,
          },
          body: JSON.stringify({
            model: ORCHESTRATOR_MODEL,
            messages,
            response_format: { type: "json_object" },
          }),
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          return new Response(
            JSON.stringify({ error: `OpenRouter ${upstream.status}: ${errText.slice(0, 500)}` }),
            { status: upstream.status, headers: { "Content-Type": "application/json" } },
          );
        }

        const data = (await upstream.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const raw = data.choices?.[0]?.message?.content ?? "{}";

        let parsed: {
          action?: "chat" | "image";
          reply?: string;
          prompt?: string;
          isEdit?: boolean;
        } = {};
        try {
          parsed = JSON.parse(raw);
        } catch {
          // Fall back: treat as chat reply
          parsed = { action: "chat", reply: raw || "Sorry, I didn't catch that." };
        }

        const action = parsed.action === "image" ? "image" : "chat";
        const reply = parsed.reply?.trim() || (action === "image" ? "Generating…" : "");
        const prompt = action === "image" ? parsed.prompt?.trim() || "" : undefined;
        const isEdit = action === "image" ? !!parsed.isEdit && body.hasImage && body.hasMask : undefined;

        return new Response(
          JSON.stringify({ action, reply, prompt, isEdit }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});

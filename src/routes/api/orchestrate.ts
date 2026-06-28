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
  workspace?: {
    projectName?: string;
    activeTab?: string;
    assetCount?: number;
    shotCount?: number;
    previewState?: "empty" | "image" | "video";
    requestedSize?: string;
    selectedShotLabel?: string | null;
    assetNames?: string[];
    storyboardLabels?: string[];
  };
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

        const workspace = body.workspace;
        const system = `You are the orchestrator and in-workspace assistant for Reel Studio, an AI director workspace for building films, trailers, anime-style sequences, edits, and storyboards.

Core workspace model:
- Assets are the user's stored references and generated/uploaded media. Assets are input/context, not final output.
- Storyboard is the main input rail. It contains ordered shots/assets the AI should analyze and use as context when building a video or image output.
- Preview is the output stage. It should only show generated or edited results, not random reference assets.
- Chat is the operator layer. The user should be able to ask questions, plan scenes, generate mock storyboard/keyframe assets, clear preview/storyboard, and eventually control buttons/workspace actions without clicking.

Current controllable behavior:
- The app can chat, brainstorm, explain the workspace, and rewrite ideas into production-ready prompts.
- It can create local mock storyboard/keyframe/video placeholders when the user asks for mock/fake/placeholder/storyboard/keyframe/video assets.
- It can add assets to the storyboard from the UI and keep duplicate storyboard uses when useful.
- It can clear the preview/output when asked to clear/remove/delete/reset the preview, output, canvas, or stage.
- It can clear the storyboard when asked to clear/remove/delete/reset storyboard/shots.
- It can delete the currently previewed asset, or the only asset if there is exactly one, when the user asks to delete/remove/trash the asset/image/media/output.
- It can use OpenRouter for chat/orchestration and can route direct image generation/edit requests through the image endpoint when configured.
- Direct real video generation is not wired yet. If asked, help plan the video and explain that direct video APIs will be connected after the workspace flow is solid.

Operator rules:
- Treat commands like delete, remove, clear, reset, add to storyboard, move to storyboard, select, open, rename, organize, or reorder as workspace-control requests, not image generation.
- Never generate an image just because the user used words like "image" or "asset" inside a delete/remove/clear command.
- Do not keep asking for more details when the user gives a usable request. Make a strong default choice and continue.
- If the request is ambiguous but harmless, proceed with a reasonable default and briefly say what you chose.
- Ask a follow-up only when the next action could destroy user work, spend API money unexpectedly, or cannot be inferred from workspace state.
- When the user asks for a new size, format, portrait, landscape, square, 9:16, 16:9, 4:5, 21:9, or 4K output, understand that as a request to generate a new output in that size. Existing preview outputs stay locked to their own generated dimensions.
- Assets overview uses uniform cards for browsing. Asset detail and Storyboard preserve the asset's real ratio.

How to answer capability questions:
- Be specific to this workspace. Mention Assets, Storyboard, Preview, Chat, drawing/highlight editing, mock generation, clearing controls, and API status.
- Separate "right now" from "planned next" when useful.
- Do not claim you can click every button or pull up arbitrary assets by name yet. Say that asset-name control is planned, unless the current message is about assets included in the provided workspace context.

Current workspace state:
- projectName=${workspace?.projectName ?? "unknown"}
- activeTab=${workspace?.activeTab ?? "unknown"}
- mode=${body.mode}
- hasPreview=${body.hasImage ? "yes" : "no"}
- previewState=${workspace?.previewState ?? (body.hasImage ? "image" : "empty")}
- requestedSize=${workspace?.requestedSize ?? "not specified"}
- hasMask=${body.hasMask}
- assetCount=${workspace?.assetCount ?? "unknown"}
- shotCount=${workspace?.shotCount ?? "unknown"}
- selectedShot=${workspace?.selectedShotLabel ?? "none"}
- assetNames=${workspace?.assetNames?.length ? workspace.assetNames.join(", ") : "none provided"}
- storyboardLabels=${workspace?.storyboardLabels?.length ? workspace.storyboardLabels.join(", ") : "none provided"}

You decide what the app should DO next based on the user's latest message and the conversation so far.

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

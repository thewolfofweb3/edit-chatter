import { createFileRoute } from "@tanstack/react-router";

// Image generation + editing via OpenAI GPT Image.
// Keep this route server-only: the API key is read from process.env here,
// never sent to the browser.
type ImageRequest = {
  prompt: string;
  mode: "generate" | "edit";
  imageBase64?: string; // raw base64, no data: prefix
  maskBase64?: string;  // alpha mask: opaque = marked focus, transparent = context
  size?: { width: number; height: number; ratio?: string; label?: string };
  sourceKind?: "generated" | "uploaded-or-unknown";
};

function openAiImageSize(size?: ImageRequest["size"]): "1024x1024" | "1024x1536" | "1536x1024" | "auto" {
  if (!size?.width || !size?.height) return "auto";
  const ratio = size.width / size.height;
  if (ratio > 1.12) return "1536x1024";
  if (ratio < 0.9) return "1024x1536";
  return "1024x1024";
}

function animationPrompt(prompt: string, size?: ImageRequest["size"]) {
  return [
    "Reel Studio visual identity: animation-first, digital-film production art. Default to stylized animation, anime/cinematic animation, cel-shaded illustration, graphic novel, motion-design, or polished game-cinematic concept art.",
    "Do not create photorealistic/live-action/documentary photography, real-camera bokeh, realistic human skin texture, physical toy/clay render, miniature figurine, or a stock-photo scene for new generations.",
    "Build the whole frame as one coherent animated world: designed background, animation-style materials, matching lighting, clean silhouettes, readable staging, intentional color palette, and production-quality detail.",
    "Maintain style consistency across related assets and preserve character identity, proportions, color language, line style, silhouette, and mood when editing or reframing.",
    size?.label ? `Target composition: ${size.label}. Fill the frame edge-to-edge for that composition without letterboxing, empty borders, or cropped UI-looking margins.` : "",
    `User request: ${prompt}`,
  ].filter(Boolean).join("\n");
}

function editPrompt(prompt: string, size?: ImageRequest["size"], sourceKind: ImageRequest["sourceKind"] = "uploaded-or-unknown") {
  const sourceRule = sourceKind === "generated"
    ? "The source is a Reel Studio generated output. Keep the result in a fully animated/digital world. If the source drifted into a realistic photo setting, repaint the setting as designed animation background art while preserving the user's requested subject and composition."
    : "The source may be an uploaded real photo. If the user is placing an animated character/object into the photo, preserve the real photo and integrate the animated element like professional compositing/VFX with matched contact shadows, scale, perspective, occlusion, and light direction.";

  return [
    animationPrompt(prompt, size),
    sourceRule,
    "Edit workflow:",
    "- Treat the alpha mask as the user's marked focus area. Use it to understand what the user is pointing at, but make the final output a coherent full-frame edit, not a pasted sticker or small replacement object.",
    "- Preserve the same subject, character, camera angle, composition, and background unless the user asks to change them.",
    "- When changing anatomy, clothing, pose, expression, props, color, lighting, or texture, rebuild the selected area so it blends into the surrounding line art, shadows, perspective, and style.",
    "- For pose edits, keep the same character identity and body scale; adjust connected anatomy naturally so limbs attach correctly and the silhouette reads clearly.",
    "- Never insert a tiny new character, icon, card, white box, sticker, screenshot, or bordered patch inside the highlighted area.",
    "- Do not leave visible mask edges, rectangular patches, selection borders, mismatched resolution, or pasted-card artifacts.",
  ].join("\n");
}

function base64ToFile(base64: string, name: string, type = "image/png") {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new File([bytes], name, { type });
}

export const Route = createFileRoute("/api/image")({
  server: {
    handlers: {
      GET: async () => {
        return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
          status: 405,
          headers: {
            "Content-Type": "application/json",
            Allow: "POST, OPTIONS",
          },
        });
      },
      OPTIONS: async () => {
        return new Response(null, {
          status: 204,
          headers: { Allow: "POST, OPTIONS" },
        });
      },
      POST: async ({ request }) => {
        const key = process.env.OPENAI_API_KEY;
        if (!key) {
          return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY. Add it to .env or Codespaces secrets, then restart the dev server." }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const body = (await request.json()) as ImageRequest;
        if (!body.prompt || typeof body.prompt !== "string") {
          return new Response(JSON.stringify({ error: "prompt required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const size = openAiImageSize(body.size);
        const prompt = animationPrompt(body.prompt, body.size);
        const imageModel = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";

        if (body.mode === "edit" && body.imageBase64) {
          const form = new FormData();
          form.set("model", imageModel);
          form.set("prompt", editPrompt(body.prompt, body.size, body.sourceKind));
          form.set("size", size);
          form.set("quality", process.env.OPENAI_IMAGE_QUALITY || "high");
          form.set("output_format", "png");
          form.set("image", base64ToFile(body.imageBase64, "source.png"));
          if (body.maskBase64) {
            form.set("mask", base64ToFile(body.maskBase64, "mask.png"));
          }

          const upstream = await fetch("https://api.openai.com/v1/images/edits", {
            method: "POST",
            headers: { Authorization: `Bearer ${key}` },
            body: form,
          });

          if (!upstream.ok) {
            const errText = await upstream.text();
            return new Response(
              JSON.stringify({ error: `OpenAI ${upstream.status}: ${errText.slice(0, 600)}` }),
              { status: upstream.status, headers: { "Content-Type": "application/json" } },
            );
          }

          const data = (await upstream.json()) as { data?: { b64_json?: string; revised_prompt?: string }[] };
          const b64 = data.data?.[0]?.b64_json;
          if (!b64) {
            return new Response(JSON.stringify({ error: "No image returned by OpenAI" }), {
              status: 502,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify({ dataUrl: `data:image/png;base64,${b64}`, text: data.data?.[0]?.revised_prompt ?? "" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        const upstream = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: imageModel,
            prompt,
            size,
            quality: process.env.OPENAI_IMAGE_QUALITY || "high",
            output_format: "png",
          }),
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          return new Response(
            JSON.stringify({ error: `OpenAI ${upstream.status}: ${errText.slice(0, 600)}` }),
            { status: upstream.status, headers: { "Content-Type": "application/json" } },
          );
        }

        const data = (await upstream.json()) as { data?: { b64_json?: string; revised_prompt?: string }[] };
        const b64 = data.data?.[0]?.b64_json;
        if (!b64) {
          return new Response(JSON.stringify({ error: "No image returned by OpenAI" }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ dataUrl: `data:image/png;base64,${b64}`, text: data.data?.[0]?.revised_prompt ?? "" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});

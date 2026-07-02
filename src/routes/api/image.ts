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
  editIntent?: "marked-region" | "background-swap" | "general-edit";
  maskHint?: {
    x: number;
    y: number;
    width: number;
    height: number;
    horizontal: "left" | "center" | "right";
    vertical: "top" | "middle" | "bottom";
  };
};

type EditCandidate = {
  dataUrl: string;
  revisedPrompt?: string;
  attempt: number;
};

type OpenAIImageResult = {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
};

function openAiImageSize(size?: ImageRequest["size"]): "1024x1024" | "1024x1536" | "1536x1024" | "auto" {
  if (!size?.width || !size?.height) return "auto";
  const ratio = size.width / size.height;
  if (ratio > 1.12) return "1536x1024";
  if (ratio < 0.9) return "1024x1536";
  return "1024x1024";
}

function configuredImageModel() {
  const model = (process.env.OPENAI_IMAGE_MODEL || "gpt-image-1").trim();
  // Keep older .env files working. We originally suggested gpt-image-2, but
  // gpt-image-1 is the safer Images API model for this workflow right now.
  return model === "gpt-image-2" ? "gpt-image-1" : model;
}

function editCandidateCount() {
  const parsed = Number.parseInt(process.env.OPENAI_EDIT_CANDIDATES || "2", 10);
  if (!Number.isFinite(parsed)) return 2;
  return Math.max(1, Math.min(4, parsed));
}

function dataUrlFromBase64(b64: string) {
  return `data:image/png;base64,${b64}`;
}

function previewJson(value: unknown) {
  try {
    return JSON.stringify(value).slice(0, 900);
  } catch {
    return String(value).slice(0, 900);
  }
}

async function imageResultToDataUrl(result?: OpenAIImageResult) {
  if (!result) throw new Error("No image result returned by OpenAI");
  if (result.b64_json) return dataUrlFromBase64(result.b64_json);

  if (result.url) {
    const imageResponse = await fetch(result.url);
    if (!imageResponse.ok) {
      throw new Error(`OpenAI returned an image URL, but the image download failed ${imageResponse.status}`);
    }

    const contentType = imageResponse.headers.get("content-type") || "image/png";
    const bytes = Buffer.from(await imageResponse.arrayBuffer());
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  }

  throw new Error(`OpenAI returned no usable image data: ${previewJson(result)}`);
}

async function selectBestEditCandidate(params: {
  candidates: EditCandidate[];
  sourceBase64: string;
  prompt: string;
  maskHint?: ImageRequest["maskHint"];
  editIntent?: ImageRequest["editIntent"];
}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key || params.candidates.length <= 1) return params.candidates[0];

  const model = process.env.OPENROUTER_IMAGE_JUDGE_MODEL || process.env.OPENROUTER_ORCHESTRATOR_MODEL || "google/gemini-2.5-flash";
  const region = params.maskHint
    ? `${params.maskHint.vertical}-${params.maskHint.horizontal}, ${Math.round(params.maskHint.width * 100)}% by ${Math.round(params.maskHint.height * 100)}%`
    : "unmarked/general edit";

  try {
    const content: Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    > = [
      {
        type: "text",
        text: [
          "You are Reel Studio's image edit quality judge.",
          "Pick the best edited candidate by comparing it to the source image and the user's request.",
          `User request: ${params.prompt}`,
          `Edit intent: ${params.editIntent ?? "general-edit"}`,
          `Marked region: ${region}`,
          "Scoring priorities, in order:",
          "1. Preserve the original character/subject identity, pose, body proportions, clothing color, line art, lighting, and scale.",
          "2. Preserve the original background/camera/framing unless the edit intent is background-swap.",
          "3. Change the exact marked object/body part on the same visible side. Penalize editing the opposite hand/arm/limb.",
          "4. Penalize background drift, color drift, posture drift, new characters, sticker patches, and mismatched style.",
          "Return STRICT JSON only: {\"selected\":1,\"reason\":\"short reason\"}. selected is 1-based candidate number.",
          "Source image:",
        ].join("\n"),
      },
      { type: "image_url", image_url: { url: dataUrlFromBase64(params.sourceBase64) } },
    ];

    params.candidates.forEach((candidate, index) => {
      content.push({ type: "text", text: `Candidate ${index + 1}:` });
      content.push({ type: "image_url", image_url: { url: candidate.dataUrl } });
    });

    const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER || "http://localhost:8080",
        "X-Title": process.env.OPENROUTER_APP_TITLE || "Reel Studio",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content }],
        response_format: { type: "json_object" },
      }),
    });

    if (!upstream.ok) return params.candidates[0];
    const data = (await upstream.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { selected?: number };
    const selectedIndex = Math.max(0, Math.min(params.candidates.length - 1, (parsed.selected ?? 1) - 1));
    return params.candidates[selectedIndex] ?? params.candidates[0];
  } catch {
    return params.candidates[0];
  }
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

function editPrompt(
  prompt: string,
  size?: ImageRequest["size"],
  sourceKind: ImageRequest["sourceKind"] = "uploaded-or-unknown",
  maskHint?: ImageRequest["maskHint"],
  editIntent: ImageRequest["editIntent"] = "general-edit",
  candidate = 1,
) {
  const sourceRule = sourceKind === "generated"
    ? "The source is a Reel Studio generated output. Keep the result in a fully animated/digital world. If the source drifted into a realistic photo setting, repaint the setting as designed animation background art while preserving the user's requested subject and composition."
    : "The source may be an uploaded real photo. If the user is placing an animated character/object into the photo, preserve the real photo and integrate the animated element like professional compositing/VFX with matched contact shadows, scale, perspective, occlusion, and light direction.";
  const regionRule = editIntent === "background-swap"
    ? "Background swap cue: use the source image as the character reference. Keep the foreground character locked exactly: same pose, body proportions, silhouette, clothing color, outline weight, head/face shape, scale, and position. Change only the background/environment/setting."
    : maskHint
    ? `Marked region cue: the user marked the ${maskHint.vertical}-${maskHint.horizontal} area of the image, covering about ${Math.round(maskHint.width * 100)}% width by ${Math.round(maskHint.height * 100)}% height. Treat that marked area as the exact body part/object to transform. If the user names an arm, hand, leg, face, prop, or color, apply the change to the marked part on that same visible side, not the opposite side.`
    : "Marked region cue: treat the mask as the exact body part/object the user is pointing at.";

  return [
    animationPrompt(prompt, size),
    sourceRule,
    regionRule,
    "Edit workflow:",
    editIntent === "background-swap"
      ? "- Preserve camera angle, framing, character identity, clothing, colors, line style, lighting direction on the character, and all foreground character details as tightly as possible."
      : "- Preserve the background, camera angle, framing, character identity, clothing, colors, line style, lighting direction, and unmarked body parts as tightly as possible.",
    editIntent === "background-swap" ? "- For this background swap, preserve the entire character as if rotoscoped/cut out from the source, but render it naturally in the new animated environment. Do not recolor the character, change the pose, slim/widen the body, redraw the outfit, or shift the character unless necessary for frame fit." : "",
    "- The marked region identifies what to change. It is not permission to replace the scene, swap the character, move the camera, change the background, or edit the opposite limb.",
    "- When changing anatomy, clothing, pose, expression, props, color, lighting, or texture, rebuild the selected part and its natural connection points so it blends into the surrounding line art, shadows, perspective, and style.",
    "- For pose edits, keep the same character identity and body scale; adjust only the necessary connected anatomy so limbs attach correctly and the silhouette reads clearly.",
    "- If the user asks to raise an arm, wave, move a hand, bend a knee, turn a head, or change a facial feature, identify the marked body part first, then transform that same marked part.",
    "- Never insert a tiny new character, icon, card, white box, sticker, screenshot, or bordered patch inside the highlighted area.",
    "- Do not leave visible mask edges, rectangular patches, selection borders, mismatched resolution, or pasted-card artifacts.",
    `Candidate pass ${candidate}: prioritize scene preservation first, requested edit second, and stylistic consistency third. A boring but accurate edit is better than a dramatic scene rewrite.`,
  ].filter(Boolean).join("\n");
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
        const imageModel = configuredImageModel();

        if (body.mode === "edit" && body.imageBase64) {
          const attempts = editCandidateCount();
          const candidates: EditCandidate[] = [];
          let lastError = "";

          for (let attempt = 1; attempt <= attempts; attempt++) {
            const form = new FormData();
            form.set("model", imageModel);
            form.set("prompt", editPrompt(body.prompt, body.size, body.sourceKind, body.maskHint, body.editIntent, attempt));
            form.set("size", size);
            form.set("quality", process.env.OPENAI_IMAGE_QUALITY || "high");
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
              lastError = `OpenAI edit ${upstream.status}: ${errText.slice(0, 900)}`;
              continue;
            }

            const data = (await upstream.json()) as { data?: OpenAIImageResult[] };
            const result = data.data?.[0];
            if (!result) {
              lastError = `No image returned by OpenAI. Raw response: ${previewJson(data)}`;
              continue;
            }

            try {
              candidates.push({
                dataUrl: await imageResultToDataUrl(result),
                revisedPrompt: result.revised_prompt,
                attempt,
              });
            } catch (error) {
              lastError = error instanceof Error ? error.message : "Unable to read OpenAI image result";
            }
          }

          if (candidates.length > 0) {
            const selected = await selectBestEditCandidate({
              candidates,
              sourceBase64: body.imageBase64,
              prompt: body.prompt,
              maskHint: body.maskHint,
              editIntent: body.editIntent,
            });

            return new Response(JSON.stringify({
              dataUrl: selected.dataUrl,
              text: selected.revisedPrompt ?? "",
              candidateCount: candidates.length,
              selectedCandidate: selected.attempt,
            }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }

          return new Response(JSON.stringify({ error: lastError || "Image edit failed" }), {
            status: 502,
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
            JSON.stringify({ error: `OpenAI generation ${upstream.status}: ${errText.slice(0, 900)}` }),
            { status: upstream.status, headers: { "Content-Type": "application/json" } },
          );
        }

        const data = (await upstream.json()) as { data?: OpenAIImageResult[] };
        const result = data.data?.[0];
        if (!result) {
          return new Response(JSON.stringify({ error: `No image returned by OpenAI. Raw response: ${previewJson(data)}` }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          return new Response(JSON.stringify({ dataUrl: await imageResultToDataUrl(result), text: result.revised_prompt ?? "" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unable to read OpenAI image result" }), {
            status: 502,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});

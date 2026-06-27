import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import {
  Image as ImageIcon, Film, Settings,
  Folder, Download, Upload, Send, ChevronDown,
  MessageSquarePlus, History, Paperclip,
  SquareDashedMousePointer, MousePointer2, Plus, Brush,
  ArrowLeft, Pencil, Trash2, X, FileText, MessageSquare,
  LayoutGrid, Library, Save, LayoutTemplate,
  Target, Play, Sparkles, Search,
} from "lucide-react";
import { buildMaskDataUrl, compositeWithMask, dataUrlToBase64, loadImage } from "@/lib/imageOps";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Reel — AI Video Studio" },
      { name: "description", content: "An AI video & image studio. Chat to create, edit, and refine." },
    ],
  }),
  component: Studio,
});

type Attachment = { id: number; name: string; type: string; url?: string };
type Msg = { id: number; role: "user" | "ai"; text: string; attachments?: Attachment[] };
type Chat = { id: number; name: string; messages: Msg[]; updatedAt: number };
type Sel = { x: number; y: number; w: number; h: number };
type Tool = "move" | "select" | "brush";
type Pt = { x: number; y: number };
type Stroke = Pt[];
type Preset = { label: string; w: number; h: number; ratio: string };
type PanelView = "chat" | "history";
type AssetKind = "image" | "video";
type Asset = {
  id: number;
  name: string;
  kind: AssetKind;
  url: string;        // data URL or object URL
  poster?: string;    // poster for videos
  createdAt: number;
};
type Shot = { id: number; assetId: number; label: string };
type Project = { id: number; name: string; updatedAt: number; shotCount: number };
type Template = { id: string; name: string; description: string; ratio: string; accent: string };

const SIZE_PRESETS: Preset[] = [
  { label: "Landscape · 1920×1080", w: 1920, h: 1080, ratio: "16 / 9" },
  { label: "Portrait · 1080×1920", w: 1080, h: 1920, ratio: "9 / 16" },
  { label: "Square · 1080×1080", w: 1080, h: 1080, ratio: "1 / 1" },
  { label: "Vertical 4:5 · 1080×1350", w: 1080, h: 1350, ratio: "4 / 5" },
  { label: "Cinema 21:9 · 2560×1080", w: 2560, h: 1080, ratio: "21 / 9" },
  { label: "4K · 3840×2160", w: 3840, h: 2160, ratio: "16 / 9" },
];
const FPS_PRESETS = [24, 30, 60];

const TEMPLATES: Template[] = [
  { id: "t1", name: "Product Hero", description: "Centered product on gradient with floating bokeh.", ratio: "16 / 9", accent: "from-indigo-500 to-fuchsia-500" },
  { id: "t2", name: "Vertical Promo", description: "9:16 reel with kinetic text and color sweeps.", ratio: "9 / 16", accent: "from-rose-500 to-amber-400" },
  { id: "t3", name: "Cinematic Intro", description: "21:9 letterboxed title card with film grain.", ratio: "21 / 9", accent: "from-slate-600 to-cyan-500" },
  { id: "t4", name: "Square Story", description: "1:1 story tile with bold text overlay.", ratio: "1 / 1", accent: "from-emerald-500 to-teal-400" },
  { id: "t5", name: "Lookbook Frame", description: "4:5 portrait crop with editorial typography.", ratio: "4 / 5", accent: "from-violet-500 to-pink-400" },
  { id: "t6", name: "Mood Reel", description: "Mood-board montage with smooth crossfades.", ratio: "16 / 9", accent: "from-orange-500 to-red-500" },
];

const INITIAL_PROJECTS: Project[] = [
  { id: 101, name: "summer-campaign-2026", updatedAt: Date.now() - 1000 * 60 * 60 * 3, shotCount: 8 },
  { id: 102, name: "brand-intro-v2", updatedAt: Date.now() - 1000 * 60 * 60 * 26, shotCount: 4 },
  { id: 103, name: "product-launch-reel", updatedAt: Date.now() - 1000 * 60 * 60 * 72, shotCount: 12 },
];

// ---------- Mock keyframe / video generators (client-side, no API) ----------

function makeMockImage(seedText: string, w = 1280, h = 720): string {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  // hash for repeatable colors
  let h1 = 0;
  for (let i = 0; i < seedText.length; i++) h1 = (h1 * 31 + seedText.charCodeAt(i)) & 0xffffffff;
  const hue = Math.abs(h1) % 360;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${hue}, 70%, 22%)`);
  g.addColorStop(0.5, `hsl(${(hue + 40) % 360}, 65%, 35%)`);
  g.addColorStop(1, `hsl(${(hue + 80) % 360}, 70%, 18%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // bokeh circles
  for (let i = 0; i < 24; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const r = 20 + Math.random() * 120;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `hsla(${(hue + 120) % 360}, 90%, 75%, 0.35)`);
    rg.addColorStop(1, "hsla(0,0%,0%,0)");
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // label
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = `600 ${Math.round(h * 0.06)}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(seedText.slice(0, 48) || "Mock Keyframe", w / 2, h / 2 + h * 0.02);
  ctx.font = `400 ${Math.round(h * 0.025)}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.fillText("mock preview · generated locally", w / 2, h / 2 + h * 0.08);
  return c.toDataURL("image/png");
}

async function makeMockVideo(seedText: string, w = 1280, h = 720, durationSec = 3): Promise<{ url: string; poster: string }> {
  // Build an animated WebM via MediaRecorder on a canvas.
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  const stream = (c as HTMLCanvasElement).captureStream(30);
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: mime });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  const done = new Promise<Blob>((resolve) => { rec.onstop = () => resolve(new Blob(chunks, { type: mime })); });

  let h1 = 0;
  for (let i = 0; i < seedText.length; i++) h1 = (h1 * 31 + seedText.charCodeAt(i)) & 0xffffffff;
  const baseHue = Math.abs(h1) % 360;

  let poster = "";
  rec.start();
  const start = performance.now();
  const drawFrame = () => {
    const t = (performance.now() - start) / 1000;
    const hue = (baseHue + t * 30) % 360;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `hsl(${hue}, 70%, 22%)`);
    g.addColorStop(1, `hsl(${(hue + 90) % 360}, 70%, 18%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2 + Math.cos(t * 1.2) * w * 0.15;
    const cy = h / 2 + Math.sin(t * 1.5) * h * 0.15;
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.4);
    rg.addColorStop(0, `hsla(${(hue + 180) % 360}, 90%, 70%, 0.55)`);
    rg.addColorStop(1, "hsla(0,0%,0%,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = `600 ${Math.round(h * 0.06)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(seedText.slice(0, 48) || "Mock Video", w / 2, h / 2 + h * 0.02);
    ctx.font = `400 ${Math.round(h * 0.025)}px Inter, system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText(`mock clip · ${t.toFixed(1)}s`, w / 2, h / 2 + h * 0.08);
    if (!poster && t > 0.3) poster = c.toDataURL("image/jpeg", 0.7);
  };

  const interval = window.setInterval(drawFrame, 1000 / 30);
  await new Promise((r) => setTimeout(r, durationSec * 1000));
  window.clearInterval(interval);
  rec.stop();
  const blob = await done;
  if (!poster) poster = c.toDataURL("image/jpeg", 0.7);
  return { url: URL.createObjectURL(blob), poster };
}

function detectMockIntent(text: string): { kind: "video" | "keyframe" | "storyboard"; count: number } | null {
  const t = text.toLowerCase();
  const mock = /mock|placeholder|fake|dummy/.test(t);
  const wantVideo = /\bvideo|clip|reel|animation\b/.test(t);
  const wantKey = /\bkey\s*frame|keyframe|shot|frame\b/.test(t);
  const wantBoard = /\bstoryboard|story\s*board|board\b/.test(t);
  if (!mock && !wantVideo && !wantKey && !wantBoard) return null;
  const m = t.match(/(\d+)\s*(?:shots|frames|keyframes|clips)/);
  const count = m ? Math.min(12, Math.max(1, parseInt(m[1], 10))) : (wantBoard ? 4 : 1);
  if (wantVideo && !wantKey && !wantBoard) return { kind: "video", count: 1 };
  if (wantBoard) return { kind: "storyboard", count };
  return { kind: "keyframe", count };
}

function Studio() {
  const [chats, setChats] = useState<Chat[]>([
    { id: 1, name: "Untitled chat", messages: [], updatedAt: Date.now() },
  ]);
  const [currentChatId, setCurrentChatId] = useState<number>(1);
  const [panelView, setPanelView] = useState<PanelView>("chat");
  const [activeTab, setActiveTab] = useState<string>("workspace");

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [projectName, setProjectName] = useState("untitled-project");
  const [projectRenaming, setProjectRenaming] = useState(false);
  const [projectRenameValue, setProjectRenameValue] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const assetUploadRef = useRef<HTMLInputElement>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"video" | "photo">("photo");
  const [modeOpen, setModeOpen] = useState(false);
  const modeRef = useRef<HTMLDivElement>(null);

  // Asset library + storyboard + selected preview
  const [assets, setAssets] = useState<Asset[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [previewAssetId, setPreviewAssetId] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS);
  const [shotPickerOpen, setShotPickerOpen] = useState(false);
  const shotPickerRef = useRef<HTMLDivElement>(null);

  // Settings panel state
  const [settings, setSettings] = useState({
    theme: "dark" as "dark" | "system",
    autoSave: true,
    brushSize: 18,
    brushColor: "#ef4444",
  });

  useEffect(() => {
    if (!modeOpen) return;
    function onDown(e: MouseEvent) {
      if (modeRef.current && !modeRef.current.contains(e.target as Node)) setModeOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [modeOpen]);

  useEffect(() => {
    if (!plusOpen) return;
    function onDown(e: MouseEvent) {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) setPlusOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [plusOpen]);

  useEffect(() => {
    if (!shotPickerOpen) return;
    function onDown(e: MouseEvent) {
      if (shotPickerRef.current && !shotPickerRef.current.contains(e.target as Node)) setShotPickerOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [shotPickerOpen]);


  const [input, setInput] = useState("");
  const [chatWidth, setChatWidth] = useState(380);
  const [shellWidth, setShellWidth] = useState(0);
  const [tool, setTool] = useState<Tool>("select");
  const [sizeIdx, setSizeIdx] = useState(0);
  const [fps, setFps] = useState(30);
  const [menu, setMenu] = useState<null | "size" | "fps">(null);

  const currentChat = chats.find((c) => c.id === currentChatId) ?? chats[0];
  const messages = currentChat?.messages ?? [];

  const [selection, setSelection] = useState<Sel | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);

  const [drawing, setDrawing] = useState<{ x: number; y: number } | null>(null);

  // Legacy single image used for masking/edit pipeline (image only).
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);

  const previewAsset = assets.find((a) => a.id === previewAssetId) ?? null;
  const showVideo = previewAsset?.kind === "video";
  const visibleImage = !showVideo ? (previewAsset?.url ?? previewImage) : null;

  const draggingRef = useRef(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // Tool dock dragging
  const [dockPos, setDockPos] = useState({ x: 0, y: 0 });
  const [dockDragging, setDockDragging] = useState(false);
  const dockPressRef = useRef<{ mx: number; my: number; ox: number; oy: number; moved: boolean } | null>(null);
  const dockSuppressClickRef = useRef(false);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      const p = dockPressRef.current;
      if (!p) return;
      const dx = e.clientX - p.mx;
      const dy = e.clientY - p.my;
      if (!p.moved && Math.hypot(dx, dy) < 4) return;
      p.moved = true;
      dockSuppressClickRef.current = true;
      setDockDragging(true);
      setDockPos({ x: p.ox + dx, y: p.oy + dy });
    }
    function onUp() {
      if (dockPressRef.current) {
        dockPressRef.current = null;
        setDockDragging(false);
        setTimeout(() => { dockSuppressClickRef.current = false; }, 0);
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current || !shellRef.current) return;
      const rect = shellRef.current.getBoundingClientRect();
      const available = Math.max(0, rect.width - 48 - 4);
      const raw = rect.right - e.clientX;
      const MIN_CHAT = 280;
      const MIN_PREVIEW = 320;
      const SNAP_CLOSE = 140;
      let next = Math.max(0, Math.min(available, raw));
      if (raw < SNAP_CLOSE) next = 0;
      else if (raw < MIN_CHAT) next = MIN_CHAT;
      else if (available - raw < SNAP_CLOSE) next = available;
      else if (available - raw < MIN_PREVIEW) next = available - MIN_PREVIEW;
      setChatWidth(next);
    }
    function onUp() {
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  useEffect(() => {
    if (!shellRef.current) return;
    const el = shellRef.current;
    const update = () => setShellWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const previewWidth = Math.max(0, shellWidth - 48 - 4 - chatWidth);
  const previewCollapsed = shellWidth > 0 && previewWidth < 240;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function updateChat(id: number, updater: (c: Chat) => Chat) {
    setChats((cs) => cs.map((c) => (c.id === id ? updater(c) : c)));
  }

  function pushMessage(role: "user" | "ai", text: string, attachments?: Attachment[]) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    updateChat(currentChatId, (c) => ({
      ...c,
      updatedAt: Date.now(),
      messages: [...c.messages, { id, role, text, attachments }],
    }));
    return id;
  }

  // ----- asset helpers -----
  function addAsset(a: Omit<Asset, "id" | "createdAt">): Asset {
    const asset: Asset = { ...a, id: Date.now() + Math.floor(Math.random() * 1000), createdAt: Date.now() };
    setAssets((xs) => [asset, ...xs]);
    return asset;
  }
  function addShot(assetId: number, label: string) {
    setShots((xs) => [...xs, { id: Date.now() + Math.floor(Math.random() * 1000), assetId, label }]);
  }
  function selectAsset(a: Asset) {
    setPreviewAssetId(a.id);
    if (a.kind === "image") setPreviewImage(a.url);
    setStrokes([]); setCurrentStroke(null);
    setActiveTab("workspace");
  }
  function saveCurrentToAssets() {
    const url = previewAsset?.url ?? previewImage;
    if (!url) return;
    const kind: AssetKind = previewAsset?.kind ?? "image";
    const a = addAsset({
      name: `${kind}-${new Date().toLocaleTimeString()}.${kind === "video" ? "webm" : "png"}`,
      kind,
      url,
      poster: previewAsset?.poster,
    });
    setPreviewAssetId(a.id);
  }
  function onAssetUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    for (const f of Array.from(files)) {
      const isVideo = f.type.startsWith("video/");
      const isImage = f.type.startsWith("image/");
      if (!isVideo && !isImage) continue;
      const url = URL.createObjectURL(f);
      addAsset({ name: f.name, kind: isVideo ? "video" : "image", url });
    }
    e.target.value = "";
  }

  async function send() {
    const t = input.trim();
    if ((!t && pendingAttachments.length === 0) || isThinking) return;

    const hasStrokes = strokes.length > 0 && !!visibleImage && !showVideo;
    const userAtts: Attachment[] = [...pendingAttachments];
    let maskDataUrl: string | null = null;

    if (hasStrokes && visibleImage && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      try {
        const img = await loadImage(visibleImage);
        maskDataUrl = buildMaskDataUrl(
          strokes, rect.width, rect.height, img.naturalWidth, img.naturalHeight, settings.brushSize,
        );
        const chip = document.createElement("canvas");
        chip.width = img.naturalWidth; chip.height = img.naturalHeight;
        const cctx = chip.getContext("2d")!;
        cctx.drawImage(img, 0, 0);
        const maskImg = await loadImage(maskDataUrl);
        cctx.globalAlpha = 0.55;
        const tint = document.createElement("canvas");
        tint.width = chip.width; tint.height = chip.height;
        const tctx = tint.getContext("2d")!;
        tctx.drawImage(maskImg, 0, 0);
        tctx.globalCompositeOperation = "source-in";
        tctx.fillStyle = settings.brushColor;
        tctx.fillRect(0, 0, tint.width, tint.height);
        cctx.drawImage(tint, 0, 0);
        cctx.globalAlpha = 1;
        userAtts.push({ id: Date.now(), name: "highlighted-region.png", type: "image/png", url: chip.toDataURL("image/png") });
      } catch (e) {
        console.error("mask snapshot failed", e);
      }
    }

    pushMessage("user", t, userAtts.length ? userAtts : undefined);
    setInput("");
    setPendingAttachments([]);
    setIsThinking(true);

    // ---- mock keyframe / video / storyboard intercept ----
    const mockIntent = detectMockIntent(t);
    if (mockIntent) {
      try {
        if (mockIntent.kind === "video") {
          pushMessage("ai", "Generating a mock video clip…");
          const { url, poster } = await makeMockVideo(t || "Mock clip");
          const a = addAsset({ name: `mock-clip-${Date.now()}.webm`, kind: "video", url, poster });
          setPreviewAssetId(a.id);
          addShot(a.id, "Clip");
          pushMessage("ai", "Placed a mock clip in the preview, asset library and storyboard.", [
            { id: Date.now(), name: a.name, type: "video/webm", url: poster },
          ]);
        } else {
          const n = mockIntent.count;
          pushMessage("ai", `Generating ${n} mock keyframe${n > 1 ? "s" : ""}…`);
          const created: Asset[] = [];
          for (let i = 0; i < n; i++) {
            const url = makeMockImage(`${t} #${i + 1}`);
            const a = addAsset({ name: `keyframe-${Date.now()}-${i + 1}.png`, kind: "image", url });
            addShot(a.id, `Shot ${shots.length + i + 1}`);
            created.push(a);
          }
          const first = created[0];
          if (first) { setPreviewAssetId(first.id); setPreviewImage(first.url); }
          pushMessage(
            "ai",
            `Dropped ${n} mock keyframe${n > 1 ? "s" : ""} into your assets and storyboard.`,
            created.slice(0, 4).map((a) => ({ id: a.id, name: a.name, type: "image/png", url: a.url })),
          );
        }
      } catch (e) {
        pushMessage("ai", `⚠️ Mock generation failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setIsThinking(false);
      }
      return;
    }

    try {
      const history = [...messages, { role: "user" as const, text: t }].map((m) => ({
        role: (m.role === "ai" ? "assistant" : "user") as "assistant" | "user",
        content: m.text || "(no text)",
      }));

      const routeRes = await fetch("/api/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, hasImage: !!visibleImage, hasMask: hasStrokes, mode }),
      });
      const decision = await routeRes.json();
      if (!routeRes.ok) {
        pushMessage("ai", `⚠️ ${decision.error || "Orchestrator failed"}`);
        return;
      }

      if (mode === "video" || decision.action === "chat") {
        pushMessage("ai", decision.reply || "…");
        return;
      }

      if (decision.reply) pushMessage("ai", decision.reply);

      const isEdit = !!decision.isEdit && !!visibleImage && hasStrokes;
      const imgPrompt: string = decision.prompt || t;

      const r = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: imgPrompt,
          mode: isEdit ? "edit" : "generate",
          imageBase64: isEdit && visibleImage ? dataUrlToBase64(visibleImage) : undefined,
          maskBase64: isEdit && maskDataUrl ? dataUrlToBase64(maskDataUrl) : undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.dataUrl) {
        const detail = data.text ? ` — model said: "${data.text.trim()}"` : "";
        pushMessage("ai", `⚠️ ${data.error || "Image generation failed"}${detail}\n\nTip: image models often refuse copyrighted characters. Try a descriptive prompt instead.`);
        return;
      }

      let finalDataUrl: string = data.dataUrl;
      if (isEdit && visibleImage && maskDataUrl) {
        try { finalDataUrl = await compositeWithMask(visibleImage, data.dataUrl, maskDataUrl); }
        catch (e) { console.error("composite failed, using raw edit", e); }
      }

      const a = addAsset({ name: isEdit ? "edited.png" : "generated.png", kind: "image", url: finalDataUrl });
      setPreviewImage(finalDataUrl);
      setPreviewAssetId(a.id);
      setStrokes([]);
      setCurrentStroke(null);
      pushMessage("ai", isEdit ? "Edited the highlighted region." : "Done.", [
        { id: Date.now(), name: a.name, type: "image/png", url: finalDataUrl },
      ]);
    } catch (e) {
      console.error(e);
      pushMessage("ai", `⚠️ ${e instanceof Error ? e.message : "Request failed"}`);
    } finally {
      setIsThinking(false);
    }
  }


  function newChat() {
    const id = Date.now();
    setChats((cs) => {
      const existing = new Set(cs.map((c) => c.name));
      let name = "Untitled chat";
      let n = 2;
      while (existing.has(name)) name = `Untitled chat ${n++}`;
      return [{ id, name, messages: [], updatedAt: Date.now() }, ...cs];
    });
    setCurrentChatId(id);
    setPanelView("chat");
    setInput("");
    setPendingAttachments([]);
    setRenaming(false);
    setPlusOpen(false);
    setMenu(null);
    setTimeout(() => composerRef.current?.focus(), 0);
  }


  function openChat(id: number) { setCurrentChatId(id); setPanelView("chat"); }

  function deleteChat(id: number) {
    setChats((cs) => {
      const next = cs.filter((c) => c.id !== id);
      if (next.length === 0) {
        const nid = Date.now();
        const fresh = { id: nid, name: "Untitled chat", messages: [], updatedAt: Date.now() };
        setCurrentChatId(nid);
        return [fresh];
      }
      if (id === currentChatId) setCurrentChatId(next[0].id);
      return next;
    });
  }

  function startRename() { setRenameValue(currentChat.name); setRenaming(true); }
  function commitRename() {
    const v = renameValue.trim() || "Untitled chat";
    updateChat(currentChatId, (c) => ({ ...c, name: v }));
    setRenaming(false);
  }

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const next: Attachment[] = Array.from(files).map((f, i) => ({
      id: Date.now() + i,
      name: f.name,
      type: f.type,
      url: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined,
    }));
    setPendingAttachments((p) => [...p, ...next]);
    e.target.value = "";
  }
  function removePending(id: number) { setPendingAttachments((p) => p.filter((a) => a.id !== id)); }

  function canvasPoint(e: React.MouseEvent): Pt | null {
    if (!canvasRef.current) return null;
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function onCanvasDown(e: React.MouseEvent) {
    const p = canvasPoint(e);
    if (!p) return;
    if (tool === "select") { setDrawing(p); setSelection(null); }
    else if (tool === "brush") { setCurrentStroke([p]); }
  }
  function onCanvasMove(e: React.MouseEvent) {
    const p = canvasPoint(e);
    if (!p) return;
    if (tool === "select" && drawing) {
      setSelection({
        x: Math.min(drawing.x, p.x), y: Math.min(drawing.y, p.y),
        w: Math.abs(p.x - drawing.x), h: Math.abs(p.y - drawing.y),
      });
    } else if (tool === "brush" && currentStroke) {
      setCurrentStroke((prev) => (prev ? [...prev, p] : prev));
    }
  }
  function onCanvasUp() {
    if (drawing && selection && (selection.w < 8 || selection.h < 8)) setSelection(null);
    setDrawing(null);
    if (currentStroke) {
      if (currentStroke.length > 1) setStrokes((prev) => [...prev, currentStroke]);
      setCurrentStroke(null);
    }
  }

  const cursorClass = tool === "select" || tool === "brush" ? "cursor-crosshair" : "cursor-default";

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Top bar */}
      <header className="h-10 flex items-center justify-between px-3 border-b border-border bg-panel text-sm">
        <div className="flex items-center gap-3">
          <button className="text-muted-foreground hover:text-foreground transition-colors">Workspace</button>
          <span className="text-muted-foreground/60">/</span>
          {projectRenaming ? (
            <input
              autoFocus
              value={projectRenameValue}
              onChange={(e) => setProjectRenameValue(e.target.value)}
              onBlur={() => { setProjectName(projectRenameValue.trim() || "untitled-project"); setProjectRenaming(false); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { setProjectName(projectRenameValue.trim() || "untitled-project"); setProjectRenaming(false); }
                else if (e.key === "Escape") setProjectRenaming(false);
              }}
              className="h-7 px-2 text-sm bg-input/60 border border-border rounded-md outline-none focus:border-primary/60 min-w-0"
            />
          ) : (
            <button
              onClick={() => { setProjectRenameValue(projectName); setProjectRenaming(true); }}
              title="Rename project"
              className="h-7 px-2 flex items-center gap-1.5 rounded-md text-sm hover:bg-accent text-foreground/90 group"
            >
              <span className="truncate">{projectName}</span>
              <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60 shrink-0" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button className="px-2.5 py-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center gap-1.5">
            <Upload className="h-3.5 w-3.5" /> Import
          </button>
          <button className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 flex items-center gap-1.5 font-medium">
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </div>
      </header>

      <div ref={shellRef} className="relative flex-1 flex min-h-0">
        {/* Left icon rail (Tutorials removed) */}
        <aside className="w-12 bg-rail border-r border-border flex flex-col items-center py-2 gap-1">
          {[
            { id: "workspace", Icon: LayoutGrid, label: "Workspace" },
            { id: "projects", Icon: Folder, label: "Projects" },
            { id: "assets", Icon: Library, label: "Assets" },
            { id: "templates", Icon: LayoutTemplate, label: "Templates" },
          ].map(({ id, Icon, label }) => (
            <button
              key={id}
              title={label}
              onClick={() => setActiveTab(id)}
              className={`h-9 w-9 grid place-items-center rounded-md transition-colors ${
                activeTab === id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" />
            </button>
          ))}
          <div className="flex-1" />
          <button
            title="Settings"
            onClick={() => setActiveTab("settings")}
            className={`h-9 w-9 grid place-items-center rounded-md transition-colors ${
              activeTab === "settings" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
            }`}
          >
            <Settings className="h-[18px] w-[18px]" />
          </button>
        </aside>

        {/* Workspace / panels */}
        <main className="flex-1 flex flex-col min-w-0 bg-canvas overflow-hidden">
          {activeTab === "workspace" ? (
            <>
              <div className="relative flex-1 flex flex-col items-center justify-center p-6 pb-4 min-h-0 gap-3">
                {previewCollapsed ? null : (
                <>
                {/* Floating tool dock */}
                <div
                  onMouseDown={(e) => { dockPressRef.current = { mx: e.clientX, my: e.clientY, ox: dockPos.x, oy: dockPos.y, moved: false }; }}
                  style={{ transform: `translate(calc(-50% + ${dockPos.x}px), ${dockPos.y}px)` }}
                  className={`absolute top-4 left-1/2 z-10 flex items-center gap-0.5 p-1 rounded-lg bg-panel/90 border border-border backdrop-blur shadow-lg select-none ${dockDragging ? "cursor-grabbing" : "cursor-grab"}`}
                >
                  {[
                    { id: "move", Icon: MousePointer2, label: "Move" },
                    { id: "select", Icon: SquareDashedMousePointer, label: "Highlight area" },
                    { id: "brush", Icon: Brush, label: "Brush (free draw)" },
                  ].map(({ id, Icon, label }) => (
                    <button
                      key={id}
                      title={label}
                      onClick={() => { if (dockSuppressClickRef.current) return; setTool(id as Tool); }}
                      className={`h-8 w-8 grid place-items-center rounded-md transition-colors cursor-pointer ${
                        tool === id ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </button>
                  ))}
                </div>

                <div
                  ref={canvasRef}
                  onMouseDown={onCanvasDown}
                  onMouseMove={onCanvasMove}
                  onMouseUp={onCanvasUp}
                  onMouseLeave={onCanvasUp}
                  onDoubleClick={() => { setStrokes([]); setCurrentStroke(null); }}
                  style={{ aspectRatio: SIZE_PRESETS[sizeIdx].ratio }}
                  className={`relative w-full max-w-6xl max-h-full rounded-lg overflow-hidden border border-border shadow-2xl bg-[oklch(0.08_0.003_270)] select-none ${cursorClass}`}
                >
                  {showVideo && previewAsset ? (
                    <video
                      src={previewAsset.url}
                      poster={previewAsset.poster}
                      controls
                      className="absolute inset-0 w-full h-full object-contain pointer-events-auto select-none bg-black"
                    />
                  ) : visibleImage ? (
                    <img
                      src={visibleImage}
                      alt="Preview"
                      draggable={false}
                      className="absolute inset-0 w-full h-full object-contain pointer-events-none select-none"
                    />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center text-center px-6 pointer-events-none">
                      <p className="text-muted-foreground text-sm">Preview</p>
                    </div>
                  )}

                  {selection && (
                    <div
                      className="absolute border border-primary bg-primary/10 pointer-events-none"
                      style={{ left: selection.x, top: selection.y, width: selection.w, height: selection.h }}
                    />
                  )}

                  {!showVideo && (strokes.length > 0 || currentStroke) && (
                    <svg className="absolute inset-0 w-full h-full pointer-events-none">
                      <defs>
                        <filter id="brushGlow" x="-20%" y="-20%" width="140%" height="140%">
                          <feGaussianBlur stdDeviation="2.5" result="b" />
                          <feMerge>
                            <feMergeNode in="b" />
                            <feMergeNode in="SourceGraphic" />
                          </feMerge>
                        </filter>
                      </defs>
                      {strokes.map((s, i) => (
                        <polyline
                          key={i}
                          points={s.map((p) => `${p.x},${p.y}`).join(" ")}
                          fill="none"
                          stroke={settings.brushColor}
                          strokeOpacity={0.55}
                          strokeWidth={settings.brushSize}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          filter="url(#brushGlow)"
                        />
                      ))}
                      {currentStroke && currentStroke.length > 0 && (
                        <polyline
                          points={currentStroke.map((p) => `${p.x},${p.y}`).join(" ")}
                          fill="none"
                          stroke={settings.brushColor}
                          strokeOpacity={0.55}
                          strokeWidth={settings.brushSize}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          filter="url(#brushGlow)"
                        />
                      )}
                    </svg>
                  )}
                </div>

                {/* Preview toolbar removed — to be rebuilt */}
                </>
                )}
              </div>

              {/* Storyboard strip */}
              <div className="h-28 shrink-0 border-t border-border bg-panel/60 flex items-stretch">
                <div className="flex flex-col justify-center px-4 shrink-0 border-r border-border min-w-[120px]">
                  <div className="text-[11px] uppercase tracking-wider text-foreground/80 font-medium">Storyboard</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{shots.length} shot{shots.length === 1 ? "" : "s"}</div>
                </div>
                <div className="relative shrink-0 flex items-center px-3 border-r border-border" ref={shotPickerRef}>
                  <button
                    onClick={() => setShotPickerOpen((v) => !v)}
                    className={`h-20 w-20 rounded-md border border-dashed grid place-items-center transition-colors ${
                      shotPickerOpen ? "border-primary text-foreground bg-accent/40" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                    }`}
                    title="Add shot from assets"
                  >
                    <Plus className="h-5 w-5" />
                  </button>
                  {shotPickerOpen && (
                    <div className="absolute bottom-full left-2 mb-2 w-[320px] rounded-lg border border-border bg-popover shadow-xl z-30 overflow-hidden">
                      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                        <span className="text-xs font-medium">Add from Assets</span>
                        <button
                          onClick={() => { setShotPickerOpen(false); setActiveTab("assets"); }}
                          className="text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          Open Assets →
                        </button>
                      </div>
                      <div className="max-h-64 overflow-y-auto p-2">
                        {assets.length === 0 ? (
                          <div className="px-2 py-6 text-center text-xs text-muted-foreground">No assets yet.</div>
                        ) : (
                          <div className="grid grid-cols-3 gap-2">
                            {assets.map((a) => (
                              <button
                                key={a.id}
                                className="relative aspect-video rounded-md overflow-hidden border border-border hover:border-primary/60 bg-black"
                                title={a.name}
                              >
                                <img
                                  src={a.kind === "video" ? (a.poster ?? "") : a.url}
                                  alt={a.name}
                                  className="absolute inset-0 w-full h-full object-cover"
                                />
                                {a.kind === "video" && (
                                  <div className="absolute inset-0 grid place-items-center bg-black/30">
                                    <Play className="h-4 w-4 text-white drop-shadow" />
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="px-3 py-2 border-t border-border flex items-center justify-end gap-2">
                        <button
                          onClick={() => setShotPickerOpen(false)}
                          className="h-7 px-2.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
                        >
                          Cancel
                        </button>
                        <button
                          disabled
                          className="h-7 px-3 rounded-md bg-primary/60 text-primary-foreground text-xs font-medium opacity-60 cursor-not-allowed"
                          title="Selection wiring coming soon"
                        >
                          Add selected
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex-1 flex items-center gap-2 px-3 overflow-x-auto">
                  {shots.length === 0 ? (
                    <div className="text-xs text-muted-foreground/70">Empty storyboard</div>
                  ) : (
                    shots.map((s, i) => {
                      const a = assets.find((x) => x.id === s.assetId);
                      if (!a) return null;
                      const active = previewAssetId === a.id;
                      return (
                        <div
                          key={s.id}
                          className={`relative h-20 w-32 rounded-md overflow-hidden border shrink-0 ${
                            active ? "border-primary ring-2 ring-primary/40" : "border-border"
                          }`}
                          title={s.label}
                        >
                          <img
                            src={a.kind === "video" ? (a.poster ?? "") : a.url}
                            alt={s.label}
                            className="absolute inset-0 w-full h-full object-cover bg-black"
                          />
                          <div className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 text-[10px] text-white bg-gradient-to-t from-black/80 to-transparent">
                            #{i + 1}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

            </>
          ) : activeTab === "projects" ? (
            <PanelProjects
              projects={projects}
              onOpen={(p) => { setProjectName(p.name); setActiveTab("workspace"); }}
              onRename={(id, name) => setProjects((xs) => xs.map((p) => p.id === id ? { ...p, name } : p))}
            />

          ) : activeTab === "assets" ? (
            <PanelAssets
              assets={assets}
              onUploadClick={() => assetUploadRef.current?.click()}
              onSelect={selectAsset}
              onDelete={(id) => {
                setAssets((xs) => xs.filter((a) => a.id !== id));
                setShots((xs) => xs.filter((s) => s.assetId !== id));
                if (previewAssetId === id) setPreviewAssetId(null);
              }}
            />
          ) : activeTab === "templates" ? (
            <PanelTemplates
              templates={TEMPLATES}
              onUse={(tpl) => {
                const idx = SIZE_PRESETS.findIndex((p) => p.ratio === tpl.ratio);
                if (idx >= 0) setSizeIdx(idx);
                const url = makeMockImage(tpl.name);
                const a = addAsset({ name: `${tpl.name}.png`, kind: "image", url });
                setPreviewAssetId(a.id); setPreviewImage(url);
                setActiveTab("workspace");
              }}
            />
          ) : activeTab === "settings" ? (
            <PanelSettings
              settings={settings}
              onChange={setSettings}
              projectName={projectName}
              onProjectName={setProjectName}
            />
          ) : null}

          <input ref={assetUploadRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={onAssetUpload} />
        </main>


        {/* Resize handle */}
        <div
          onMouseDown={() => {
            draggingRef.current = true;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
          className="w-1 cursor-col-resize bg-border hover:bg-primary/60 transition-colors shrink-0"
        />

        {/* Right: AI chat */}
        <aside style={{ width: chatWidth }} className="bg-panel border-l border-border flex flex-col min-h-0 shrink-0 overflow-hidden">
          <div className="h-11 px-2 flex items-center justify-between border-b border-border gap-1">
            <div className="flex items-center gap-1 min-w-0">
              <button
                onClick={() => setPanelView(panelView === "history" ? "chat" : "history")}
                title={panelView === "history" ? "Back to chat" : "Project chats"}
                className={`h-8 w-8 grid place-items-center rounded-md shrink-0 ${
                  panelView === "history" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                {panelView === "history" ? <ArrowLeft className="h-4 w-4" /> : <History className="h-4 w-4" />}
              </button>
              {panelView === "chat" ? (
                renaming ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setRenaming(false); }}
                    className="h-8 px-2 text-sm bg-input/60 border border-border rounded-md outline-none focus:border-primary/60 min-w-0 flex-1"
                  />
                ) : (
                  <button
                    onClick={startRename}
                    title="Rename chat"
                    className="h-8 px-2 flex items-center gap-1.5 rounded-md text-sm hover:bg-accent text-foreground/90 min-w-0 group"
                  >
                    <span className="truncate">{currentChat.name}</span>
                    <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60 shrink-0" />
                  </button>
                )
              ) : (
                <span className="px-2 text-sm text-foreground/90">Chat history</span>
              )}
            </div>
            <div className="flex items-center gap-0.5 shrink-0">
              <button onClick={newChat} title="New chat" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent">
                <MessageSquarePlus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {panelView === "history" ? (
            <div className="flex-1 overflow-y-auto py-2">
              {chats.length === 0 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">No chats yet.</div>
              )}
              {[...chats].sort((a, b) => b.updatedAt - a.updatedAt).map((c) => {
                const last = c.messages[c.messages.length - 1];
                const preview = last?.text || (last?.attachments?.length ? `📎 ${last.attachments[0].name}` : "");
                const active = c.id === currentChatId;
                return (
                  <div
                    key={c.id}
                    className={`group flex items-start gap-2 px-3 py-2.5 cursor-pointer border-l-2 ${
                      active ? "bg-accent/60 border-primary" : "border-transparent hover:bg-accent/40"
                    }`}
                    onClick={() => openChat(c.id)}
                  >
                    <MessageSquare className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-foreground/90 truncate">{c.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{preview || "No messages yet"}</div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }}
                      title="Delete chat"
                      className="opacity-0 group-hover:opacity-100 h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              <div key={currentChatId} ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3 animate-fade-in">
                {messages.length === 0 && (
                  <div className="text-xs text-muted-foreground/80 leading-relaxed border border-dashed border-border rounded-md p-3">
                    Try: <span className="text-foreground">"mock 4 keyframes of a neon city"</span>, <span className="text-foreground">"mock video"</span>, or <span className="text-foreground">"mock storyboard with 6 shots"</span> — they'll land in your preview, assets and storyboard.
                  </div>
                )}
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                        m.role === "user"
                          ? "bg-primary text-primary-foreground rounded-br-sm"
                          : "bg-accent text-foreground rounded-bl-sm"
                      }`}
                    >
                      {m.attachments && m.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                          {m.attachments.map((a) => (
                            a.url ? (
                              <img key={a.id} src={a.url} alt={a.name} className="max-h-32 rounded-md border border-border/40" />
                            ) : (
                              <div key={a.id} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/20 text-xs">
                                <FileText className="h-3 w-3" /> {a.name}
                              </div>
                            )
                          ))}
                        </div>
                      )}
                      {m.text && <div>{m.text}</div>}
                    </div>
                  </div>
                ))}
                {isThinking && (
                  <div className="flex justify-start">
                    <div className="rounded-2xl rounded-bl-sm bg-accent px-3.5 py-2 text-sm text-muted-foreground inline-flex items-center gap-2">
                      <span className="thinking-shimmer">Thinking</span>
                      <span className="inline-flex gap-0.5">
                        <span className="thinking-dot" style={{ animationDelay: "0ms" }}>.</span>
                        <span className="thinking-dot" style={{ animationDelay: "150ms" }}>.</span>
                        <span className="thinking-dot" style={{ animationDelay: "300ms" }}>.</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Composer */}
              <div className="p-3">
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onPickFiles} />
                {visibleImage && !showVideo && strokes.length > 0 && (
                  <div className="mb-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-primary/10 border border-primary/30 text-xs text-foreground">
                    <Target className="h-3 w-3 text-primary" />
                    <span>Editing highlighted region — your next message edits only the brushed area.</span>
                  </div>
                )}
                <div className="rounded-xl bg-input/60 border border-border focus-within:border-primary/60 transition-colors">
                  {pendingAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 p-2 border-b border-border/60">
                      {pendingAttachments.map((a) => (
                        <div key={a.id} className="group relative flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-md bg-background/40 border border-border/60 text-xs">
                          {a.url ? (
                            <img src={a.url} alt={a.name} className="h-5 w-5 object-cover rounded" />
                          ) : (
                            <FileText className="h-3 w-3" />
                          )}
                          <span className="max-w-[140px] truncate">{a.name}</span>
                          <button
                            onClick={() => removePending(a.id)}
                            className="h-4 w-4 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-accent"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea
                    ref={composerRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                    rows={2}
                    placeholder="Type here — ask the AI, or 'mock 4 keyframes' / 'mock video'…"
                    className="w-full resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
                  />
                  <div className="flex items-center justify-between px-2 pb-2">
                    <div className="relative" ref={plusRef}>
                      <button
                        onClick={() => setPlusOpen((v) => !v)}
                        className={`p-1.5 rounded-md hover:bg-accent ${plusOpen ? "text-foreground bg-accent" : "text-muted-foreground hover:text-foreground"}`}
                        title="Add"
                      >
                        <Plus className={`h-4 w-4 transition-transform ${plusOpen ? "rotate-45" : ""}`} />
                      </button>
                      {plusOpen && (
                        <div className="absolute bottom-full left-0 mb-2 w-48 rounded-lg border border-border bg-popover shadow-lg p-1 z-50">
                          <button
                            onClick={() => { setPlusOpen(false); fileInputRef.current?.click(); }}
                            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm hover:bg-accent text-left"
                          >
                            <Paperclip className="h-4 w-4 text-muted-foreground" />
                            <span>Attach file</span>
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="relative" ref={modeRef}>
                        <button
                          onClick={() => setModeOpen((v) => !v)}
                          className="h-7 px-2 rounded-md text-xs font-medium flex items-center gap-1 text-muted-foreground hover:text-foreground hover:bg-accent border border-border"
                          title="Mode"
                        >
                          {mode === "video" ? <Film className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                          <span className="capitalize">{mode}</span>
                          <ChevronDown className={`h-3 w-3 transition-transform ${modeOpen ? "rotate-180" : ""}`} />
                        </button>
                        {modeOpen && (
                          <div className="absolute bottom-full right-0 mb-2 w-44 rounded-lg border border-border bg-popover shadow-lg p-1 z-50">
                            <button
                              onClick={() => { setMode("video"); setModeOpen(false); }}
                              className={`w-full flex items-start gap-2 px-2 py-1.5 rounded-md text-left hover:bg-accent ${mode === "video" ? "bg-accent" : ""}`}
                            >
                              <Film className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
                              <div>
                                <div className="text-xs font-medium">Video</div>
                                <div className="text-[10px] text-muted-foreground">Generate & edit videos</div>
                              </div>
                            </button>
                            <button
                              onClick={() => { setMode("photo"); setModeOpen(false); }}
                              className={`w-full flex items-start gap-2 px-2 py-1.5 rounded-md text-left hover:bg-accent ${mode === "photo" ? "bg-accent" : ""}`}
                            >
                              <ImageIcon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground" />
                              <div>
                                <div className="text-xs font-medium">Photo</div>
                                <div className="text-[10px] text-muted-foreground">Generate & edit images</div>
                              </div>
                            </button>
                          </div>
                        )}
                      </div>
                      <button
                        onClick={send}
                        className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40"
                        disabled={isThinking || (!input.trim() && pendingAttachments.length === 0)}
                      >
                        Send <Send className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </aside>

      </div>


      <footer className="h-6 border-t border-border bg-rail text-[11px] text-muted-foreground flex items-center px-3 gap-4">
        <span>● Ready</span>
        <span>Project: {projectName}</span>
        <span>{assets.length} assets · {shots.length} shots</span>
        <div className="flex-1" />
        <span>v0.1</span>
      </footer>
    </div>
  );
}

// ---------------- panels ----------------

function PanelHeader({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-border">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function PanelProjects({
  projects, onOpen, onRename,
}: {
  projects: Project[];
  onOpen: (p: Project) => void;
  onRename: (id: number, name: string) => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  function commit(id: number) {
    const v = draft.trim();
    if (v) onRename(id, v);
    setEditingId(null);
  }
  return (
    <div className="flex-1 overflow-y-auto">
      <PanelHeader title="Projects" subtitle="Switch between workspaces or start something new.">
        <button className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5 hover:opacity-90">
          <Plus className="h-3.5 w-3.5" /> New project
        </button>
      </PanelHeader>
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {projects.map((p) => (
          <div
            key={p.id}
            className="text-left rounded-lg border border-border bg-panel hover:border-primary/60 transition-colors p-4 group"
          >
            <button onClick={() => onOpen(p)} className="block w-full text-left">
              <div className="aspect-video rounded-md bg-gradient-to-br from-primary/30 via-accent to-background mb-3 grid place-items-center">
                <Folder className="h-7 w-7 text-foreground/60 group-hover:text-foreground" />
              </div>
            </button>
            <div className="flex items-center gap-1 min-w-0">
              {editingId === p.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commit(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commit(p.id);
                    else if (e.key === "Escape") setEditingId(null);
                  }}
                  className="h-7 px-2 text-sm bg-input/60 border border-border rounded-md outline-none focus:border-primary/60 flex-1 min-w-0"
                />
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setDraft(p.name); setEditingId(p.id); }}
                  className="h-7 px-2 -mx-2 flex items-center gap-1.5 rounded-md text-sm hover:bg-accent text-foreground/90 min-w-0 group/btn flex-1"
                  title="Rename project"
                >
                  <span className="truncate font-medium">{p.name}</span>
                  <Pencil className="h-3 w-3 opacity-0 group-hover/btn:opacity-60 shrink-0" />
                </button>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {p.shotCount} shots · updated {new Date(p.updatedAt).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PanelAssets({
  assets, onUploadClick, onSelect, onDelete,
}: {
  assets: Asset[];
  onUploadClick: () => void;
  onSelect: (a: Asset) => void;
  onDelete: (id: number) => void;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | AssetKind>("all");
  const filtered = assets.filter((a) =>
    (filter === "all" || a.kind === filter) && a.name.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <div className="flex-1 overflow-y-auto">
      <PanelHeader title="Assets" subtitle="Everything you upload or generate lives here.">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="h-8 pl-7 pr-2 text-xs bg-input/60 border border-border rounded-md outline-none focus:border-primary/60 w-44"
          />
        </div>
        {(["all", "image", "video"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`h-8 px-2.5 rounded-md text-xs capitalize ${filter === k ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/60"}`}
          >
            {k}
          </button>
        ))}
        <button
          onClick={onUploadClick}
          className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5 hover:opacity-90"
        >
          <Upload className="h-3.5 w-3.5" /> Upload
        </button>
      </PanelHeader>
      {filtered.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted-foreground">
          No assets yet. Upload files, or ask the chat for <span className="text-foreground">"mock 4 keyframes"</span>.
        </div>
      ) : (
        <div className="p-6 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((a) => (
            <div key={a.id} className="group rounded-lg border border-border bg-panel overflow-hidden hover:border-primary/60 transition-colors">
              <button onClick={() => onSelect(a)} className="block w-full aspect-video bg-black relative">
                <img src={a.kind === "video" ? (a.poster ?? "") : a.url} alt={a.name} className="absolute inset-0 w-full h-full object-cover" />
                {a.kind === "video" && (
                  <div className="absolute inset-0 grid place-items-center bg-black/30">
                    <Play className="h-6 w-6 text-white drop-shadow" />
                  </div>
                )}
              </button>
              <div className="flex items-center justify-between px-2 py-1.5 text-xs">
                <span className="truncate">{a.name}</span>
                <button
                  onClick={() => onDelete(a.id)}
                  className="opacity-0 group-hover:opacity-100 h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-accent shrink-0"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PanelTemplates({ templates, onUse }: { templates: Template[]; onUse: (t: Template) => void }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <PanelHeader title="Templates" subtitle="Pre-sized starting points with a mock keyframe." />
      <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {templates.map((t) => (
          <div key={t.id} className="rounded-lg border border-border bg-panel overflow-hidden hover:border-primary/60 transition-colors">
            <div className={`aspect-video bg-gradient-to-br ${t.accent} relative`}>
              <div className="absolute inset-0 grid place-items-center text-white/90 text-sm font-medium drop-shadow">
                {t.ratio}
              </div>
            </div>
            <div className="p-3">
              <div className="font-medium text-sm">{t.name}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{t.description}</div>
              <button
                onClick={() => onUse(t)}
                className="mt-2 h-7 px-2.5 rounded-md bg-accent text-foreground text-xs font-medium flex items-center gap-1.5 hover:bg-accent/80"
              >
                <Sparkles className="h-3 w-3" /> Use template
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PanelSettings({
  settings, onChange, projectName, onProjectName,
}: {
  settings: { theme: "dark" | "system"; autoSave: boolean; brushSize: number; brushColor: string };
  onChange: (s: PanelSettings["settings"]) => void;
  projectName: string;
  onProjectName: (s: string) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto">
      <PanelHeader title="Settings" subtitle="Project preferences and tool defaults." />
      <div className="max-w-2xl p-6 space-y-6">
        <Section title="Project">
          <Row label="Name">
            <input
              value={projectName}
              onChange={(e) => onProjectName(e.target.value || "untitled-project")}
              className="h-8 px-2 text-sm bg-input/60 border border-border rounded-md outline-none focus:border-primary/60 w-72"
            />
          </Row>
          <Row label="Auto-save generated outputs to Assets">
            <input
              type="checkbox"
              checked={settings.autoSave}
              onChange={(e) => onChange({ ...settings, autoSave: e.target.checked })}
              className="h-4 w-4 accent-[var(--primary)]"
            />
          </Row>
        </Section>
        <Section title="Brush">
          <Row label={`Size: ${settings.brushSize}px`}>
            <input
              type="range" min={4} max={64} value={settings.brushSize}
              onChange={(e) => onChange({ ...settings, brushSize: parseInt(e.target.value) })}
              className="w-72"
            />
          </Row>
          <Row label="Color">
            <input
              type="color"
              value={settings.brushColor}
              onChange={(e) => onChange({ ...settings, brushColor: e.target.value })}
              className="h-8 w-14 rounded-md border border-border bg-transparent cursor-pointer"
            />
          </Row>
        </Section>
        <Section title="Appearance">
          <Row label="Theme">
            <div className="flex items-center gap-1">
              {(["dark", "system"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => onChange({ ...settings, theme: t })}
                  className={`h-8 px-3 rounded-md text-xs capitalize ${settings.theme === t ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent/60"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </Row>
        </Section>
      </div>
    </div>
  );
}

type PanelSettings = React.ComponentProps<typeof PanelSettings>;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-panel">
      <div className="px-4 py-2.5 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="p-4 space-y-3">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="text-sm text-foreground/90">{label}</div>
      <div>{children}</div>
    </div>
  );
}

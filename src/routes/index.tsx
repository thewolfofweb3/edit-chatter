import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import {
  Image as ImageIcon, Film,
  Folder, Download, Upload, Send, ChevronDown, Pause,
  MessageSquarePlus, History, Paperclip,
  SquareDashedMousePointer, MousePointer2, Plus, Brush,
  ArrowLeft, Pencil, Trash2, X, FileText, MessageSquare,
  LayoutGrid, Library, LayoutTemplate,
  Target, Play, Sparkles, Search, CheckCircle2, Clock3, Wand2, Volume2,
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
type InventoryAction =
  | { label: string; action: "open-assets" }
  | { label: string; action: "add-assets-to-storyboard"; assetIds: number[] }
  | { label: string; action: "prompt"; prompt: string };
type InventoryCard = {
  id: string;
  kind: "asset-batch" | "storyboard-batch" | "workspace-action";
  title: string;
  subtitle?: string;
  stats?: { label: string; value: string }[];
  actions?: InventoryAction[];
};
type Msg = { id: number; role: "user" | "ai"; text: string; attachments?: Attachment[]; cards?: InventoryCard[] };
type Chat = { id: number; name: string; messages: Msg[]; updatedAt: number };
type Sel = { x: number; y: number; w: number; h: number };
type Tool = "move" | "select" | "brush";
type Pt = { x: number; y: number };
type Stroke = Pt[];
type Preset = { label: string; w: number; h: number; ratio: string };
type PanelView = "chat" | "history";
type AssetKind = "image" | "video";
type WorkspaceRail = "storyboard" | "timeline" | "audio";
type Asset = {
  id: number;
  name: string;
  kind: AssetKind;
  url: string;        // data URL or object URL
  poster?: string;    // poster for videos
  width?: number;
  height?: number;
  ratio?: string;
  sizeLabel?: string;
  styleSeed?: string;
  createdAt: number;
};
type Shot = { id: number; assetId: number; label: string };
type Project = { id: number; name: string; updatedAt: number; shotCount: number };
type Template = { id: string; name: string; description: string; ratio: string; accent: string };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanApiError(error: unknown, fallback: string) {
  const message = typeof error === "string" && error.trim() ? error.trim() : fallback;
  if (message.includes("Missing OPENROUTER_API_KEY")) {
    return "API key missing. Add OPENROUTER_API_KEY to your Codespace environment or .env file, then restart the dev server.";
  }
  return message;
}

const SIZE_PRESETS: Preset[] = [
  { label: "Landscape · 1920×1080", w: 1920, h: 1080, ratio: "16 / 9" },
  { label: "Portrait · 1080×1920", w: 1080, h: 1920, ratio: "9 / 16" },
  { label: "Square · 1080×1080", w: 1080, h: 1080, ratio: "1 / 1" },
  { label: "Vertical 4:5 · 1080×1350", w: 1080, h: 1350, ratio: "4 / 5" },
  { label: "Cinema 21:9 · 2560×1080", w: 2560, h: 1080, ratio: "21 / 9" },
  { label: "4K · 3840×2160", w: 3840, h: 2160, ratio: "16 / 9" },
];

const RAIL_CLOSED = 24;
const STORYBOARD_OPEN = 112;
const TIMELINE_OPEN = 86;
const AUDIO_OPEN = 68;

function presetFromAsset(asset: Asset | null | undefined, fallback: Preset): Preset {
  if (!asset?.width || !asset?.height) return fallback;
  return {
    label: asset.sizeLabel ?? `${asset.width}×${asset.height}`,
    w: asset.width,
    h: asset.height,
    ratio: asset.ratio ?? `${asset.width} / ${asset.height}`,
  };
}

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
  let randState = Math.abs(h1) || 1;
  const rand = () => {
    randState = (randState * 1664525 + 1013904223) >>> 0;
    return randState / 4294967296;
  };
  const hue = Math.abs(h1) % 360;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${hue}, 70%, 22%)`);
  g.addColorStop(0.5, `hsl(${(hue + 40) % 360}, 65%, 35%)`);
  g.addColorStop(1, `hsl(${(hue + 80) % 360}, 70%, 18%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // bokeh circles
  for (let i = 0; i < 24; i++) {
    const x = rand() * w, y = rand() * h;
    const r = 20 + rand() * 120;
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

function parseRequestedCount(text: string, fallback: number) {
  const t = text.toLowerCase();
  const wordNumbers: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    couple: 2,
    few: 3,
    several: 4,
    multiple: 4,
  };
  const digit = t.match(/\b(\d+)\s*(?:storyboard\s*)?(?:shots?|frames?|keyframes?|clips?|images?|assets?|scenes?)\b/);
  const nearbyDigit = t.match(/\b(\d+)\s+(?=(?:\w+\s+){0,5}(?:shots?|frames?|keyframes?|clips?|images?|assets?|scenes?)\b)/);
  const word = t.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|few|several|multiple)\s*(?:storyboard\s*)?(?:shots?|frames?|keyframes?|clips?|images?|assets?|scenes?)\b/);
  const nearbyWord = t.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|couple|few|several|multiple)\s+(?=(?:\w+\s+){0,5}(?:shots?|frames?|keyframes?|clips?|images?|assets?|scenes?)\b)/);
  const count = digit ? parseInt(digit[1], 10) : nearbyDigit ? parseInt(nearbyDigit[1], 10) : word ? wordNumbers[word[1]] : nearbyWord ? wordNumbers[nearbyWord[1]] : fallback;
  return Math.min(12, Math.max(1, count));
}

function detectMockIntent(text: string, requestedPresetCount = 0): { kind: "video" | "keyframe" | "storyboard"; count: number } | null {
  const t = text.toLowerCase();
  const mock = /mock|placeholder|fake|dummy/.test(t);
  const wantsCreate = /\b(create|generate|make|build|render|produce|give me|add)\b/.test(t);
  const wantVideo = /\b(videos?|clips?|reels?|animations?)\b/.test(t);
  const wantKey = /\b(key\s*frames?|keyframes?|shots?|frames?|images?|pictures?|assets?)\b/.test(t);
  const wantBoard = /\b(storyboard|story\s*board|board)\b/.test(t);
  const wantsMultipleMedia = /\b(multiple|several|few|couple|\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/.test(t) && wantKey;
  if (!mock && !wantVideo && !wantKey && !wantBoard) return null;
  if (!mock && !wantsCreate && !wantBoard && !wantsMultipleMedia) return null;
  const fallbackCount = wantBoard ? 4 : requestedPresetCount > 1 ? requestedPresetCount : wantsMultipleMedia ? 4 : 1;
  const count = parseRequestedCount(t, fallbackCount);
  if (wantVideo && !wantKey && !wantBoard) return { kind: "video", count: 1 };
  if (wantBoard) return { kind: "storyboard", count };
  return { kind: "keyframe", count };
}

function detectRequestedPreset(text: string): number | null {
  const presets = detectRequestedPresets(text);
  return presets.length ? presets[presets.length - 1] : null;
}

function detectRequestedPresets(text: string): number[] {
  const t = text.toLowerCase();
  const matches: Array<{ index: number; preset: number }> = [];
  [
    { preset: 1, re: /\b(9\s*:\s*16|portrait|vertical|tiktok|reel|shorts)\b/g },
    { preset: 2, re: /\b(1\s*:\s*1|square)\b/g },
    { preset: 3, re: /\b(4\s*:\s*5|lookbook|poster)\b/g },
    { preset: 4, re: /\b(21\s*:\s*9|cinema|cinematic|ultrawide|wide\s*screen)\b/g },
    { preset: 5, re: /\b(4k|3840\s*x\s*2160|3840×2160)\b/g },
    { preset: 0, re: /\b(16\s*:\s*9|landscape|horizontal|1920\s*x\s*1080|1920×1080)\b/g },
  ].forEach(({ preset, re }) => {
    for (const match of t.matchAll(re)) matches.push({ index: match.index ?? 0, preset });
  });
  return matches
    .sort((a, b) => a.index - b.index)
    .map((m) => m.preset)
    .filter((preset, index, presets) => presets.indexOf(preset) === index);
}

function buildRequestedPresetSequence(count: number, requestedPresetIdxs: number[], fallbackPreset: Preset) {
  if (requestedPresetIdxs.length === 0) return Array.from({ length: count }, () => fallbackPreset);
  return Array.from({ length: count }, (_, i) => SIZE_PRESETS[requestedPresetIdxs[i % requestedPresetIdxs.length]]);
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
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const inventoryRef = useRef<HTMLDivElement>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"video" | "photo">("photo");
  const [modeOpen, setModeOpen] = useState(false);
  const modeRef = useRef<HTMLDivElement>(null);

  // Asset library + storyboard + selected preview
  const [assets, setAssets] = useState<Asset[]>([]);
  const [recentAssetIds, setRecentAssetIds] = useState<number[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [previewAssetId, setPreviewAssetId] = useState<number | null>(null);
  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS);
  const [shotPickerOpen, setShotPickerOpen] = useState(false);
  const [dragShotId, setDragShotId] = useState<number | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<number | null>(null);
  const [shotPickerSelectedIds, setShotPickerSelectedIds] = useState<number[]>([]);
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
    if (!inventoryOpen) return;
    function onDown(e: MouseEvent) {
      if (inventoryRef.current && !inventoryRef.current.contains(e.target as Node)) setInventoryOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [inventoryOpen]);

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
  const [railOrder, setRailOrder] = useState<WorkspaceRail[]>(["storyboard", "timeline", "audio"]);
  const [storyboardHeight, setStoryboardHeight] = useState(STORYBOARD_OPEN);
  const [timelineHeight, setTimelineHeight] = useState(RAIL_CLOSED);
  const [audioHeight, setAudioHeight] = useState(RAIL_CLOSED);
  const [audioMuted, setAudioMuted] = useState(false);
  const [renderMode, setRenderMode] = useState<"draft" | "final">("draft");
  const [shellWidth, setShellWidth] = useState(0);
  const [tool, setTool] = useState<Tool>("select");
  const [sizeIdx, setSizeIdx] = useState(0);
  const [menu, setMenu] = useState<null | "size">(null);
  const selectedPreset = SIZE_PRESETS[sizeIdx];

  const currentChat = chats.find((c) => c.id === currentChatId) ?? chats[0];
  const messages = currentChat?.messages ?? [];

  const [selection, setSelection] = useState<Sel | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);

  const [drawing, setDrawing] = useState<{ x: number; y: number } | null>(null);

  // Legacy single image used for masking/edit pipeline (image only).
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isThinking, setIsThinking] = useState(false);
  const [thinkingLabel, setThinkingLabel] = useState("Thinking");

  const previewAsset = assets.find((a) => a.id === previewAssetId) ?? null;
  const showVideo = previewAsset?.kind === "video";
  const visibleImage = !showVideo ? (previewAsset?.url ?? previewImage) : null;
  const outputPreset = presetFromAsset(previewAsset, selectedPreset);
  const hasPreviewOutput = !!previewAsset || !!previewImage;
  const storyboardCollapsed = storyboardHeight < 44;
  const timelineCollapsed = timelineHeight < 36;
  const audioCollapsed = audioHeight < 34;
  const railHeightMap: Record<WorkspaceRail, number> = {
    storyboard: storyboardHeight,
    timeline: timelineHeight,
    audio: audioHeight,
  };
  const railAnchorFor = (rail: WorkspaceRail) => {
    let anchor = 0;
    for (let i = railOrder.length - 1; i >= 0; i--) {
      anchor += railHeightMap[railOrder[i]];
      if (railOrder[i] === rail) return anchor;
    }
    return anchor;
  };
  const audioRailAnchor = railAnchorFor("audio");
  const timelineRailAnchor = railAnchorFor("timeline");
  const storyboardRailAnchor = railAnchorFor("storyboard");
  const storyboardRailTabBottom = Math.max(0, storyboardRailAnchor - 10);
  const storyboardRailConnectorBottom = Math.max(0, storyboardRailAnchor - 3);
  const timelineRailTabBottom = Math.max(0, timelineRailAnchor - 10);
  const timelineRailConnectorBottom = Math.max(0, timelineRailAnchor - 3);
  const audioRailTabBottom = Math.max(0, audioRailAnchor - 10);
  const audioRailConnectorBottom = Math.max(0, audioRailAnchor - 3);

  const draggingRef = useRef(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const previewAreaRef = useRef<HTMLDivElement>(null);
  const storyboardDragRef = useRef(false);
  const storyboardPressRef = useRef<{ startY: number } | null>(null);
  const storyboardSuppressClickRef = useRef(false);
  const timelineDragRef = useRef(false);
  const timelinePressRef = useRef<{ startY: number } | null>(null);
  const timelineSuppressClickRef = useRef(false);
  const audioDragRef = useRef(false);
  const audioPressRef = useRef<{ startY: number } | null>(null);
  const audioSuppressClickRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const typingTimersRef = useRef<ReturnType<typeof setInterval>[]>([]);
  const sizeMenuRef = useRef<HTMLDivElement>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewAreaSize, setPreviewAreaSize] = useState({ w: 0, h: 0 });

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
    if (menu !== "size") return;
    function onDown(e: MouseEvent) {
      if (sizeMenuRef.current && !sizeMenuRef.current.contains(e.target as Node)) setMenu(null);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menu]);

  useEffect(() => {
    setIsPreviewPlaying(false);
    videoRef.current?.pause();
  }, [previewAssetId]);

  function togglePreviewPlayback() {
    const video = videoRef.current;
    if (!showVideo || !video) return;
    if (video.paused) {
      void video.play();
      setIsPreviewPlaying(true);
    } else {
      video.pause();
      setIsPreviewPlaying(false);
    }
  }

  function openWorkspaceRail(rail: WorkspaceRail) {
    if (rail === "storyboard") setStoryboardHeight(STORYBOARD_OPEN);
    if (rail === "timeline") setTimelineHeight(TIMELINE_OPEN);
    if (rail === "audio") setAudioHeight(AUDIO_OPEN);
  }

  function toggleWorkspaceRail(rail: WorkspaceRail) {
    const isOpen =
      rail === "storyboard" ? !storyboardCollapsed :
      rail === "timeline" ? !timelineCollapsed :
      !audioCollapsed;
    if (isOpen) {
      if (rail === "storyboard") setStoryboardHeight(RAIL_CLOSED);
      if (rail === "timeline") setTimelineHeight(RAIL_CLOSED);
      if (rail === "audio") setAudioHeight(RAIL_CLOSED);
      return;
    }
    openWorkspaceRail(rail);
  }

  useEffect(() => {
    const heightBelowRail = (rail: WorkspaceRail) => {
      const index = railOrder.indexOf(rail);
      if (index < 0) return 0;
      return railOrder
        .slice(index + 1)
        .reduce((sum, current) => sum + railHeightMap[current], 0);
    };
    const moveRailToPointer = (rail: WorkspaceRail, clientY: number, rect: DOMRect) => {
      const totalRailHeight = railOrder.reduce((sum, current) => sum + railHeightMap[current], 0);
      const stackTop = rect.bottom - totalRailHeight;
      let cursor = stackTop;
      let targetIndex = railOrder.length - 1;

      for (let i = 0; i < railOrder.length; i++) {
        const current = railOrder[i];
        const center = cursor + railHeightMap[current] / 2;
        if (clientY < center) {
          targetIndex = i;
          break;
        }
        cursor += railHeightMap[current];
      }

      setRailOrder((currentOrder) => {
        const withoutRail = currentOrder.filter((current) => current !== rail);
        const insertAt = Math.max(0, Math.min(withoutRail.length, targetIndex));
        const nextOrder = [...withoutRail];
        nextOrder.splice(insertAt, 0, rail);
        return nextOrder.every((current, index) => current === currentOrder[index]) ? currentOrder : nextOrder;
      });
    };

    function onMove(e: MouseEvent) {
      if (!shellRef.current) return;
      const rect = shellRef.current.getBoundingClientRect();
      const SNAP_CLOSE = 28;
      if (storyboardDragRef.current) {
        const press = storyboardPressRef.current;
        if (press && Math.abs(e.clientY - press.startY) > 3) {
          storyboardSuppressClickRef.current = true;
          moveRailToPointer("storyboard", e.clientY, rect);
        }
        const raw = rect.bottom - e.clientY - heightBelowRail("storyboard");
        setStoryboardHeight(raw < SNAP_CLOSE ? RAIL_CLOSED : Math.max(RAIL_CLOSED, Math.min(STORYBOARD_OPEN, raw)));
      } else if (timelineDragRef.current) {
        const press = timelinePressRef.current;
        if (press && Math.abs(e.clientY - press.startY) > 3) {
          timelineSuppressClickRef.current = true;
          moveRailToPointer("timeline", e.clientY, rect);
        }
        const raw = rect.bottom - e.clientY - heightBelowRail("timeline");
        setTimelineHeight(raw < SNAP_CLOSE ? RAIL_CLOSED : Math.max(RAIL_CLOSED, Math.min(TIMELINE_OPEN, raw)));
      } else if (audioDragRef.current) {
        const press = audioPressRef.current;
        if (press && Math.abs(e.clientY - press.startY) > 3) {
          audioSuppressClickRef.current = true;
          moveRailToPointer("audio", e.clientY, rect);
        }
        const raw = rect.bottom - e.clientY - heightBelowRail("audio");
        setAudioHeight(raw < SNAP_CLOSE ? RAIL_CLOSED : Math.max(RAIL_CLOSED, Math.min(AUDIO_OPEN, raw)));
      }
    }
    function onUp() {
      if (storyboardDragRef.current) {
        storyboardDragRef.current = false;
        storyboardPressRef.current = null;
        setTimeout(() => { storyboardSuppressClickRef.current = false; }, 0);
      }
      if (timelineDragRef.current) {
        timelineDragRef.current = false;
        timelinePressRef.current = null;
        setTimeout(() => { timelineSuppressClickRef.current = false; }, 0);
      }
      if (audioDragRef.current) {
        audioDragRef.current = false;
        audioPressRef.current = null;
        setTimeout(() => { audioSuppressClickRef.current = false; }, 0);
      }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [railHeightMap, railOrder]);

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

  useEffect(() => {
    if (!previewAreaRef.current) return;
    const el = previewAreaRef.current;
    const update = () => setPreviewAreaSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [activeTab, chatWidth]);

  const previewWidth = Math.max(0, shellWidth - 48 - 4 - chatWidth);
  const previewCollapsed = shellWidth > 0 && previewWidth < 240;
  const recentAssets = recentAssetIds
    .map((id) => assets.find((asset) => asset.id === id))
    .filter((asset): asset is Asset => !!asset);
  const outputTakes = [
    ...recentAssets,
    ...assets.filter((asset) => !recentAssetIds.includes(asset.id)),
  ].slice(0, 6);
  const recentsVisible = outputTakes.length > 0;
  const recentsRailVisible = recentsVisible && previewAreaSize.w >= 760;
  const recentsStripVisible = recentsVisible && !recentsRailVisible;
  const recentsRailWidth = recentsRailVisible ? 80 : 0;
  const previewRatio = outputPreset.w / outputPreset.h;
  const previewMaxWidth = Math.max(260, Math.min(1152, previewAreaSize.w - 48 - recentsRailWidth));
  const previewMaxHeight = Math.max(220, previewAreaSize.h - 98);
  const previewFrame =
    previewMaxWidth / previewMaxHeight > previewRatio
      ? { width: previewMaxHeight * previewRatio, height: previewMaxHeight }
      : { width: previewMaxWidth, height: previewMaxWidth / previewRatio };
  const activePageLabel = activeTab === "workspace"
    ? "Workspace"
    : activeTab.charAt(0).toUpperCase() + activeTab.slice(1);
  const previewVideoDuration = showVideo ? "00:03" : "00:00";
  const renderSeed = previewAsset ? String(previewAsset.createdAt).slice(-5) : "-----";
  const outputStatus = hasPreviewOutput ? (showVideo ? "video ready" : "image ready") : "empty";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    return () => {
      typingTimersRef.current.forEach((timer) => clearInterval(timer));
      typingTimersRef.current = [];
    };
  }, []);

  function updateChat(id: number, updater: (c: Chat) => Chat) {
    setChats((cs) => cs.map((c) => (c.id === id ? updater(c) : c)));
  }

  function pushMessage(role: "user" | "ai", text: string, attachments?: Attachment[], options?: { typing?: "normal" | "deliberate"; cards?: InventoryCard[] }) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    const chatId = currentChatId;
    if (role === "ai" && text) {
      updateChat(chatId, (c) => ({
        ...c,
        updatedAt: Date.now(),
        messages: [...c.messages, { id, role, text: "", attachments, cards: options?.cards }],
      }));
      let cursor = 0;
      const deliberate = options?.typing === "deliberate";
      const step = deliberate ? (text.length > 260 ? 3 : 2) : Math.max(1, text.length > 220 ? 4 : text.length > 90 ? 3 : 2);
      const timer = setInterval(() => {
        cursor = Math.min(text.length, cursor + step);
        updateChat(chatId, (c) => ({
          ...c,
          updatedAt: Date.now(),
          messages: c.messages.map((m) => (m.id === id ? { ...m, text: text.slice(0, cursor) } : m)),
        }));
        if (cursor >= text.length) {
          clearInterval(timer);
          typingTimersRef.current = typingTimersRef.current.filter((t) => t !== timer);
        }
      }, deliberate ? 34 : 22);
      typingTimersRef.current.push(timer);
      return id;
    }
    updateChat(currentChatId, (c) => ({
      ...c,
      updatedAt: Date.now(),
      messages: [...c.messages, { id, role, text, attachments, cards: options?.cards }],
    }));
    return id;
  }

  // ----- asset helpers -----
  function addAsset(a: Omit<Asset, "id" | "createdAt">): Asset {
    const asset: Asset = { ...a, id: Date.now() + Math.floor(Math.random() * 1000), createdAt: Date.now() };
    setAssets((xs) => [asset, ...xs]);
    setRecentAssetIds((ids) => [asset.id, ...ids.filter((id) => id !== asset.id)].slice(0, 6));
    return asset;
  }
  function updateAssetDimensions(asset: Asset) {
    if (asset.width && asset.height) return;
    if (asset.kind === "image") {
      void loadImage(asset.url).then((img) => {
        setAssets((xs) => xs.map((a) => (
          a.id === asset.id
            ? { ...a, width: img.naturalWidth, height: img.naturalHeight, ratio: `${img.naturalWidth} / ${img.naturalHeight}`, sizeLabel: `${img.naturalWidth}×${img.naturalHeight}` }
            : a
        )));
      }).catch(() => {});
      return;
    }
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      setAssets((xs) => xs.map((a) => (
        a.id === asset.id && video.videoWidth && video.videoHeight
          ? { ...a, width: video.videoWidth, height: video.videoHeight, ratio: `${video.videoWidth} / ${video.videoHeight}`, sizeLabel: `${video.videoWidth}×${video.videoHeight}` }
          : a
      )));
    };
    video.src = asset.url;
  }
  function addShot(assetId: number, label: string) {
    setShots((xs) => [...xs, { id: Date.now() + Math.floor(Math.random() * 1000), assetId, label }]);
  }
  function selectPreviewAsset(a: Asset) {
    setPreviewAssetId(a.id);
    if (a.kind === "image") setPreviewImage(a.url);
    else setPreviewImage(null);
    setStrokes([]);
    setCurrentStroke(null);
    setSelection(null);
  }
  function cuePreviewRefine() {
    if (!hasPreviewOutput) return;
    setInput("Refine the current preview output. Keep the strongest parts, improve the weak parts, and preserve the same composition.");
    setActiveTab("workspace");
    setTimeout(() => composerRef.current?.focus(), 0);
  }
  function cueInventoryPrompt(prompt: string) {
    setInput(prompt);
    setPanelView("chat");
    setInventoryOpen(false);
    setActiveTab("workspace");
    setTimeout(() => composerRef.current?.focus(), 0);
  }
  function runInventoryAction(action: InventoryAction) {
    if (action.action === "open-assets") {
      setActiveTab("assets");
      return;
    }
    if (action.action === "prompt") {
      setInput(action.prompt);
      setActiveTab("workspace");
      setTimeout(() => composerRef.current?.focus(), 0);
      return;
    }
    if (action.action === "add-assets-to-storyboard") {
      const selected = action.assetIds
        .map((id) => assets.find((asset) => asset.id === id))
        .filter((asset): asset is Asset => !!asset);
      moveAssetsToStoryboard(selected);
    }
  }
  function clearPreview() {
    setPreviewAssetId(null);
    setPreviewImage(null);
    setStrokes([]);
    setCurrentStroke(null);
    setSelection(null);
  }
  function addAssetToStoryboard(a: Asset) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setShots((xs) => [...xs, { id, assetId: a.id, label: a.name }]);
    setSelectedShotId(id);
    clearPreview();
    setShotPickerOpen(false);
  }
  function toggleShotPickerAsset(id: number) {
    setShotPickerSelectedIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }
  function addSelectedAssetsToStoryboard() {
    const selected = shotPickerSelectedIds
      .map((id) => assets.find((a) => a.id === id))
      .filter((a): a is Asset => !!a);
    if (selected.length === 0) return;
    const nextShots = selected.map((a, i) => ({
      id: Date.now() + i + Math.floor(Math.random() * 1000),
      assetId: a.id,
      label: a.name,
    }));
    setShots((xs) => [...xs, ...nextShots]);
    setSelectedShotId(nextShots[0].id);
    clearPreview();
    setShotPickerSelectedIds([]);
    setShotPickerOpen(false);
  }
  function moveAssetsToStoryboard(selected: Asset[]) {
    if (selected.length === 0) return;
    const nextShots = selected.map((a, i) => ({
      id: Date.now() + i + Math.floor(Math.random() * 1000),
      assetId: a.id,
      label: a.name,
    }));
    setShots((xs) => [...xs, ...nextShots]);
    setSelectedShotId(nextShots[0].id);
    clearPreview();
    setActiveTab("workspace");
  }
  function deleteAssetById(id: number) {
    setAssets((xs) => xs.filter((a) => a.id !== id));
    setRecentAssetIds((ids) => ids.filter((assetId) => assetId !== id));
    setShots((xs) => xs.filter((s) => s.assetId !== id));
    if (previewAssetId === id) clearPreview();
  }
  function findAssetForDimensionCommand(text: string) {
    const t = text.toLowerCase();
    if (previewAsset?.kind === "image") return previewAsset;
    const imageAssets = assets.filter((a) => a.kind === "image");
    if (/\bportrait|vertical|9\s*:\s*16\b/.test(t)) {
      const portrait = imageAssets.find((a) => (a.width ?? 16) < (a.height ?? 9));
      if (portrait) return portrait;
    }
    if (/\blandscape|horizontal|16\s*:\s*9\b/.test(t)) {
      const landscape = imageAssets.find((a) => (a.width ?? 16) > (a.height ?? 9));
      if (landscape) return landscape;
    }
    return imageAssets.length === 1 ? imageAssets[0] : null;
  }
  async function convertAssetToPreset(asset: Asset, preset: Preset) {
    const seed = asset.styleSeed ?? asset.name.replace(/\.[^.]+$/, "");
    const url = makeMockImage(seed, preset.w, preset.h);
    const next: Asset = {
      ...asset,
      url,
      width: preset.w,
      height: preset.h,
      ratio: preset.ratio,
      sizeLabel: preset.label,
      styleSeed: seed,
    };
    setAssets((xs) => xs.map((a) => (a.id === asset.id ? next : a)));
    setPreviewAssetId(next.id);
    setPreviewImage(next.url);
    setStrokes([]);
    setCurrentStroke(null);
    setSelection(null);
    return next;
  }
  async function handleWorkspaceCommand(text: string, activePreset: Preset, requestedPresetIdx: number | null) {
    const t = text.toLowerCase();
    if (/\b(capabilities|what can you do|what are you able|list.*can do|workplace.*do)\b/.test(t)) {
      setThinkingLabel("Checking workspace");
      await wait(550);
      pushMessage("ai", [
        `Reel Studio is set up around the Assets -> Storyboard -> Preview flow.`,
        "",
        "**Right now, I can:**",
        `- Track this project: ${projectName}`,
        `- Read the current workspace state: ${assets.length} asset${assets.length === 1 ? "" : "s"}, ${shots.length} storyboard shot${shots.length === 1 ? "" : "s"}, preview is ${showVideo ? "showing a video output" : visibleImage ? "showing an image output" : "empty"}`,
        "- Help plan scenes, shots, trailers, anime sequences, and cinematic prompts",
        "- Create mock storyboard/keyframe/video placeholders for planning",
        "- Clear the preview/output or clear the storyboard when you ask",
        "- Delete the current preview asset, or the only asset if there is just one",
        "- Explain how Assets, Storyboard, Preview, drawing tools, and Chat work together",
        "",
        "**Planned next:**",
        "- Find assets by name from chat",
        "- Add named assets to the storyboard without clicking",
        "- Reorder shots from chat",
        "- Send storyboard context into real image/video APIs",
      ].join("\n"), undefined, { typing: "deliberate" });
      return true;
    }
    const wantsClear = /\b(clear|remove|delete|empty|reset)\b/.test(t);
    const wantsDimensionChange = requestedPresetIdx !== null && /\b(same|exact|resize|dimension|dimensions|convert|change|make it|regenerate|reframe)\b/.test(t) && /\b(asset|image|picture|output|preview)\b/.test(t);
    if (wantsDimensionChange) {
      setThinkingLabel("Regenerating asset");
      await wait(450);
      const source = findAssetForDimensionCommand(t);
      if (!source) {
        pushMessage("ai", "Open the asset in preview first, or leave only one image asset in Assets, and I can reframe it to that size.", undefined, { typing: "deliberate" });
        return true;
      }
      const next = await convertAssetToPreset(source, activePreset);
      pushMessage("ai", `Regenerated ${next.name} in ${activePreset.label} while keeping the same style seed.`, undefined, { typing: "deliberate" });
      return true;
    }
    if (/\b(delete|remove|trash)\b/.test(t) && /\b(asset|image|picture|media|output)\b/.test(t)) {
      setThinkingLabel("Updating assets");
      await wait(350);
      const target = previewAsset ?? (assets.length === 1 ? assets[0] : null);
      if (!target) {
        pushMessage("ai", "I need a specific asset selected or opened in preview before I delete one.", undefined, { typing: "deliberate" });
        return true;
      }
      deleteAssetById(target.id);
      pushMessage("ai", `Deleted ${target.name} from Assets${shots.some((s) => s.assetId === target.id) ? " and removed it from the storyboard" : ""}.`, undefined, { typing: "deliberate" });
      return true;
    }
    if (wantsClear && /\bpreview|output|canvas|stage\b/.test(t)) {
      setThinkingLabel("Updating preview");
      await wait(350);
      clearPreview();
      pushMessage("ai", "Cleared the preview.", undefined, { typing: "deliberate" });
      return true;
    }
    if (wantsClear && /\bstoryboard|story\s*board|shots?\b/.test(t)) {
      setThinkingLabel("Updating storyboard");
      await wait(350);
      setShots([]);
      setSelectedShotId(null);
      pushMessage("ai", "Cleared the storyboard.", undefined, { typing: "deliberate" });
      return true;
    }
    return false;
  }
  function removeShot(id: number) {
    setShots((xs) => {
      const next = xs.filter((s) => s.id !== id);
      if (selectedShotId === id) setSelectedShotId(next[0]?.id ?? null);
      return next;
    });
  }
  function moveShot(sourceId: number, targetId: number) {
    if (sourceId === targetId) return;
    setShots((xs) => {
      const from = xs.findIndex((s) => s.id === sourceId);
      const to = xs.findIndex((s) => s.id === targetId);
      if (from < 0 || to < 0) return xs;
      const next = [...xs];
      const [shot] = next.splice(from, 1);
      next.splice(to, 0, shot);
      return next;
    });
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
      width: outputPreset.w,
      height: outputPreset.h,
      ratio: outputPreset.ratio,
      sizeLabel: outputPreset.label,
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
      updateAssetDimensions(addAsset({ name: f.name, kind: isVideo ? "video" : "image", url }));
    }
    e.target.value = "";
  }

  async function runMockWorkspaceAction(text: string, preset: Preset = selectedPreset, requestedPresetIdxs: number[] = []) {
    const intent = detectMockIntent(text, requestedPresetIdxs.length);
    if (!intent) return false;

    setThinkingLabel("Reading the request");
    await wait(450);
    setThinkingLabel("Planning the shot structure");
    await wait(650);

    if (intent.kind === "video") {
      setThinkingLabel("Rendering a motion preview");
      await wait(700);
      const video = await makeMockVideo(text);
      const asset = addAsset({ name: "mock-video.webm", kind: "video", url: video.url, poster: video.poster, width: 1280, height: 720, ratio: "16 / 9", sizeLabel: "Landscape · 1280×720" });
      selectPreviewAsset(asset);
      pushMessage("ai", "", undefined, {
        cards: [{
          id: `inventory-video-${asset.id}`,
          kind: "asset-batch",
          title: "Video output created",
          subtitle: "Saved to Assets and opened in Preview.",
          stats: [
            { label: "Type", value: "Video" },
            { label: "Size", value: asset.sizeLabel ?? "Landscape" },
          ],
          actions: [
            { label: "Open Assets", action: "open-assets" },
            { label: "Refine", action: "prompt", prompt: "Refine the current video output. Keep the strongest parts and improve the weak parts." },
          ],
        }],
      });
      return true;
    }

    const created: Asset[] = [];
    const presetSequence = buildRequestedPresetSequence(intent.count, requestedPresetIdxs, preset);
    for (let i = 0; i < intent.count; i++) {
      setThinkingLabel(`Creating asset ${i + 1} of ${intent.count}`);
      await wait(350);
      const assetPreset = presetSequence[i];
      const url = makeMockImage(`${text}${intent.count > 1 ? ` - ${i + 1}` : ""}`, assetPreset.w, assetPreset.h);
      created.push(addAsset({
        name: intent.kind === "storyboard" ? `storyboard-shot-${i + 1}.png` : `mock-keyframe-${i + 1}.png`,
        kind: "image",
        url,
        width: assetPreset.w,
        height: assetPreset.h,
        ratio: assetPreset.ratio,
        sizeLabel: assetPreset.label,
        styleSeed: `${text}${intent.count > 1 ? ` - ${i + 1}` : ""}`,
      }));
    }

    if (intent.kind === "storyboard") {
      const nextShots = created.map((asset, i) => ({
        id: Date.now() + i + Math.floor(Math.random() * 1000),
        assetId: asset.id,
        label: `Shot ${i + 1}`,
      }));
      setShots(nextShots);
      setSelectedShotId(nextShots[0]?.id ?? null);
      clearPreview();
      const uniqueSizes = Array.from(new Set(created.map((asset) => asset.sizeLabel ?? "asset")));
      pushMessage("ai", "", undefined, {
        cards: [{
          id: `inventory-storyboard-${Date.now()}`,
          kind: "storyboard-batch",
          title: `${created.length} storyboard shot${created.length === 1 ? "" : "s"} created`,
          subtitle: "Added to the storyboard input rail and saved to Assets.",
          stats: [
            { label: "Shots", value: String(created.length) },
            { label: "Sizing", value: uniqueSizes.length === 1 ? uniqueSizes[0] : `${uniqueSizes.length} sizes` },
            { label: "Destination", value: "Storyboard" },
            { label: "Inventory", value: "Assets" },
          ],
          actions: [
            { label: "Open Assets", action: "open-assets" },
            { label: "Refine Prompt", action: "prompt", prompt: "Refine this storyboard batch with stronger cinematic composition and more consistent style." },
          ],
        }],
      });
    } else {
      if (created[0]) selectPreviewAsset(created[0]);
      const uniqueSizes = Array.from(new Set(created.map((asset) => asset.sizeLabel ?? "asset")));
      pushMessage("ai", "", undefined, {
        cards: [{
          id: `inventory-assets-${Date.now()}`,
          kind: "asset-batch",
          title: `${created.length} asset${created.length === 1 ? "" : "s"} created`,
          subtitle: "Saved to Assets and added to Recents for quick preview switching.",
          stats: [
            { label: "Assets", value: String(created.length) },
            { label: "Sizing", value: uniqueSizes.length === 1 ? uniqueSizes[0] : `${uniqueSizes.length} sizes` },
            { label: "Preview", value: created[0]?.name ?? "Latest asset" },
            { label: "Inventory", value: "Assets + Recents" },
          ],
          actions: [
            { label: "Open Assets", action: "open-assets" },
            { label: "Add to Storyboard", action: "add-assets-to-storyboard", assetIds: created.map((asset) => asset.id) },
            { label: "Refine Prompt", action: "prompt", prompt: "Refine these generated assets with stronger style consistency and better cinematic composition." },
          ],
        }],
      });
    }
    return true;
  }

  async function send() {
    const t = input.trim();
    const hasCanvasMark = (strokes.length > 0 || !!selection) && !!visibleImage && !showVideo;
    if ((!t && pendingAttachments.length === 0 && !hasCanvasMark) || isThinking) return;

    const requestedPresetIdxs = detectRequestedPresets(t);
    const requestedPresetIdx = requestedPresetIdxs.length ? requestedPresetIdxs[requestedPresetIdxs.length - 1] : null;
    const activePreset = requestedPresetIdx !== null ? SIZE_PRESETS[requestedPresetIdx] : selectedPreset;
    if (requestedPresetIdx !== null && requestedPresetIdx !== sizeIdx) setSizeIdx(requestedPresetIdx);

    const activeSelections = selection ? [selection] : [];
    const hasMarkedRegion = hasCanvasMark;
    const userAtts: Attachment[] = [...pendingAttachments];
    let maskDataUrl: string | null = null;

    if (hasMarkedRegion && visibleImage && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect();
      try {
        const img = await loadImage(visibleImage);
        maskDataUrl = buildMaskDataUrl(
          strokes, rect.width, rect.height, img.naturalWidth, img.naturalHeight, settings.brushSize, activeSelections,
        );
      } catch (e) {
        console.error("mask snapshot failed", e);
      }
    }

    pushMessage("user", t, userAtts.length ? userAtts : undefined);
    setInput("");
    setPendingAttachments([]);
    setIsThinking(true);
    setThinkingLabel("Thinking");

    try {
      const handledCommand = await handleWorkspaceCommand(t, activePreset, requestedPresetIdx);
      if (handledCommand) return;

      const handledMock = await runMockWorkspaceAction(t, activePreset, requestedPresetIdxs);
      if (handledMock) return;

      const history = [...messages, { role: "user" as const, text: t }].map((m) => ({
        role: (m.role === "ai" ? "assistant" : "user") as "assistant" | "user",
        content: m.text || "(no text)",
      }));

      const routeRes = await fetch("/api/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history,
          hasImage: !!visibleImage,
          hasMask: hasMarkedRegion,
          mode,
          workspace: {
            projectName,
            activeTab,
            assetCount: assets.length,
            shotCount: shots.length,
            previewState: showVideo ? "video" : visibleImage ? "image" : "empty",
            requestedSize: activePreset.label,
            selectedShotLabel: shots.find((s) => s.id === selectedShotId)?.label ?? null,
            assetNames: assets.slice(0, 24).map((a) => a.name),
            storyboardLabels: shots.slice(0, 24).map((s) => s.label),
          },
        }),
      });
      const decision = await routeRes.json();
      if (!routeRes.ok) {
        pushMessage("ai", `Setup issue: ${cleanApiError(decision.error, "Orchestrator failed")}`);
        return;
      }

      if (mode === "video" || decision.action === "chat") {
        pushMessage("ai", decision.reply || "…");
        return;
      }

      if (decision.reply) pushMessage("ai", decision.reply);

      const isEdit = !!decision.isEdit && !!visibleImage && hasMarkedRegion;
      const imgPrompt = `${decision.prompt || t}\n\nOutput format: ${activePreset.label}. Compose for ${activePreset.w}x${activePreset.h} (${activePreset.ratio}) and fill the frame edge to edge without letterboxing or empty borders.`;

      const r = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: imgPrompt,
          size: { width: activePreset.w, height: activePreset.h, ratio: activePreset.ratio, label: activePreset.label },
          mode: isEdit ? "edit" : "generate",
          imageBase64: isEdit && visibleImage ? dataUrlToBase64(visibleImage) : undefined,
          maskBase64: isEdit && maskDataUrl ? dataUrlToBase64(maskDataUrl) : undefined,
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.dataUrl) {
        const detail = data.text ? ` Model said: "${data.text.trim()}"` : "";
        pushMessage("ai", `Image request failed: ${cleanApiError(data.error, "Image generation failed")}${detail}\n\nTip: image models often refuse copyrighted characters. Try a descriptive prompt instead.`);
        return;
      }

      let finalDataUrl: string = data.dataUrl;
      if (isEdit && visibleImage && maskDataUrl) {
        try { finalDataUrl = await compositeWithMask(visibleImage, data.dataUrl, maskDataUrl); }
        catch (e) { console.error("composite failed, using raw edit", e); }
      }

      const a = addAsset({
        name: isEdit ? "edited.png" : "generated.png",
        kind: "image",
        url: finalDataUrl,
        width: activePreset.w,
        height: activePreset.h,
        ratio: activePreset.ratio,
        sizeLabel: activePreset.label,
        styleSeed: decision.prompt || t,
      });
      setPreviewImage(finalDataUrl);
      setPreviewAssetId(a.id);
      setStrokes([]);
      setCurrentStroke(null);
      pushMessage("ai", isEdit ? "Edited the highlighted region." : "Done.", [
        { id: Date.now(), name: a.name, type: "image/png", url: finalDataUrl },
      ]);
    } catch (e) {
      console.error(e);
      pushMessage("ai", `Request failed: ${cleanApiError(e instanceof Error ? e.message : "", "Request failed")}`);
    } finally {
      setIsThinking(false);
      setThinkingLabel("Thinking");
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
    const next: Attachment[] = Array.from(files).map((f, i) => {
      const url = f.type.startsWith("image/") || f.type.startsWith("video/") ? URL.createObjectURL(f) : undefined;
      if (url && (f.type.startsWith("image/") || f.type.startsWith("video/"))) {
        updateAssetDimensions(addAsset({ name: f.name, kind: f.type.startsWith("video/") ? "video" : "image", url }));
      }
      return {
        id: Date.now() + i,
        name: f.name,
        type: f.type,
        url: f.type.startsWith("image/") ? url : undefined,
      };
    });
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
  const hasDraftMarkedRegion = !!visibleImage && !showVideo && (strokes.length > 0 || !!selection);
  const markedRegionLabel = strokes.length > 0 && selection
    ? "Editing marked region - highlight and brush mask active."
    : selection
      ? "Editing highlighted region - your next message edits inside the box."
      : "Editing brushed region - your next message edits only the painted area.";

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Top bar */}
      <header className="h-10 flex items-center justify-between px-3 border-b border-border bg-panel text-sm">
        <div className="flex items-center gap-3">
          <button className="text-muted-foreground hover:text-foreground transition-colors">{activePageLabel}</button>
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
          <button
            onClick={() => assetUploadRef.current?.click()}
            className="px-2.5 py-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground flex items-center gap-1.5"
          >
            <Upload className="h-3.5 w-3.5" /> Import
          </button>
          <button className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 flex items-center gap-1.5 font-medium">
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </div>
      </header>

      <div ref={shellRef} className="relative flex-1 flex min-h-0">
        {/* Left icon rail (Tutorials removed) */}
        <aside className="relative z-30 w-12 bg-rail border-r border-border flex flex-col items-center py-2 gap-1 overflow-visible">
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
          {activeTab === "workspace" && (
            <>
              <button
                onMouseDown={(e) => {
                  storyboardDragRef.current = true;
                  storyboardPressRef.current = { startY: e.clientY };
                  document.body.style.cursor = "row-resize";
                  document.body.style.userSelect = "none";
                }}
                onClick={() => {
                  if (storyboardSuppressClickRef.current) return;
                  toggleWorkspaceRail("storyboard");
                }}
                className="absolute left-1 flex h-5 w-9 items-center justify-center rounded-[3px] border border-white/10 bg-background/80 text-[5.5px] font-medium lowercase leading-none tracking-[0.01em] text-foreground/55 shadow-[0_7px_18px_rgba(0,0,0,0.28)] ring-1 ring-white/5 backdrop-blur transition-colors hover:border-primary/45 hover:text-foreground/90 hover:shadow-[0_0_16px_rgba(255,255,255,0.10)]"
                style={{ bottom: storyboardRailTabBottom }}
                title={storyboardCollapsed ? "Open storyboard" : "Drag to resize storyboard"}
              >
                storyboard
              </button>
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute left-[39px] h-3 w-2.5 overflow-visible text-primary/45"
                style={{ bottom: storyboardRailConnectorBottom }}
                viewBox="0 0 10 12"
              >
                <path
                  d="M 0 6 L 4 6 L 6 9 L 10 9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1"
                  strokeLinecap="square"
                  strokeLinejoin="miter"
                />
                <path
                  d="M 0 6 L 4 6 L 6 9 L 10 9"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.4"
                  strokeLinecap="square"
                  strokeLinejoin="miter"
                  className="text-foreground/35"
                />
              </svg>
              <button
                onMouseDown={(e) => {
                  timelineDragRef.current = true;
                  timelinePressRef.current = { startY: e.clientY };
                  document.body.style.cursor = "row-resize";
                  document.body.style.userSelect = "none";
                }}
                onClick={() => {
                  if (timelineSuppressClickRef.current) return;
                  toggleWorkspaceRail("timeline");
                }}
                className="absolute left-1 flex h-5 w-9 items-center justify-center rounded-[3px] border border-white/10 bg-background/80 text-[5.5px] font-medium lowercase leading-none tracking-[0.01em] text-emerald-200/60 shadow-[0_7px_18px_rgba(0,0,0,0.28)] ring-1 ring-white/5 backdrop-blur transition-colors hover:border-emerald-300/45 hover:text-emerald-100 hover:shadow-[0_0_16px_rgba(110,231,183,0.12)]"
                style={{ bottom: timelineRailTabBottom }}
                title={timelineCollapsed ? "Open timeline" : "Drag to resize timeline"}
              >
                timeline
              </button>
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute left-[39px] h-3 w-2.5 overflow-visible text-emerald-300/45"
                style={{ bottom: timelineRailConnectorBottom }}
                viewBox="0 0 10 12"
              >
                <path d="M 0 6 L 4 6 L 6 9 L 10 9" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="square" strokeLinejoin="miter" />
                <path d="M 0 6 L 4 6 L 6 9 L 10 9" fill="none" stroke="currentColor" strokeWidth="0.4" strokeLinecap="square" strokeLinejoin="miter" className="text-foreground/35" />
              </svg>
              <button
                onMouseDown={(e) => {
                  audioDragRef.current = true;
                  audioPressRef.current = { startY: e.clientY };
                  document.body.style.cursor = "row-resize";
                  document.body.style.userSelect = "none";
                }}
                onClick={() => {
                  if (audioSuppressClickRef.current) return;
                  toggleWorkspaceRail("audio");
                }}
                className="absolute left-1 flex h-5 w-9 items-center justify-center rounded-[3px] border border-white/10 bg-background/80 text-[5.5px] font-medium lowercase leading-none tracking-[0.01em] text-amber-200/60 shadow-[0_7px_18px_rgba(0,0,0,0.28)] ring-1 ring-white/5 backdrop-blur transition-colors hover:border-amber-300/45 hover:text-amber-100 hover:shadow-[0_0_16px_rgba(252,211,77,0.12)]"
                style={{ bottom: audioRailTabBottom }}
                title={audioCollapsed ? "Open audio" : "Drag to resize audio"}
              >
                audio
              </button>
              <svg
                aria-hidden="true"
                className="pointer-events-none absolute left-[39px] h-3 w-2.5 overflow-visible text-amber-300/45"
                style={{ bottom: audioRailConnectorBottom }}
                viewBox="0 0 10 12"
              >
                <path d="M 0 6 L 4 6 L 6 9 L 10 9" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="square" strokeLinejoin="miter" />
                <path d="M 0 6 L 4 6 L 6 9 L 10 9" fill="none" stroke="currentColor" strokeWidth="0.4" strokeLinecap="square" strokeLinejoin="miter" className="text-foreground/35" />
              </svg>
            </>
          )}
        </aside>

        {/* Workspace / panels */}
        <main className="flex-1 flex flex-col min-w-0 bg-canvas overflow-hidden">
          {activeTab === "workspace" ? (
            <>
              <div ref={previewAreaRef} className="relative flex-1 flex flex-col items-center justify-center p-6 pb-4 min-h-0 gap-3">
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

                <div className="flex max-w-full items-center justify-center gap-3">
                <div
                  ref={canvasRef}
                  onMouseDown={onCanvasDown}
                  onMouseMove={onCanvasMove}
                  onMouseUp={onCanvasUp}
                  onMouseLeave={onCanvasUp}
                  onDoubleClick={() => { setStrokes([]); setCurrentStroke(null); }}
                  style={{ width: previewFrame.width, height: previewFrame.height }}
                  className={`relative rounded-lg overflow-hidden border border-border shadow-2xl bg-black select-none ring-1 ring-white/5 ${cursorClass}`}
                >
                  {showVideo && previewAsset ? (
                    <video
                      ref={videoRef}
                      src={previewAsset.url}
                      poster={previewAsset.poster}
                      onPlay={() => setIsPreviewPlaying(true)}
                      onPause={() => setIsPreviewPlaying(false)}
                      onEnded={() => setIsPreviewPlaying(false)}
                      className="absolute inset-0 h-full w-full object-cover pointer-events-none select-none bg-black"
                    />
                  ) : visibleImage ? (
                    <img
                      src={visibleImage}
                      alt="Preview"
                      draggable={false}
                      className="absolute inset-0 h-full w-full object-cover pointer-events-none select-none bg-black"
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
                        <g key={i} filter="url(#brushGlow)">
                          <polyline
                            points={s.map((p) => `${p.x},${p.y}`).join(" ")}
                            fill="none"
                            stroke={settings.brushColor}
                            strokeOpacity={0.55}
                            strokeWidth={settings.brushSize}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          {s[0] && (
                            <circle
                              cx={s[0].x}
                              cy={s[0].y}
                              r={settings.brushSize / 2}
                              fill={settings.brushColor}
                              fillOpacity={0.55}
                            />
                          )}
                        </g>
                      ))}
                      {currentStroke && currentStroke.length > 0 && (
                        <g filter="url(#brushGlow)">
                          <polyline
                            points={currentStroke.map((p) => `${p.x},${p.y}`).join(" ")}
                            fill="none"
                            stroke={settings.brushColor}
                            strokeOpacity={0.55}
                            strokeWidth={settings.brushSize}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          {currentStroke[0] && (
                            <circle
                              cx={currentStroke[0].x}
                              cy={currentStroke[0].y}
                              r={settings.brushSize / 2}
                              fill={settings.brushColor}
                              fillOpacity={0.55}
                            />
                          )}
                        </g>
                      )}
                    </svg>
                  )}
                </div>

                {recentsRailVisible && (
                  <div className="flex max-h-[min(420px,calc(100vh-18rem))] w-16 shrink-0 flex-col gap-1.5 overflow-hidden rounded-lg border border-white/10 bg-panel/85 p-1.5 shadow-lg backdrop-blur">
                    <div className="px-1 text-[8.5px] uppercase tracking-[0.08em] text-muted-foreground/70">recents</div>
                    <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto pr-0.5">
                      {outputTakes.map((take, index) => {
                        const active = previewAssetId === take.id;
                        return (
                          <button
                            key={take.id}
                            onClick={() => selectPreviewAsset(take)}
                            className={`group relative h-10 overflow-hidden rounded-md border bg-black transition-colors ${
                              active ? "border-primary ring-2 ring-primary/25" : "border-white/10 hover:border-white/35"
                            }`}
                            title={`Recent ${index + 1}: ${take.name}`}
                          >
                            <img
                              src={take.kind === "video" ? (take.poster ?? "") : take.url}
                              alt=""
                              className="absolute inset-0 h-full w-full object-cover opacity-85 transition-opacity group-hover:opacity-100"
                            />
                            {take.kind === "video" && (
                              <div className="absolute inset-0 grid place-items-center bg-black/20">
                                <Play className="h-3 w-3 text-white drop-shadow" />
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 rounded-tr bg-black/70 px-1 py-0.5 text-[8px] leading-none text-white/75">
                              {index + 1}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                </div>

                {recentsStripVisible && (
                  <div className="flex h-14 max-w-full items-center gap-1.5 overflow-hidden rounded-lg border border-white/10 bg-panel/85 p-1.5 shadow-lg backdrop-blur">
                    <div className="shrink-0 px-1 text-[8.5px] uppercase tracking-[0.08em] text-muted-foreground/70">recents</div>
                    <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
                      {outputTakes.map((take, index) => {
                        const active = previewAssetId === take.id;
                        return (
                          <button
                            key={take.id}
                            onClick={() => selectPreviewAsset(take)}
                            className={`group relative h-10 w-14 shrink-0 overflow-hidden rounded-md border bg-black transition-colors ${
                              active ? "border-primary ring-2 ring-primary/25" : "border-white/10 hover:border-white/35"
                            }`}
                            title={`Recent ${index + 1}: ${take.name}`}
                          >
                            <img
                              src={take.kind === "video" ? (take.poster ?? "") : take.url}
                              alt=""
                              className="absolute inset-0 h-full w-full object-cover opacity-85 transition-opacity group-hover:opacity-100"
                            />
                            {take.kind === "video" && (
                              <div className="absolute inset-0 grid place-items-center bg-black/20">
                                <Play className="h-3 w-3 text-white drop-shadow" />
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 rounded-tr bg-black/70 px-1 py-0.5 text-[8px] leading-none text-white/75">
                              {index + 1}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="relative flex h-10 max-w-full items-center gap-2 rounded-lg border border-border bg-panel/80 px-2 shadow-lg backdrop-blur" ref={sizeMenuRef}>
                  <button
                    onClick={togglePreviewPlayback}
                    disabled={!showVideo}
                    title={showVideo ? (isPreviewPlaying ? "Pause preview" : "Play preview") : "Play is available when preview contains video"}
                    className="h-8 w-8 grid place-items-center rounded-md bg-accent text-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:bg-accent/80"
                  >
                    {isPreviewPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                  <div className="h-5 w-px bg-border" />
                  <button
                    onClick={() => {
                      setMenu(menu === "size" ? null : "size");
                    }}
                    className="h-8 min-w-[176px] justify-between rounded-md px-2 text-xs text-foreground hover:bg-accent flex items-center gap-2"
                    title={hasPreviewOutput ? "Inspect dimensions. Current output keeps its generated size until you ask to regenerate it." : "Preview dimensions"}
                  >
                    <span className="truncate">{outputPreset.label}</span>
                    <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${menu === "size" ? "rotate-180" : ""}`} />
                  </button>
                  {menu === "size" && (
                    <div className="absolute bottom-full left-10 mb-2 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-xl z-40">
                      {SIZE_PRESETS.map((preset, idx) => (
                        <button
                          key={preset.label}
                          onClick={() => { setSizeIdx(idx); setMenu(null); }}
                          title={hasPreviewOutput ? "This sets the target size for the next generation. It will not resize the current output." : undefined}
                          className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs hover:bg-accent ${
                            idx === sizeIdx ? "bg-accent/70 text-foreground" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          <span>{preset.label}</span>
                          <span className="text-[10px] text-muted-foreground">{preset.w}x{preset.h}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="hidden h-5 w-px bg-border sm:block" />
                  <div className="hidden h-7 items-center gap-1.5 rounded-md border border-white/10 bg-black/25 px-2 text-[11px] text-muted-foreground sm:flex">
                    <span className={`h-1.5 w-1.5 rounded-full ${hasPreviewOutput ? "bg-emerald-300" : "bg-muted-foreground/35"}`} />
                    <span className="whitespace-nowrap">{outputStatus}</span>
                  </div>
                  <div className="hidden h-7 overflow-hidden rounded-md border border-white/10 bg-black/20 p-0.5 md:flex">
                    {(["draft", "final"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setRenderMode(mode)}
                        className={`h-6 rounded px-2 text-[11px] capitalize transition-colors ${
                          renderMode === mode ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                  {showVideo && (
                  <div className="hidden h-7 items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-2 text-[11px] text-muted-foreground lg:flex">
                    <Target className="h-3 w-3 text-foreground/60" />
                    <span>{previewVideoDuration}</span>
                  </div>
                  )}
                  <div className="hidden h-7 items-center rounded-md border border-white/10 bg-black/20 px-2 text-[11px] text-muted-foreground lg:flex">
                    seed {renderSeed}
                  </div>
                  <button
                    onClick={cuePreviewRefine}
                    disabled={!hasPreviewOutput}
                    className="grid h-7 w-7 place-items-center rounded-md border border-white/10 bg-black/20 text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                    title="Refine output"
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                </>
                )}
              </div>

              {/* Storyboard strip */}
              <div
                className="relative shrink-0 border-t border-border bg-panel/60 flex flex-col"
                style={{ height: storyboardHeight, order: railOrder.indexOf("storyboard") + 1 }}
              >
                <button
                  onMouseDown={(e) => {
                    storyboardDragRef.current = true;
                    storyboardPressRef.current = { startY: e.clientY };
                    document.body.style.cursor = "row-resize";
                    document.body.style.userSelect = "none";
                  }}
                  onClick={() => {
                    if (storyboardSuppressClickRef.current) return;
                    toggleWorkspaceRail("storyboard");
                  }}
                  className="h-1 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-primary/60"
                  title={storyboardCollapsed ? "Open storyboard" : "Resize storyboard"}
                />
                {!storyboardCollapsed && (
                <div className="flex min-h-0 flex-1 items-stretch">
                <div className="relative shrink-0 flex w-28 flex-col items-center justify-center gap-1.5 px-3" ref={shotPickerRef}>
                  <button
                    onClick={() => setShotPickerOpen((v) => !v)}
                    className={`h-14 w-16 rounded-md border border-dashed grid place-items-center transition-colors ${
                      shotPickerOpen ? "border-primary text-foreground bg-accent/40" : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40"
                    }`}
                    title="Add reference asset"
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
                                onClick={() => toggleShotPickerAsset(a.id)}
                                style={{ aspectRatio: a.ratio ?? "16 / 9" }}
                                className={`relative rounded-md overflow-hidden border bg-black ${
                                  shotPickerSelectedIds.includes(a.id) ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-primary/60"
                                }`}
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
                                <div className={`absolute left-1.5 top-1.5 h-4 w-4 rounded border grid place-items-center text-[10px] ${
                                  shotPickerSelectedIds.includes(a.id) ? "border-primary bg-primary text-primary-foreground" : "border-white/50 bg-black/40 text-white/70"
                                }`}>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="px-3 py-2 border-t border-border flex items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          {shotPickerSelectedIds.length} selected
                        </span>
                        <button
                          onClick={() => {
                            setShotPickerSelectedIds([]);
                            setShotPickerOpen(false);
                          }}
                          className="h-7 px-2.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={addSelectedAssetsToStoryboard}
                          disabled={shotPickerSelectedIds.length === 0}
                          className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-40"
                        >
                          Add
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
                      const active = selectedShotId === s.id || previewAssetId === a.id;
                      return (
                        <div
                          key={s.id}
                          draggable
                          onDragStart={() => setDragShotId(s.id)}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => {
                            if (dragShotId) moveShot(dragShotId, s.id);
                            setDragShotId(null);
                          }}
                          style={{ width: Math.max(46, Math.min(188, 80 * ((a.width ?? 16) / (a.height ?? 9)))), aspectRatio: a.ratio ?? "16 / 9" }}
                          className={`group relative h-20 rounded-md overflow-hidden border shrink-0 bg-black ${
                            active ? "border-primary ring-2 ring-primary/40" : "border-border"
                          }`}
                          title={s.label}
                          onDragEnd={() => setDragShotId(null)}
                        >
                          <button
                            draggable={false}
                            onClick={() => {
                              setSelectedShotId(s.id);
                            }}
                            className="absolute inset-0 h-full w-full"
                            title={`Select ${s.label}`}
                          >
                            <img
                              draggable={false}
                              src={a.kind === "video" ? (a.poster ?? "") : a.url}
                              alt={s.label}
                              className="absolute inset-0 w-full h-full object-cover bg-black"
                            />
                            {a.kind === "video" && (
                              <div className="absolute inset-0 grid place-items-center bg-black/25">
                                <Play className="h-4 w-4 text-white drop-shadow" />
                              </div>
                            )}
                          </button>
                          <div className="absolute bottom-0 inset-x-0 px-1.5 py-0.5 text-[10px] text-white bg-gradient-to-t from-black/80 to-transparent">
                            #{i + 1}
                          </div>
                          <button
                            onClick={() => removeShot(s.id)}
                            className="absolute right-1 top-1 h-5 w-5 grid place-items-center rounded bg-black/55 text-white/80 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
                            title="Remove shot"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                </div>
                )}
              </div>

              {/* Timeline rail */}
              <div
                className="relative shrink-0 border-t border-border bg-panel/50 flex flex-col"
                style={{ height: timelineHeight, order: railOrder.indexOf("timeline") + 1 }}
              >
                <button
                  onMouseDown={(e) => {
                    timelineDragRef.current = true;
                    timelinePressRef.current = { startY: e.clientY };
                    document.body.style.cursor = "row-resize";
                    document.body.style.userSelect = "none";
                  }}
                  onClick={() => {
                    if (timelineSuppressClickRef.current) return;
                    toggleWorkspaceRail("timeline");
                  }}
                  className="h-1 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-emerald-400/60"
                  title={timelineCollapsed ? "Open timeline" : "Resize timeline"}
                />
                {!timelineCollapsed && (
                  <div className="flex min-h-0 flex-1 items-center gap-2.5 px-3">
                    <div className="flex h-10 w-24 shrink-0 items-center gap-2 rounded-md border border-white/10 bg-black/25 px-2 text-[11px] text-muted-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <Film className="h-3.5 w-3.5 text-foreground/70" />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-foreground/80">Video</div>
                        <div className="truncate">{previewVideoDuration}</div>
                      </div>
                    </div>
                    <div className="relative h-12 min-w-0 flex-1 overflow-hidden rounded-md border border-white/10 bg-[#08090b]/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <div className="absolute inset-x-0 top-0 flex h-3 items-start justify-between border-b border-white/5 px-2">
                        {Array.from({ length: 9 }).map((_, i) => (
                          <span key={`video-tick-${i}`} className="h-1.5 w-px bg-white/12" />
                        ))}
                      </div>
                      <div className="absolute inset-x-2 bottom-1.5 top-4 rounded bg-background/35">
                        {showVideo && previewAsset ? (
                          <button
                            onClick={togglePreviewPlayback}
                            className="absolute inset-y-0 left-0 flex w-[54%] min-w-[150px] items-center overflow-hidden rounded border border-emerald-300/45 bg-emerald-300/10 text-left shadow-[0_0_20px_rgba(52,211,153,0.08)] transition-colors hover:border-emerald-200/70"
                            title={isPreviewPlaying ? "Pause preview output" : "Play preview output"}
                          >
                            {previewAsset.poster ? (
                              <img src={previewAsset.poster} alt="" className="h-full w-14 shrink-0 object-cover opacity-80" />
                            ) : (
                              <div className="h-full w-14 shrink-0 bg-emerald-300/15" />
                            )}
                            <div className="min-w-0 px-2">
                              <div className="truncate text-[11px] font-medium text-foreground">preview output</div>
                              <div className="text-[10px] text-muted-foreground">{previewVideoDuration}</div>
                            </div>
                          </button>
                        ) : (
                          <div className="absolute inset-0 flex items-center rounded border border-dashed border-white/10 px-3 text-[11px] text-muted-foreground/65">
                            Preview output track
                          </div>
                        )}
                      </div>
                      <div className="absolute bottom-1 top-0 left-[18%] w-px bg-white/45 shadow-[0_0_10px_rgba(255,255,255,0.2)]" />
                    </div>
                  </div>
                )}
              </div>

              {/* Audio rail */}
              <div
                className="relative shrink-0 border-t border-border bg-panel/45 flex flex-col"
                style={{ height: audioHeight, order: railOrder.indexOf("audio") + 1 }}
              >
                <button
                  onMouseDown={(e) => {
                    audioDragRef.current = true;
                    audioPressRef.current = { startY: e.clientY };
                    document.body.style.cursor = "row-resize";
                    document.body.style.userSelect = "none";
                  }}
                  onClick={() => {
                    if (audioSuppressClickRef.current) return;
                    toggleWorkspaceRail("audio");
                  }}
                  className="h-1 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-amber-300/60"
                  title={audioCollapsed ? "Open audio" : "Resize audio"}
                />
                {!audioCollapsed && (
                  <div className="flex min-h-0 flex-1 items-center gap-2.5 px-3">
                    <div className="flex h-10 w-24 shrink-0 items-center gap-2 rounded-md border border-white/10 bg-black/25 px-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <button
                        onClick={() => setAudioMuted((v) => !v)}
                        className={`grid h-7 w-7 shrink-0 place-items-center rounded border transition-colors ${
                          audioMuted ? "border-white/10 bg-black/35 text-muted-foreground hover:text-foreground" : "border-white/20 bg-white/[0.06] text-foreground hover:bg-white/[0.09]"
                        }`}
                        title={audioMuted ? "Enable music" : "Mute music"}
                      >
                        <Volume2 className="h-3.5 w-3.5" />
                      </button>
                      <div className="min-w-0 text-[11px] leading-tight">
                        <div className="text-xs font-medium text-foreground/80">Audio</div>
                        <div className="truncate text-muted-foreground">{audioMuted ? "muted" : "bed 0 dB"}</div>
                      </div>
                    </div>
                    <div className="relative h-10 min-w-0 flex-1 overflow-hidden rounded-md border border-white/10 bg-[#08090b]/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <div className="absolute inset-x-0 top-0 flex h-2.5 justify-between px-2">
                        {Array.from({ length: 12 }).map((_, i) => (
                          <span key={`audio-tick-${i}`} className="h-1.5 w-px bg-white/10" />
                        ))}
                      </div>
                      <div className="absolute left-3 right-3 top-1/2 h-px bg-white/10" />
                      <svg
                        aria-hidden="true"
                        className={`absolute inset-x-3 top-2 h-6 w-[calc(100%-1.5rem)] ${audioMuted ? "opacity-30" : "opacity-90"}`}
                        viewBox="0 0 800 40"
                        preserveAspectRatio="none"
                      >
                        <path
                          d="M0 20 C28 14 45 10 70 20 S120 28 150 18 S205 8 244 19 S305 31 352 18 S424 9 470 22 S535 33 588 19 S665 7 710 20 S768 28 800 18"
                          fill="none"
                          stroke="rgba(255,255,255,0.28)"
                          strokeWidth="1.4"
                        />
                        <path
                          d="M0 20 C35 24 58 31 92 20 S144 9 185 21 S238 30 284 20 S352 8 405 21 S486 32 535 19 S600 10 646 20 S730 29 800 20"
                          fill="none"
                          stroke={audioMuted ? "rgba(148,163,184,0.36)" : "rgba(245,222,179,0.72)"}
                          strokeWidth="2.2"
                          strokeLinecap="round"
                        />
                      </svg>
                      <div className="absolute bottom-1 top-0 left-[18%] w-px bg-white/35 shadow-[0_0_8px_rgba(255,255,255,0.16)]" />
                    </div>
                  </div>
                )}
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
              onMoveToStoryboard={moveAssetsToStoryboard}
              onDelete={deleteAssetById}
            />
          ) : activeTab === "templates" ? (
            <PanelTemplates
              templates={TEMPLATES}
              onUse={(tpl) => {
                const idx = SIZE_PRESETS.findIndex((p) => p.ratio === tpl.ratio);
                if (idx >= 0) setSizeIdx(idx);
                const tplPreset = SIZE_PRESETS[idx >= 0 ? idx : sizeIdx];
                const url = makeMockImage(tpl.name, tplPreset.w, tplPreset.h);
                const a = addAsset({
                  name: `${tpl.name}.png`,
                  kind: "image",
                  url,
                  width: tplPreset.w,
                  height: tplPreset.h,
                  ratio: tplPreset.ratio,
                  sizeLabel: tplPreset.label,
                  styleSeed: tpl.name,
                });
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


        {activeTab === "workspace" && (
          <>
        {/* Resize handle */}
        <div
          onMouseDown={() => {
            draggingRef.current = true;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
          className="w-1 cursor-col-resize bg-border hover:bg-primary/60 transition-colors shrink-0"
        />

        {/* Right: AI chat (workspace only) */}
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
              {panelView === "chat" && (
                <div className="relative" ref={inventoryRef}>
                  <button
                    onClick={() => setInventoryOpen((v) => !v)}
                    title="AI Inventory"
                    className={`h-8 w-8 grid place-items-center rounded-md ${
                      inventoryOpen ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    }`}
                  >
                    <Sparkles className="h-4 w-4" />
                  </button>
                  {inventoryOpen && (
                    <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-lg border border-border bg-popover shadow-xl">
                      <div className="border-b border-border px-3 py-2">
                        <div className="text-sm font-medium text-foreground">AI Inventory</div>
                        <div className="text-[11px] text-muted-foreground">Commands the assistant can use in this workspace.</div>
                      </div>
                      <div className="max-h-[360px] overflow-y-auto p-1.5">
                        {[
                          {
                            icon: Library,
                            title: "Generate Asset Batch",
                            detail: "Create multiple image assets and send them to Recents.",
                            prompt: "Generate 6 cinematic image assets in landscape dimensions for this project.",
                          },
                          {
                            icon: LayoutGrid,
                            title: "Build Storyboard",
                            detail: "Create storyboard inputs and place them on the storyboard rail.",
                            prompt: "Generate 6 storyboard shots for this video idea and add them to the storyboard.",
                          },
                          {
                            icon: Wand2,
                            title: "Refine Preview",
                            detail: "Use the current preview as the output to improve.",
                            prompt: "Refine the current preview output. Keep the strongest parts, improve the weak parts, and preserve the same composition.",
                          },
                          {
                            icon: Target,
                            title: "Use Marked Region",
                            detail: "Edit only the highlighted or brushed area.",
                            prompt: "Use my marked region as the edit target and blend the change naturally into the rest of the image.",
                          },
                          {
                            icon: Film,
                            title: "Create Motion Preview",
                            detail: "Render a short mock video output.",
                            prompt: "Generate a short cinematic mock video preview for this idea.",
                          },
                          {
                            icon: Trash2,
                            title: "Clean Workspace",
                            detail: "Clear preview or storyboard by command.",
                            prompt: "Clear the preview output but keep my assets and storyboard safe.",
                          },
                        ].map(({ icon: Icon, title, detail, prompt }) => (
                          <button
                            key={title}
                            onClick={() => cueInventoryPrompt(prompt)}
                            className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
                          >
                            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/10 bg-black/20 text-primary">
                              <Icon className="h-3.5 w-3.5" />
                            </span>
                            <span className="min-w-0">
                              <span className="block text-xs font-medium text-foreground">{title}</span>
                              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{detail}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
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
                const preview = last?.text || last?.cards?.[0]?.title || (last?.attachments?.length ? `Attachment: ${last.attachments[0].name}` : "");
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
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} ${m.role === "ai" ? "px-1" : ""}`}>
                    <div
                      className={`max-w-[85%] text-sm leading-relaxed ${
                        m.role === "user"
                          ? "rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-3.5 py-2 shadow-sm"
                          : "text-foreground px-1 py-1"
                      }`}
                    >
                      {m.attachments && m.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                          {m.attachments.map((a) => (
                            a.url ? (
                              <img key={a.id} src={a.url} alt={a.name} className="max-h-32 rounded-md border border-border/40 bg-background/30" />
                            ) : (
                              <div key={a.id} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-background/20 text-xs">
                                <FileText className="h-3 w-3" /> {a.name}
                              </div>
                            )
                          ))}
                        </div>
                      )}
                      {m.text && (
                        m.role === "ai"
                          ? <AssistantMessage text={m.text} cards={m.cards} onAction={runInventoryAction} />
                          : <div className="whitespace-pre-wrap">{m.text}</div>
                      )}
                      {!m.text && m.role === "ai" && m.cards && m.cards.length > 0 && (
                        <AssistantMessage text="" cards={m.cards} onAction={runInventoryAction} />
                      )}
                    </div>
                  </div>
                ))}
                {isThinking && (
                  <div className="flex justify-start px-1">
                    <div className="px-1 py-1 text-sm text-muted-foreground inline-flex items-center gap-2">
                      <span className="thinking-shimmer">{thinkingLabel}</span>
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
                {hasDraftMarkedRegion && (
                  <div className="mb-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-primary/10 border border-primary/30 text-xs text-foreground">
                    <Target className="h-3 w-3 text-primary" />
                    <span>{markedRegionLabel}</span>
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
                    placeholder="Message the AI…"
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
                        disabled={isThinking || (!input.trim() && pendingAttachments.length === 0 && !hasDraftMarkedRegion)}
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
          </>
        )}

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

function AssistantMessage({
  text,
  cards = [],
  onAction,
}: {
  text: string;
  cards?: InventoryCard[];
  onAction?: (action: InventoryAction) => void;
}) {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);

  return (
    <div className="space-y-2.5">
      {lines.map((line, index) => {
        const heading = line.match(/^\*\*(.+?)\*\*:?\s*$/);
        const bullet = line.match(/^(?:[-*]|•)\s+(.*)$/);
        if (heading) {
          const title = heading[1];
          const Icon = /planned|next|soon/i.test(title) ? Clock3 : /right now|can/i.test(title) ? CheckCircle2 : Sparkles;
          return (
            <div key={`${line}-${index}`} className="mt-3 first:mt-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Icon className="h-3.5 w-3.5 text-primary" />
              <span>{title}</span>
            </div>
          );
        }
        if (bullet) {
          const cleaned = bullet[1].replace(/\*\*(.+?)\*\*/g, "$1").replace(/^\s+/, "");
          const [lead, ...rest] = cleaned.split(":");
          const hasLead = rest.length > 0 && lead.length < 44;
          return (
            <div key={`${line}-${index}`} className="flex gap-2 pl-0.5 text-foreground/90">
              <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/85" />
              <div>
                {hasLead ? (
                  <>
                    <span className="font-medium text-foreground">{lead.trim()}</span>
                    <span className="text-muted-foreground">:{rest.join(":")}</span>
                  </>
                ) : (
                  <span>{cleaned}</span>
                )}
              </div>
            </div>
          );
        }
        return (
          <p key={`${line}-${index}`} className="text-foreground/90">
            {line.replace(/\*\*(.+?)\*\*/g, "$1")}
          </p>
        );
      })}
      {cards.map((card) => (
        <AssistantInventoryCard key={card.id} card={card} onAction={onAction} />
      ))}
    </div>
  );
}

function AssistantInventoryCard({ card, onAction }: { card: InventoryCard; onAction?: (action: InventoryAction) => void }) {
  const Icon = card.kind === "asset-batch" ? Library : card.kind === "storyboard-batch" ? LayoutGrid : Sparkles;

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-white/10 bg-background/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex items-start gap-2 border-b border-white/10 px-2.5 py-2">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/10 bg-black/25 text-primary">
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">{card.title}</div>
          {card.subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{card.subtitle}</div>}
        </div>
      </div>
      {card.stats && card.stats.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5 p-2">
          {card.stats.map((stat) => (
            <div key={`${card.id}-${stat.label}`} className="rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
              <div className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/70">{stat.label}</div>
              <div className="mt-0.5 truncate text-xs font-medium text-foreground">{stat.value}</div>
            </div>
          ))}
        </div>
      )}
      {card.actions && card.actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-white/10 px-2 py-2">
          {card.actions.map((action) => (
            <button
              key={`${card.id}-${action.label}`}
              onClick={() => onAction?.(action)}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/10 bg-black/20 px-2 text-xs text-muted-foreground transition-colors hover:text-foreground hover:border-white/25"
            >
              {action.action === "open-assets" ? <Library className="h-3 w-3" /> : action.action === "add-assets-to-storyboard" ? <LayoutGrid className="h-3 w-3" /> : <Wand2 className="h-3 w-3" />}
              {action.label}
            </button>
          ))}
        </div>
      )}
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
  assets, onUploadClick, onMoveToStoryboard, onDelete,
}: {
  assets: Asset[];
  onUploadClick: () => void;
  onMoveToStoryboard: (assets: Asset[]) => void;
  onDelete: (id: number) => void;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | AssetKind>("all");
  const [viewerAssetId, setViewerAssetId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const filtered = assets.filter((a) =>
    (filter === "all" || a.kind === filter) && a.name.toLowerCase().includes(q.toLowerCase()),
  );
  const viewerAsset = assets.find((a) => a.id === viewerAssetId) ?? null;
  const selectedAssets = selectedIds
    .map((id) => assets.find((a) => a.id === id))
    .filter((a): a is Asset => !!a);
  function toggleSelected(id: number) {
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  }
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
        <button
          onClick={() => onMoveToStoryboard(selectedAssets)}
          disabled={selectedAssets.length === 0}
          className="h-8 px-3 rounded-md bg-accent text-foreground text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add to storyboard
        </button>
      </PanelHeader>
      {filtered.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted-foreground">
          No assets yet. Upload files to get started.
        </div>
      ) : (
        <>
          <div className="p-6">
            {selectedIds.length > 0 && (
              <div className="mb-3 flex items-center justify-between rounded-lg border border-border bg-panel px-3 py-2 text-xs">
                <span className="text-muted-foreground">{selectedIds.length} selected</span>
                <button onClick={() => setSelectedIds([])} className="rounded-md px-2 py-1 hover:bg-accent">Clear</button>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filtered.map((a) => {
                const selected = selectedIds.includes(a.id);
                const isWideAsset = (a.width ?? 16) >= (a.height ?? 9);
                return (
                  <div key={a.id} className={`group grid h-80 grid-rows-[minmax(0,1fr)_52px] rounded-lg border bg-panel overflow-hidden transition-colors ${selected ? "border-primary/70" : "border-border hover:border-primary/60"}`}>
                    <div className="relative min-h-0 bg-black">
                      <button onClick={() => setViewerAssetId(a.id)} className="absolute inset-0 grid h-full w-full place-items-center p-6">
                        <div
                          className="relative max-h-full max-w-full overflow-hidden rounded-lg bg-black shadow-sm ring-1 ring-white/5"
                          style={{ aspectRatio: a.ratio ?? "16 / 9", ...(isWideAsset ? { width: "100%" } : { height: "100%" }) }}
                        >
                          <img
                            src={a.kind === "video" ? (a.poster ?? "") : a.url}
                            alt={a.name}
                            className="absolute inset-0 h-full w-full rounded-lg bg-black object-contain"
                          />
                        </div>
                        {a.kind === "video" && (
                          <div className="absolute inset-0 grid place-items-center bg-black/30">
                            <Play className="h-6 w-6 text-white drop-shadow" />
                          </div>
                        )}
                      </button>
                      <button
                        onClick={() => toggleSelected(a.id)}
                        className={`absolute right-2 top-2 h-5 w-5 rounded border grid place-items-center text-[10px] ${
                          selected ? "border-primary bg-primary text-primary-foreground" : "border-white/50 bg-black/40 text-white/70"
                        }`}
                        title="Select asset"
                      />
                    </div>
                    <div className="flex min-h-0 items-center justify-between border-t border-border bg-panel px-3 text-xs">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{a.name}</div>
                        <div className="mt-0.5 truncate text-[11px] uppercase text-muted-foreground">{a.sizeLabel ?? a.kind}</div>
                      </div>
                      <button
                        onClick={() => onDelete(a.id)}
                        className="opacity-0 group-hover:opacity-100 h-6 w-6 grid place-items-center rounded text-muted-foreground hover:text-foreground hover:bg-accent shrink-0"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {viewerAsset && (
            <div
              className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-5 backdrop-blur-sm"
              onMouseDown={() => setViewerAssetId(null)}
            >
              <div
                className="relative grid h-[92vh] w-full max-w-5xl grid-rows-[44px_minmax(0,1fr)_48px] overflow-hidden rounded-xl border border-border bg-panel shadow-2xl"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="flex min-h-0 items-center justify-between border-b border-border px-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{viewerAsset.name}</div>
                    <div className="text-[11px] uppercase text-muted-foreground">{viewerAsset.sizeLabel ?? viewerAsset.kind}</div>
                  </div>
                  <button
                    onClick={() => setViewerAssetId(null)}
                    className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                    title="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="min-h-0 overflow-auto bg-black/70 p-3">
                  <div className="flex h-full min-h-full items-center justify-center">
                    {viewerAsset.kind === "video" ? (
                      <video
                        src={viewerAsset.url}
                        poster={viewerAsset.poster}
                        controls
                        className="block max-h-full max-w-full rounded-lg object-contain"
                      />
                    ) : (
                      <img
                        src={viewerAsset.url}
                        alt={viewerAsset.name}
                        className="block max-h-full max-w-full rounded-lg object-contain"
                      />
                    )}
                  </div>
                </div>
                <div className="flex min-h-0 items-center justify-between gap-4 border-t border-border bg-panel px-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-foreground">{viewerAsset.name}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {viewerAsset.kind === "video" ? "Video asset" : "Image asset"} - stored in Assets
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => toggleSelected(viewerAsset.id)}
                      className={`h-8 px-3 rounded-md text-xs font-medium ${
                        selectedIds.includes(viewerAsset.id) ? "bg-primary text-primary-foreground" : "bg-accent text-foreground"
                      }`}
                    >
                      {selectedIds.includes(viewerAsset.id) ? "Selected" : "Select asset"}
                    </button>
                    <button
                      onClick={() => {
                        onMoveToStoryboard([viewerAsset]);
                        setViewerAssetId(null);
                      }}
                      className="h-8 px-3 rounded-md border border-border bg-background/40 text-xs font-medium text-foreground hover:bg-accent"
                    >
                      Add to storyboard
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
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


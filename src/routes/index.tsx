import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import {
  Image as ImageIcon, Film, Layers, Wand2, Settings,
  Folder, Download, Upload, Send, Plus, Scissors,
  Type, Music, Maximize2, ChevronDown, MessageSquarePlus,
  PanelRightClose, History, MoreHorizontal, Paperclip,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Reel — AI Video Studio" },
      { name: "description", content: "An AI video & image studio. Chat to create, edit, and refine." },
    ],
  }),
  component: Studio,
});

type Msg = { id: number; role: "user" | "ai"; text: string };

function Studio() {
  const [messages, setMessages] = useState<Msg[]>([
    { id: 1, role: "ai", text: "Hey — drop an image or video on the canvas, or just tell me what you want to make." },
  ]);
  const [input, setInput] = useState("");
  const [chatWidth, setChatWidth] = useState(380);
  const draggingRef = useRef(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!draggingRef.current || !shellRef.current) return;
      const rect = shellRef.current.getBoundingClientRect();
      const next = rect.right - e.clientX;
      setChatWidth(Math.min(640, Math.max(280, next)));
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
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function send() {
    const t = input.trim();
    if (!t) return;
    const id = Date.now();
    setMessages((m) => [...m, { id, role: "user", text: t }]);
    setInput("");
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        { id: id + 1, role: "ai", text: "Got it — working on that. (Hook this up to your model on the backend.)" },
      ]);
    }, 600);
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Top bar */}
      <header className="h-10 flex items-center justify-between px-3 border-b border-border bg-panel text-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-[oklch(0.65_0.18_25)]" />
            <div className="h-2.5 w-2.5 rounded-full bg-[oklch(0.78_0.14_85)]" />
            <div className="h-2.5 w-2.5 rounded-full bg-[oklch(0.7_0.14_150)]" />
          </div>
          <span className="text-muted-foreground">Reel Studio</span>
          <span className="text-muted-foreground/60">/</span>
          <span className="flex items-center gap-1 text-foreground/90">
            untitled-project <ChevronDown className="h-3.5 w-3.5 opacity-60" />
          </span>
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

      <div ref={shellRef} className="flex-1 flex min-h-0">
        {/* Left icon rail */}
        <aside className="w-12 bg-rail border-r border-border flex flex-col items-center py-2 gap-1">
          {[
            { Icon: ImageIcon, active: true, label: "Images" },
            { Icon: Film, label: "Clips" },
            { Icon: Layers, label: "Layers" },
            { Icon: Folder, label: "Assets" },
            { Icon: Wand2, label: "Effects" },
          ].map(({ Icon, active, label }) => (
            <button
              key={label}
              title={label}
              className={`h-9 w-9 grid place-items-center rounded-md transition-colors ${
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent/60"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" />
            </button>
          ))}
          <div className="flex-1" />
          <button className="h-9 w-9 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60">
            <Settings className="h-[18px] w-[18px]" />
          </button>
        </aside>

        {/* Workspace */}
        <main className="flex-1 flex flex-col min-w-0 bg-canvas">
          {/* Canvas toolbar */}
          <div className="h-9 px-3 flex items-center gap-1 border-b border-border bg-panel/60 text-xs text-muted-foreground">
            <button className="px-2 py-1 rounded hover:bg-accent hover:text-foreground flex items-center gap-1"><Scissors className="h-3.5 w-3.5" /> Cut</button>
            <button className="px-2 py-1 rounded hover:bg-accent hover:text-foreground flex items-center gap-1"><Type className="h-3.5 w-3.5" /> Text</button>
            <button className="px-2 py-1 rounded hover:bg-accent hover:text-foreground flex items-center gap-1"><Music className="h-3.5 w-3.5" /> Audio</button>
            <button className="px-2 py-1 rounded hover:bg-accent hover:text-foreground flex items-center gap-1"><Wand2 className="h-3.5 w-3.5" /> Effects</button>
            <div className="flex-1" />
            <span>1920 × 1080 · 30fps</span>
            <button className="ml-2 p-1 rounded hover:bg-accent hover:text-foreground"><Maximize2 className="h-3.5 w-3.5" /></button>
          </div>

          {/* Preview */}
          <div className="flex-1 flex items-center justify-center p-6 min-h-0">
            <div className="relative aspect-video w-full max-w-6xl max-h-full rounded-lg overflow-hidden border border-border shadow-2xl bg-[oklch(0.08_0.003_270)]">
              <div className="absolute inset-0 grid place-items-center text-center px-6">
                <div>
                  <p className="text-foreground/80 text-base font-medium">Preview</p>
                  <p className="text-muted-foreground text-sm mt-1">Your image or video will appear here.</p>
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Resize handle */}
        <div
          onMouseDown={() => {
            draggingRef.current = true;
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
          }}
          className="w-1 cursor-col-resize bg-border hover:bg-primary/60 transition-colors relative group"
        >
          <div className="absolute inset-y-0 -left-1 -right-1" />
        </div>

        {/* Right: AI chat */}
        <aside style={{ width: chatWidth }} className="bg-panel border-l border-border flex flex-col min-h-0 shrink-0">
          <div className="h-11 px-2 flex items-center justify-between border-b border-border gap-1">
            <div className="flex items-center gap-1">
              <button title="Chat history" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent">
                <History className="h-4 w-4" />
              </button>
              <button className="h-8 px-2 flex items-center gap-1.5 rounded-md text-sm hover:bg-accent text-foreground/90">
                <span className="truncate max-w-[140px]">Untitled chat</span>
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </button>
            </div>
            <div className="flex items-center gap-0.5">
              <button title="New chat" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent">
                <MessageSquarePlus className="h-4 w-4" />
              </button>
              <button title="More" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent">
                <MoreHorizontal className="h-4 w-4" />
              </button>
              <button title="Hide panel" className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent">
                <PanelRightClose className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="px-3 py-1.5 border-b border-border flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Connected
            </span>
            <span>{messages.length} message{messages.length === 1 ? "" : "s"}</span>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
            {messages.map((m) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-accent text-foreground rounded-bl-sm"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>

          {/* Suggestions */}
          <div className="px-3 pb-2 flex flex-wrap gap-1.5">
            {["Make it cinematic", "Add captions", "Cut silences", "Color grade"].map((s) => (
              <button
                key={s}
                onClick={() => setInput(s)}
                className="text-xs px-2 py-1 rounded-full bg-accent/60 hover:bg-accent text-muted-foreground hover:text-foreground border border-border"
              >
                {s}
              </button>
            ))}
          </div>

          {/* Composer */}
          <div className="p-3 border-t border-border">
            <div className="rounded-xl bg-input/60 border border-border focus-within:border-primary/60 transition-colors">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={2}
                placeholder="Type here — ask the AI to edit, generate, or refine…"
                className="w-full resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground"
              />
              <div className="flex items-center justify-between px-2 pb-2">
                <button className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent" title="Attach">
                  <Paperclip className="h-4 w-4" />
                </button>
                <button
                  onClick={send}
                  className="h-7 px-3 rounded-md bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5 hover:opacity-90 disabled:opacity-40"
                  disabled={!input.trim()}
                >
                  Send <Send className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* Status bar */}
      <footer className="h-6 border-t border-border bg-rail text-[11px] text-muted-foreground flex items-center px-3 gap-4">
        <span>● Ready</span>
        <span>Project: untitled-project</span>
        <div className="flex-1" />
        <span>v0.1</span>
      </footer>
    </div>
  );
}

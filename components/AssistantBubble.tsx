"use client";

import { useEffect, useRef, useState } from "react";
import BrandMark from "@/components/BrandMark";
import { BRAND } from "@/lib/brand";

// The assistant, tucked where support chats live: a speech-bubble button in the
// bottom-right that opens a compact chat panel. Replaces the old full-width
// "ask me anything" hero — the dashboard leads with the numbers now, and the
// assistant is there when you want it. Answers stream from /api/my/assistant.

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
}

export default function AssistantBubble({ firstName }: { firstName?: string }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest message in view as tokens stream in.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || streaming) return;

    setNotice(null);
    setInput("");
    const history: ChatMsg[] = [...messages, { role: "user", content: question }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setStreaming(true);

    try {
      const res = await fetch("/api/my/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { message?: string } | null;
        setMessages(history); // drop the empty assistant bubble
        setNotice(
          data?.message ??
            "The assistant couldn't answer just now — give it another go in a moment."
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        const snapshot = answer;
        setMessages([...history, { role: "assistant", content: snapshot }]);
      }
      if (!answer.trim()) {
        setMessages(history);
        setNotice("The assistant sent back an empty answer — try rephrasing.");
      }
    } catch {
      setMessages(history);
      setNotice("Lost the connection mid-answer — check your network and try again.");
    } finally {
      setStreaming(false);
      inputRef.current?.focus();
    }
  }

  return (
    <>
      {/* ---- the panel ---- */}
      {open ? (
        <div
          ref={panelRef}
          className="swing-down fixed right-4 top-[64px] z-50 flex h-[min(540px,calc(100vh-6rem))] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-2xl sm:right-6"
          role="dialog"
          aria-label="TLE Assistant"
        >
          <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
            <BrandMark size={20} />
            <div className="leading-tight">
              <p className="text-[13px] font-semibold">TLE Assistant</p>
              <p className="text-[11px] text-muted">Your numbers, on tap</p>
            </div>
            {messages.length ? (
              <button
                type="button"
                onClick={() => {
                  setMessages([]);
                  setNotice(null);
                }}
                className="ml-auto text-[11px] font-medium text-muted transition hover:text-ink"
              >
                New chat
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              className={`${messages.length ? "" : "ml-auto "}rounded-full p-1 text-muted transition hover:bg-black/[0.04] hover:text-ink`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-black/[0.05]">
                  <svg className="h-5 w-5 text-ink" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                    <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 20l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
                  </svg>
                </span>
                <p className="mt-3 text-[14px] font-medium">
                  {firstName ? `Ask me anything, ${firstName}` : "Ask me anything"}
                </p>
                <p className="mt-1 max-w-[240px] text-[12px] text-muted">
                  Your properties, earnings, compliance — I&apos;ve got the numbers.
                </p>
              </div>
            ) : (
              messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-3.5 py-2 text-[13px] text-white">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex items-start gap-2">
                    <span className="mt-1 shrink-0">
                      <BrandMark size={16} />
                    </span>
                    {streaming && i === messages.length - 1 && !m.content ? (
                      <div className="flex items-center gap-1 rounded-2xl rounded-tl-md bg-black/[0.04] px-3.5 py-3">
                        {[0, 150, 300].map((delay) => (
                          <span
                            key={delay}
                            className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink/40"
                            style={{ animationDelay: `${delay}ms` }}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tl-md bg-black/[0.04] px-3.5 py-2 text-[13px] leading-relaxed text-ink">
                        {m.content}
                        {streaming && i === messages.length - 1 ? (
                          <span className="ml-1 inline-block h-3 w-1 animate-pulse rounded-sm bg-ink/50 align-middle" />
                        ) : null}
                      </div>
                    )}
                  </div>
                )
              )
            )}
            {notice ? (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-800">{notice}</p>
            ) : null}
          </div>

          <form
            className="relative border-t border-line p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={messages.length ? "Ask a follow-up…" : "Ask about your properties…"}
              disabled={streaming}
              className="w-full rounded-full border border-line bg-white py-2.5 pl-4 pr-11 text-[13px] outline-none transition placeholder:text-muted/70 focus:border-black/20 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={streaming || !input.trim()}
              aria-label="Send"
              className="absolute right-4 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-ink text-white transition disabled:opacity-30"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </form>
        </div>
      ) : null}

      {/* ---- the bubble ---- */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close TLE Assistant" : "Open TLE Assistant"}
        aria-expanded={open}
        className="btn-press fixed right-4 top-2 z-50 flex items-center justify-center rounded-full text-white shadow-lg transition hover:shadow-xl sm:right-6"
        style={{ background: BRAND.accent, height: 40, width: 40 }}
      >
        {open ? (
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg style={{ height: 18, width: 18 }} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 20l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
          </svg>
        )}
      </button>
    </>
  );
}

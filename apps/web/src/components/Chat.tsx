"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { GOLDEN_QUERIES } from "../lib/golden-queries";
import { extractEvidence } from "../lib/message-evidence";
import type { ChatMessage } from "../lib/tools";
import { AssistantMessage } from "./AssistantMessage";
import { BrandLogo } from "./BrandLogo";

export { GOLDEN_QUERIES };

const CHIP_LABELS = ["Standardise 40 Teams rooms", "Copilot and Places: what and proof", "Monitoring and a room failing"];

type Theme = "light" | "dark";

/** One saved conversation. Kept in this browser only (localStorage); nothing is sent to a server. */
interface SavedChat {
  id: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
}

const HISTORY_KEY = "avispl-chats";
const THEME_KEY = "theme";
const MAX_SAVED_CHATS = 20;

const newChatId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function loadChats(): SavedChat[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]") as SavedChat[];
    return Array.isArray(parsed) ? parsed.filter((c) => c && typeof c.id === "string" && Array.isArray(c.messages)) : [];
  } catch {
    return [];
  }
}

function storeChats(chats: SavedChat[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(chats));
  } catch {
    /* storage full or blocked: history is a convenience, the chat still works */
  }
}

const userText = (m: ChatMessage) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

/** DefaultChatTransport puts the error response body in error.message; our route sends JSON {code, error}. */
function friendlyError(err: Error): string {
  try {
    const j = JSON.parse(err.message) as { error?: string };
    if (j.error) return j.error;
  } catch {
    /* not JSON */
  }
  if (/fetch/i.test(err.message)) return "Could not reach the chat service. Is the dev server running?";
  return err.message || "Something went wrong.";
}

const Icon = ({ d, size = 20 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ICON = {
  sidebar: "M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM9 5v14",
  newChat: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z",
  send: "M12 19V5M5 12l7-7 7 7",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  sun: "M12 3v2M12 19v2M5 5l1.5 1.5M17.5 17.5 19 19M3 12h2M19 12h2M5 19l1.5-1.5M17.5 6.5 19 5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  down: "M12 5v14M5 12l7 7 7-7",
};

export function Chat({
  target,
  modelMode,
}: {
  backend: string;
  target: "fixtures" | "offline-mock" | "hosted";
  modelMode: "anthropic" | "gateway" | "demo" | "unconfigured";
}) {
  const [input, setInput] = useState("");
  const [theme, setTheme] = useState<Theme>("light");
  const [sidebarOpen, setSidebarOpen] = useState(true); // desktop
  const [drawerOpen, setDrawerOpen] = useState(false); // phone and tablet
  const [chats, setChats] = useState<SavedChat[]>([]);
  const [chatId, setChatId] = useState<string>(() => newChatId());
  const [atBottom, setAtBottom] = useState(true);
  const transport = useMemo(() => new DefaultChatTransport<ChatMessage>({ api: "/api/chat" }), []);
  const { messages, setMessages, sendMessage, status, error, stop, clearError } = useChat<ChatMessage>({ transport });
  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = status === "submitted" || status === "streaming";

  // Theme: the inline script in layout.tsx sets <html data-theme> before paint; mirror it here.
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    setChats(loadChats());
  }, []);
  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* the choice still applies for this visit */
    }
  };

  const evidence = useMemo(
    () => new Map(messages.filter((m) => m.role === "assistant").map((m) => [m.id, extractEvidence(m.parts)])),
    [messages],
  );

  // Save the conversation once an answer has finished (never mid-stream).
  useEffect(() => {
    if (busy || messages.length === 0) return;
    setChats((prev) => {
      const first = messages.find((m) => m.role === "user");
      const title = (first ? userText(first) : "New chat").replace(/\s+/g, " ").trim().slice(0, 60) || "New chat";
      const existing = prev.find((c) => c.id === chatId);
      if (existing && existing.messages.length === messages.length) return prev;
      const next = [{ id: chatId, title, updatedAt: Date.now(), messages }, ...prev.filter((c) => c.id !== chatId)].slice(0, MAX_SAVED_CHATS);
      storeChats(next);
      return next;
    });
  }, [busy, messages, chatId]);

  useEffect(() => {
    if (atBottom) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, status, atBottom]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  const startNewChat = useCallback(() => {
    void stop();
    clearError();
    setMessages([]);
    setChatId(newChatId());
    setInput("");
    setDrawerOpen(false);
    setAtBottom(true);
    inputRef.current?.focus();
  }, [stop, clearError, setMessages]);

  const openChat = (c: SavedChat) => {
    void stop();
    clearError();
    setMessages(c.messages);
    setChatId(c.id);
    setDrawerOpen(false);
    setAtBottom(true);
  };

  const deleteChat = (id: string) => {
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== id);
      storeChats(next);
      return next;
    });
    if (id === chatId) startNewChat();
  };

  const send = (text: string) => {
    const t = text.trim();
    if (!t || busy) return;
    clearError();
    setAtBottom(true);
    void sendMessage({ text: t });
    setInput("");
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
    }
  };

  const toggleSidebar = () => {
    if (window.matchMedia("(max-width: 800px)").matches) setDrawerOpen((o) => !o);
    else setSidebarOpen((o) => !o);
  };

  const keyMissing = modelMode === "unconfigured";
  const empty = messages.length === 0;

  const composer = (
    <form className="composer" onSubmit={onSubmit}>
      <textarea
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Ask about your meeting rooms"
        rows={1}
        aria-label="Your question"
      />
      {busy ? (
        <button type="button" className="send" onClick={() => void stop()} aria-label="Stop answering" title="Stop">
          <span className="stop-square" aria-hidden="true" />
        </button>
      ) : (
        <button type="submit" className="send" disabled={!input.trim()} aria-label="Send" title="Send">
          <Icon d={ICON.send} size={18} />
        </button>
      )}
    </form>
  );

  return (
    <div className={`app${sidebarOpen ? "" : " sidebar-collapsed"}${drawerOpen ? " drawer-open" : ""}`}>
      <aside className="sidebar" aria-label="Chats">
        <div className="sidebar-head">
          <BrandLogo className="brand-logo" />
          <button type="button" className="icon-btn" onClick={toggleSidebar} aria-label="Close sidebar" title="Close sidebar">
            <Icon d={ICON.sidebar} />
          </button>
        </div>

        <button type="button" className="side-item side-new" onClick={startNewChat}>
          <Icon d={ICON.newChat} size={18} />
          New chat
        </button>

        <div className="side-list">
          {chats.length > 0 && <div className="side-label">Chats</div>}
          {chats.map((c) => (
            <div key={c.id} className={`side-chat${c.id === chatId ? " is-current" : ""}`}>
              <button type="button" className="side-chat-open" onClick={() => openChat(c)} title={c.title}>
                {c.title}
              </button>
              <button type="button" className="side-chat-delete" onClick={() => deleteChat(c.id)} aria-label={`Delete chat: ${c.title}`} title="Delete chat">
                <Icon d={ICON.trash} size={15} />
              </button>
            </div>
          ))}
          {chats.length === 0 && <p className="side-empty">Your chats will appear here. They are saved in this browser only.</p>}
        </div>

        <button type="button" className="side-item side-theme" onClick={toggleTheme}>
          <Icon d={theme === "dark" ? ICON.sun : ICON.moon} size={18} />
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>
      </aside>
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button type="button" className="icon-btn sidebar-open-btn" onClick={toggleSidebar} aria-label="Open sidebar" title="Open sidebar">
              <Icon d={ICON.sidebar} />
            </button>
            <button type="button" className="icon-btn topbar-new" onClick={startNewChat} aria-label="New chat" title="New chat">
              <Icon d={ICON.newChat} />
            </button>
            <BrandLogo className="brand-logo topbar-logo" height={20} />
            <span className="topbar-title">Meeting-room advisor</span>
          </div>
          <button
            type="button"
            className="icon-btn"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Light mode" : "Dark mode"}
          >
            <Icon d={theme === "dark" ? ICON.sun : ICON.moon} />
          </button>
        </header>

        {(target !== "hosted" || modelMode === "demo" || keyMissing) && (
          <div className="status-strip" role="status">
            {target === "fixtures" && (
              <span className="status-pill status-mock">
                <strong>MOCK DATA</strong> synthetic demo fixtures, not AVI-SPL content
              </span>
            )}
            {target === "offline-mock" && (
              <span className="status-pill status-mock">
                <strong>OFFLINE MOCK</strong> local HydraDB mock: keyword search only
              </span>
            )}
            {modelMode === "demo" && (
              <span className="status-pill status-demo">
                <strong>DEMO MODEL</strong> answers are assembled from retrieved text, not AI
              </span>
            )}
            {keyMissing && (
              <span className="status-pill status-key">
                <strong>NO MODEL KEY</strong> set <code>ANTHROPIC_API_KEY</code> in <code>.env</code>, or <code>CHAT_MODEL=demo</code>
              </span>
            )}
          </div>
        )}

        {empty ? (
          <main className="welcome">
            <h1>How can we help with your meeting rooms?</h1>
            {composer}
            <div className="suggestions">
              {GOLDEN_QUERIES.map((q, i) => (
                <button key={i} type="button" className="suggestion" onClick={() => send(q)} title={q}>
                  <span className="suggestion-label">{CHIP_LABELS[i]}</span>
                  <span className="suggestion-text">{q}</span>
                </button>
              ))}
            </div>
            {error && (
              <div className="notice notice-error" role="alert">
                {friendlyError(error)}
              </div>
            )}
          </main>
        ) : (
          <main className="conversation">
            <div className="thread-scroll" ref={scrollRef} onScroll={onScroll}>
              <div className="thread">
                {messages.map((m, idx) => {
                  if (m.role === "user") {
                    return (
                      <div key={m.id} className="msg msg-user">
                        <div className="bubble">{userText(m)}</div>
                      </div>
                    );
                  }
                  const ev = evidence.get(m.id);
                  if (!ev) return null;
                  return <AssistantMessage key={m.id} ev={ev} streaming={busy && idx === messages.length - 1} />;
                })}

                {status === "submitted" && messages[messages.length - 1]?.role === "user" && (
                  <div className="msg msg-assistant">
                    <div className="typing" aria-label="Thinking">
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                )}

                {error && (
                  <div className="notice notice-error" role="alert">
                    {friendlyError(error)}
                  </div>
                )}
                <div ref={endRef} />
              </div>
            </div>

            <div className="composer-dock">
              {!atBottom && (
                <button
                  type="button"
                  className="scroll-down"
                  onClick={() => {
                    setAtBottom(true);
                    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
                  }}
                  aria-label="Scroll to latest message"
                  title="Scroll to latest"
                >
                  <Icon d={ICON.down} size={16} />
                </button>
              )}
              {composer}
            </div>
          </main>
        )}
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Send, Sparkles, Users, UserPlus, Trash2, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { sfx, haptic } from '@/lib/sfx';
import '@/ozone-chat.css';

export type OzoneChatContext = { username: string; level: number; sparks: number; questsLeft: number; isSubscriber: boolean };

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  name?: string;
  content: string;
  at: number;
  /** Shown in the thread but never sent to the AI (errors, the greeting). */
  local?: boolean;
};

type Props = { userId: string; context: OzoneChatContext; onClose: () => void };

const HISTORY_LIMIT = 50;
const SEND_LIMIT = 20;
const MAX_INPUT = 800;
const OZONE_AVATAR = '/assets/Gemini_Generated_Image__(1).jpg';
const SUGGESTIONS = ['How do I earn more sparks?', 'Plan my day', 'How do cashouts work?', 'Best game for me?'];
const CREW_SLOTS = 4; // the player + up to 4 invited friends / family

const storageKey = (uid: string) => `ozone_chat_${uid}`;
const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`);

function loadHistory(userId: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const list = raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    return Array.isArray(list) ? list.filter((m) => m && typeof m.content === 'string').slice(-HISTORY_LIMIT) : [];
  } catch { return []; }
}
function saveHistory(userId: string, list: ChatMessage[]) {
  try { localStorage.setItem(storageKey(userId), JSON.stringify(list.slice(-HISTORY_LIMIT))); } catch { /* storage full or blocked */ }
}

function greeting(name: string): ChatMessage {
  return { id: 'greet', role: 'assistant', local: true, at: Date.now(), content: `Yo${name ? ` ${name}` : ''}! Ozone here ⚡ Ask me how to stack sparks, plan your day, or which game fits your vibe. Or just chat!` };
}

export default function OzoneChat({ userId, context, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory(userId));
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const ctxRef = useRef(context);
  ctxRef.current = context;

  useEffect(() => { saveHistory(userId, messages); }, [userId, messages]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }, [messages, typing]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 250);
    return () => { window.removeEventListener('keydown', onKey); window.clearTimeout(t); };
  }, [onClose]);

  const shown = useMemo(() => (messages.length ? messages : [greeting(context.username)]), [messages, context.username]);

  const send = async (text: string) => {
    const content = text.replace(/\s+$/g, '').trim().slice(0, MAX_INPUT);
    if (!content || typing) return;
    sfx.tap(); haptic(8);
    const mine: ChatMessage = { id: uid(), role: 'user', name: context.username || undefined, content, at: Date.now() };
    const next = [...messages, mine];
    setMessages(next);
    setDraft('');
    setTyping(true);
    const push = (m: Omit<ChatMessage, 'id' | 'at'>) => setMessages((prev) => [...prev, { ...m, id: uid(), at: Date.now() }].slice(-HISTORY_LIMIT));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const payload = {
        messages: next.filter((m) => !m.local).slice(-SEND_LIMIT).map((m) => ({ role: m.role, name: m.name, content: m.content.slice(0, MAX_INPUT) })),
        context: ctxRef.current,
      };
      const res = await fetch('/api/ozone-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as { reply?: string; error?: string };
      if (res.ok && body.reply) {
        push({ role: 'assistant', content: body.reply });
        sfx.mascot('happy');
      } else if (res.status === 503) {
        push({ role: 'assistant', local: true, content: "Ozone's brain is warming up 🧠⚡ Chat isn't switched on just yet. Check back soon. In the meantime, your daily quests are a solid way to stack sparks!" });
        sfx.mascot('squish');
      } else if (res.status === 401) {
        push({ role: 'assistant', local: true, content: body.error || 'Sign in again to keep chatting with me.' });
        sfx.mascot('squish');
      } else {
        push({ role: 'assistant', local: true, content: body.error || 'Ozone lost signal for a sec. Try again!' });
        sfx.mascot('squish');
      }
    } catch {
      push({ role: 'assistant', local: true, content: "Ozone lost signal for a sec. Check your connection and try again!" });
      sfx.mascot('squish');
    } finally {
      setTyping(false);
    }
  };

  const clearChat = () => { if (!messages.length || confirm('Clear your chat with Ozone?')) { setMessages([]); sfx.tap(); } };
  const initial = (context.username || '?').charAt(0).toUpperCase();
  const showChips = !typing && messages.filter((m) => m.role === 'user').length < 3;

  return (
    <div className="ozc-backdrop" onClick={onClose}>
      <div className="ozc-sheet" role="dialog" aria-label="Chat with Ozone" onClick={(e) => e.stopPropagation()}>
        <header className="ozc-head">
          <div className="ozc-title">
            <img className="ozc-avatar lg" src={OZONE_AVATAR} alt="" />
            <div><p className="eyebrow">OZONE / FIELD BUDDY</p><h2>Chat with Ozone</h2></div>
          </div>
          <div className="ozc-head-actions">
            <button className="ozc-icon" onClick={clearChat} aria-label="Clear chat" title="Clear chat"><Trash2 size={15} /></button>
            <button className="ozc-icon" onClick={onClose} aria-label="Close chat"><X size={17} /></button>
          </div>
        </header>

        {/* Crew (group chat) prep: UI only. Needs the crew tables migration before it can be wired up. */}
        <section className="ozc-crew" aria-label="Your crew">
          <div className="ozc-crew-top"><strong><Users size={13} /> Crew</strong><small>You + up to {CREW_SLOTS} friends or family</small></div>
          <div className="ozc-crew-row">
            <span className="ozc-member me" title={context.username || 'You'}><i>{initial}</i><small>You</small></span>
            <span className="ozc-member ozone" title="Ozone"><img src={OZONE_AVATAR} alt="" /><small>Ozone</small></span>
            {Array.from({ length: CREW_SLOTS }, (_, i) => <span key={i} className="ozc-member empty" aria-label="Empty crew slot"><i><UserPlus size={14} /></i><small>Open</small></span>)}
            <button className="ozc-invite" disabled title="Crew chat is coming soon"><Lock size={11} /> Invite to crew — coming soon</button>
          </div>
        </section>

        <div className="ozc-list" ref={listRef} aria-live="polite">
          {shown.map((m) => (
            <div key={m.id} className={`ozc-row ${m.role === 'user' ? 'me' : 'oz'} ${m.local ? 'local' : ''}`}>
              {m.role === 'assistant' ? <img className="ozc-avatar" src={OZONE_AVATAR} alt="Ozone" /> : <span className="ozc-avatar me">{initial}</span>}
              <div className="ozc-bubble">{m.content}</div>
            </div>
          ))}
          {typing && <div className="ozc-row oz"><img className="ozc-avatar" src={OZONE_AVATAR} alt="Ozone" /><div className="ozc-bubble ozc-typing" aria-label="Ozone is typing"><i /><i /><i /></div></div>}
        </div>

        {showChips && <div className="ozc-chips">{SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)}><Sparkles size={11} /> {s}</button>)}</div>}

        <form className="ozc-input" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            maxLength={MAX_INPUT}
            placeholder="Message Ozone…"
            aria-label="Message Ozone"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(draft); } }}
          />
          <button type="submit" className="ozc-send" disabled={!draft.trim() || typing} aria-label="Send"><Send size={17} /></button>
        </form>
        <small className="ozc-foot">Ozone is an AI buddy and can get things wrong. Never share passwords or payment info.</small>
      </div>
    </div>
  );
}

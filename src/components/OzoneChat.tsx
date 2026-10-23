import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Send, Sparkles, Users, UserPlus, Trash2, Check, Loader2, LogOut, Search, Plus, Crown, Bot } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { sfx, haptic } from '@/lib/sfx';
import { CHAT_CHARACTERS, EXTRA_CHARACTERS, MAX_EXTRA_CHARACTERS, addressedCharacters, characterById, isPersonaId, type PersonaId } from '@/lib/characters';
import {
  CREW_SLOTS, askCrewCharacter, cancelInvite, createCrew, disbandCrew, fetchCrewInvites, fetchCrewMessages, fetchFriends, fetchMyCrews,
  fetchMyInvites, fetchRoster, inviteToCrew, leaveCrew, markCrewRead, notifyCrew, postCrewMessage, removeMember, respondInvite,
  searchProfiles, setCrewCharacters, type Crew, type CrewInvite, type CrewMember, type CrewMessage, type ProfileLite,
} from '@/lib/crew';
import '@/ozone-chat.css';

export type OzoneChatContext = { username: string; level: number; sparks: number; questsLeft: number; isSubscriber: boolean };
export type ChatTab = 'ai' | 'crew';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  name?: string;
  persona?: PersonaId;
  content: string;
  at: number;
  /** Shown in the thread but never sent to the AI (errors, the greeting). */
  local?: boolean;
};

type Props = { userId: string; context: OzoneChatContext; onClose: () => void; initialTab?: ChatTab };

const HISTORY_LIMIT = 50;
const SEND_LIMIT = 20;
const MAX_INPUT = 800;
const SUGGESTIONS = ['How do I earn more sparks?', 'Plan my day', 'How do cashouts work?', 'Best game for me?'];

const storageKey = (uid: string) => `ozone_chat_${uid}`;
const charsKey = (uid: string) => `ozone_chat_chars_${uid}`;
const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`);
const timeLabel = (t: number | string) => {
  const d = new Date(t);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

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
function loadChars(userId: string): PersonaId[] {
  try { const l = JSON.parse(localStorage.getItem(charsKey(userId)) ?? '[]') as unknown[]; return l.filter((c): c is PersonaId => isPersonaId(c) && c !== 'ozone').slice(0, MAX_EXTRA_CHARACTERS); } catch { return []; }
}

function greeting(name: string): ChatMessage {
  return { id: 'greet', role: 'assistant', persona: 'ozone', local: true, at: Date.now(), content: `Yo${name ? ` ${name}` : ''}! Ozone here ⚡ Ask me how to stack sparks, plan your day, or which game fits your vibe. Tap "Add character" to call in Volt, Ember, or Nova, then @mention them.` };
}

// ---------- shared: character strip + picker ----------
function CharacterStrip({ chars, onChange, disabled }: { chars: PersonaId[]; onChange: (next: PersonaId[]) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const toggle = (id: PersonaId) => {
    const has = chars.includes(id);
    if (!has && chars.length >= MAX_EXTRA_CHARACTERS) return;
    onChange(has ? chars.filter((c) => c !== id) : [...chars, id]);
    sfx.tap();
  };
  return (
    <div className="ozc-chars">
      <div className="ozc-crew-row">
        {['ozone' as PersonaId, ...chars].map((id) => {
          const c = characterById(id);
          return <span key={id} className="ozc-member ozone" title={`${c.name}: ${c.blurb}`}><img src={c.image} alt="" /><small>{c.name}</small></span>;
        })}
        <button type="button" className="ozc-pill" onClick={() => setOpen((v) => !v)} disabled={disabled} aria-expanded={open}><Bot size={12} /> Add character</button>
      </div>
      {open && (
        <div className="ozc-picker" role="group" aria-label="Characters in this chat">
          {EXTRA_CHARACTERS.map((c) => {
            const on = chars.includes(c.id);
            return (
              <button key={c.id} type="button" className={`ozc-pick ${on ? 'on' : ''}`} onClick={() => toggle(c.id)} disabled={disabled || (!on && chars.length >= MAX_EXTRA_CHARACTERS)}>
                <img src={c.image} alt="" /><span><b>{c.name}</b><small>{c.blurb}</small></span>{on ? <Check size={14} /> : <Plus size={14} />}
              </button>
            );
          })}
          <small className="ozc-hint">Type @{EXTRA_CHARACTERS[0].name} (or start with their name) to get a reply in their voice. Ozone answers when nobody is named.</small>
        </div>
      )}
    </div>
  );
}

// ---------- solo Ozone (AI) chat ----------
function SoloChat({ userId, context, active }: { userId: string; context: OzoneChatContext; active: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory(userId));
  const [chars, setChars] = useState<PersonaId[]>(() => loadChars(userId));
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState<PersonaId | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const ctxRef = useRef(context);
  ctxRef.current = context;

  useEffect(() => { saveHistory(userId, messages); }, [userId, messages]);
  useEffect(() => { try { localStorage.setItem(charsKey(userId), JSON.stringify(chars)); } catch { /* ignore */ } }, [userId, chars]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }, [messages, typing, active]);
  useEffect(() => { if (!active) return; const t = window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 250); return () => window.clearTimeout(t); }, [active]);

  const shown = useMemo(() => (messages.length ? messages : [greeting(context.username)]), [messages, context.username]);

  const send = async (text: string) => {
    const content = text.replace(/\s+$/g, '').trim().slice(0, MAX_INPUT);
    if (!content || typing) return;
    sfx.tap(); haptic(8);
    const mine: ChatMessage = { id: uid(), role: 'user', name: context.username || undefined, content, at: Date.now() };
    let thread = [...messages, mine];
    setMessages(thread);
    setDraft('');
    const present: PersonaId[] = ['ozone', ...chars];
    const targets = addressedCharacters(content, present);
    const repliers = targets.length ? targets : ['ozone' as PersonaId];
    const { data: { session } } = await supabase.auth.getSession();
    for (const persona of repliers) {
      setTyping(persona);
      const push = (m: Omit<ChatMessage, 'id' | 'at'>) => { const row = { ...m, id: uid(), at: Date.now() }; thread = [...thread, row].slice(-HISTORY_LIMIT); setMessages(thread); };
      const who = characterById(persona).name;
      try {
        const payload = {
          persona,
          messages: thread.filter((m) => !m.local).slice(-SEND_LIMIT).map((m) => ({ role: m.role, name: m.name, persona: m.persona, content: m.content.slice(0, MAX_INPUT) })),
          context: ctxRef.current,
        };
        const res = await fetch('/api/ozone-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
          body: JSON.stringify(payload),
        });
        const body = (await res.json().catch(() => ({}))) as { reply?: string; error?: string };
        if (res.ok && body.reply) { push({ role: 'assistant', persona, content: body.reply }); sfx.mascot('happy'); }
        else if (res.status === 503) { push({ role: 'assistant', persona, local: true, content: `${who}'s brain is warming up 🧠⚡ AI chat isn't switched on just yet. Check back soon!` }); sfx.mascot('squish'); break; }
        else { push({ role: 'assistant', persona, local: true, content: body.error || `${who} lost signal for a sec. Try again!` }); sfx.mascot('squish'); if (res.status === 401 || res.status === 429) break; }
      } catch {
        push({ role: 'assistant', persona, local: true, content: `${who} lost signal for a sec. Check your connection and try again!` });
        sfx.mascot('squish');
        break;
      }
    }
    setTyping(null);
  };

  const clearChat = () => { if (!messages.length || confirm('Clear your AI chat?')) { setMessages([]); sfx.tap(); } };
  const initial = (context.username || '?').charAt(0).toUpperCase();
  const showChips = !typing && messages.filter((m) => m.role === 'user').length < 3;

  return (
    <div className="ozc-pane" hidden={!active}>
      <div className="ozc-pane-top">
        <CharacterStrip chars={chars} onChange={setChars} />
        <button className="ozc-icon" onClick={clearChat} aria-label="Clear chat" title="Clear chat"><Trash2 size={15} /></button>
      </div>
      <div className="ozc-list" ref={listRef} aria-live="polite">
        {shown.map((m) => {
          const c = characterById(m.persona);
          return (
            <div key={m.id} className={`ozc-row ${m.role === 'user' ? 'me' : 'oz'} ${m.local ? 'local' : ''}`}>
              {m.role === 'assistant' ? <img className="ozc-avatar" src={c.image} alt={c.name} /> : <span className="ozc-avatar me">{initial}</span>}
              <div className="ozc-msg">
                <span className="ozc-meta">{m.role === 'assistant' ? <b>{c.name}</b> : <b>You</b>} · {timeLabel(m.at)}</span>
                <div className="ozc-bubble">{m.content}</div>
              </div>
            </div>
          );
        })}
        {typing && <div className="ozc-row oz"><img className="ozc-avatar" src={characterById(typing).image} alt={characterById(typing).name} /><div className="ozc-bubble ozc-typing" aria-label={`${characterById(typing).name} is typing`}><i /><i /><i /></div></div>}
      </div>
      {showChips && <div className="ozc-chips">{SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)}><Sparkles size={11} /> {s}</button>)}</div>}
      <form className="ozc-input" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <textarea
          ref={inputRef} rows={1} value={draft} maxLength={MAX_INPUT}
          placeholder={chars.length ? `Message Ozone, or @${characterById(chars[0]).name}…` : 'Message Ozone…'}
          aria-label="Message Ozone"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(draft); } }}
        />
        <button type="submit" className="ozc-send" disabled={!draft.trim() || !!typing} aria-label="Send"><Send size={17} /></button>
      </form>
    </div>
  );
}

// ---------- crew chat ----------
function InvitePanel({ userId, crew, roster, invites, onChanged }: { userId: string; crew: Crew; roster: CrewMember[]; invites: CrewInvite[]; onChanged: () => void }) {
  const [friends, setFriends] = useState<ProfileLite[] | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProfileLite[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fetchFriends(userId).then(setFriends).catch(() => setFriends([])); }, [userId]);
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    const t = window.setTimeout(() => { searchProfiles(query, userId).then(setResults).catch(() => setResults([])); }, 300);
    return () => window.clearTimeout(t);
  }, [query, userId]);
  const inCrew = new Set(roster.map((r) => r.user_id));
  const pending = new Map(invites.map((i) => [i.invitee_id, i.id]));
  const full = roster.filter((r) => r.role !== 'owner').length + invites.length >= CREW_SLOTS;
  const invite = async (p: ProfileLite) => {
    setBusy(p.id); setErr(null);
    try { await inviteToCrew(crew.id, p.id); sfx.tap(); onChanged(); } catch (e) { setErr(e instanceof Error ? e.message : 'Could not invite'); }
    finally { setBusy(null); }
  };
  const row = (p: ProfileLite) => {
    const state = inCrew.has(p.id) ? 'in' : pending.has(p.id) ? 'pending' : 'open';
    return (
      <div key={p.id} className="ozc-person">
        <span className="ozc-avatar me">{p.username.charAt(0).toUpperCase()}</span>
        <b>{p.username}</b>
        {state === 'in' ? <span className="ozc-tag">In crew</span>
          : state === 'pending' ? <span className="ozc-tag">Invited</span>
          : <button type="button" className="ozc-pill solid" disabled={full || busy === p.id} onClick={() => invite(p)}>{busy === p.id ? <Loader2 className="spin" size={12} /> : <UserPlus size={12} />} Add to crew</button>}
      </div>
    );
  };
  return (
    <div className="ozc-invite-panel">
      <small className="ozc-hint">{full ? 'Your crew is full (you + 4). Remove someone or cancel an invite to add more.' : `Invite up to ${CREW_SLOTS} friends or family. They'll get an invite to accept.`}</small>
      {err && <small className="ozc-err">{err}</small>}
      <strong className="ozc-sub">Your friends</strong>
      {friends === null ? <Loader2 className="spin" size={14} /> : friends.length === 0 ? <small className="ozc-hint">No friends yet. Search by username below, or add friends from Find friends.</small> : friends.map(row)}
      <label className="ozc-search"><Search size={13} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Or search any username" maxLength={30} /></label>
      {results.filter((r) => !(friends ?? []).some((f) => f.id === r.id)).map(row)}
    </div>
  );
}

function CrewChat({ userId, context, active, onUnread }: { userId: string; context: OzoneChatContext; active: boolean; onUnread: (v: boolean) => void }) {
  const [crews, setCrews] = useState<Crew[] | null>(null);
  const [crewId, setCrewId] = useState<string | null>(null);
  const [myInvites, setMyInvites] = useState<CrewInvite[]>([]);
  const [roster, setRoster] = useState<CrewMember[]>([]);
  const [invites, setInvites] = useState<CrewInvite[]>([]);
  const [messages, setMessages] = useState<CrewMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [typing, setTyping] = useState<PersonaId[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const ctxRef = useRef(context);
  ctxRef.current = context;
  const activeRef = useRef(active);
  activeRef.current = active;

  const crew = crews?.find((c) => c.id === crewId) ?? null;
  const isOwner = !!crew && crew.owner_id === userId;

  const loadCrews = useCallback(async () => {
    try {
      const [list, inv] = await Promise.all([fetchMyCrews(userId), fetchMyInvites(userId)]);
      setCrews(list); setMyInvites(inv);
      setCrewId((cur) => (cur && list.some((c) => c.id === cur) ? cur : list[0]?.id ?? null));
    } catch { setCrews([]); setErr('Crew chat is not reachable right now.'); }
  }, [userId]);
  useEffect(() => { loadCrews(); }, [loadCrews]);

  const loadCrewDetails = useCallback(async (id: string) => {
    const [r, i] = await Promise.all([fetchRoster(id), fetchCrewInvites(id).catch(() => [])]);
    setRoster(r); setInvites(i);
  }, []);

  // load + live messages for the selected crew
  useEffect(() => {
    if (!crewId) { setMessages([]); setRoster([]); setInvites([]); return; }
    let alive = true;
    fetchCrewMessages(crewId).then((m) => { if (alive) setMessages(m); }).catch(() => {});
    loadCrewDetails(crewId).catch(() => {});
    const ch = supabase.channel(`crew-${crewId}-${uid()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'crew_messages', filter: `crew_id=eq.${crewId}` }, (p) => {
        const m = p.new as CrewMessage;
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m].slice(-200)));
        if (m.is_bot && m.persona) setTyping((t) => t.filter((x) => x !== m.persona));
        if (m.user_id !== userId) { if (activeRef.current) markCrewRead(crewId, m.created_at); else onUnread(true); sfx.tap(); }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_invites', filter: `crew_id=eq.${crewId}` }, () => { loadCrewDetails(crewId).catch(() => {}); })
      .subscribe();
    return () => { alive = false; supabase.removeChannel(ch); };
  }, [crewId, userId, loadCrewDetails, onUnread]);

  // invites addressed to me, live
  useEffect(() => {
    const ch = supabase.channel(`my-invites-${userId}-${uid()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_invites', filter: `invitee_id=eq.${userId}` }, () => { fetchMyInvites(userId).then(setMyInvites).catch(() => {}); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  useEffect(() => {
    if (active && crewId && messages.length) markCrewRead(crewId, messages[messages.length - 1].created_at);
    if (active) onUnread(false);
  }, [active, crewId, messages, onUnread]);
  useEffect(() => { if (myInvites.length > 0 && !active) onUnread(true); }, [myInvites, active, onUnread]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }, [messages, typing, active]);

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true); setErr(null);
    try { await fn(); after?.(); } catch (e) { setErr(e instanceof Error ? e.message : 'Something went wrong'); } finally { setBusy(false); }
  };

  const present: PersonaId[] = ['ozone', ...((crew?.characters ?? []) as PersonaId[])];

  const send = async (text: string) => {
    const body = text.trim().slice(0, MAX_INPUT);
    if (!body || !crewId) return;
    sfx.tap(); haptic(8); setDraft(''); setErr(null);
    let msg: CrewMessage;
    try { msg = await postCrewMessage(crewId, userId, body); }
    catch (e) { setDraft(body); setErr(e instanceof Error ? e.message : 'Could not send'); return; }
    setMessages((prev) => (prev.some((x) => x.id === msg.id) ? prev : [...prev, msg]));
    markCrewRead(crewId, msg.created_at);
    notifyCrew(msg.id);
    const targets = addressedCharacters(body, present);
    for (const persona of targets) {
      setTyping((t) => [...t, persona]);
      const out = await askCrewCharacter(crewId, msg.id, persona, ctxRef.current);
      if (out.message) setMessages((prev) => (prev.some((x) => x.id === out.message!.id) ? prev : [...prev, out.message!]));
      setTyping((t) => t.filter((x) => x !== persona));
      if (!out.ok) {
        const name = characterById(persona).name;
        setErr(out.status === 503 ? `${name}'s AI isn't switched on yet. Check back soon!` : out.error || `${name} lost signal. Try again.`);
        if (out.status === 503 || out.status === 401) break;
      }
    }
  };

  const changeChars = (next: PersonaId[]) => {
    if (!crew) return;
    setCrews((list) => list?.map((c) => (c.id === crew.id ? { ...c, characters: next } : c)) ?? list);
    setCrewCharacters(crew.id, next).catch((e) => { setErr(e instanceof Error ? e.message : 'Could not update characters'); loadCrews(); });
  };

  // --- render ---
  if (crews === null) return <div className="ozc-pane" hidden={!active}><div className="ozc-empty"><Loader2 className="spin" size={18} /></div></div>;

  const inviteCards = myInvites.length > 0 && (
    <div className="ozc-invites">
      {myInvites.map((i) => (
        <div key={i.id} className="ozc-invite-card">
          <span><b>{i.inviter || 'A friend'}</b> invited you to <b>{i.crew_name}</b></span>
          <div>
            <button type="button" className="ozc-pill solid" disabled={busy} onClick={() => run(() => respondInvite(i.id, true), () => { loadCrews().then(() => setCrewId(i.crew_id)); })}><Check size={12} /> Accept</button>
            <button type="button" className="ozc-pill" disabled={busy} onClick={() => run(() => respondInvite(i.id, false), loadCrews)}>Decline</button>
          </div>
        </div>
      ))}
    </div>
  );

  const ownsCrew = crews.some((c) => c.owner_id === userId);

  if (!crew) {
    return (
      <div className="ozc-pane" hidden={!active}>
        {inviteCards}
        <div className="ozc-empty">
          <Users size={28} />
          <h3>Start your crew</h3>
          <p>Group chat with up to {CREW_SLOTS} friends or family, plus Ozone and the gang. Say “@ozone” to get the AI in on it.</p>
          <form className="ozc-create" onSubmit={(e) => { e.preventDefault(); run(() => createCrew(newName || 'My Crew'), loadCrews); }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Crew name (e.g. Sunday Squad)" maxLength={40} />
            <button type="submit" className="ozc-pill solid" disabled={busy}>{busy ? <Loader2 className="spin" size={12} /> : <Plus size={12} />} Create crew</button>
          </form>
          {err && <small className="ozc-err">{err}</small>}
        </div>
      </div>
    );
  }

  return (
    <div className="ozc-pane" hidden={!active}>
      {inviteCards}
      {crews.length > 1 && (
        <div className="ozc-crew-tabs">{crews.map((c) => <button key={c.id} type="button" className={c.id === crewId ? 'on' : ''} onClick={() => setCrewId(c.id)}>{c.name}</button>)}</div>
      )}
      <section className="ozc-crew" aria-label="Your crew">
        <div className="ozc-crew-top">
          <strong><Users size={13} /> {crew.name}</strong>
          <small>{roster.length}/{CREW_SLOTS + 1} players{invites.length ? ` · ${invites.length} invited` : ''}</small>
        </div>
        <div className="ozc-crew-row">
          {roster.map((m) => (
            <span key={m.user_id} className={`ozc-member ${m.user_id === userId ? 'me' : ''}`} title={m.username || 'Player'}>
              <i>{(m.username || '?').charAt(0).toUpperCase()}</i><small>{m.user_id === userId ? 'You' : (m.username || 'Player')}{m.role === 'owner' ? ' 👑' : ''}</small>
            </span>
          ))}
          {isOwner && <button type="button" className="ozc-pill" onClick={() => { setShowInvite((v) => !v); setShowRoster(false); }} aria-expanded={showInvite}><UserPlus size={12} /> Invite</button>}
          <button type="button" className="ozc-pill" onClick={() => { setShowRoster((v) => !v); setShowInvite(false); }} aria-expanded={showRoster}>Manage</button>
        </div>
        <CharacterStrip chars={(crew.characters ?? []) as PersonaId[]} onChange={changeChars} />
        {showInvite && isOwner && <InvitePanel userId={userId} crew={crew} roster={roster} invites={invites} onChanged={() => loadCrewDetails(crew.id)} />}
        {showRoster && (
          <div className="ozc-invite-panel">
            {roster.map((m) => (
              <div key={m.user_id} className="ozc-person">
                <span className="ozc-avatar me">{(m.username || '?').charAt(0).toUpperCase()}</span>
                <b>{m.username || 'Player'}{m.user_id === userId ? ' (you)' : ''}</b>
                {m.role === 'owner' ? <span className="ozc-tag"><Crown size={11} /> Owner</span>
                  : isOwner ? <button type="button" className="ozc-pill" disabled={busy} onClick={() => { if (confirm(`Remove ${m.username || 'this player'} from the crew?`)) run(() => removeMember(crew.id, m.user_id), () => loadCrewDetails(crew.id)); }}>Remove</button> : null}
              </div>
            ))}
            {invites.map((i) => (
              <div key={i.id} className="ozc-person">
                <span className="ozc-avatar me">{(i.invitee || '?').charAt(0).toUpperCase()}</span>
                <b>{i.invitee || 'Player'}</b><span className="ozc-tag">Invited</span>
                {isOwner && <button type="button" className="ozc-pill" disabled={busy} onClick={() => run(() => cancelInvite(i.id), () => loadCrewDetails(crew.id))}>Cancel</button>}
              </div>
            ))}
            <div className="ozc-actions">
              {isOwner
                ? <button type="button" className="ozc-pill danger" disabled={busy} onClick={() => { if (confirm(`Disband ${crew.name}? The chat history will be deleted for everyone.`)) run(() => disbandCrew(crew.id), loadCrews); }}><Trash2 size={12} /> Disband crew</button>
                : <button type="button" className="ozc-pill danger" disabled={busy} onClick={() => { if (confirm(`Leave ${crew.name}?`)) run(() => leaveCrew(crew.id), loadCrews); }}><LogOut size={12} /> Leave crew</button>}
              {!ownsCrew && <button type="button" className="ozc-pill" disabled={busy} onClick={() => run(() => createCrew('My Crew'), loadCrews)}><Plus size={12} /> Start my own crew</button>}
            </div>
          </div>
        )}
      </section>

      <div className="ozc-list" ref={listRef} aria-live="polite">
        {messages.length === 0 && <div className="ozc-empty small"><p>No messages yet. Say hi, or try “@ozone plan a crew day for us”.</p></div>}
        {messages.map((m) => {
          const mine = !m.is_bot && m.user_id === userId;
          const c = m.is_bot ? characterById(m.persona) : null;
          const name = c ? c.name : mine ? 'You' : (m.username || 'Player');
          return (
            <div key={m.id} className={`ozc-row ${mine ? 'me' : 'oz'} ${m.is_bot ? 'bot' : ''}`}>
              {c ? <img className="ozc-avatar" src={c.image} alt={c.name} /> : <span className="ozc-avatar me">{(m.username || '?').charAt(0).toUpperCase()}</span>}
              <div className="ozc-msg">
                <span className="ozc-meta"><b>{name}</b>{c ? ' · AI' : ''} · {timeLabel(m.created_at)}</span>
                <div className="ozc-bubble">{m.body}</div>
              </div>
            </div>
          );
        })}
        {typing.map((p) => <div key={p} className="ozc-row oz"><img className="ozc-avatar" src={characterById(p).image} alt={characterById(p).name} /><div className="ozc-bubble ozc-typing" aria-label={`${characterById(p).name} is typing`}><i /><i /><i /></div></div>)}
      </div>
      {err && <small className="ozc-err">{err}</small>}
      <form className="ozc-input" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
        <textarea
          rows={1} value={draft} maxLength={MAX_INPUT}
          placeholder={`Message ${crew.name}… (@ozone for AI)`}
          aria-label={`Message ${crew.name}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(draft); } }}
        />
        <button type="submit" className="ozc-send" disabled={!draft.trim()} aria-label="Send"><Send size={17} /></button>
      </form>
    </div>
  );
}

export default function OzoneChat({ userId, context, onClose, initialTab = 'ai' }: Props) {
  const [tab, setTab] = useState<ChatTab>(initialTab);
  const [crewUnread, setCrewUnread] = useState(false);
  useEffect(() => { setTab(initialTab); }, [initialTab]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const onUnread = useCallback((v: boolean) => setCrewUnread(v), []);
  const ozone = CHAT_CHARACTERS[0];

  return (
    <div className="ozc-backdrop" onClick={onClose}>
      <div className="ozc-sheet" role="dialog" aria-label="Chat" onClick={(e) => e.stopPropagation()}>
        <header className="ozc-head">
          <div className="ozc-title">
            <img className="ozc-avatar lg" src={ozone.image} alt="" />
            <div><p className="eyebrow">OZONE / FIELD CHAT</p><h2>{tab === 'ai' ? 'Chat with Ozone' : 'Crew chat'}</h2></div>
          </div>
          <div className="ozc-head-actions">
            <button className="ozc-icon" onClick={onClose} aria-label="Close chat"><X size={17} /></button>
          </div>
        </header>
        <div className="ozc-tabs" role="tablist" aria-label="Chat mode">
          <button role="tab" aria-selected={tab === 'ai'} className={tab === 'ai' ? 'on' : ''} onClick={() => setTab('ai')}><Sparkles size={13} /> Ozone (AI)</button>
          <button role="tab" aria-selected={tab === 'crew'} className={tab === 'crew' ? 'on' : ''} onClick={() => setTab('crew')}><Users size={13} /> Crew{crewUnread && tab !== 'crew' && <i className="ozc-dot" aria-label="unread" />}</button>
        </div>
        <SoloChat userId={userId} context={context} active={tab === 'ai'} />
        <CrewChat userId={userId} context={context} active={tab === 'crew'} onUnread={onUnread} />
        <small className="ozc-foot">Ozone and the crew characters are AI and can get things wrong. Never share passwords or payment info.</small>
      </div>
    </div>
  );
}

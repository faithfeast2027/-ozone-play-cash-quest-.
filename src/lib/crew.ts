import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { PersonaId } from '@/lib/characters';

export type Crew = { id: string; owner_id: string; name: string; characters: PersonaId[]; created_at: string };
export type CrewMember = { crew_id: string; user_id: string; role: 'owner' | 'member'; joined_at: string; username?: string | null };
export type CrewInvite = { id: string; crew_id: string; invitee_id: string; invited_by: string | null; status: string; created_at: string; crew_name?: string; inviter?: string | null; invitee?: string | null };
export type CrewMessage = { id: string; crew_id: string; user_id: string | null; username: string | null; body: string; is_bot: boolean; persona: PersonaId | null; reply_to: string | null; created_at: string };
export type ProfileLite = { id: string; username: string; avatar_character?: string | null };

export const CREW_SLOTS = 4;
const READ_KEY = (crewId: string) => `ozone_crew_read_${crewId}`;
const READ_EVENT = 'ozone-crew-read';

/** Last-read time (ms) for a crew on this device. */
export function lastRead(crewId: string) { try { return Number(localStorage.getItem(READ_KEY(crewId)) ?? 0) || 0; } catch { return 0; } }
export function markCrewRead(crewId: string, at: string | number = Date.now()) {
  const t = typeof at === 'number' ? at : Date.parse(at);
  try { if (t > lastRead(crewId)) localStorage.setItem(READ_KEY(crewId), String(t)); } catch { /* ignore */ }
  window.dispatchEvent(new Event(READ_EVENT));
}

async function usernames(ids: string[]): Promise<Record<string, string | null>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const { data } = await supabase.from('profiles').select('id, username').in('id', uniq);
  return Object.fromEntries((data ?? []).map((p: { id: string; username: string | null }) => [p.id, p.username]));
}

export async function fetchMyCrews(userId: string): Promise<Crew[]> {
  const { data: mem, error } = await supabase.from('crew_members').select('crew_id').eq('user_id', userId);
  if (error) throw error;
  const ids = (mem ?? []).map((m: { crew_id: string }) => m.crew_id);
  if (!ids.length) return [];
  const { data, error: e2 } = await supabase.from('crews').select('id, owner_id, name, characters, created_at').in('id', ids).order('created_at');
  if (e2) throw e2;
  return (data ?? []) as Crew[];
}

export async function fetchRoster(crewId: string): Promise<CrewMember[]> {
  const { data, error } = await supabase.from('crew_members').select('crew_id, user_id, role, joined_at').eq('crew_id', crewId).order('joined_at');
  if (error) throw error;
  const rows = (data ?? []) as CrewMember[];
  const names = await usernames(rows.map((r) => r.user_id));
  return rows.map((r) => ({ ...r, username: names[r.user_id] ?? null }));
}

export async function fetchCrewInvites(crewId: string): Promise<CrewInvite[]> {
  const { data, error } = await supabase.from('crew_invites').select('id, crew_id, invitee_id, invited_by, status, created_at').eq('crew_id', crewId).eq('status', 'pending');
  if (error) throw error;
  const rows = (data ?? []) as CrewInvite[];
  const names = await usernames(rows.map((r) => r.invitee_id));
  return rows.map((r) => ({ ...r, invitee: names[r.invitee_id] ?? null }));
}

export async function fetchMyInvites(userId: string): Promise<CrewInvite[]> {
  const { data, error } = await supabase.from('crew_invites').select('id, crew_id, invitee_id, invited_by, status, created_at').eq('invitee_id', userId).eq('status', 'pending');
  if (error) throw error;
  const rows = (data ?? []) as CrewInvite[];
  if (!rows.length) return [];
  const [{ data: crews }, names] = await Promise.all([
    supabase.from('crews').select('id, name').in('id', rows.map((r) => r.crew_id)),
    usernames(rows.map((r) => r.invited_by ?? '')),
  ]);
  const crewName = Object.fromEntries((crews ?? []).map((c: { id: string; name: string }) => [c.id, c.name]));
  return rows.map((r) => ({ ...r, crew_name: crewName[r.crew_id] ?? 'A crew', inviter: r.invited_by ? names[r.invited_by] ?? null : null }));
}

export async function fetchCrewMessages(crewId: string, limit = 60): Promise<CrewMessage[]> {
  const { data, error } = await supabase.from('crew_messages')
    .select('id, crew_id, user_id, username, body, is_bot, persona, reply_to, created_at')
    .eq('crew_id', crewId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return ((data ?? []) as CrewMessage[]).reverse();
}

/** Friends from the friendships table, both directions (people I added and people who added me). */
export async function fetchFriends(userId: string): Promise<ProfileLite[]> {
  const { data, error } = await supabase.from('friendships').select('user_id, friend_id').or(`user_id.eq.${userId},friend_id.eq.${userId}`);
  if (error) throw error;
  const ids = [...new Set((data ?? []).map((r: { user_id: string; friend_id: string }) => (r.user_id === userId ? r.friend_id : r.user_id)))].filter((id) => id !== userId);
  if (!ids.length) return [];
  const { data: profs } = await supabase.from('profiles').select('id, username, avatar_character').in('id', ids).order('username');
  return ((profs ?? []) as ProfileLite[]).filter((p) => p.username);
}

export async function searchProfiles(term: string, exclude: string): Promise<ProfileLite[]> {
  const safe = term.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  if (safe.length < 2) return [];
  const { data, error } = await supabase.from('profiles').select('id, username, avatar_character').ilike('username', `%${safe}%`).neq('id', exclude).order('username').limit(15);
  if (error) throw error;
  return (data ?? []) as ProfileLite[];
}

const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
};
export const createCrew = (name: string) => rpc<string>('create_crew', { p_name: name });
export const inviteToCrew = (crewId: string, userId: string) => rpc<string>('invite_to_crew', { p_crew: crewId, p_user: userId });
export const respondInvite = (inviteId: string, accept: boolean) => rpc<string>('respond_crew_invite', { p_invite: inviteId, p_accept: accept });
export const cancelInvite = (inviteId: string) => rpc<void>('cancel_crew_invite', { p_invite: inviteId });
export const leaveCrew = (crewId: string) => rpc<void>('leave_crew', { p_crew: crewId });
export const removeMember = (crewId: string, userId: string) => rpc<void>('remove_crew_member', { p_crew: crewId, p_user: userId });
export const disbandCrew = (crewId: string) => rpc<void>('disband_crew', { p_crew: crewId });
export const setCrewCharacters = (crewId: string, chars: PersonaId[]) => rpc<PersonaId[]>('set_crew_characters', { p_crew: crewId, p_chars: chars.filter((c) => c !== 'ozone') });

export async function postCrewMessage(crewId: string, userId: string, body: string): Promise<CrewMessage> {
  const { data, error } = await supabase.from('crew_messages').insert({ crew_id: crewId, user_id: userId, body })
    .select('id, crew_id, user_id, username, body, is_bot, persona, reply_to, created_at').single();
  if (error) throw new Error(error.message);
  return data as CrewMessage;
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` };
}

/** Tell the other crew members (push), fire and forget. */
export async function notifyCrew(messageId: string) {
  try { await fetch('/api/push-send', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ kind: 'crew', messageId }) }); } catch { /* best effort */ }
}

/** Ask a character to answer a crew message. The server posts the reply into the crew (arrives via realtime). */
export async function askCrewCharacter(crewId: string, messageId: string, persona: PersonaId, context: object): Promise<{ ok: boolean; status: number; error?: string; message?: CrewMessage }> {
  try {
    const res = await fetch('/api/ozone-chat', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ crewId, messageId, persona, context }) });
    const body = (await res.json().catch(() => ({}))) as { error?: string; message?: CrewMessage };
    return { ok: res.ok, status: res.status, error: body.error, message: body.message };
  } catch { return { ok: false, status: 0, error: 'Lost signal. Try again.' }; }
}

/**
 * Unread state for the chat icon: true when any of my crews has a message newer than my last read
 * (not sent by me) or when I have a pending crew invite. Live via Supabase realtime.
 */
export function useCrewUnread(userId: string | undefined, paused: boolean) {
  const [unread, setUnread] = useState(false);
  useEffect(() => {
    if (!userId) { setUnread(false); return; }
    let alive = true;
    const check = async () => {
      try {
        const [crews, invites] = await Promise.all([fetchMyCrews(userId), fetchMyInvites(userId)]);
        let any = invites.length > 0;
        if (!any && crews.length) {
          for (const c of crews) {
            const { data } = await supabase.from('crew_messages').select('created_at').eq('crew_id', c.id)
              .or(`user_id.neq.${userId},user_id.is.null`).order('created_at', { ascending: false }).limit(1);
            const latest = data?.[0]?.created_at as string | undefined;
            if (latest && Date.parse(latest) > lastRead(c.id)) { any = true; break; }
          }
        }
        if (alive) setUnread(any);
      } catch { /* crew tables not reachable: no dot */ }
    };
    check();
    const onRead = () => { check(); };
    window.addEventListener(READ_EVENT, onRead);
    const ch = supabase.channel(`crew-unread-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'crew_messages' }, (p) => {
        const m = p.new as CrewMessage;
        if (m.user_id !== userId && !paused) setUnread(true);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'crew_invites' }, () => { check(); })
      .subscribe();
    return () => { alive = false; window.removeEventListener(READ_EVENT, onRead); supabase.removeChannel(ch); };
  }, [userId, paused]);
  return unread;
}

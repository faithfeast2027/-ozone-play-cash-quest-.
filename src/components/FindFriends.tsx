import { useEffect, useState } from 'react';
import { Check, Loader2, Search, UserPlus, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Profile = { id: string; username: string; avatar_character: string | null };

type Props = {
  currentUserId: string;
  onClose: () => void;
};

const SETUP_CODES = ['PGRST205', '42P01', 'PGRST200'];

export default function FindFriends({ currentUserId, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [friendIds, setFriendIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => {
    supabase
      .from('friendships')
      .select('friend_id')
      .eq('user_id', currentUserId)
      .then(({ data, error: err }) => {
        if (err) { if (SETUP_CODES.includes(err.code)) setNeedsSetup(true); return; }
        setFriendIds((data ?? []).map((row: { friend_id: string }) => row.friend_id));
      });
  }, [currentUserId]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setResults([]); setLoading(false); return; }
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const safe = term.replace(/[\\%_]/g, (c) => `\\${c}`);
      const { data, error: err } = await supabase
        .from('profiles')
        .select('id, username, avatar_character')
        .ilike('username', `%${safe}%`)
        .neq('id', currentUserId)
        .order('username')
        .limit(20);
      setLoading(false);
      if (err) {
        if (SETUP_CODES.includes(err.code)) setNeedsSetup(true);
        else setError('Search failed. Try again.');
        setResults([]);
        return;
      }
      setError(null);
      setResults((data ?? []) as Profile[]);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, currentUserId]);

  const addFriend = async (id: string) => {
    setAddingId(id);
    const { error: err } = await supabase.from('friendships').insert({ user_id: currentUserId, friend_id: id });
    setAddingId(null);
    if (err && err.code !== '23505') { setError(SETUP_CODES.includes(err.code) ? null : 'Could not add friend. Try again.'); if (SETUP_CODES.includes(err.code)) setNeedsSetup(true); return; }
    setFriendIds((prev) => [...prev, id]);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="store-modal" onClick={(event) => event.stopPropagation()} style={{ width: 'min(460px, 100%)' }}>
        <button className="modal-close" onClick={onClose} aria-label="Close"><X size={17} /></button>
        <p className="eyebrow">FIELD NETWORK / FIND FRIENDS</p>
        <h2>Find your crew.</h2>
        <p className="store-subtitle">Search other operators by username and add them as friends.</p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '16px 0 12px', padding: '11px 13px', borderRadius: 13, border: '1px solid #34444a', background: '#0d1519' }}>
          <Search size={16} color="#b9f17b" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search usernames"
            maxLength={30}
            style={{ flex: 1, minWidth: 0, background: 'transparent', border: 0, outline: 'none', color: '#e6eee9', fontSize: 14 }}
          />
          {loading && <Loader2 className="spin" size={15} />}
        </label>
        {needsSetup && <div className="checkout-error">Find Friends needs a one-time database setup (profiles + friendships tables). Run find-friends.sql in Supabase, then try again.</div>}
        {error && <div className="checkout-error">{error}</div>}
        <div style={{ display: 'grid', gap: 8, maxHeight: '48vh', overflowY: 'auto' }}>
          {!needsSetup && query.trim().length >= 2 && !loading && results.length === 0 && !error && (
            <p style={{ color: '#84939a', fontSize: 12, textAlign: 'center', padding: '18px 0' }}>No operators found for “{query.trim()}”.</p>
          )}
          {query.trim().length < 2 && !needsSetup && (
            <p style={{ color: '#84939a', fontSize: 12, textAlign: 'center', padding: '18px 0' }}><Users size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />Type at least 2 letters to search.</p>
          )}
          {results.map((p) => {
            const added = friendIds.includes(p.id);
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 13, border: '1px solid #26343a', background: '#131d22' }}>
                <span className="avatar">{p.username.charAt(0).toUpperCase()}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ display: 'block', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.username}</strong>
                  {p.avatar_character && <small style={{ color: '#84939a', fontSize: 10 }}>Plays as {p.avatar_character}</small>}
                </span>
                <button
                  className={added ? undefined : 'primary-button'}
                  onClick={() => !added && addFriend(p.id)}
                  disabled={added || addingId === p.id}
                  style={{ padding: '8px 12px', fontSize: 11, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 5, ...(added ? { background: 'transparent', color: '#b9f17b', border: '1px solid #b9f17b55' } : {}) }}
                >
                  {addingId === p.id ? <Loader2 className="spin" size={13} /> : added ? <><Check size={13} /> Added</> : <><UserPlus size={13} /> Add friend</>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
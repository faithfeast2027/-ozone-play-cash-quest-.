import { useEffect, useState } from 'react';
import { Check, Copy, Gift, Share2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const SITE = 'https://ozone-cash-quest.netlify.app';

export function inviteLink(userId: string) {
  return `${SITE}/?ref=${userId}`;
}

export default function InviteFriends({ userId, onClose }: { userId: string; onClose: () => void }) {
  const link = inviteLink(userId);
  const [copied, setCopied] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    supabase.rpc('my_referral_count').then(({ data }) => { if (typeof data === 'number') setCount(data); });
  }, []);

  const message = 'Come play Ozone Play: Cash Quest with me. Explore the city, earn sparks, and own plots on the Live Map.';

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); }
    catch {
      const t = document.createElement('textarea'); t.value = link; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
    }
    setCopied(true); window.setTimeout(() => setCopied(false), 1800);
  };

  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: 'Ozone Play: Cash Quest', text: message, url: link }); return; } catch { return; }
    }
    copy();
  };

  const sms = `sms:?&body=${encodeURIComponent(`${message} ${link}`)}`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="store-modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(460px, 100%)' }}>
        <button className="modal-close" onClick={onClose} aria-label="Close"><X size={17} /></button>
        <p className="eyebrow">FIELD NETWORK / INVITE</p>
        <h2>Bring your crew.</h2>
        <p className="store-subtitle">Share your link. When a friend joins with it, you're auto-added as friends, you get <strong>+100 sparks</strong> and they get <strong>+50</strong>.</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '16px 0 12px', padding: '11px 13px', borderRadius: 13, border: '1px solid #34444a', background: '#0d1519' }}>
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} style={{ flex: 1, minWidth: 0, background: 'transparent', border: 0, outline: 'none', color: '#e6eee9', fontSize: 12 }} />
          <button onClick={copy} aria-label="Copy link" style={{ padding: '7px 10px', borderRadius: 10, fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }}>{copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button className="primary-button" onClick={share} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Share2 size={15} /> Share link</button>
          <a href={sms} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 12px', borderRadius: 12, border: '1px solid #34444a', color: 'inherit', textDecoration: 'none', fontSize: 13 }}>Text it</a>
        </div>
        <p style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#84939a', fontSize: 11, marginTop: 14 }}><Gift size={13} /> {count === null ? 'Invite bonuses are play sparks.' : `${count} friend${count === 1 ? '' : 's'} joined with your link. Invite bonuses are play sparks.`}</p>
      </div>
    </div>
  );
}

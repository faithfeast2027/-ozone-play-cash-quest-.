import { X, Palette, Volume2, Music2, Play, Smile, Bell, Share } from 'lucide-react';
import { SOUND_PACKS, previewSoundPack, setSoundPack, setSfxVolume, useSoundSettings, unlockAudio } from '@/lib/sfx';
import { AMBIENT_TRACKS, getAmbientTrack, setAmbientTrack, type AmbientTrackId } from '@/lib/ambient';
import { useMascotSettings, setMascotVisible, setMascotMinimized, setMascotPos, mascotSay } from '@/lib/mascot';
import { useEffect, useState } from 'react';
import { PUSH_CATEGORIES, currentSubscription, disablePush, enablePush, isIOS, isStandalone, loadPrefs, pushSupported, updatePushPrefs, type PushPrefs } from '@/lib/push';

export type Theme = 'dark' | 'white' | 'red' | 'pink';
export const THEMES: { id: Theme; label: string }[] = [
  { id: 'dark', label: 'Dark' }, { id: 'white', label: 'Light' }, { id: 'red', label: 'Red' }, { id: 'pink', label: 'Pink' },
];

type Props = {
  theme: Theme;
  onTheme: (t: Theme) => void;
  ambientOn: boolean;
  onToggleAmbient: () => void;
  onClose: () => void;
};

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" className="switch" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

function NotificationsSection() {
  const [on, setOn] = useState(false);
  const [prefs, setPrefs] = useState<PushPrefs>(loadPrefs);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const supported = pushSupported();
  const iosNeedsInstall = isIOS() && !isStandalone();
  const denied = supported && Notification.permission === 'denied';

  useEffect(() => { currentSubscription().then((s) => setOn(!!s && Notification.permission === 'granted')).catch(() => {}); }, []);

  const toggleMaster = async (v: boolean) => {
    setBusy(true); setMsg(null);
    try {
      if (v) { await enablePush(prefs); setOn(true); setMsg('Notifications are on for this device.'); }
      else { await disablePush(); setOn(false); setMsg('Notifications are off for this device.'); }
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not change notifications.'); }
    finally { setBusy(false); }
  };
  const toggleCat = async (id: keyof PushPrefs, v: boolean) => {
    const next = { ...prefs, [id]: v };
    setPrefs(next);
    try { await updatePushPrefs(next); } catch (e) { setMsg(e instanceof Error ? e.message : 'Could not save.'); }
  };

  return (
    <section className="settings-group">
      <strong><Bell size={15} /> Notifications</strong>
      {iosNeedsInstall && (
        <div className="push-hint"><Share size={13} /> <span>On iPhone, <b>Add to Home Screen first</b>: tap Share, then “Add to Home Screen”, open Ozone Play from your Home Screen, and turn notifications on there (iOS 16.4+).</span></div>
      )}
      {!supported && !iosNeedsInstall && <small>This browser doesn't support push notifications.</small>}
      {denied && <small>Notifications are blocked for this site. Allow them in your browser or phone settings, then try again.</small>}
      <div className="switch-row"><span>Push notifications</span><Switch on={on} onChange={(v) => { if (!busy && supported) toggleMaster(v); }} label="Push notifications" /></div>
      {PUSH_CATEGORIES.map((c) => (
        <div key={c.id} className="switch-row" style={{ opacity: on ? 1 : 0.5 }}>
          <span>{c.label}<small style={{ display: 'block' }}>{c.blurb}</small></span>
          <Switch on={prefs[c.id]} onChange={(v) => toggleCat(c.id, v)} label={c.label} />
        </div>
      ))}
      {busy && <small>Working…</small>}
      {msg && <small>{msg}</small>}
    </section>
  );
}

export default function SettingsSheet({ theme, onTheme, ambientOn, onToggleAmbient, onClose }: Props) {
  const { pack, volume } = useSoundSettings();
  const mascot = useMascotSettings();
  const [track, setTrack] = useState<AmbientTrackId>(getAmbientTrack());
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="store-modal settings-modal" role="dialog" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close settings"><X size={17} /></button>
        <div><p className="eyebrow">SETTINGS / YOUR FIELD</p><h2>Make it yours.</h2></div>

        <section className="settings-group">
          <strong><Palette size={15} /> Theme</strong>
          <div className="theme-swatches" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t.id} role="radio" aria-checked={theme === t.id} className={`theme-swatch ${theme === t.id ? 'active' : ''}`} onClick={() => onTheme(t.id)}>
                <i className={`sw-${t.id}`} />{t.label}
              </button>
            ))}
          </div>
        </section>

        <section className="settings-group">
          <strong><Volume2 size={15} /> Game sounds</strong>
          <small>Used by every game and by Ozone.</small>
          <div className="pack-list" role="radiogroup" aria-label="Sound pack">
            {SOUND_PACKS.map((p) => (
              <label key={p.id} className={`pack-row ${pack === p.id ? 'active' : ''}`}>
                <input type="radio" name="sound-pack" checked={pack === p.id} onChange={() => { unlockAudio(); setSoundPack(p.id); if (p.id !== 'off') previewSoundPack(p.id); }} />
                <span className="pack-emoji" aria-hidden="true">{p.emoji}</span>
                <span className="pack-copy"><b>{p.name}</b><small>{p.blurb}</small></span>
                {p.id !== 'off' && <button type="button" className="pack-preview" onClick={(e) => { e.preventDefault(); e.stopPropagation(); unlockAudio(); previewSoundPack(p.id); }} aria-label={`Preview ${p.name}`}><Play size={11} fill="currentColor" /> Preview</button>}
              </label>
            ))}
          </div>
          <div className="volume-row">
            <span>Volume</span>
            <input type="range" min={0} max={100} step={5} value={Math.round(volume * 100)} aria-label="Game sound volume" disabled={pack === 'off'}
              onChange={(e) => setSfxVolume(Number(e.target.value) / 100)}
              onPointerUp={() => { if (pack !== 'off') previewSoundPack(pack); }}
              onKeyUp={() => { if (pack !== 'off') previewSoundPack(pack); }} />
            <output>{Math.round(volume * 100)}%</output>
          </div>
        </section>

        <section className="settings-group">
          <strong><Music2 size={15} /> Ambient music</strong>
          <div className="switch-row"><span>Calming background sounds</span><Switch on={ambientOn} onChange={onToggleAmbient} label="Ambient music" /></div>
          <div className="track-chips" role="radiogroup" aria-label="Ambient track">
            {AMBIENT_TRACKS.map((t) => (
              <button key={t.id} role="radio" aria-checked={track === t.id} className={`track-chip ${track === t.id ? 'active' : ''}`} title={t.blurb}
                onClick={() => { setTrack(t.id); setAmbientTrack(t.id); if (!ambientOn) onToggleAmbient(); }}>{t.name}</button>
            ))}
          </div>
        </section>

        <NotificationsSection />

        <section className="settings-group">
          <strong><Smile size={15} /> Ozone buddy</strong>
          <div className="switch-row"><span>Show Ozone on screen</span><Switch on={mascot.visible} onChange={(v) => { setMascotVisible(v); if (v) setTimeout(() => mascotSay('I\'m back! Missed me? 😎', 'wink'), 400); }} label="Show Ozone" /></div>
          <div className="switch-row"><span>Tuck Ozone to the edge</span><Switch on={mascot.visible && mascot.minimized} onChange={(v) => { if (!mascot.visible) setMascotVisible(true); setMascotMinimized(v); }} label="Minimize Ozone" /></div>
          <button type="button" className="track-chip" style={{ justifySelf: 'start' }} onClick={() => { setMascotPos(null); setMascotVisible(true); }}>Reset Ozone's spot</button>
        </section>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Banknote,
  Bell,
  CheckCircle2,
  ChevronRight,
  Compass,
  Crosshair,
  Gem,
  Gift,
  Info,
  Loader2,
  MapPin,
  Plus,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Sun,
  Moon,
  Palette,
  Target,
  Trophy,
  Wallet as WalletIcon,
  X,
  Zap,
  Gamepad2,
  Users,
  Share2,
  Lock,
  Check,
  Footprints,
  Shell,
  Wine,
  Star,
  Coins,
  Bird,
} from 'lucide-react';
import {
  creditSparks,
  ensureWallet,
  fetchProducts,
  fetchSubscription,
  fetchWallet,
  fetchWithdrawals,
  getOrCreatePlayerId,
  requestWithdrawal,
  startCheckout,
  startSubscriptionCheckout,
  type Product,
  type Subscription,
  type Wallet as WalletRow,
  type Withdrawal,
} from '@/lib/supabase';
import { supabase, openBillingPortal } from '@/lib/supabase';
import { startAmbient, stopAmbient } from '@/lib/ambient';
import SparkRunGame, { type Character } from '@/components/SparkRunGame';
import WalkEarn from '@/components/WalkEarn';
import MancalaIsland from '@/components/MancalaIsland';
import DrunkTeaDiamond from '@/components/DrunkTeaDiamond';
import NYCStarCrush from '@/components/NYCStarCrush';
import TempleMarioRun from '@/components/TempleMarioRun';
import FloppyAngryBird from '@/components/FloppyAngryBird';
import Landing from '@/components/Landing';
import InviteFriends from './components/InviteFriends';
import FindFriends from '@/components/FindFriends';
import LiveMap from '@/components/LiveMap';

type Tab = 'explore' | 'quests' | 'wallet';
type Theme = 'dark' | 'white' | 'red';

const CHARACTERS: Character[] = [
  { id: 'mascot', name: 'Ozone', image: '/assets/Gemini_Generated_Image__(1).jpg', cost: 0, perk: 'Balanced runner', speed: 1 },
  { id: 'volt', name: 'Volt', image: '/assets/char_volt.jpg', cost: 800, perk: '+15% run speed', speed: 1.15 },
  { id: 'ember', name: 'Ember', image: '/assets/char_ember.jpg', cost: 1400, perk: '+25% run speed', speed: 1.25 },
  { id: 'nova', name: 'Nova', image: '/assets/char_nova.jpg', cost: 2200, perk: '+35% run speed', speed: 1.35 },
];

const OWNED_KEY = 'ozone_owned_characters';
const REF_KEY = 'ozone_ref';
(() => { try { const r = new URLSearchParams(window.location.search).get('ref'); if (r && /^[0-9a-f-]{36}$/i.test(r)) localStorage.setItem(REF_KEY, r); } catch { /* ignore */ } })();
type Point = { id: number; x: number; y: number; label: string; venue: string; category: 'Cafe' | 'Market' | 'Restaurant' | 'Shop'; address: string; reward: number; tone: 'mint' | 'coral' | 'gold' };

const points: Point[] = [
  { id: 1, x: 22, y: 28, label: 'Morning Signal', venue: 'Juniper Coffee Co.', category: 'Cafe', address: '18 Oak Street', reward: 45, tone: 'mint' },
  { id: 2, x: 67, y: 22, label: 'Fresh Drop', venue: 'Northside Market', category: 'Market', address: '204 Harbor Avenue', reward: 80, tone: 'coral' },
  { id: 3, x: 78, y: 58, label: 'Rare Find', venue: 'The Lantern Room', category: 'Restaurant', address: '7 Franklin Row', reward: 120, tone: 'gold' },
  { id: 4, x: 35, y: 70, label: 'Street Relay', venue: 'Common Ground', category: 'Shop', address: '91 Mercer Lane', reward: 60, tone: 'mint' },
  { id: 5, x: 52, y: 43, label: 'Chef Select', venue: 'Marlow Kitchen', category: 'Restaurant', address: '42 Union Square', reward: 150, tone: 'coral' },
];

// Fallback map center when location is denied, unavailable, or times out: Times Square, NYC.
const FALLBACK_LOCATION = { latitude: 40.758, longitude: -73.9855 };

type AppNotification = { id: string; title: string; body: string };
const NOTIFICATIONS: AppNotification[] = [
  { id: 'welcome-v1', title: 'Welcome to Ozone Play', body: 'Your field is live. Collect a nearby drop to earn your first sparks.' },
  { id: 'drops-live-v1', title: '5 drops are live near you', body: 'Open the live map to see cafes, markets, and rare drops nearby.' },
  { id: 'daily-quests-v1', title: 'Daily quests are ready', body: 'Finish all 3 daily quests for bonus sparks.' },
];
const READ_NOTIFICATIONS_KEY = 'ozone_read_notifications';

type SessionUser = { email?: string; user_metadata?: Record<string, unknown> };
function getUsername(user?: SessionUser | null): string {
  const meta = user?.user_metadata ?? {};
  const name = [meta.username, meta.user_name, meta.display_name, meta.full_name, meta.name].find((v) => typeof v === 'string' && v.trim());
  return typeof name === 'string' ? name.trim() : '';
}

const quests = [
  { title: 'First Signal', detail: 'Collect one nearby discovery', progress: 0, total: 1, reward: 50, icon: Crosshair, done: false },
  { title: 'Quick Hands', detail: 'Score 750 in Quantum Reflex', progress: 0, total: 750, reward: 120, icon: Zap, done: false },
  { title: 'City Circuit', detail: 'Visit 3 different zones today', progress: 0, total: 3, reward: 200, icon: Compass, done: false },
];

function App() {
  const [session, setSession] = useState<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [showAuth, setShowAuth] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authUsername, setAuthUsername] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('explore');
  const [showLiveMap, setShowLiveMap] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<Point | null>(null);
  const [showGame, setShowGame] = useState(false);
  const [showMancala, setShowMancala] = useState(false);
  const [showDrunk, setShowDrunk] = useState(false);
  const [showNYC, setShowNYC] = useState(false);
  const [showTemple, setShowTemple] = useState(false);
  const [showFloppy, setShowFloppy] = useState(false);
  const [showWalk, setShowWalk] = useState(false);
  const [showCharacters, setShowCharacters] = useState(false);
  const [ownedCharacters, setOwnedCharacters] = useState<string[]>(() => {
    const stored = localStorage.getItem(OWNED_KEY);
    return stored ? JSON.parse(stored) : ['mascot'];
  });
  const [activeCharacter, setActiveCharacter] = useState<Character>(CHARACTERS[0]);
  const [characterError, setCharacterError] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [theme, setTheme] = useState<Theme>('dark');
  const [wallet, setWallet] = useState<WalletRow | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [showStore, setShowStore] = useState(false);
  const [checkoutLoadingId, setCheckoutLoadingId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [checkoutSuccess, setCheckoutSuccess] = useState(false);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'ready' | 'denied'>('idle');
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);
  const [withdrawSuccess, setWithdrawSuccess] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [readNotifications, setReadNotifications] = useState<string[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [showFriends, setShowFriends] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [ambientOn, setAmbientOn] = useState(false);
  const toggleAmbient = () => { if (ambientOn) { stopAmbient(); setAmbientOn(false); localStorage.setItem('ozone_ambient', '0'); } else { startAmbient(); setAmbientOn(true); localStorage.setItem('ozone_ambient', '1'); } };
  useEffect(() => { if (localStorage.getItem('ozone_ambient') !== '1') return; const go = () => { startAmbient(); setAmbientOn(true); window.removeEventListener('pointerdown', go); }; window.addEventListener('pointerdown', go); return () => window.removeEventListener('pointerdown', go); }, []);
  const [dailyBonus, setDailyBonus] = useState<{ amount: number; streak: number } | null>(null);
  const [signups, setSignups] = useState<{ email: string; joined: string; username: string | null }[] | null>(null);
  const isAdmin = (session?.user.email ?? '').toLowerCase() === 'odrich217@gmail.com';
  const openSignups = async () => { const { data, error } = await supabase.rpc('admin_signups'); if (error) { alert(error.message); return; } setSignups(data ?? []); };
  const manageMembership = async () => { try { window.location.href = await openBillingPortal(); } catch (e) { alert(e instanceof Error && e.message.includes('No subscription') ? 'No active membership yet. Join Walk & Earn first.' : (e instanceof Error ? e.message : 'Could not open billing.')); } };
  const mapRef = useRef<HTMLElement | null>(null);

  const playerId = useMemo(() => getOrCreatePlayerId(session?.user.id), [session?.user.id]);
  const username = getUsername(session?.user);
  const readKey = `${READ_NOTIFICATIONS_KEY}_${session?.user.id ?? 'guest'}`;
  const unreadCount = NOTIFICATIONS.filter((n) => !readNotifications.includes(n.id)).length;

  useEffect(() => {
    try {
      const stored = localStorage.getItem(readKey);
      setReadNotifications(stored ? JSON.parse(stored) : []);
    } catch {
      setReadNotifications([]);
    }
  }, [readKey]);

  const toggleNotifications = () => {
    const next = !showNotifications;
    setShowNotifications(next);
    setShowMenu(false);
    if (next) {
      const allIds = NOTIFICATIONS.map((n) => n.id);
      setReadNotifications(allIds);
      localStorage.setItem(readKey, JSON.stringify(allIds));
    }
  };

  // Keep a public profile row in sync so other players can find this username (needs find-friends.sql; errors are ignored until then).
  useEffect(() => {
    if (!session?.user.id || !username) return;
    supabase.from('profiles').upsert({ id: session.user.id, username }).then(() => {}, () => {});
  }, [session?.user.id, username]);

  const saveUsername = async () => {
    const value = nameDraft.trim();
    if (value.length < 3 || value.length > 20 || !/^[A-Za-z0-9_.-]+$/.test(value)) {
      setNameError('Use 3-20 letters, numbers, dots, dashes, or underscores.');
      return;
    }
    setNameError(null);
    setNameSaving(true);
    const { data, error } = await supabase.auth.updateUser({ data: { username: value } });
    setNameSaving(false);
    if (error) { setNameError('Could not save your name. Try again.'); return; }
    if (data.user) setSession((prev) => (prev ? { ...prev, user: data.user } : prev));
    setNameDraft('');
  };

  const openMap = () => {
    setActiveTab('explore');
    setSelectedPoint(null);
    window.setTimeout(() => mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const requestLocation = () => {
    if (!navigator.geolocation) {
      setLocation(FALLBACK_LOCATION);
      setLocationStatus('denied');
      return;
    }
    setLocationStatus('loading');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation({ latitude: coords.latitude, longitude: coords.longitude });
        setLocationStatus('ready');
      },
      () => {
        setLocation((prev) => prev ?? FALLBACK_LOCATION);
        setLocationStatus('denied');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const handleAuth = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError('');
    setAuthSubmitting(true);
    const result = authMode === 'login'
      ? await supabase.auth.signInWithPassword({ email: authEmail, password: authPassword })
      : await supabase.auth.signUp({ email: authEmail, password: authPassword, options: { data: { username: authUsername.trim() } } });
    setAuthSubmitting(false);
    if (result.error) {
      setAuthError('That sign-in could not be completed. Check your details and try again.');
    }
  };

  useEffect(() => {
    if (!session) return;
    let active = true;
    (async () => {
      try {
        const [w, p] = await Promise.all([ensureWallet(playerId), fetchProducts()]);
        if (!active) return;
        setWallet(w);
        setProducts(p);
      } catch (err) {
        console.error('Failed to load wallet or products', err);
      }
    })();
    return () => { active = false; };
  }, [playerId, session]);

  useEffect(() => {
    if (!session) return;
    requestLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  useEffect(() => {
    if (!session?.user.id) return;
    supabase.rpc('claim_daily_bonus', { p_player_id: playerId }).then(({ data }) => {
      const r = data as { claimed?: boolean; amount?: number; streak?: number } | null;
      if (r?.claimed) { setDailyBonus({ amount: r.amount ?? 0, streak: r.streak ?? 1 }); fetchWallet(playerId).then((w) => { if (w) setWallet(w); }); setTimeout(() => setDailyBonus(null), 6000); }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  useEffect(() => {
    const uid = session?.user.id;
    const ref = localStorage.getItem(REF_KEY);
    if (!uid || !ref) return;
    localStorage.removeItem(REF_KEY);
    if (ref === uid) return;
    supabase.rpc('accept_referral', { p_ref: ref, p_player_id: playerId }).then(() => { fetchWallet(playerId).then((w) => { if (w) setWallet(w); }); });
    if (window.location.search.includes('ref=')) window.history.replaceState({}, '', window.location.pathname);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('checkout') === 'success') {
      setCheckoutSuccess(true);
      window.history.replaceState({}, '', window.location.pathname);
      const poll = async () => {
        for (let i = 0; i < 8; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          const w = await fetchWallet(playerId);
          if (w && (!wallet || w.sparks > wallet.sparks)) {
            setWallet(w);
            break;
          }
        }
      };
      poll();
    }
  }, []);

  const handleBuy = async (product: Product) => {
    setCheckoutError(null);
    setCheckoutLoadingId(product.id);
    try {
      const url = await startCheckout(product.id, playerId);
      window.location.href = url;
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setCheckoutLoadingId(null);
    }
  };

  const sparkBalance = wallet?.sparks ?? 0;

  const handleBuyCharacter = (character: Character) => {
    if (ownedCharacters.includes(character.id)) {
      setActiveCharacter(character);
      setShowCharacters(false);
      return;
    }
    if (sparkBalance < character.cost) {
      setCharacterError('Not enough sparks. Play Spark Run or collect drops to earn more.');
      return;
    }
    creditSparks(playerId, -character.cost, 'character_purchase', character.id)
      .then(() => {
        const next = [...ownedCharacters, character.id];
        setOwnedCharacters(next);
        localStorage.setItem(OWNED_KEY, JSON.stringify(next));
        setActiveCharacter(character);
        setShowCharacters(false);
        fetchWallet(playerId).then((w) => { if (w) setWallet(w); });
      })
      .catch(() => setCharacterError('Purchase failed. Try again.'));
  };

  const refreshWallet = () => { fetchWallet(playerId).then((w) => { if (w) setWallet(w); }); };

  const isSubscriber = subscription?.status === 'active' &&
    (!subscription.current_period_end || new Date(subscription.current_period_end) > new Date());

  const handleWithdraw = async () => {
    setWithdrawError(null);
    setWithdrawSuccess(false);
    const amount = parseInt(withdrawAmount, 10);
    if (!amount || amount < 100) {
      setWithdrawError('Minimum withdrawal is 100 sparks.');
      return;
    }
    if (amount > sparkBalance) {
      setWithdrawError("You don't have that many sparks.");
      return;
    }
    setWithdrawLoading(true);
    try {
      await requestWithdrawal(amount);
      setWithdrawSuccess(true);
      setWithdrawAmount('');
      const [w, list] = await Promise.all([fetchWallet(playerId), fetchWithdrawals()]);
      if (w) setWallet(w);
      setWithdrawals(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Withdrawal failed.';
      setWithdrawError(msg.includes('subscriber') || msg.includes('subscription') ? 'Only active subscribers can withdraw. Subscribe to unlock cashouts.' : msg);
    } finally {
      setWithdrawLoading(false);
    }
  };

  const collectPoint = () => {
    setSelectedPoint(null);
    creditSparks(playerId, selectedPoint?.reward ?? 0, 'drop_collect', selectedPoint ? String(selectedPoint.id) : undefined).then(() => {
      fetchWallet(playerId).then((w) => { if (w) setWallet(w); });
    }).catch(() => {});
  };

  if (authLoading) return <main className="auth-shell"><div className="auth-card"><Loader2 className="spin" size={24} /><span>Connecting to your field…</span></div></main>;

  if (!session && !showAuth) return <Landing onStart={() => { setAuthMode('signup'); setAuthError(''); setShowAuth(true); }} onSignIn={() => { setAuthMode('login'); setAuthError(''); setShowAuth(true); }} />;

  if (!session) return <main className={`auth-shell theme-${theme}`}><div className="auth-card"><img className="auth-mascot" src="/assets/Gemini_Generated_Image__(1).jpg" alt="Ozone Play field mascot" /><p className="eyebrow">OZONE PLAY / FIELD ACCESS</p><h1>{authMode === 'login' ? 'Welcome back, operator.' : 'Claim your field name.'}</h1><p className="auth-copy">Sign in to save your sparks, unlock live location, and keep every run tied to your account.</p><form onSubmit={handleAuth}>{authMode === 'signup' && <label>Field name (username)<input type="text" value={authUsername} onChange={(event) => setAuthUsername(event.target.value)} required minLength={3} maxLength={20} pattern="[A-Za-z0-9_.\-]+" title="3-20 letters, numbers, dots, dashes, or underscores" autoComplete="username" /></label>}<label>Email<input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} required autoComplete="email" /></label><label>Password<input type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} required minLength={6} autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} /></label>{authError && <p className="auth-error">{authError}</p>}<button className="primary-button full" type="submit" disabled={authSubmitting}>{authSubmitting ? <Loader2 className="spin" size={16} /> : authMode === 'login' ? 'Enter Ozone Play' : 'Create account'}</button></form><button className="auth-switch" onClick={() => { setAuthMode(authMode === 'login' ? 'signup' : 'login'); setAuthError(''); }}>{authMode === 'login' ? 'New here? Create an account' : 'Already have an account? Sign in'}</button><button className="auth-switch" style={{ color: '#84939a', marginTop: 10 }} onClick={() => { setShowAuth(false); setAuthError(''); }}>← Back to Ozone Play overview</button></div></main>;

  return (
    <main className={`app-shell theme-${theme}`}>
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark"><ScanLine size={20} strokeWidth={2.5} /></div>
          <div>
            <div className="brand-name">OZONE <span>PLAY</span></div>
            <div className="brand-subtitle">CASH QUEST / FIELD 01</div>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="theme-toggle" aria-label={`Switch theme. Current theme: ${theme}`} onClick={() => setTheme(theme === 'dark' ? 'white' : theme === 'white' ? 'red' : 'dark')}><span className="theme-toggle-icon">{theme === 'dark' ? <Moon size={14} /> : theme === 'white' ? <Sun size={14} /> : <Palette size={14} />}</span><span>{theme}</span></button>
          <button className="icon-button" aria-label={ambientOn ? 'Turn calming sounds off' : 'Turn calming sounds on'} title="Calming sounds" onClick={toggleAmbient} style={{ fontSize: 16 }}>{ambientOn ? '🔊' : '🔈'}</button><button className="icon-button" aria-label="Invite friends" onClick={() => setShowInvite(true)}><Share2 size={18} /></button>
          <button className="icon-button notification-button" aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'} aria-expanded={showNotifications} onClick={toggleNotifications}><Bell size={19} />{unreadCount > 0 && <i />}</button>
          <button className="profile-chip" onClick={() => { setShowMenu(!showMenu); setShowNotifications(false); }}>
            <span className="avatar">{(username || session.user.email || '?').charAt(0).toUpperCase()}</span><span className="profile-name">{username ? username.toUpperCase() : 'SET NAME'}</span><ChevronRight size={16} />
          </button>
          {showNotifications && <div className="profile-menu" style={{ width: 280, zIndex: 30 }}><strong>Notifications</strong>{NOTIFICATIONS.map((n) => <div key={n.id} style={{ display: 'grid', gap: 3, paddingTop: 9, borderTop: '1px solid #26343a' }}><b style={{ fontSize: 12, fontWeight: 600 }}>{n.title}</b><span>{n.body}</span></div>)}<button onClick={() => setShowNotifications(false)}>Close</button></div>}
          {showMenu && <div className="profile-menu" style={{ zIndex: 30 }}><strong>{username || 'Field Operator'}</strong><span>{session.user.email}</span>{!username && <div style={{ display: 'grid', gap: 6, marginTop: 6 }}><span>Pick your field name</span><input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="username" maxLength={20} style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 9, border: '1px solid #34444a', background: '#10181d', color: '#e6eee9', fontSize: 12 }} />{nameError && <span style={{ color: '#efad93' }}>{nameError}</span>}<button onClick={saveUsername} disabled={nameSaving}>{nameSaving ? 'Saving…' : 'Save name'}</button></div>}<button style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => { setShowInvite(true); setShowMenu(false); }}><Share2 size={13} /> Invite friends</button><button style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => { setShowFriends(true); setShowMenu(false); }}><Users size={13} /> Find friends</button><button style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => { setShowMenu(false); manageMembership(); }}>Manage membership</button><a href="/terms.html" style={{ fontSize: 12, color: 'inherit', opacity: .8, padding: '4px 0' }}>Terms, privacy &amp; refunds</a>{isAdmin && <button style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => { setShowMenu(false); openSignups(); }}>📈 Player signups</button>}<button onClick={() => setShowMenu(false)}>Close menu</button></div>}
        </div>
      </header>

      <section className="content-grid">
        <div className="main-column">
          <div className="welcome-row">
            <div><p className="eyebrow">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).toUpperCase()}</p><h1>Make the city <em>yours.</em></h1><p className="intro">Discover signal drops, master skill runs, and turn your route into rewards.</p></div>
            <div className="streak-badge"><span className="streak-flame">◆</span><div><strong>0 day streak</strong><small>Start your first run today</small></div></div>
          </div>

          <div className="hero-card">
            <div className="hero-copy"><div className="live-pill"><span /> CITY DROP SCAN</div><h2>Your city is<br /><strong>calling.</strong></h2><p>Scan nearby cafes, markets, shops, and restaurants for live drops you can visit.</p><button className="primary-button" onClick={openMap}>Open live map <ArrowUpRight size={16} /></button></div>
            <img className="mascot-image" src="/assets/Gemini_Generated_Image__(1).jpg" alt="Ozone Play mascot holding a signal orb" />
            <div className="hero-stats"><span><strong>05</strong><small>active drops</small></span><span><strong>0.8<small>mi</small></strong><small>search radius</small></span></div>
          </div>

          <div className="section-heading"><div><p className="eyebrow">YOUR FIELD GUIDE</p><h2>What&apos;s calling you</h2></div><button className="text-button" onClick={() => setActiveTab('quests')}>View all <ChevronRight size={16} /></button></div>
          <div className="quest-row">
            <button className="quest-card feature-quest" onClick={() => setShowGame(true)}><div className="quest-top"><span className="quest-icon orange"><Gamepad2 size={20} /></span><span className="quest-tag">ARCADE RUN</span><span className="card-arrow"><ArrowUpRight size={17} /></span></div><div className="quest-body"><h3>Spark Run</h3><p>Grab coins, dodge blocks, build combos.</p><div className="quest-meta"><span><Trophy size={14} /> Up to <b>120 sparks</b></span><span>playing</span></div></div><div className="quest-art"><div className="pulse-line" /><div className="pulse-orb" /></div></button>
            <button className="quest-card mancala-card" onClick={() => setShowMancala(true)}><div className="quest-top"><span className="quest-icon gold"><Shell size={20} /></span><span className="quest-tag">ISLAND BOARD</span><span className="card-arrow"><ArrowUpRight size={17} /></span></div><div className="quest-body"><h3>Mancala Island</h3><p>Sow shells, outsmart the AI, win the tide.</p><div className="quest-meta"><span><Trophy size={14} /> Up to <b>250 sparks</b></span><span>vs AI</span></div></div></button>
            <button className="quest-card drunk-card" onClick={() => setShowDrunk(true)}><div className="quest-top"><span className="quest-icon purple"><Wine size={20} /></span><span className="quest-tag">PARTY MODE</span><span className="card-arrow"><ArrowUpRight size={17} /></span></div><div className="quest-body"><h3>Drunk Tea Diamond</h3><p>A social drinking card game for groups.</p><div className="quest-meta"><span><Wine size={14} /> 21+ party</span><span>multiplayer</span></div></div></button>
            <button className="quest-card nyc-card" onClick={() => setShowNYC(true)}><div className="quest-top"><span className="quest-icon sky"><Star size={20} /></span><span className="quest-tag">NYC SHOOTER</span><span className="card-arrow"><ArrowUpRight size={17} /></span></div><div className="quest-body"><h3>NYC Star Crush</h3><p>Shoot falling stars over the Manhattan skyline.</p><div className="quest-meta"><span><Trophy size={14} /> Up to <b>200 sparks</b></span><span>arcade</span></div></div></button>
            <button className="quest-card temple-card" onClick={() => setShowTemple(true)}><div className="quest-top"><span className="quest-icon amber"><Coins size={20} /></span><span className="quest-tag">TEMPLE RUN</span><span className="card-arrow"><ArrowUpRight size={17} /></span></div><div className="quest-body"><h3>Temple Mario Run</h3><p>Auto-runner with jumps, platforms, and coins.</p><div className="quest-meta"><span><Trophy size={14} /> Up to <b>180 sparks</b></span><span>arcade</span></div></div></button>
            <button className="quest-card floppy-card" onClick={() => setShowFloppy(true)}><div className="quest-top"><span className="quest-icon coral"><Bird size={20} /></span><span className="quest-tag">LAUNCH ARCADE</span><span className="card-arrow"><ArrowUpRight size={17} /></span></div><div className="quest-body"><h3>Floppy Angry Bird</h3><p>Flap through pipes and smash pigs mid-flight.</p><div className="quest-meta"><span><Trophy size={14} /> Up to <b>160 sparks</b></span><span>arcade</span></div></div></button>
            <button className="quest-card walk-card" onClick={() => setShowWalk(true)}><div className="quest-top"><span className="quest-icon mint"><Footprints size={20} /></span><span className="quest-tag">WALK & EARN</span><span className="card-arrow"><ArrowUpRight size={17} /></span></div><div className="quest-body"><h3>Walk to Earn</h3><p>Members earn sparks per real step.</p><div className="quest-meta"><span><Sparkles size={14} /> Members only</span><span>live GPS</span></div></div></button>
          </div>

          <div className="section-heading compact"><div><p className="eyebrow">PLAY AS</p><h2>Characters</h2></div><button className="text-button" onClick={() => setShowCharacters(true)}>View all <ChevronRight size={16} /></button></div>
          <div className="character-row">
            {CHARACTERS.map((c) => (
              <button key={c.id} className={`character-card ${activeCharacter.id === c.id ? 'active' : ''} ${!ownedCharacters.includes(c.id) ? 'locked' : ''}`} onClick={() => ownedCharacters.includes(c.id) ? setActiveCharacter(c) : setShowCharacters(true)}>
                <img src={c.image} alt={c.name} />
                <div>
                  <strong>{c.name}</strong>
                  <small>{c.perk}</small>
                </div>
                {!ownedCharacters.includes(c.id) && <span className="lock-badge"><Lock size={11} /> {c.cost}</span>}
                {activeCharacter.id === c.id && <span className="active-badge"><Check size={11} /> Active</span>}
              </button>
            ))}
          </div>

          <div className="section-heading compact"><div><p className="eyebrow">LIVE ACTIVITY</p><h2>Nearby operators</h2></div><span className="online-label"><i /> 1,284 online</span></div>
          <div className="activity-card"><div className="activity-avatars"><span className="avatar coral">M</span><span className="avatar blue">K</span><span className="avatar mint">A</span><span className="avatar plus">+9</span></div><div><strong>Your field is active</strong><p>12 operators just claimed drops in the city.</p></div><button className="icon-button small"><ArrowUpRight size={16} /></button></div>
        </div>

        <aside className="side-column">
          <div className="balance-card"><div className="card-label"><WalletIcon size={16} /> AVAILABLE BALANCE <Info size={14} /></div><div className="balance-amount"><span>$</span>0<span className="decimal">.00</span></div><div className="balance-footer"><span><ArrowUpRight size={14} /> +$0.00 this week</span><button onClick={() => setActiveTab('wallet')}>View wallet <ChevronRight size={14} /></button></div></div>
          <div className="spark-card"><div className="spark-icon"><Sparkles size={19} /></div><div><span>SPARKS</span><strong>{sparkBalance.toLocaleString()}</strong></div><button onClick={() => setShowStore(true)} aria-label="Get more sparks"><Plus size={17} /></button></div>
          <div className="side-section"><div className="section-heading compact"><div><p className="eyebrow">NEXT UP</p><h2>Daily quests</h2></div><span className="quest-count">0/3</span></div><div className="daily-list">{quests.map((quest) => <button className={`daily-item ${quest.done ? 'completed' : ''}`} key={quest.title} onClick={() => quest.title === 'Quick Hands' && setShowGame(true)}><span className={`daily-icon ${quest.done ? 'done' : ''}`}><quest.icon size={17} /></span><span className="daily-copy"><strong>{quest.title}</strong><small>{quest.detail}</small><span className="daily-progress"><i style={{ width: `${(quest.progress / quest.total) * 100}%` }} /></span></span><span className="daily-reward"><Gem size={12} /> {quest.reward}</span></button>)}</div></div>
          <div className="trust-card"><ShieldCheck size={18} /><div><strong>Skill-first rewards</strong><p>No chance mechanics. Your score earns your edge.</p></div></div>
        </aside>
      </section>

      <nav className="bottom-nav">{([['explore', Compass, 'Explore'], ['quests', Gamepad2, 'Play'], ['wallet', Banknote, 'Wallet']] as const).map(([tab, Icon, label]) => <button className={activeTab === tab ? 'active' : ''} onClick={() => (tab === 'explore' ? openMap() : setActiveTab(tab))} key={tab}><Icon size={20} /><span>{label}</span></button>)}</nav>

      {activeTab === 'explore' && <section className="map-drawer" ref={mapRef} style={{ scrollMarginTop: 12 }}><div className="drawer-header"><div><p className="eyebrow">LIVE CITY MAP / 0.8 MI</p><h2>Go collect nearby</h2><small className="map-subtitle">Drops are placed at local spots worth visiting.</small></div><button className={`location-pill location-${locationStatus}`} onClick={requestLocation}><MapPin size={13} /> {locationStatus === 'ready' ? 'LOCATION LOCKED' : locationStatus === 'loading' ? 'LOCATING…' : locationStatus === 'denied' ? 'ENABLE LOCATION' : 'LIVE LOCATION'}</button></div>{locationStatus === 'denied' && <p className="map-notice" role="status" style={{ margin: '0 6px 10px', padding: '8px 11px', borderRadius: 10, border: '1px solid #efad9355', background: '#efad9314', color: '#efad93', font: "500 10px 'DM Mono', monospace", letterSpacing: '.06em' }}>Location is off or timed out, so the map is centered on Times Square, NYC. Tap ENABLE LOCATION to try again.</p>}<button className="primary-button" onClick={() => setShowLiveMap(true)} style={{ width: '100%', margin: '0 0 12px' }}><MapPin size={15} /> Open Live Map · earn &amp; own plots</button><div className="map-grid">{points.map((point) => <button key={point.id} className={`map-point ${point.tone}`} style={{ left: `${point.x}%`, top: `${point.y}%` }} onClick={() => setSelectedPoint(point)}><span className="point-pulse" /><span className="point-core"><Gem size={13} /></span></button>)}<div className="player-position" title={location ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}` : 'Location not enabled'}><span /><small>{locationStatus === 'ready' ? 'YOU / LIVE' : location ? 'TIMES SQ' : 'YOU'}</small></div><div className="map-road road-one" /><div className="map-road road-two" /><div className="map-road road-three" /></div><div className="map-legend"><span><i className="legend-dot mint" /> Cafe / shop</span><span><i className="legend-dot coral" /> Market / food</span><span><i className="legend-dot gold" /> Rare drop</span></div></section>}
      {activeTab === 'quests' && <section className="overlay-panel"><button className="close-panel" onClick={() => setActiveTab('explore')}><X size={18} /></button><p className="eyebrow">QUEST BOARD / TODAY</p><h2>Choose your next run.</h2><p className="panel-subtitle">Every challenge is built around skill, speed, and showing up.</p>{quests.map((quest) => <button className="large-quest" key={quest.title} onClick={() => !quest.done && setShowGame(true)}><span className="large-quest-icon"><quest.icon size={21} /></span><span><strong>{quest.title}</strong><small>{quest.detail}</small></span><span className="large-reward"><Gem size={13} /> {quest.reward}</span><ChevronRight size={17} /></button>)}<button className="large-quest" onClick={() => setShowGame(true)}><span className="large-quest-icon"><Gamepad2 size={21} /></span><span><strong>Spark Run arcade</strong><small>Play as {activeCharacter.name} · earn sparks</small></span><span className="large-reward"><Sparkles size={13} /> Up to 120</span><ChevronRight size={17} /></button><button className="large-quest" onClick={() => setShowCharacters(true)}><span className="large-quest-icon"><Users size={21} /></span><span><strong>Unlock characters</strong><small>Spend sparks on new runners</small></span><span className="large-reward"><Sparkles size={13} /> from 800</span><ChevronRight size={17} /></button><button className="large-quest" onClick={() => setShowMancala(true)}><span className="large-quest-icon"><Shell size={21} /></span><span><strong>Mancala Island</strong><small>Sow shells vs the tide AI</small></span><span className="large-reward"><Sparkles size={13} /> Up to 250</span><ChevronRight size={17} /></button><button className="large-quest drunk-quest" onClick={() => setShowDrunk(true)}><span className="large-quest-icon"><Wine size={21} /></span><span><strong>Drunk Tea Diamond</strong><small>21+ drinking card party game</small></span><span className="large-reward"><Wine size={13} /> Party</span><ChevronRight size={17} /></button><button className="large-quest nyc-quest" onClick={() => setShowNYC(true)}><span className="large-quest-icon"><Star size={21} /></span><span><strong>NYC Star Crush</strong><small>Shoot stars over Manhattan</small></span><span className="large-reward"><Sparkles size={13} /> Up to 200</span><ChevronRight size={17} /></button><button className="large-quest temple-quest" onClick={() => setShowTemple(true)}><span className="large-quest-icon"><Coins size={21} /></span><span><strong>Temple Mario Run</strong><small>Auto-run, jump, collect coins</small></span><span className="large-reward"><Sparkles size={13} /> Up to 180</span><ChevronRight size={17} /></button><button className="large-quest floppy-quest" onClick={() => setShowFloppy(true)}><span className="large-quest-icon"><Bird size={21} /></span><span><strong>Floppy Angry Bird</strong><small>Flap through pipes, smash pigs</small></span><span className="large-reward"><Sparkles size={13} /> Up to 160</span><ChevronRight size={17} /></button><button className="large-quest" onClick={() => setShowWalk(true)}><span className="large-quest-icon"><Footprints size={21} /></span><span><strong>Walk & Earn</strong><small>Members earn sparks per real step</small></span><span className="large-reward"><Sparkles size={13} /> Members</span><ChevronRight size={17} /></button></section>}
      {activeTab === 'wallet' && <section className="overlay-panel wallet-panel"><button className="close-panel" onClick={() => setActiveTab('explore')}><X size={18} /></button><p className="eyebrow">WALLET / PAYOUTS</p><h2>Your reward runway.</h2><div className="wallet-total"><small>AVAILABLE TO WITHDRAW</small><strong>${((wallet?.cashable_sparks ?? 0) / 100).toFixed(2)}</strong><span>{isSubscriber ? 'Subscriber cashout unlocked.' : 'Subscribe to unlock cashouts.'}</span></div><div className="wallet-actions">{isSubscriber ? (<button className="primary-button" onClick={() => document.getElementById('withdraw-section')?.scrollIntoView({ behavior: 'smooth' })}>Cash out <ArrowUpRight size={16} /></button>) : (<button onClick={() => { startSubscriptionCheckout().then((url) => { window.location.href = url; }).catch(() => setWithdrawError('Could not start subscription. Try again.')); }}>Subscribe to unlock <ArrowUpRight size={16} /></button>)}<button onClick={() => setShowStore(true)}>Add funds <Plus size={16} /></button></div><div className="wallet-sparks"><Sparkles size={18} /> <strong>{sparkBalance.toLocaleString()}</strong> sparks in your wallet</div><div className="withdraw-section" id="withdraw-section"><div className="withdraw-header"><strong><Banknote size={16} /> Redeem sparks for cash</strong>{isSubscriber ? <span className="withdraw-status active">Subscriber active</span> : <span className="withdraw-status locked"><Lock size={11} /> Subscriber only</span>}</div>{!isSubscriber && <p className="withdraw-gate-note">Cashouts are only available to active subscribers. Subscribe to redeem your sparks for real payouts.</p>}{withdrawError && <div className="checkout-error">{withdrawError}</div>}{withdrawSuccess && <div className="withdraw-success"><CheckCircle2 size={15} /> Withdrawal requested. Your payout is being processed.</div>}<div className="withdraw-input-row"><input type="number" min="100" max={wallet?.cashable_sparks ?? 0} placeholder="Sparks to redeem (min 100)" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} disabled={!isSubscriber || withdrawLoading} /><button className="primary-button" onClick={handleWithdraw} disabled={!isSubscriber || withdrawLoading || (wallet?.cashable_sparks ?? 0) < 100}>{withdrawLoading ? <Loader2 className="spin" size={15} /> : 'Request payout'}</button></div><small className="withdraw-footnote">{(wallet?.cashable_sparks ?? 0).toLocaleString()} cash-eligible sparks · only sparks earned on the Live Map can be cashed out · 1 spark = $0.01 · min 100</small></div>{withdrawals.length > 0 && <div className="withdraw-history"><strong>Recent withdrawals</strong>{withdrawals.map((w) => <div key={w.id} className="withdraw-history-row"><span className={`withdraw-status-badge ${w.status}`}>{w.status}</span><span><Sparkles size={12} /> {w.sparks_used.toLocaleString()} sparks</span><span>${(w.amount_cents / 100).toFixed(2)}</span><span className="withdraw-date">{new Date(w.created_at).toLocaleDateString()}</span></div>)}</div>}<div className="wallet-note"><ShieldCheck size={18} /><p><strong>Built for trust.</strong> Withdrawals require an active subscription. Payouts are reviewed before release to protect the field.</p></div></section>}

      {selectedPoint && <div className="modal-backdrop" onClick={() => setSelectedPoint(null)}><div className="drop-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setSelectedPoint(null)}><X size={17} /></button><div className={`modal-symbol ${selectedPoint.tone}`}><Gift size={24} /></div><p className="eyebrow">LIVE DROP / {selectedPoint.id.toString().padStart(2, '0')}</p><h2>{selectedPoint.label}</h2><div className="drop-venue"><strong>{selectedPoint.venue}</strong><span>{selectedPoint.category} · {selectedPoint.address}</span></div><p>Visit this local spot, show up at the drop, and collect your sparks when you arrive.</p><div className="drop-reward"><Gem size={17} /> +{selectedPoint.reward} sparks</div><button className="primary-button full" onClick={collectPoint}>Collect drop <ArrowUpRight size={16} /></button></div></div>}
      {showGame && <SparkRunGame character={activeCharacter} onClose={() => setShowGame(false)} onWalletUpdate={refreshWallet} />}

      {showMancala && <MancalaIsland character={activeCharacter} onClose={() => setShowMancala(false)} onWalletUpdate={refreshWallet} />}

      {showDrunk && <DrunkTeaDiamond onClose={() => setShowDrunk(false)} />}

      {showNYC && <NYCStarCrush character={activeCharacter} onClose={() => setShowNYC(false)} onWalletUpdate={refreshWallet} />}

      {showTemple && <TempleMarioRun character={activeCharacter} onClose={() => setShowTemple(false)} onWalletUpdate={refreshWallet} />}

      {showFloppy && <FloppyAngryBird character={activeCharacter} onClose={() => setShowFloppy(false)} onWalletUpdate={refreshWallet} />}

      {showInvite && session && <InviteFriends userId={session.user.id} onClose={() => setShowInvite(false)} />}
      {showFriends && session && <FindFriends currentUserId={session.user.id} onClose={() => setShowFriends(false)} />}

      {showLiveMap && <LiveMap onClose={() => setShowLiveMap(false)} onWalletUpdate={refreshWallet} sparkBalance={sparkBalance} playerId={playerId} />}
      {showWalk && <WalkEarn onClose={() => setShowWalk(false)} onWalletUpdate={refreshWallet} />}

      {showCharacters && <div className="modal-backdrop" onClick={() => setShowCharacters(false)}><div className="store-modal character-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowCharacters(false)}><X size={17} /></button><p className="eyebrow">CHARACTERS / PLAYABLE RUNNERS</p><h2>Pick your runner.</h2><p className="store-subtitle">Each character changes your run speed and style. Unlock with sparks you earn in-game.</p>{characterError && <div className="checkout-error">{characterError}</div>}<div className="store-grid">{CHARACTERS.map((c) => {
          const owned = ownedCharacters.includes(c.id);
          const active = activeCharacter.id === c.id;
          const affordable = sparkBalance >= c.cost;
          return (
            <button key={c.id} className={`store-card character-store-card ${active ? 'active' : ''}`} onClick={() => handleBuyCharacter(c)} disabled={!owned && !affordable}>
              <img src={c.image} alt={c.name} className="character-store-img" />
              <div className="store-card-top"><Sparkles size={16} /><span>{c.name.toUpperCase()}</span></div>
              <div className="store-card-body"><strong>{c.name}</strong><small>{c.perk}</small></div>
              <div className="store-card-foot">
                {owned ? <span className="store-price">{active ? 'Active' : 'Select'}</span> : <span className="store-price">{c.cost} sparks</span>}
                {owned ? (active ? <Check size={16} /> : <ChevronRight size={16} />) : (affordable ? <ChevronRight size={16} /> : <Lock size={14} />)}
              </div>
            </button>
          );
        })}</div><div className="wallet-sparks"><Sparkles size={18} /> <strong>{sparkBalance.toLocaleString()}</strong> sparks available</div></div></div>}

      {showStore && <div className="modal-backdrop" onClick={() => setShowStore(false)}><div className="store-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowStore(false)}><X size={17} /></button><p className="eyebrow">STORE / SPARK PACKS</p><h2>Fuel your field.</h2><p className="store-subtitle">Sparks power drops, streaks, and skill runs. Secure checkout via Stripe.</p>{checkoutError && <div className="checkout-error">{checkoutError}</div>}<div className="store-grid">{products.map((product) => <button className="store-card" key={product.id} onClick={() => handleBuy(product)} disabled={checkoutLoadingId === product.id}><div className="store-card-top"><Sparkles size={18} /><span>{product.sparks.toLocaleString()} sparks</span></div><div className="store-card-body"><strong>{product.name}</strong><small>{product.tagline}</small></div><div className="store-card-foot"><span className="store-price">${(product.price_cents / 100).toFixed(2)}</span>{checkoutLoadingId === product.id ? <Loader2 size={16} className="spin" /> : <ChevronRight size={16} />}</div></button>)}</div><div className="store-trust"><ShieldCheck size={15} /><span>Payments secured by Stripe. Sparks credited after confirmation.</span></div></div></div>}

      {dailyBonus && <div className="checkout-toast" onClick={() => setDailyBonus(null)}><Sparkles size={18} /><span>Daily bonus +{dailyBonus.amount} sparks · {dailyBonus.streak}-day streak{dailyBonus.streak < 7 ? ' (come back tomorrow for more)' : ''}</span></div>}
      {signups && <div className="store-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 60, background: '#000a', display: 'grid', placeItems: 'center', padding: 16 }} onClick={() => setSignups(null)}><div className="store-modal" onClick={(e) => e.stopPropagation()}><h2>Players · {signups.length}</h2><p className="store-subtitle">{signups.filter((u) => Date.now() - new Date(u.joined).getTime() < 86400000).length} joined in the last 24 h</p><div style={{ display: 'grid', gap: 8 }}>{signups.map((u) => <div key={u.email + u.joined} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, borderBottom: '1px solid #2b3a40', paddingBottom: 6 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.username ? <b>{u.username} </b> : null}{u.email}</span><span style={{ opacity: .7, whiteSpace: 'nowrap' }}>{new Date(u.joined).toLocaleDateString()}</span></div>)}</div><button style={{ marginTop: 16 }} onClick={() => setSignups(null)}>Close</button></div></div>}
      {checkoutSuccess && <div className="checkout-toast" onClick={() => setCheckoutSuccess(false)}><CheckCircle2 size={18} /><span>Payment received — sparks credited to your wallet.</span></div>}
    </main>
  );
}

export default App;
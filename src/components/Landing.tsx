import {
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Bird,
  Building2,
  Clock,
  Crosshair,
  Footprints,
  Gamepad2,
  Gem,
  HandHeart,
  LogIn,
  Mail,
  Map as MapIcon,
  MapPin,
  ScanLine,
  Shell,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  Zap,
} from 'lucide-react';

type LandingProps = {
  onStart: () => void;
  onSignIn: () => void;
};

const MASCOT = '/assets/Gemini_Generated_Image__(1).jpg';
const PARTNER_MAIL = 'mailto:odrichls@gmail.com?subject=Ozone%20Play%20partner';

const GAMES = [
  { name: 'Spark Run', note: 'Arcade runner', icon: Gamepad2 },
  { name: 'NYC Star Crush', note: 'Manhattan star shooter', icon: Star },
  { name: 'Quantum Reflex', note: 'Timing and reflexes', icon: Zap },
  { name: 'Mancala Island', note: 'Shell-sowing strategy vs AI', icon: Shell },
  { name: 'Floppy Angry Bird', note: 'Flappy-style flight', icon: Bird },
];

const DROPS = [
  { x: 24, y: 30, tone: 'mint' },
  { x: 70, y: 22, tone: 'coral' },
  { x: 78, y: 64, tone: 'gold' },
  { x: 36, y: 72, tone: 'mint' },
] as const;

const css = `
.lp-shell { min-height: 100vh; position: relative; overflow: hidden; color: #f3f3ed; background: radial-gradient(circle at 80% -5%, rgba(46, 91, 83, .35), transparent 32rem), radial-gradient(circle at 0% 40%, rgba(216, 104, 67, .08), transparent 26rem), #0a0f13; padding: 0 20px 40px; }
.lp-wrap { max-width: 1120px; margin: 0 auto; position: relative; z-index: 1; }
.lp-top { height: 72px; display: flex; align-items: center; justify-content: space-between; }
.lp-ghost { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 11px 16px; border: 1px solid #34444a; border-radius: 10px; background: #10181dcc; color: #dce6e0; font-size: 12px; font-weight: 600; transition: border-color .2s, color .2s, transform .2s; text-decoration: none; }
.lp-ghost:hover { border-color: #9be362; color: #b9f17b; transform: translateY(-2px); }
.lp-ghost.sm { padding: 8px 12px; font-size: 11px; }
.lp-hero { display: grid; gap: 36px; padding: 28px 0 12px; align-items: center; }
.lp-hero h1 { margin: 18px 0 16px; font-size: clamp(40px, 11vw, 74px); line-height: .95; letter-spacing: -.055em; font-weight: 700; }
.lp-hero h1 em { font-style: normal; color: #b9f17b; text-shadow: 0 0 28px #b9f17b55; }
.lp-sub { margin: 0; max-width: 520px; color: #9badab; font-size: 15px; line-height: 1.65; }
.lp-ctas { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px; }
.lp-ctas .primary-button { padding: 14px 22px; font-size: 13px; }
.lp-ctas .lp-ghost { padding: 13px 20px; font-size: 13px; }
.lp-badge { display: inline-flex; align-items: center; gap: 8px; margin-top: 22px; padding: 8px 12px; border: 1px solid rgba(182, 239, 119, .28); border-radius: 999px; background: rgba(182, 239, 119, .07); color: #b9f17b; font: 500 11px 'DM Mono', monospace; letter-spacing: .08em; }
.lp-visual { position: relative; height: 360px; border-radius: 22px; overflow: hidden; border: 1px solid #2c4945; background-color: #14272a; background-image: linear-gradient(#9ed09b10 1px, transparent 1px), linear-gradient(90deg, #9ed09b10 1px, transparent 1px); background-size: 38px 38px; box-shadow: 0 24px 80px #0007, inset 0 0 80px #0a0f13; }
.lp-visual .map-road { z-index: 0; }
.lp-visual .map-point { cursor: default; }
.lp-mascot { position: absolute; left: 50%; bottom: 0; width: 190px; height: 270px; transform: translateX(-50%); object-fit: cover; object-position: center 22%; border-radius: 100px 100px 0 0; border: 1px solid #b9f17b44; box-shadow: 0 0 60px #b9f17b26; z-index: 2; animation: lp-float-x 5s ease-in-out infinite; }
.lp-ring { position: absolute; left: 50%; top: 46%; width: 300px; height: 300px; margin: -150px 0 0 -150px; border: 1px solid #b9f17b22; border-radius: 50%; z-index: 1; animation: lp-ring 4s ease-out infinite; }
.lp-ring.two { animation-delay: 2s; }
.lp-chip { position: absolute; z-index: 3; display: flex; align-items: center; gap: 7px; padding: 8px 11px; border-radius: 11px; background: #111a1fee; border: 1px solid #34444a; font: 500 10px 'DM Mono', monospace; letter-spacing: .06em; color: #dce6e0; box-shadow: 0 10px 30px #0008; backdrop-filter: blur(8px); animation: lp-float 6s ease-in-out infinite; }
.lp-chip svg { color: #b9f17b; }
.lp-chip.a { left: 14px; top: 16px; }
.lp-chip.b { right: 14px; top: 46%; animation-delay: 1.5s; }
.lp-chip.b svg { color: #e8d083; }
.lp-chip.c { left: 14px; bottom: 18px; animation-delay: 3s; }
.lp-chip.c svg { color: #8bd1d4; }
.lp-section { margin-top: 64px; }
.lp-section > .eyebrow { margin-bottom: 10px; }
.lp-h2 { margin: 0 0 22px; font-size: clamp(28px, 6vw, 42px); line-height: 1.02; letter-spacing: -.05em; font-weight: 600; }
.lp-h2 em { font-style: normal; color: #b9f17b; }
.lp-steps { display: grid; gap: 12px; counter-reset: lp; }
.lp-step { position: relative; padding: 20px; border: 1px solid #27343a; border-radius: 16px; background: #111a1f; transition: transform .25s, border-color .25s; }
.lp-step:hover { transform: translateY(-4px); border-color: #698b61; }
.lp-step-head { display: flex; align-items: center; gap: 10px; }
.lp-step-num { margin-left: auto; font: 500 10px 'DM Mono', monospace; color: #5f7378; letter-spacing: .12em; }
.lp-step h3 { margin: 18px 0 6px; font-size: 20px; letter-spacing: -.03em; }
.lp-step p { margin: 0; color: #8c9a9e; font-size: 13px; line-height: 1.6; }
.lp-step.cash { background: #b9f17b; border-color: #b9f17b; color: #172319; }
.lp-step.cash p { color: #2b3d2c; }
.lp-step.cash .lp-step-num { color: #42603f; }
.lp-step.cash .quest-icon { background: #17231922; color: #172319; }
.lp-games { display: grid; gap: 6px; margin-top: 14px; }
.lp-game { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border-radius: 9px; background: #172126; border: 1px solid #26353b; font-size: 12px; }
.lp-game svg { color: #b9f17b; flex: 0 0 auto; }
.lp-game small { margin-left: auto; color: #7e9296; font: 9px 'DM Mono', monospace; text-align: right; }
.lp-band { margin-top: 28px; display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 10px 18px; padding: 18px; border: 1px dashed #b9f17b44; border-radius: 16px; background: rgba(182, 239, 119, .05); text-align: center; }
.lp-badge svg, .lp-ghost svg { flex: 0 0 auto; }
.lp-band strong { font-size: 20px; letter-spacing: -.03em; color: #b9f17b; display: inline-flex; align-items: center; gap: 9px; }
.lp-band span { color: #8c9a9e; font-size: 12px; }
.lp-split { display: grid; gap: 14px; }
.lp-card { position: relative; overflow: hidden; padding: 26px 22px; border: 1px solid #2c4945; border-radius: 20px; background: linear-gradient(120deg, #1b292b, #132125 60%, #172e2d); }
.lp-card p { color: #9badab; font-size: 14px; line-height: 1.65; margin: 0 0 20px; max-width: 520px; }
.lp-card h3 { margin: 16px 0 10px; font-size: 26px; line-height: 1.05; letter-spacing: -.04em; }
.lp-card .primary-button { text-decoration: none; }
.lp-card.soon { background: linear-gradient(120deg, #221a14, #161a1c 60%, #1b1f22); border-color: #4a3a2a; }
.lp-card.soon:after { content: ''; position: absolute; width: 240px; height: 240px; right: -70px; top: -80px; border-radius: 50%; border: 1px solid #e8a55833; background: #e8a5580a; }
.lp-soon-pill { display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: 999px; background: #e8a55818; border: 1px solid #e8a55855; color: #e8a558; font: 500 9px 'DM Mono', monospace; letter-spacing: .12em; }
.lp-mission { display: flex; gap: 12px; margin-top: 4px; padding: 14px; border-radius: 12px; background: #0d1519aa; border: 1px solid #2b3a40; }
.lp-mission svg { color: #e58a69; flex: 0 0 auto; margin-top: 2px; }
.lp-mission p { margin: 0; font-size: 12px; color: #bdc9c6; }
.lp-final { margin-top: 64px; padding: 34px 22px; text-align: center; border: 1px solid #34444a; border-radius: 22px; background: radial-gradient(circle at 50% 0%, #26494b, transparent 70%), #10191e; }
.lp-final .lp-h2 { margin-bottom: 10px; }
.lp-final p { margin: 0 auto; color: #8c9a9e; font-size: 13px; }
.lp-final .lp-ctas { justify-content: center; }
.lp-foot { margin-top: 32px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; color: #5f7378; font: 10px 'DM Mono', monospace; letter-spacing: .08em; }
.lp-foot-links { display: flex; flex-wrap: wrap; gap: 14px; }
.lp-foot-links a, .lp-foot-links span { display: inline-flex; align-items: center; gap: 6px; }
.lp-icon-title { display: flex; align-items: center; gap: 10px; }
.lp-icon-title svg { color: #e8a558; }
.lp-foot a { color: #84939a; text-decoration: none; }
.lp-foot a:hover { color: #b9f17b; }
.lp-reveal { opacity: 0; animation: lp-up .7s cubic-bezier(.2, .7, .2, 1) forwards; }
.lp-d1 { animation-delay: .08s; } .lp-d2 { animation-delay: .16s; } .lp-d3 { animation-delay: .24s; } .lp-d4 { animation-delay: .32s; }
@keyframes lp-up { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@keyframes lp-float { 50% { transform: translateY(-8px); } }
@keyframes lp-float-x { 0%, 100% { transform: translateX(-50%); } 50% { transform: translateX(-50%) translateY(-8px); } }
@keyframes lp-ring { from { transform: scale(.55); opacity: .9; } to { transform: scale(1.35); opacity: 0; } }
@media (min-width: 760px) {
  .lp-shell { padding: 0 32px 48px; }
  .lp-top { height: 88px; }
  .lp-hero { grid-template-columns: 1.15fr .85fr; padding-top: 40px; }
  .lp-visual { height: 440px; }
  .lp-mascot { width: 220px; height: 320px; }
  .lp-steps { grid-template-columns: repeat(2, 1fr); }
  .lp-split { grid-template-columns: 1fr 1fr; }
  .lp-card { padding: 32px 30px; }
  .lp-final { padding: 48px 32px; }
}
@media (min-width: 1040px) {
  .lp-steps { grid-template-columns: 1fr 1fr 1.35fr 1fr; align-items: stretch; }
}
@media (prefers-reduced-motion: reduce) {
  .lp-reveal { opacity: 1; animation: none; }
  .lp-mascot, .lp-chip, .lp-ring, .lp-visual .point-pulse { animation: none; }
}
`;

function Landing({ onStart, onSignIn }: LandingProps) {
  return (
    <main className="lp-shell">
      <style>{css}</style>
      <div className="ambient ambient-left" />
      <div className="ambient ambient-right" />
      <div className="lp-wrap">
        <header className="lp-top">
          <div className="brand-lockup">
            <div className="brand-mark"><ScanLine size={20} strokeWidth={2.5} /></div>
            <div>
              <div className="brand-name">OZONE <span>PLAY</span></div>
              <div className="brand-subtitle">CASH QUEST / FIELD 01</div>
            </div>
          </div>
          <button className="lp-ghost sm" onClick={onSignIn}><LogIn size={14} /> Sign in</button>
        </header>

        <section className="lp-hero">
          <div>
            <div className="live-pill lp-reveal"><span /> REAL CITY / REAL REWARDS</div>
            <h1 className="lp-reveal lp-d1">Get Paid to <em>Explore</em> Your City</h1>
            <p className="lp-sub lp-reveal lp-d2">Ozone Play turns real steps into sparks, local cafe drops into rewards, and skill games into cashouts. Free to start.</p>
            <div className="lp-ctas lp-reveal lp-d3">
              <button className="primary-button" onClick={onStart}>Start free <ArrowRight size={16} /></button>
              <button className="lp-ghost" onClick={onSignIn}>Sign in</button>
            </div>
            <div className="lp-badge lp-reveal lp-d4"><ShieldCheck size={14} /> Pure skill. No chance.</div>
          </div>

          <div className="lp-visual lp-reveal lp-d2" aria-hidden="true">
            <div className="map-road road-one" />
            <div className="map-road road-two" />
            <div className="map-road road-three" />
            {DROPS.map((d) => (
              <span key={`${d.x}-${d.y}`} className={`map-point ${d.tone}`} style={{ left: `${d.x}%`, top: `${d.y}%` }}>
                <span className="point-pulse" />
                <span className="point-core"><Gem size={13} /></span>
              </span>
            ))}
            <div className="lp-ring" />
            <div className="lp-ring two" />
            <img className="lp-mascot" src={MASCOT} alt="" />
            <div className="lp-chip a"><Footprints size={14} /> STEPS → SPARKS</div>
            <div className="lp-chip b"><MapPin size={14} /> CAFE DROP NEARBY</div>
            <div className="lp-chip c"><Crosshair size={14} /> SKILL RUN READY</div>
          </div>
        </section>

        <section className="lp-section">
          <p className="eyebrow">HOW IT WORKS</p>
          <h2 className="lp-h2">Walk. Collect. Play. <em>Cash out.</em></h2>
          <div className="lp-steps">
            <article className="lp-step">
              <div className="lp-step-head"><span className="quest-icon mint"><Footprints size={20} /></span><span className="lp-step-num">01</span></div>
              <h3>Walk</h3>
              <p>Earn sparks for real steps. Your daily route becomes progress.</p>
            </article>
            <article className="lp-step">
              <div className="lp-step-head"><span className="quest-icon coral"><MapPin size={20} /></span><span className="lp-step-num">02</span></div>
              <h3>Collect</h3>
              <p>Grab drops at local cafes and shops on the live city map.</p>
            </article>
            <article className="lp-step">
              <div className="lp-step-head"><span className="quest-icon gold"><Gamepad2 size={20} /></span><span className="lp-step-num">03</span></div>
              <h3>Play</h3>
              <p>Pure skill games, no luck. Your score earns your sparks.</p>
              <div className="lp-games">
                {GAMES.map((g) => (
                  <div className="lp-game" key={g.name}><g.icon size={14} /><span>{g.name}</span><small>{g.note}</small></div>
                ))}
              </div>
            </article>
            <article className="lp-step cash">
              <div className="lp-step-head"><span className="quest-icon"><Banknote size={20} /></span><span className="lp-step-num">04</span></div>
              <h3>Cash out</h3>
              <p>Members turn eligible sparks into real payouts. 100-spark minimum.</p>
            </article>
          </div>
          <div className="lp-band">
            <strong><ShieldCheck size={20} /> Pure skill. No chance.</strong>
            <span>No chance mechanics. Your score earns your edge.</span>
          </div>
        </section>

        <section className="lp-section lp-split">
          <div className="lp-card">
            <span className="quest-icon blue"><Store size={20} /></span>
            <p className="eyebrow" style={{ marginTop: 12 }}>FOR LOCAL BUSINESSES</p>
            <h3>Turn players into customers</h3>
            <p>Put a sponsored drop at your cafe, shop, or restaurant. It glows on the live map, and players walk in to check in and collect bonus sparks.</p>
            <ul style={{ margin: '12px 0 16px', paddingLeft: 18, display: 'grid', gap: 6, fontSize: 14, color: '#b9c9c4' }}>
              <li><b>Real foot traffic:</b> players only earn when they're physically at your door.</li>
              <li><b>Stand out:</b> your business name shows on a highlighted spot on the map.</li>
              <li><b>You set the reward:</b> pick the bonus and how long it runs.</li>
              <li><b>Simple monthly plan:</b> from $50 a month, cancel anytime.</li>
            </ul>
            <a className="primary-button" href={PARTNER_MAIL}><Mail size={15} /> Feature my business</a>
          </div>
          <div className="lp-card soon">
            <span className="lp-soon-pill"><Sparkles size={11} /> LIVE NOW</span>
            <h3 className="lp-icon-title"><MapIcon size={22} /> Own the Block</h3>
            <p>Buy plots on a real city map and earn sparks every time players check in. Turn on Rush Hour to make your plot glow and draw a crowd.</p>
            <div className="lp-mission">
              <HandHeart size={18} />
              <p>Faithfeast restaurants earn bonus drops. Faithfeast, sponsored by Givenga, is ending food scarcity one neighborhood at a time, from a smartphone near you.</p>
            </div>
          </div>
        </section>

        <section className="lp-final">
          <p className="eyebrow">YOUR CITY IS CALLING</p>
          <h2 className="lp-h2">Ready for your <em>first run?</em></h2>
          <p>Free to start. Create an account and start earning sparks today.</p>
          <div className="lp-ctas">
            <button className="primary-button" onClick={onStart}>Start free <ArrowUpRight size={16} /></button>
            <button className="lp-ghost" onClick={onSignIn}>Sign in</button>
          </div>
        </section>

        <footer className="lp-foot">
          <span>OZONE PLAY / CASH QUEST</span>
          <span className="lp-foot-links"><a href={PARTNER_MAIL}><Building2 size={11} /> PARTNER WITH US</a><span><Sparkles size={11} /> FREE TO START</span></span>
        </footer>
      </div>
    </main>
  );
}

export default Landing;
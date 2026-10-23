import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { reportGameResult } from '@/lib/progress';
import { sfx, haptic } from '@/lib/sfx';
import { X, Diamond, Coffee, RotateCcw, Plus, Users, Wine, Skull, Star, Flame, ArrowRight, Crown } from 'lucide-react';

type Props = {
  onClose: () => void;
};

type Suit = 'diamond' | 'tea' | 'flame' | 'skull';
type CardKind = 'drink' | 'give' | 'rule' | 'game' | 'social' | 'wild';
type GameCard = {
  id: string;
  suit: Suit;
  kind: CardKind;
  rank: string;
  title: string;
  prompt: string;
  intensity: 1 | 2 | 3;
};

type Player = { id: number; name: string; sips: number; cards: number };

const SUITS: { suit: Suit; icon: typeof Diamond; color: string; label: string }[] = [
  { suit: 'diamond', icon: Diamond, color: '#8bd1d4', label: 'Diamond' },
  { suit: 'tea', icon: Coffee, color: '#e8d083', label: 'Tea' },
  { suit: 'flame', icon: Flame, color: '#e58a69', label: 'Flame' },
  { suit: 'skull', icon: Skull, color: '#c98ad4', label: 'Skull' },
];

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

const CARD_DEFS: Record<CardKind, { title: string; prompt: string }[]> = {
  drink: [
    { title: 'Sip Sunset', prompt: 'Take 1 sip for every diamond card on the table.' },
    { title: 'Tide Rise', prompt: 'Take sips equal to the last card number drawn.' },
    { title: 'Brew Over', prompt: 'Finish half your drink. No complaints.' },
    { title: 'Deep End', prompt: 'Drink for 3 seconds straight.' },
  ],
  give: [
    { title: 'Pass the Pot', prompt: 'Give 2 sips to any player. Split or stack.' },
    { title: 'Diamond Tax', prompt: 'Pick someone to drink twice. They pick next.' },
    { title: 'Tea Time', prompt: 'Everyone with a full drink takes 1 sip.' },
    { title: 'Hot Pour', prompt: 'Give 4 sips across the table however you like.' },
  ],
  rule: [
    { title: 'New Law', prompt: 'Make a rule. Break it = 1 sip. Lasts until next rule card.' },
    { title: 'No Names', prompt: 'No first names until the next diamond appears. Sip if you slip.' },
    { title: 'Left Hand Only', prompt: 'Drink only with your left hand until the next rule card.' },
    { title: 'Word Ban', prompt: 'Ban a common word. Anyone who says it drinks.' },
  ],
  game: [
    { title: 'Quick Draw', prompt: 'Last person to touch their drink drinks. 3-2-1.' },
    { title: 'Stare Down', prompt: 'Stare at the player to your right. First to blink sips.' },
    { title: 'Rhyme Time', prompt: 'Go around rhyming a word. First to repeat or stall drinks.' },
    { title: 'Categories', prompt: 'Name a category. Go around. Repeat or stall = sip.' },
  ],
  social: [
    { title: 'Island Toast', prompt: 'Everyone raises a glass and drinks together. Cheers!' },
    { title: 'Social Sip', prompt: 'Everyone takes 1 sip on the count of three.' },
    { title: 'Waterfall', prompt: 'Waterfall! Start drinking. Stop when the player before you stops.' },
  ],
  wild: [
    { title: 'Wildcard Royal', prompt: 'Make any player finish their drink. Use once.' },
    { title: 'Diamond Reverse', prompt: 'Reverse play direction and give 2 sips.' },
    { title: 'Tea Break', prompt: 'Skip your next turn and force someone to take 2 sips.' },
  ],
};

const KIND_BY_SUIT: Record<Suit, CardKind[]> = {
  diamond: ['give', 'social', 'wild'],
  tea: ['drink', 'rule', 'game'],
  flame: ['drink', 'give', 'game'],
  skull: ['rule', 'wild', 'drink'],
};

function buildDeck(): GameCard[] {
  const deck: GameCard[] = [];
  for (const { suit } of SUITS) {
    const kinds = KIND_BY_SUIT[suit];
    RANKS.forEach((rank, idx) => {
      const kind = kinds[idx % kinds.length];
      const defs = CARD_DEFS[kind];
      const def = defs[idx % defs.length];
      const intensity = (idx >= 10 ? 3 : idx >= 6 ? 2 : 1) as 1 | 2 | 3;
      deck.push({
        id: `${suit}-${rank}`,
        suit,
        kind,
        rank,
        title: def.title,
        prompt: def.prompt,
        intensity,
      });
    });
  }
  return shuffle(deck);
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const KIND_META: Record<CardKind, { label: string; icon: typeof Wine; color: string }> = {
  drink: { label: 'Drink', icon: Wine, color: '#e58a69' },
  give: { label: 'Give', icon: ArrowRight, color: '#8bd1d4' },
  rule: { label: 'Rule', icon: Star, color: '#e8d083' },
  game: { label: 'Mini Game', icon: Flame, color: '#b9f17b' },
  social: { label: 'Social', icon: Users, color: '#c98ad4' },
  wild: { label: 'Wildcard', icon: Crown, color: '#df8fb0' },
};

export default function DrunkTeaDiamond({ onClose }: Props) {
  const [deck, setDeck] = useState<GameCard[]>(() => buildDeck());
  const [drawn, setDrawn] = useState<GameCard | null>(null);
  const [discards, setDiscards] = useState<GameCard[]>([]);
  const [players, setPlayers] = useState<Player[]>([
    { id: 1, name: 'Player 1', sips: 0, cards: 0 },
    { id: 2, name: 'Player 2', sips: 0, cards: 0 },
  ]);
  const [currentPlayer, setCurrentPlayer] = useState(0);
  const [activeRules, setActiveRules] = useState<string[]>([]);
  const [newRuleText, setNewRuleText] = useState('');
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const cardsLeft = deck.length;
  const round = discards.length;

  const drawnCount = useRef(0);
  const drawCard = useCallback(() => {
    if (cardsLeft === 0) return;
    const [next, ...rest] = deck;
    sfx.whoosh(); haptic(10);
    drawnCount.current += 1;
    if (drawnCount.current === 3) reportGameResult('drunk', 3);
    setDeck(rest);
    setDrawn(next);
    setDiscards((d) => [next, ...d].slice(0, 12));
    setPlayers((prev) => prev.map((p, i) => i === currentPlayer ? { ...p, cards: p.cards + 1 } : p));
    if (next.kind === 'rule') {
      setActiveRules((r) => [next.title, ...r].slice(0, 4));
    }
  }, [cardsLeft, deck, currentPlayer]);

  const nextTurn = () => {
    setDrawn(null);
    setCurrentPlayer((p) => (p + 1) % players.length);
  };

  const addPlayer = () => {
    if (players.length >= 8) return;
    setPlayers((prev) => [...prev, { id: prev.length + 1, name: `Player ${prev.length + 1}`, sips: 0, cards: 0 }]);
  };

  const removePlayer = (id: number) => {
    if (players.length <= 2) return;
    setPlayers((prev) => prev.filter((p) => p.id !== id));
    setCurrentPlayer((p) => Math.min(p, players.length - 2));
  };

  const renamePlayer = (id: number, name: string) => {
    setPlayers((prev) => prev.map((p) => p.id === id ? { ...p, name } : p));
  };

  const recordSips = (playerId: number, amount: number) => {
    setPlayers((prev) => prev.map((p) => p.id === playerId ? { ...p, sips: Math.max(0, p.sips + amount) } : p));
  };

  const addCustomRule = () => {
    if (!newRuleText.trim()) return;
    setActiveRules((r) => [newRuleText.trim(), ...r].slice(0, 4));
    setNewRuleText('');
  };

  const restart = () => {
    setDeck(buildDeck());
    setDrawn(null);
    setDiscards([]);
    setPlayers((prev) => prev.map((p) => ({ ...p, sips: 0, cards: 0 })));
    setCurrentPlayer(0);
    setActiveRules([]);
  };

  const suitMeta = useMemo(() => {
    if (!drawn) return null;
    return SUITS.find((s) => s.suit === drawn.suit)!;
  }, [drawn]);

  const kindMeta = drawn ? KIND_META[drawn.kind] : null;

  if (!agreed) {
    return (
      <div className="modal-backdrop">
        <div className="game-modal drunk-modal">
          <button className="modal-close" onClick={onClose}><X size={17} /></button>
          <div className="drunk-hero">
            <div className="drunk-emblem">
              <Diamond size={26} />
              <Coffee size={20} />
            </div>
            <p className="eyebrow">PARTY MODE / 21+</p>
            <h2>Drunk Tea Diamond</h2>
            <p className="store-subtitle">A social drinking card game. Draw diamond, tea, flame, and skull cards to hand out sips, set rules, and play mini-games with your group.</p>
          </div>
          <div className="drunk-disclaimer">
            <Skull size={18} />
            <div>
              <strong>Play responsibly</strong>
              <p>This game is for adults 21+ who choose to drink. Drink water between rounds, never drive after drinking, and skip sips or substitute water anytime — no judgment. Know your limits and look out for each other.</p>
            </div>
          </div>
          <div className="drunk-start-actions">
            <button className="primary-button full" onClick={() => setAgreed(true)}>
              I understand — let&apos;s play <ArrowRight size={15} />
            </button>
            <button className="boost-button" onClick={onClose}>Not now</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop">
      <div className="game-modal drunk-modal">
        <button className="modal-close" onClick={onClose}><X size={17} /></button>
        <div className="game-header">
          <div>
            <p className="eyebrow">PARTY DECK / ROUND {round + 1}</p>
            <h2>Drunk Tea Diamond</h2>
          </div>
          <span className="timer island-tide"><Diamond size={13} /> {cardsLeft} cards left</span>
        </div>

        <div className="drunk-layout">
          <div className="drunk-board">
            <div className="drunk-table">
              {!drawn ? (
                <button className="draw-pile" onClick={drawCard} disabled={cardsLeft === 0}>
                  <div className="pile-stack">
                    <span className="pile-card back" />
                    <span className="pile-card back" />
                    <span className="pile-card back top" />
                  </div>
                  <strong>{cardsLeft === 0 ? 'Deck empty' : 'Draw a card'}</strong>
                  <small>{players[currentPlayer]?.name}&apos;s turn</small>
                </button>
              ) : (
                <div className={`drawn-card suit-${drawn.suit} kind-${drawn.kind}`}>
                  <div className="card-corner top-left">
                    <span>{drawn.rank}</span>
                    {suitMeta && <suitMeta.icon size={14} />}
                  </div>
                  <div className="card-center">
                    {kindMeta && <kindMeta.icon size={32} />}
                    <strong>{drawn.title}</strong>
                    <p>{drawn.prompt}</p>
                    <div className="intensity-dots">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <span key={i} className={i < drawn.intensity ? 'on' : ''} />
                      ))}
                    </div>
                  </div>
                  <div className="card-corner bottom-right">
                    {suitMeta && <suitMeta.icon size={14} />}
                    <span>{drawn.rank}</span>
                  </div>
                </div>
              )}
            </div>

            {drawn && (
              <div className="drawn-actions">
                <button className="primary-button full" onClick={nextTurn}>
                  Done — next player <ArrowRight size={15} />
                </button>
              </div>
            )}

            {activeRules.length > 0 && (
              <div className="active-rules">
                <strong><Star size={13} /> Active rules</strong>
                {activeRules.map((rule, i) => (
                  <div key={i} className="rule-chip">{rule}</div>
                ))}
              </div>
            )}

            {drawn?.kind === 'rule' && (
              <div className="custom-rule-row">
                <input
                  type="text"
                  placeholder="Add your own rule…"
                  value={newRuleText}
                  onChange={(e) => setNewRuleText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCustomRule()}
                />
                <button onClick={addCustomRule}>Add rule</button>
              </div>
            )}
          </div>

          <div className="drunk-side">
            <div className="player-list-header">
              <strong><Users size={14} /> Players ({players.length})</strong>
              {players.length < 8 && <button className="add-player-btn" onClick={addPlayer}><Plus size={13} /> Add</button>}
            </div>
            <div className="player-list">
              {players.map((p, i) => (
                <div key={p.id} className={`player-row ${i === currentPlayer ? 'current' : ''}`}>
                  <span className="player-dot" />
                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) => renamePlayer(p.id, e.target.value)}
                    className="player-name-input"
                  />
                  <div className="sip-controls">
                    <button onClick={() => recordSips(p.id, -1)} aria-label="remove sip">–</button>
                    <span className="sip-count">{p.sips}</span>
                    <button onClick={() => recordSips(p.id, 1)} aria-label="add sip">+</button>
                  </div>
                  <small className="cards-drawn">{p.cards} cards</small>
                  {players.length > 2 && <button className="remove-player" onClick={() => removePlayer(p.id)}><X size={12} /></button>}
                </div>
              ))}
            </div>

            <div className="discard-preview">
              <strong>Last cards</strong>
              <div className="discard-row">
                {discards.slice(0, 6).map((c) => {
                  const sm = SUITS.find((s) => s.suit === c.suit)!;
                  return (
                    <span key={c.id} className={`discard-mini suit-${c.suit}`}>
                      <sm.icon size={11} />
                      {c.rank}
                    </span>
                  );
                })}
                {discards.length === 0 && <small className="empty-note">No cards drawn yet</small>}
              </div>
            </div>

            <button className="portal-link" onClick={restart}>
              <RotateCcw size={13} /> Shuffle a new deck
            </button>
          </div>
        </div>

        <small className="game-footnote">Drink responsibly · substitute water anytime · 21+ only · this game tracks sips for fun, not as a drinking target</small>
      </div>
    </div>
  );
}

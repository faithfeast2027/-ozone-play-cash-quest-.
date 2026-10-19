import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Sparkles, Trophy, RotateCcw, Waves, Shell, Crown } from 'lucide-react';
import { creditSparks, fetchWallet, getOrCreatePlayerId } from '@/lib/supabase';
import type { Character } from '@/components/SparkRunGame';

type Props = {
  character: Character;
  onClose: () => void;
  onWalletUpdate?: () => void;
};

const PIT_COUNT = 6;
const START_STONES = 4;

type Board = {
  pits: number[];
  stores: [number, number];
};

const createBoard = (): Board => ({
  pits: Array(PIT_COUNT * 2).fill(START_STONES),
  stores: [0, 0],
});

const PLAYER = 0;
const AI = 1;

const playerPitRange = (player: number): [number, number] =>
  player === PLAYER ? [0, PIT_COUNT - 1] : [PIT_COUNT, PIT_COUNT * 2 - 1];

const oppositePit = (pit: number): number =>
  (pit + PIT_COUNT) % (PIT_COUNT * 2);

const isPlayerSide = (pit: number, player: number): boolean => {
  const [start, end] = playerPitRange(player);
  return pit >= start && pit <= end;
};

const isValidMove = (board: Board, pit: number, player: number): boolean => {
  if (!isPlayerSide(pit, player)) return false;
  return board.pits[pit] > 0;
};

const sowStones = (board: Board, pit: number, player: number): { board: Board; extraTurn: boolean; captured: boolean } => {
  const next: Board = { pits: [...board.pits], stores: [...board.stores] as [number, number] };
  let stones = next.pits[pit];
  next.pits[pit] = 0;
  let current = pit;
  let lastPit = pit;

  while (stones > 0) {
    current = (current + 1) % (PIT_COUNT * 2);
    if (current === pit) continue;
    next.pits[current] += 1;
    stones -= 1;
    lastPit = current;
  }

  let extraTurn = false;
  let captured = false;

  const lastInStore = false;

  if (isPlayerSide(lastPit, player) && next.pits[lastPit] === 1 && board.pits[lastPit] === 0) {
    const opp = oppositePit(lastPit);
    if (next.pits[opp] > 0) {
      next.stores[player] += next.pits[lastPit] + next.pits[opp];
      next.pits[lastPit] = 0;
      next.pits[opp] = 0;
      captured = true;
    }
  }

  void lastInStore;

  if (lastPit === pit && next.pits[pit] === 1 && isPlayerSide(pit, player)) {
    const opp = oppositePit(pit);
    if (next.pits[opp] > 0) {
      next.stores[player] += next.pits[pit] + next.pits[opp];
      next.pits[pit] = 0;
      next.pits[opp] = 0;
      captured = true;
    }
  }

  return { board: next, extraTurn, captured };
};

const sideIsEmpty = (board: Board, player: number): boolean => {
  const [start, end] = playerPitRange(player);
  return board.pits.slice(start, end + 1).every((s) => s === 0);
};

const finalizeBoard = (board: Board): Board => {
  const next: Board = { pits: [...board.pits], stores: [...board.stores] as [number, number] };
  for (const player of [PLAYER, AI]) {
    if (sideIsEmpty(next, player)) {
      const other = player === PLAYER ? AI : PLAYER;
      const [oStart, oEnd] = playerPitRange(other);
      for (let i = oStart; i <= oEnd; i++) {
        next.stores[other] += next.pits[i];
        next.pits[i] = 0;
      }
    }
  }
  return next;
};

const evaluateBoard = (board: Board): number => board.stores[AI] - board.stores[PLAYER];

const aiMove = (board: Board): number => {
  const [start, end] = playerPitRange(AI);
  let best = -Infinity;
  let bestPit = start;

  for (let pit = start; pit <= end; pit++) {
    if (!isValidMove(board, pit, AI)) continue;
    const { board: next } = sowStones(board, pit, AI);
    let score = evaluateBoard(next);
    if (sideIsEmpty(next, PLAYER)) {
      score += 20;
    }
    const myRemaining = next.pits.slice(start, end + 1).reduce((a, b) => a + b, 0);
    score += myRemaining * 0.1;
    if (score > best) {
      best = score;
      bestPit = pit;
    }
  }
  return bestPit;
};

const SPARKS_PER_WIN = 150;
const SPARKS_PER_SHELL = 3;

export default function MancalaIsland({ character, onClose, onWalletUpdate }: Props) {
  const [board, setBoard] = useState<Board>(createBoard);
  const [turn, setTurn] = useState<number>(PLAYER);
  const [message, setMessage] = useState('Your move — pick a shell pit');
  const [phase, setPhase] = useState<'playing' | 'ended'>('playing');
  const [winner, setWinner] = useState<number | null>(null);
  const [thinking, setThinking] = useState(false);
  const [history, setHistory] = useState<{ you: number; ai: number }[]>([]);
  const [credited, setCredited] = useState(false);
  const [lastPit, setLastPit] = useState<number | null>(null);

  const playerId = useMemo(() => getOrCreatePlayerId(), []);
  const [playerScore, aiScore] = board.stores;

  const totalStones = useMemo(() => board.pits.reduce((a, b) => a + b, 0) + board.stores[0] + board.stores[1], [board]);

  const endGame = useCallback((finalBoard: Board) => {
    setPhase('ended');
    if (finalBoard.stores[PLAYER] > finalBoard.stores[AI]) {
      setWinner(PLAYER);
      setMessage('You won the island round!');
    } else if (finalBoard.stores[AI] > finalBoard.stores[PLAYER]) {
      setWinner(AI);
      setMessage('The tide turned — AI wins this round.');
    } else {
      setWinner(-1);
      setMessage('A perfect tie at sunset.');
    }
  }, []);

  const handleWinCredit = useCallback((finalBoard: Board) => {
    if (credited) return;
    setCredited(true);
    let reward = 0;
    if (finalBoard.stores[PLAYER] > finalBoard.stores[AI]) {
      reward = SPARKS_PER_WIN + finalBoard.stores[PLAYER] * SPARKS_PER_SHELL;
    } else if (finalBoard.stores[PLAYER] === finalBoard.stores[AI]) {
      reward = Math.floor(finalBoard.stores[PLAYER] * SPARKS_PER_SHELL * 0.5);
    }
    if (reward > 0) {
      creditSparks(playerId, reward, 'mancala_island', character.id)
        .then(() => {
          fetchWallet(playerId).then(() => onWalletUpdate?.());
        })
        .catch(() => {});
    }
  }, [credited, playerId, character.id, onWalletUpdate]);

  useEffect(() => {
    if (phase !== 'playing') return;
    if (sideIsEmpty(board, PLAYER) || sideIsEmpty(board, AI)) {
      const finalBoard = finalizeBoard(board);
      setBoard(finalBoard);
      endGame(finalBoard);
      handleWinCredit(finalBoard);
      return;
    }
    if (turn === AI) {
      setThinking(true);
      const timer = setTimeout(() => {
        const pit = aiMove(board);
        const { board: next } = sowStones(board, pit, AI);
        setLastPit(pit);
        setBoard(next);
        setThinking(false);
        setMessage('Your move — pick a shell pit');
        setTurn(PLAYER);
      }, 850);
      return () => clearTimeout(timer);
    }
  }, [turn, board, phase, endGame, handleWinCredit]);

  const makeMove = (pit: number) => {
    if (phase === 'ended' || turn !== PLAYER || thinking) return;
    if (!isValidMove(board, pit, PLAYER)) return;
    const { board: next, extraTurn, captured } = sowStones(board, pit, PLAYER);
    setLastPit(pit);
    setBoard(next);
    if (captured) {
      setMessage('Capture! You swept the opposing shells.');
    } else if (extraTurn) {
      setMessage('Landed in your store — bonus turn!');
    } else {
      setMessage('AI is thinking…');
      setTurn(AI);
    }
  };

  const restart = () => {
    setBoard(createBoard());
    setTurn(PLAYER);
    setPhase('playing');
    setWinner(null);
    setMessage('Your move — pick a shell pit');
    setThinking(false);
    setCredited(false);
    setLastPit(null);
  };

  const earnedSparks = winner === PLAYER ? SPARKS_PER_WIN + board.stores[PLAYER] * SPARKS_PER_SHELL : winner === -1 ? Math.floor(board.stores[PLAYER] * SPARKS_PER_SHELL * 0.5) : 0;

  return (
    <div className="modal-backdrop">
      <div className="game-modal mancala-modal">
        <button className="modal-close" onClick={onClose}><X size={17} /></button>
        <div className="game-header">
          <div>
            <p className="eyebrow">ISLAND BOARD / SHELL SOW</p>
            <h2>Mancala Island</h2>
          </div>
          <span className="timer island-tide"><Waves size={13} /> {totalStones} shells</span>
        </div>

        <div className="island-board">
          <div className="island-side ai-side">
            <div className="island-player-tag"><span className="avatar coral">AI</span><small>Tidecaster</small></div>
            <div className="island-store ai-store">
              <strong>{aiScore}</strong>
              <small>store</small>
            </div>
          </div>

          <div className="island-pits">
            <div className="pit-row ai-row">
              {board.pits.slice(PIT_COUNT, PIT_COUNT * 2).reverse().map((stones, i) => {
                const pitIndex = PIT_COUNT * 2 - 1 - i;
                return (
                  <button
                    key={pitIndex}
                    className={`shell-pit ${lastPit === pitIndex ? 'sown' : ''}`}
                    disabled={turn !== PLAYER || phase === 'ended' || thinking}
                    onClick={() => makeMove(pitIndex)}
                  >
                    {Array.from({ length: Math.min(stones, 8) }).map((_, s) => (
                      <span key={s} className="shell" style={{ '--r': `${(s / Math.max(stones, 1)) * 360}deg`, '--d': `${1.1 + (s % 3) * 0.15}rem` } as React.CSSProperties} />
                    ))}
                    {stones > 8 && <i className="shell-count">+{stones - 8}</i>}
                    <span className="pit-number">{stones}</span>
                  </button>
                );
              })}
            </div>
            <div className="pit-row player-row">
              {board.pits.slice(0, PIT_COUNT).map((stones, i) => {
                const pitIndex = i;
                return (
                  <button
                    key={pitIndex}
                    className={`shell-pit ${lastPit === pitIndex ? 'sown' : ''} ${turn === PLAYER && phase === 'playing' && stones > 0 ? 'clickable' : ''}`}
                    disabled={turn !== PLAYER || phase === 'ended' || thinking || stones === 0}
                    onClick={() => makeMove(pitIndex)}
                  >
                    {Array.from({ length: Math.min(stones, 8) }).map((_, s) => (
                      <span key={s} className="shell" style={{ '--r': `${(s / Math.max(stones, 1)) * 360}deg`, '--d': `${1.1 + (s % 3) * 0.15}rem` } as React.CSSProperties} />
                    ))}
                    {stones > 8 && <i className="shell-count">+{stones - 8}</i>}
                    <span className="pit-number">{stones}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="island-side player-side">
            <div className="island-player-tag"><img src={character.image} alt={character.name} /><small>{character.name}</small></div>
            <div className="island-store player-store">
              <strong>{playerScore}</strong>
              <small>your store</small>
            </div>
          </div>
        </div>

        <div className="island-status">
          <span className={`status-pill ${turn === PLAYER ? 'you' : 'ai'}`}>
            {phase === 'ended' ? <Trophy size={13} /> : thinking ? <Waves size={13} /> : <Shell size={13} />}
            {message}
          </span>
        </div>

        {phase === 'ended' && (
          <div className="mancala-result">
            <div className="result-banner">
              {winner === PLAYER ? <><Crown size={22} /><strong>Victory!</strong></> : winner === AI ? <><Waves size={22} /><strong>AI wins</strong></> : <><Shell size={22} /><strong>Tie game</strong></>}
            </div>
            <div className="result-score">
              <span className={winner === PLAYER ? 'win' : ''}><b>You</b> {board.stores[PLAYER]}</span>
              <span className={winner === AI ? 'win' : ''}><b>AI</b> {board.stores[AI]}</span>
            </div>
            {earnedSparks > 0 && <p className="earned-note"><Sparkles size={13} /> Earned {earnedSparks} sparks · added to your wallet</p>}
            <div className="run-gameover-actions">
              <button className="primary-button" onClick={restart}><RotateCcw size={15} /> Play again</button>
              <button className="boost-button" onClick={onClose}>Close</button>
            </div>
          </div>
        )}

        <small className="game-footnote">Pick a pit on your side to sow shells counter-clockwise · land in your store for a bonus turn · capture opposite shells by ending on an empty pit</small>
      </div>
    </div>
  );
}

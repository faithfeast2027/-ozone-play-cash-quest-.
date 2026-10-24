import { useEffect, useState } from 'react';
import { characterById, type PersonaId } from '@/lib/characters';

/** Floating companion: character portrait with a speech bubble. `line` changes trigger a fresh bubble. */
export default function WalkBuddy({ id, line, corner = 'bottom-left', compact = false }: {
  id: PersonaId; line?: string | null; corner?: 'bottom-left' | 'bottom-right' | 'inline'; compact?: boolean;
}) {
  const c = characterById(id);
  const [shown, setShown] = useState<string | null>(line ?? null);
  useEffect(() => {
    if (!line) return;
    setShown(line);
    const t = window.setTimeout(() => setShown(null), 4200);
    return () => window.clearTimeout(t);
  }, [line]);
  return (
    <div className={`walk-buddy wb-${c.id} ${corner} ${compact ? 'compact' : ''}`} onClick={() => setShown((s) => s ? null : (line ?? `${c.name} is with you`))}>
      <span className="wb-ring"><img src={c.image} alt={c.name} /></span>
      {shown && <span className="wb-bubble"><b>{c.name}</b>{shown}</span>}
    </div>
  );
}

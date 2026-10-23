// AI chat characters (fixed whitelist; personas are built server-side in /api/ozone-chat).
export type PersonaId = 'ozone' | 'volt' | 'ember' | 'nova';
export type ChatCharacter = { id: PersonaId; name: string; image: string; blurb: string };

export const CHAT_CHARACTERS: ChatCharacter[] = [
  { id: 'ozone', name: 'Ozone', image: '/assets/Gemini_Generated_Image__(1).jpg', blurb: 'Your hype field buddy' },
  { id: 'volt', name: 'Volt', image: '/assets/char_volt.jpg', blurb: 'Electric speedster' },
  { id: 'ember', name: 'Ember', image: '/assets/char_ember.jpg', blurb: 'Fiery streak keeper' },
  { id: 'nova', name: 'Nova', image: '/assets/char_nova.jpg', blurb: 'Cosmic strategist' },
];
export const EXTRA_CHARACTERS = CHAT_CHARACTERS.filter((c) => c.id !== 'ozone');
export const MAX_EXTRA_CHARACTERS = 3;

export const characterById = (id?: string | null): ChatCharacter => CHAT_CHARACTERS.find((c) => c.id === id) ?? CHAT_CHARACTERS[0];
export const isPersonaId = (id: unknown): id is PersonaId => typeof id === 'string' && CHAT_CHARACTERS.some((c) => c.id === id);

/**
 * Which characters a message addresses: "@Name" anywhere, or a greeting/name at the very start
 * ("Volt, ...", "hey nova what's up"). Only characters in `present` count. At most 2 reply per message.
 */
export function addressedCharacters(text: string, present: PersonaId[]): PersonaId[] {
  const out: PersonaId[] = [];
  const lower = text.toLowerCase();
  for (const id of present) {
    const name = characterById(id).name.toLowerCase();
    const at = new RegExp(`(^|[^\\w])@${name}\\b`).test(lower);
    const lead = new RegExp(`^\\s*((hey|yo|hi|hello|ok|okay|ayo|sup)[\\s,]+)?${name}\\b\\s*([,:!?.]|$)`).test(lower)
      || new RegExp(`^\\s*(hey|yo|hi|hello|ayo|sup)[\\s,]+${name}\\b`).test(lower);
    if (at || lead) out.push(id);
  }
  return out.slice(0, 2);
}

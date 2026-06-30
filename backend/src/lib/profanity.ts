// Lightweight profanity filter for user-generated text (DMs, comments).
// We censor rather than reject so a message still goes through — the bad word
// just renders as f***. hasProfanity() lets callers flag/log if they want.

const WORDS = [
  'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bullshit', 'bitch',
  'asshole', 'dick', 'pussy', 'cunt', 'slut', 'whore', 'bastard', 'douche',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'spic', 'chink', 'kike', 'tranny',
  'cock', 'jerk off', 'jackass', 'wanker', 'twat', 'prick',
]

// \b…\b so we don't censor inside innocent words (e.g. "Scunthorpe"); the source
// list stays the single point of truth. Leet-ish separators (.,*,-,_ ,spaces)
// between letters are tolerated so "f-u-c-k" is still caught.
const pattern = WORDS
  .map(w => w.split('').map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s.\\-_*]*'))
  .join('|')
const RE = new RegExp(`\\b(?:${pattern})\\b`, 'gi')

/** Replace each bad word with first letter + asterisks. */
export function censorProfanity(text: string): string {
  if (!text) return text
  return text.replace(RE, (m) => {
    const letters = m.replace(/[\s.\-_*]/g, '')
    return letters[0] + '*'.repeat(Math.max(1, letters.length - 1))
  })
}

/** True if the text contains a flagged word. */
export function hasProfanity(text: string): boolean {
  RE.lastIndex = 0
  return RE.test(text || '')
}

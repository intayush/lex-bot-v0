type SectionType = 'practice-area' | 'attorney-bio' | 'faq' | 'blog-post' | 'contact' | 'about' | 'general';

// URL path patterns — checked first (most reliable signal)
const URL_PATTERNS: [RegExp, SectionType][] = [
  [/\/practice-area|\/service|\/area-of-law/i, 'practice-area'],
  [/\/attorney|\/lawyer|\/team|\/staff|\/bio/i, 'attorney-bio'],
  [/\/faq|\/frequently-asked/i, 'faq'],
  [/\/blog|\/news|\/article|\/post/i, 'blog-post'],
  [/\/contact|\/location|\/office/i, 'contact'],
  [/\/about|\/firm|\/history|\/mission/i, 'about'],
];

// Content-based heuristics — checked when URL doesn't match.
// These use content analysis for more reliable classification.
// Order matters: more specific patterns must come before broad ones.
const CONTENT_HINTS: { test: (title: string, content: string) => boolean; type: SectionType }[] = [
  // FAQ — very specific titles
  {
    test: (title) => /faq|frequently asked|common question/i.test(title),
    type: 'faq',
  },
  // Contact — specific titles
  {
    test: (title) => /contact|reach us|get in touch|location|office hours/i.test(title),
    type: 'contact',
  },
  // About — specific titles
  {
    test: (title) => /about|our firm|our story|who we are|our history/i.test(title),
    type: 'about',
  },
  // Blog — specific titles or date-heavy patterns
  {
    test: (title) => /blog|news|article|update|posted on/i.test(title),
    type: 'blog-post',
  },
  // Attorney bio — must match biographical patterns, not just the word "attorney".
  // A page titled "Pittsburgh DUI Attorney" is a practice area, not a bio.
  // A bio has a person's name as the primary title (short, proper-noun-heavy)
  // AND content about education, experience, bar admissions, etc.
  {
    test: (title, content) => {
      // Content mentions biographical markers
      const bioMarkers = /\b(education|bar admissions?|law school|j\.d\.|juris doctor|admitted to|years of experience|practice since|biography)\b/i;
      const hasBioContent = bioMarkers.test(content);
      // Title explicitly says bio/profile/partner/associate (but NOT just "attorney" or "lawyer")
      const explicitBioTitle = /\b(bio|profile|partner|associate|of counsel|senior counsel)\b/i.test(title);

      // If content has clear bio markers or title says "bio/profile", it's a bio
      if (explicitBioTitle || hasBioContent) return true;

      // Name-like title alone is NOT sufficient (too many false positives like "Demo Law Firm")
      return false;
    },
    type: 'attorney-bio',
  },
  // Practice area — broad match on legal topic titles.
  // Matches titles like "Criminal Defense", "DUI Attorney", "Family Law Services", etc.
  // This comes AFTER attorney-bio so genuine bio pages are caught first.
  // Excludes standalone "law" to avoid matching "Law Firm" in firm names.
  {
    test: (title) => /practice area|service|legal service|attorney|lawyer|defense|criminal|injury|estate|family law|immigration|dui|dwi/i.test(title),
    type: 'practice-area',
  },
];

export function inferSectionType(url: string, title: string, content: string): SectionType {
  // Check URL patterns first — most reliable signal
  for (const [pattern, type] of URL_PATTERNS) {
    if (pattern.test(url)) return type;
  }

  // Check content-based heuristics
  for (const hint of CONTENT_HINTS) {
    if (hint.test(title, content)) return hint.type;
  }

  return 'general';
}

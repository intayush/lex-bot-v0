const STOP_WORDS = new Set([
  'the', 'is', 'at', 'in', 'on', 'to', 'of', 'and', 'or', 'for',
  'was', 'with', 'that', 'this', 'are', 'be', 'have', 'has', 'had',
  'do', 'does', 'did', 'an', 'as', 'by', 'from', 'it', 'my', 'me',
  'we', 'our', 'can', 'will', 'about', 'would', 'there', 'their',
  'what', 'when', 'how', 'who', 'which', 'if', 'not', 'no', 'so',
  'up', 'out', 'just', 'also', 'than', 'them', 'then', 'its',
  'you', 'your', 'they', 'but', 'all', 'been', 'more', 'most',
  'may', 'each', 'any', 'such', 'into', 'over', 'own', 'other',
  'very', 'every', 'after', 'before', 'between', 'under', 'through',
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'while', 'because',
]);

export function extractKeywords(title: string, content: string): string[] {
  const text = `${title} ${content}`.toLowerCase();
  const words = text
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  // Count word frequency
  const freq = new Map<string, number>();
  for (const word of words) {
    freq.set(word, (freq.get(word) || 0) + 1);
  }

  // Return top keywords by frequency, limited to 10
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word);
}

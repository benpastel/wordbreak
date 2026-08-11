// The same word list the server validates against, fetched once and held locally so
// that auto-claiming does not need a round trip on every letter. The server is still
// the authority — this only decides when it is worth asking.

let words: Set<string> | null = null;
let loading: Promise<void> | null = null;

export function loadWords(): Promise<void> {
  if (loading) return loading;
  loading = fetch(`${import.meta.env.BASE_URL}words.txt`)
    .then((r) => {
      if (!r.ok) throw new Error(`words.txt ${r.status}`);
      return r.text();
    })
    .then((text) => {
      words = new Set(text.split('\n').map((w) => w.trim()).filter(Boolean));
    });
  return loading;
}

export function isWord(w: string): boolean {
  return !!words && words.has(w.toLowerCase());
}

export function wordsReady(): boolean {
  return words !== null;
}

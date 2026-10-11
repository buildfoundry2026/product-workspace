/**
 * Structure-aware text chunking for source intake (FR-002).
 *
 * Splits on paragraphs first, then sentences, then whitespace, and greedily
 * packs the pieces into chunks of at most `maxChars`. Chunks never overlap and
 * every chunk records its exact [charStart, charEnd) span in the input, so
 * `text.slice(charStart, charEnd) === content` always holds. Evidence
 * references can therefore be traced back to precise positions in the source.
 */

export type TextChunk = {
  chunkIndex: number;
  content: string;
  charStart: number;
  charEnd: number;
};

export type ChunkOptions = {
  /** Upper bound on chunk length in characters. */
  maxChars?: number;
};

type Span = { start: number; end: number };

const DEFAULT_MAX_CHARS = 1500;

/** Normalizes line endings so stored content and chunk offsets agree. */
export function normalizeSourceText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  if (!Number.isInteger(maxChars) || maxChars < 50) {
    throw new RangeError("maxChars must be an integer >= 50");
  }

  const units = paragraphSpans(text).flatMap((p) =>
    p.end - p.start <= maxChars ? [p] : splitLongSpan(text, p, maxChars),
  );

  const chunks: TextChunk[] = [];
  let current: Span | null = null;

  const flush = () => {
    if (!current) return;
    chunks.push({
      chunkIndex: chunks.length,
      content: text.slice(current.start, current.end),
      charStart: current.start,
      charEnd: current.end,
    });
    current = null;
  };

  for (const unit of units) {
    if (current && unit.end - current.start <= maxChars) {
      current.end = unit.end;
    } else {
      flush();
      current = { ...unit };
    }
  }
  flush();

  return chunks;
}

/** Non-empty paragraphs separated by blank lines, trimmed of whitespace. */
function paragraphSpans(text: string): Span[] {
  const spans: Span[] = [];
  const separator = /\n[ \t]*\n/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = separator.exec(text)) !== null) {
    pushTrimmed(text, cursor, match.index, spans);
    cursor = match.index + match[0].length;
  }
  pushTrimmed(text, cursor, text.length, spans);
  return spans;
}

/** Splits an oversized paragraph into sentences, hard-splitting as a last resort. */
function splitLongSpan(text: string, span: Span, maxChars: number): Span[] {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const slice = text.slice(span.start, span.end);
  const result: Span[] = [];

  for (const { segment, index } of segmenter.segment(slice)) {
    const start = span.start + index;
    const sentence: Span[] = [];
    pushTrimmed(text, start, start + segment.length, sentence);

    for (const s of sentence) {
      if (s.end - s.start <= maxChars) {
        result.push(s);
      } else {
        result.push(...hardSplit(text, s, maxChars));
      }
    }
  }
  return result;
}

/** Splits at the last whitespace before maxChars, or exactly at maxChars if none. */
function hardSplit(text: string, span: Span, maxChars: number): Span[] {
  const result: Span[] = [];
  let start = span.start;

  while (span.end - start > maxChars) {
    const window = text.slice(start, start + maxChars);
    const lastSpace = window.search(/\s\S*$/);
    const cut = lastSpace > maxChars / 2 ? start + lastSpace : start + maxChars;
    pushTrimmed(text, start, cut, result);
    start = cut;
  }
  pushTrimmed(text, start, span.end, result);
  return result;
}

function pushTrimmed(text: string, start: number, end: number, out: Span[]) {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /\s/.test(text[end - 1])) end--;
  if (end > start) out.push({ start, end });
}

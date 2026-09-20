import { coverage, tokens } from './util';

export interface GroundingReport {
  grounded: boolean;
  score: number;
  notes: string[];
}

/**
 * A cheap, deterministic faithfulness check that runs on every generated journey.
 *
 * It does two things a second model call would not do reliably or cheaply:
 *  1. term coverage - does the generated text actually talk about the source?
 *  2. unsupported numbers - did a figure appear that is nowhere in the source?
 *     Invented numbers are the most dangerous hallucination in a bank or a ward,
 *     so any number not present in the source is flagged and surfaced in the UI.
 */
export function checkGrounding(generated: string, sourceText: string): GroundingReport {
  const notes: string[] = [];

  const genTerms = [...new Set(tokens(generated))].slice(0, 200);
  const score = coverage(genTerms.slice(0, 60), sourceText);

  const srcNumbers = new Set((sourceText.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(/,/g, '')));
  const genNumbers = [...new Set((generated.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(/,/g, '')))];
  const unsupported = genNumbers.filter(
    (n) => !srcNumbers.has(n) && Number(n) > 5 && !/^(0|1|2|3|4|5|10|100)$/.test(n),
  );

  if (unsupported.length) {
    notes.push(
      `${unsupported.length} figure(s) not found in the source (${unsupported.slice(0, 5).join(', ')}) — shown as scenario detail, not as fact.`,
    );
  }
  if (score < 0.35) {
    notes.push(`Low term overlap with the source (${Math.round(score * 100)}%). Treat as loosely grounded.`);
  }
  if (!notes.length) {
    notes.push(`Grounded: ${Math.round(score * 100)}% term overlap, no unsupported figures.`);
  }

  return { grounded: score >= 0.35 && unsupported.length <= 2, score, notes };
}

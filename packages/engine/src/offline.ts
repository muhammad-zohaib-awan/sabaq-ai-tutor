import type { BuildJourneyInput, EngineConfig, Journey, Localized } from './types';
import type { ExtractedSource } from './extract';
import { titleCase } from './extract';
import { keywords, now, uid } from './util';

/**
 * Deterministic, zero-dependency journey builder.
 *
 * This is the last link in the provider chain. It is NOT a placeholder: it
 * produces a real, playable three-beat mission from the extracted concepts, so
 * the learner experience survives an expired key, a 429, or a dead network.
 * The UI marks these journeys as "degraded" and the admin report counts them.
 */

const L = (en: string, ur: string, mix: string): Localized => ({ en, ur, mix });

function mutate(sentence: string, foreignWord: string): string {
  const ks = keywords(sentence, 3);
  if (!ks.length) return `${sentence} (always, in every case)`;
  const target = ks[0];
  const re = new RegExp(`\\b${target}\\b`, 'i');
  return re.test(sentence)
    ? sentence.replace(re, foreignWord)
    : `${sentence} — and this is caused by ${foreignWord}.`;
}

export function buildOfflineJourney(
  src: ExtractedSource,
  input: BuildJourneyInput,
  cfg: EngineConfig,
): Journey {
  const topic = titleCase(src.topic) || 'This Material';
  // "handed Cardiac_Cycle_Notes.pdf" reads fine; "handed Topic" does not.
  const sourcePhrase = /^(pasted text|topic|upload|your topic)$/i.test(src.sourceName)
    ? 'this material'
    : src.sourceName;
  const picks = src.concepts.slice(0, 6);
  const sourceRef = picks[0]?.sourceRef ?? src.sourceName;
  const difficulty = input.difficulty ?? cfg.defaultDifficulty;
  const elementCount = Math.min(4, Math.max(2, Math.round(difficulty / 1.5) + 1));

  const claims = picks.slice(0, elementCount).map((c, i) => {
    const isTrue = i % 2 === 0;
    const other = picks[(i + 1) % picks.length];
    const text = isTrue ? c.summary : mutate(c.summary, keywords(other?.summary ?? '', 1)[0] ?? 'the opposite');
    return {
      id: `e${i + 1}`,
      label: text.length > 110 ? text.slice(0, 107) + '...' : text,
      states: ['holds up', 'does not hold up'] as [string, string],
      correct: (isTrue ? 0 : 1) as 0 | 1,
      hint: isTrue
        ? `Look again at "${c.label}" in the source.`
        : `Check every noun in this one against the source before you accept it.`,
      group: (i % 2 === 0 ? 'left' : 'right') as 'left' | 'right',
    };
  });

  const facts = picks.slice(0, 4).map((c, i) => ({
    id: `f${i + 1}`,
    fact: c.summary,
    keywords: keywords(c.summary, 5),
  }));

  const rubric = picks.slice(0, 4).map((c, i) => ({
    id: `r${i + 1}`,
    label: `Explains "${c.label}" correctly`,
    keywords: keywords(c.summary, 6),
    weight: Number((1 / Math.min(4, Math.max(1, picks.length))).toFixed(2)),
  }));

  const numbers = (src.text.match(/\b\d{1,3}(?:[./]\d{1,3})?\b/g) ?? []).slice(0, 3);

  /**
   * The offline builder makes the same mechanic call the model is asked to make,
   * using surface cues rather than judgement. A no-key deployment therefore still
   * demonstrates the palette rather than always falling back to one mechanic.
   */
  const sequenceSentences = src.text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?۔])\s+/)
    .map((s) => s.trim())
    .filter((s) =>
      /^(step\s*(one|two|three|four|five|six|\d)|first|second|third|then|next|after that|finally|lastly|\d\s*[.)])\b/i.test(
        s,
      ),
    )
    .slice(0, 6);

  const orderStep =
    sequenceSentences.length >= 3
      ? {
          prompt: 'Drag these into the order they actually happen, then check it.',
          runLabel: 'Check the order',
          items: sequenceSentences.map((s, i) => ({
            id: `i${i + 1}`,
            label: s.replace(
              /^(step\s*(one|two|three|four|five|six|\d)|first|second|third|then|next|after that|finally|lastly|\d\s*[.)])[:,]?\s*/i,
              '',
            ).slice(0, 150),
            note: '',
          })),
          correctOrder: sequenceSentences.map((_, i) => `i${i + 1}`),
          consequenceIfWrong:
            'Out of order, a later step acts on information the earlier step was supposed to produce.',
          successMessage: 'That is the sequence the source actually describes.',
        }
      : null;

  const looksDefinitional =
    src.text.length < 700 ||
    /\b(what is|definition|meaning|vocabulary|basics|glossary|terms)\b/i.test(src.text.slice(0, 400));

  return {
    id: uid('j'),
    createdAt: now(),
    mode: looksDefinitional ? 'explain' : 'scenario',
    // The primer is the one place the offline builder can be genuinely
    // substantive: these are real sentences lifted from the learner's own
    // source, not invention. Without a model this is what teaches.
    primer: picks.length
      ? (() => {
          const body = picks.slice(0, 3).map((c) => c.summary).join(' ');
          return L(body, body, body);
        })()
      : L('', '', ''),
    lesson: {
      whatItIs: picks[0]?.summary ?? `${topic} — built from the material you supplied.`,
      keyPoints: picks.slice(1, 5).map((c) => c.summary),
      example: '',
      whyItMatters: '',
    },
    knowledge: picks.map((c) => c.summary),
    sourceKind: src.text.trim().length < 200 ? 'topic' : 'document',
    // Without a model there is no honest analogy to draw, and a generic one
    // ("think of it like a checklist") teaches nothing. The UI hides an empty one.
    analogy: L('', '', ''),
    media: {
      imagePrompt: `clean labelled educational diagram explaining ${topic}, flat vector illustration, white background, no watermark`,
      videoSearchQuery: `${topic} explained simply`,
    },
    title: orderStep
      ? L(`${topic}: In the Right Order`, `${topic}: درست ترتیب میں`, `${topic}: Sahi Tarteeb Mein`)
      : L(`${topic}: What Holds Up`, `${topic}: کیا درست ٹھہرتا ہے`, `${topic}: Kya Durust Thehrta Hai`),
    missionLabel: L(`Mission 1 · ${topic}`, `مشن ۱ · ${topic}`, `Mission 1 · ${topic}`),
    topic: src.topic,
    sourceName: src.sourceName,
    sourceRef,
    concepts: src.concepts,
    conceptCount: src.conceptCount,
    learnerType: input.learnerType,
    tone: input.tone ?? cfg.defaultTone,
    difficulty,
    language: input.language,
    constraint: input.constraint,
    contextPanel: {
      title: `Case file · ${topic}`,
      subtitle: src.sourceName,
      metrics: [
        ...(src.conceptCount > 0
          ? [{ label: 'Concepts in play', value: String(Math.min(src.conceptCount, 99)), tone: 'neutral' as const }]
          : []),
        ...(numbers[0] ? [{ label: 'Key figure', value: numbers[0], tone: 'warn' as const }] : []),
        { label: 'Difficulty', value: `${difficulty}/5`, tone: 'neutral' as const },
      ],
      // No synthetic trace. The offline builder has no signal to plot, and a
      // drawn-on waveform is decoration pretending to be data.
      waveform: 'none',
      caption: 'Working from the source you supplied. Running without a model right now.',
      audioCue: { label: 'Play cue', kind: 'tone' },
    },
    steps: [
      {
        id: uid('s'),
        kind: 'simulate',
        mechanic: orderStep ? 'order' : 'sort',
        label: orderStep
          ? L('Put it in order', 'ترتیب لگائیں', 'Tarteeb lagayen')
          : L('Judge the claims', 'دعووں کو پرکھیں', 'Claims parkhein'),
        xp: cfg.xpPerStep[0],
        narrative: orderStep
          ? L(
              `You have been handed ${sourcePhrase} and told to run this process today. Nobody is going to walk you through it first. Put the steps into the order they actually happen, then check yourself.`,
              `آپ کو ${sourcePhrase} دی گئی ہے اور آج یہ عمل خود چلانا ہے۔ کوئی پہلے سے سمجھانے نہیں آئے گا۔ مراحل کو اُس ترتیب میں لگائیں جس میں وہ واقعی ہوتے ہیں، پھر خود جانچیں۔`,
              `Aap ko ${sourcePhrase} di gayi hai aur aaj ye process khud chalana hai. Koi pehle se samjhane nahi aayega. Steps ko us tarteeb mein lagayen jis mein wo waqai hotay hain, phir khud check karein.`,
            )
          : L(
              `You have been handed ${sourcePhrase} and asked to act on it. Before anyone explains it to you, decide which of these statements actually hold up against the source. Flip each one, then run the check.`,
              `آپ کو ${sourcePhrase} دی گئی ہے اور اس پر عمل کرنا ہے۔ اس سے پہلے کہ کوئی آپ کو سمجھائے، یہ فیصلہ کریں کہ کون سے بیانات ماخذ کے مطابق درست ہیں۔`,
              `Aap ko ${sourcePhrase} di gayi hai aur is par amal karna hai. Koi aap ko samjhaye us se pehle ye tay karein ke kaun se statements source ke mutabiq durust hain.`,
            ),
        order: orderStep ?? undefined,
        sim: orderStep
          ? undefined
          : {
          prompt: 'Flip each statement to where you think it belongs, then run the check.',
          runLabel: 'Run the check',
          visual: 'board',
          elements: claims,
          successMessage: 'You separated what the source supports from what it does not.',
          failureMessage: 'At least one of those does not survive a look at the source.',
          legend: [
            { label: 'Holds up', color: '#34d399' },
            { label: 'Does not hold up', color: '#f87171' },
          ],
        },
      },
      {
        id: uid('s'),
        kind: 'inquire',
        label: L('Question the case', 'کیس سے سوال کریں', 'Case se sawal karein'),
        xp: cfg.xpPerStep[1],
        narrative: L(
          'Now interrogate it. Ask whatever you would ask a colleague who has already read this end to end.',
          'اب سوال کریں۔ جو کچھ آپ ایک ایسے ساتھی سے پوچھتے جس نے یہ پورا پڑھ رکھا ہو، وہ پوچھیں۔',
          'Ab sawal karein. Jo aap aisay colleague se poochte jisne ye poora parh rakha ho, wohi poochein.',
        ),
        inquire: {
          persona: 'a colleague who has already worked through this material',
          openingLine: `I have been through ${sourcePhrase}. Ask me anything about it — what is the part you are least sure of?`,
          suggestedQuestions: picks.slice(0, 4).map((c) => `What does "${c.label}" actually mean here?`),
          mustSurfaceFacts: facts,
        },
      },
      {
        id: uid('s'),
        kind: 'explain',
        label: L('Explain it back', 'اپنے الفاظ میں سمجھائیں', 'Apnay alfaz mein samjhayen'),
        xp: cfg.xpPerStep[2],
        narrative: L(
          'Last beat. Explain it to someone who has never seen this material, in your own words.',
          'آخری مرحلہ۔ کسی ایسے شخص کو اپنے الفاظ میں سمجھائیں جس نے یہ کبھی نہ دیکھا ہو۔',
          'Aakhri step. Kisi aisay banday ko apnay alfaz mein samjhayen jisne ye kabhi na dekha ho.',
        ),
        explain: {
          prompt: `In your own words, explain the core idea of ${topic} to a new joiner who has not seen ${sourcePhrase}.`,
          rubric: rubric.length
            ? rubric
            : [{ id: 'r1', label: 'Explains the main idea', keywords: keywords(src.text, 8), weight: 1 }],
          modelAnswer: picks
            .slice(0, 3)
            .map((c) => c.summary)
            .join(' '),
          phraseTiles: picks.slice(0, 6).map((c) => c.label.slice(0, 40)),
        },
      },
    ],
    provider: 'offline',
    model: 'deterministic-template-v1',
    latencyMs: 0,
    grounded: true,
    groundingNotes: ['Built directly from extracted source sentences; no generated facts.'],
    degraded: true,
  };
}

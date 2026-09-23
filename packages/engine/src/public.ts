import type { Journey, JourneyStep } from './types';
import { uid, now } from './util';

/**
 * What the browser is allowed to see.
 *
 * Grading happens on the server, so the answer key never needs to leave it.
 * The previous build sent the whole journey — `correct` on every sort element,
 * `correctOrder`, the "best" option, `correctNodeId`, the model answer — which
 * meant any learner could open DevTools (or just press the old client-side
 * "Show Answer") and read it. Mastery built on that is meaningless.
 */
export function publicJourney(j: Journey): Journey {
  const copy: Journey = JSON.parse(JSON.stringify(j));
  copy.steps = copy.steps.map((s) => publicStep(s));
  return copy;
}

function publicStep(s: JourneyStep): JourneyStep {
  const out: any = { ...s };
  if (s.sim) {
    out.sim = {
      prompt: s.sim.prompt,
      runLabel: s.sim.runLabel,
      visual: s.sim.visual,
      legend: s.sim.legend,
      elements: s.sim.elements.map((e) => ({
        id: e.id,
        label: e.label,
        states: e.states,
        group: e.group,
        x: e.x,
        y: e.y,
      })),
    };
  }
  if (s.order) {
    out.order = {
      prompt: s.order.prompt,
      runLabel: s.order.runLabel,
      items: s.order.items.map((i) => ({ id: i.id, label: i.label })),
    };
  }
  if (s.decide) {
    out.decide = {
      prompt: s.decide.prompt,
      situation: s.decide.situation,
      meters: s.decide.meters,
      options: s.decide.options.map((o) => ({ id: o.id, label: o.label })),
    };
  }
  if (s.trace) {
    out.trace = {
      prompt: s.trace.prompt,
      runLabel: s.trace.runLabel,
      question: s.trace.question,
      meterLabel: s.trace.meterLabel,
      edges: s.trace.edges,
      nodes: s.trace.nodes.map((n) => ({ id: n.id, label: n.label })),
    };
  }
  if (s.inquire) {
    out.inquire = {
      persona: s.inquire.persona,
      openingLine: s.inquire.openingLine,
      suggestedQuestions: s.inquire.suggestedQuestions,
      mustSurfaceFacts: s.inquire.mustSurfaceFacts.map((f) => ({
        id: f.id,
        hint: f.hint || (f.keywords?.[0] ? `Ask about "${f.keywords[0]}".` : 'Ask about the part you are least sure of.'),
      })),
    };
  }
  if (s.explain) {
    out.explain = {
      prompt: s.explain.prompt,
      phraseTiles: s.explain.phraseTiles ?? [],
      rubric: s.explain.rubric.map((r) => ({ id: r.id, label: r.label, weight: r.weight })),
    };
  }
  return out as JourneyStep;
}

/** A cached journey handed to a new learner gets its own identity. */
export function reissueJourney(j: Journey): Journey {
  const copy: Journey = JSON.parse(JSON.stringify(j));
  copy.id = uid('j');
  copy.createdAt = now();
  return copy;
}

/* ------------------------------------------------------------------ hints */

export interface HintInput {
  states?: Record<string, number>;
  order?: string[];
  optionId?: string | null;
  nodeId?: string | null;
  /** How many hints the learner has already taken on this step. */
  level?: number;
}

/**
 * A hint for whatever mechanic the step runs, based on where the learner
 * actually is right now. Never states the full answer.
 */
export function hintFor(step: JourneyStep, input: HintInput): { hint: string; targetId?: string } {
  const mech = step.mechanic ?? 'sort';
  const level = Math.max(0, Number(input.level) || 0);

  if (mech === 'order' && step.order) {
    const expected = step.order.correctOrder;
    const got = Array.isArray(input.order) ? input.order : [];
    const label = (id: string) => step.order!.items.find((i) => i.id === id)?.label ?? id;
    const firstWrong = expected.findIndex((id, i) => got[i] !== id);
    if (firstWrong === -1) return { hint: 'Your order looks right — go ahead and check it.' };
    if (firstWrong === 0) {
      return { hint: `Start with what has to happen before anything else. The first step is: "${label(expected[0])}".`, targetId: expected[0] };
    }
    return {
      hint: `Everything up to "${label(expected[firstWrong - 1])}" is in place. Ask yourself: what has to happen right after it?${
        level >= 1 ? ` (It is "${label(expected[firstWrong])}".)` : ''
      }`,
      targetId: expected[firstWrong],
    };
  }

  if (mech === 'decide' && step.decide) {
    const risky = step.decide.options.filter((o) => o.quality === 'risky');
    const goal = step.decide.meters[0];
    const ruleOut = risky[level % Math.max(1, risky.length)] ?? step.decide.options.find((o) => o.quality !== 'best');
    const goalLine = goal
      ? `The right call keeps "${goal.label}" moving ${goal.goodDirection === 'down' ? 'down' : 'up'} without creating a new problem.`
      : 'The right call solves the problem in front of you without creating a new one.';
    return { hint: `${goalLine}${ruleOut ? ` You can rule out: "${ruleOut.label}".` : ''}`, targetId: ruleOut?.id };
  }

  if (mech === 'trace' && step.trace) {
    const wrong = step.trace.nodes.filter((n) => n.id !== step.trace!.correctNodeId);
    const skip = wrong[level % Math.max(1, wrong.length)];
    return {
      hint: `Follow "${step.trace.meterLabel}" — where does it actually change?${
        skip ? ` It is not at "${skip.label}".` : ''
      }`,
      targetId: skip?.id,
    };
  }

  const els = step.sim?.elements ?? [];
  const wrong = els.find((e) => Number(input.states?.[e.id] ?? -1) !== e.correct) ?? els[level % Math.max(1, els.length)];
  if (!wrong) return { hint: 'Everything looks set — run the check.' };
  return { hint: `Look again at "${wrong.label}". ${wrong.hint}`, targetId: wrong.id };
}

/* ------------------------------------------------------ show correct steps */

export interface RevealStep {
  label: string;
  detail?: string;
  tag?: string;
}

/**
 * "Show correct steps": the full worked solution, laid out as a sequence the
 * learner can read — not just the board snapping into place.
 */
export function revealFor(step: JourneyStep): {
  mechanic: string;
  explanation: string;
  steps: RevealStep[];
  order?: string[];
  states?: Record<string, number>;
  optionId?: string;
  nodeId?: string;
} {
  const mech = step.mechanic ?? 'sort';

  if (mech === 'order' && step.order) {
    const byId = new Map(step.order.items.map((i) => [i.id, i]));
    return {
      mechanic: mech,
      explanation: step.order.successMessage,
      order: step.order.correctOrder,
      steps: step.order.correctOrder.map((id) => ({ label: byId.get(id)?.label ?? id, detail: byId.get(id)?.note })),
    };
  }

  if (mech === 'decide' && step.decide) {
    const rank = { best: 0, defensible: 1, risky: 2 } as const;
    const best = step.decide.options.find((o) => o.quality === 'best');
    return {
      mechanic: mech,
      explanation: step.decide.successMessage,
      optionId: best?.id,
      steps: [...step.decide.options]
        .sort((a, b) => rank[a.quality] - rank[b.quality])
        .map((o) => ({
          label: o.label,
          detail: o.consequence,
          tag: o.quality === 'best' ? 'Best call' : o.quality === 'defensible' ? 'Defensible' : 'Risky',
        })),
    };
  }

  if (mech === 'trace' && step.trace) {
    return {
      mechanic: mech,
      explanation: step.trace.successMessage,
      nodeId: step.trace.correctNodeId,
      steps: step.trace.nodes.map((n) => ({
        label: n.label,
        detail: n.detail,
        tag: n.id === step.trace!.correctNodeId ? 'The real work happens here' : undefined,
      })),
    };
  }

  const els = step.sim?.elements ?? [];
  return {
    mechanic: 'sort',
    explanation: step.sim?.successMessage ?? '',
    states: Object.fromEntries(els.map((e) => [e.id, e.correct])),
    steps: els.map((e) => ({ label: e.label, tag: e.states[e.correct], detail: e.hint })),
  };
}

/**
 * Core domain types for the Sabaq learning experience engine.
 *
 * Design note: nothing here is cardiology-specific. A "journey" is a generic
 * three-beat arc (simulate -> inquire -> explain) that any source content can be
 * mapped onto. The cardiac demo in the screenshots is just one instantiation.
 */

export type Language = 'en' | 'ur' | 'mix';

export type OperatingConstraint =
  | 'standard'
  | 'low_bandwidth'
  | 'voice_only'
  | 'accessibility'
  | 'offline_first';

export type Tone = 'coaching' | 'socratic' | 'formal' | 'playful' | 'mentor';

export interface Localized {
  en: string;
  ur: string;
  mix: string;
}

/** A concept lifted out of the source material. Mastery is tracked per concept. */
export interface Concept {
  id: string;
  label: string;
  summary: string;
  sourceRef: string;
}

/** Metric tiles + optional waveform shown beside the scenario (the "vitals" card). */
export interface ContextPanel {
  title: string;
  subtitle: string;
  metrics: Array<{
    label: string;
    value: string;
    tone: 'neutral' | 'good' | 'warn' | 'bad';
  }>;
  waveform: 'ecg' | 'wave' | 'none';
  caption: string;
  audioCue?: { label: string; kind: 'heartbeat' | 'tone' | 'none' };
}

/**
 * Step 1 - the simulation. Generalised as a "state board": a set of elements the
 * learner flips between two states, then runs to see the consequence.
 * Cardiac: valves open/closed. KYC: documents accept/escalate. Safety: valves,
 * switches, approvals - same primitive.
 */
export interface SimSpec {
  prompt: string;
  runLabel: string;
  visual: 'heart' | 'board';
  elements: Array<{
    id: string;
    label: string;
    states: [string, string];
    correct: 0 | 1;
    hint: string;
    group?: 'left' | 'right';
    /** Position on the generic board, 0..1 space. Ignored by the heart visual. */
    x?: number;
    y?: number;
  }>;
  successMessage: string;
  failureMessage: string;
  legend?: Array<{ label: string; color: string }>;
}

/** Step 2 - the learner interrogates the case. Free conversation, no quiz. */
export interface InquireSpec {
  persona: string;
  openingLine: string;
  suggestedQuestions: string[];
  /** Facts a competent learner should surface. Used as an engagement signal. */
  mustSurfaceFacts: Array<{ id: string; fact: string; keywords: string[]; hint?: string }>;
}

/** Step 3 - the learner explains it back. This is where mastery evidence is strongest. */
export interface ExplainSpec {
  prompt: string;
  rubric: Array<{
    id: string;
    label: string;
    keywords: string[];
    weight: number;
  }>;
  modelAnswer: string;
  /** Short clickable phrases that help a learner start their explanation. */
  phraseTiles?: string[];
}

/* ------------------------------------------------- interaction mechanics */

/**
 * The mechanic palette.
 *
 * The hard problem this solves: a learner can bring ANY topic, and no model can
 * invent a bespoke interaction per topic reliably. So the interactions live in
 * code and the model only supplies data for them. Every mechanic below works on
 * arbitrary source material - none of them assume a domain.
 *
 * Deliberately NOT included: a free-variable physics simulator. It would mean
 * asking the model to author a rule table ("if gas>60 then speed+3"), which is
 * ungrounded numeric invention - exactly the failure mode the grounding check
 * exists to catch - and it only applies to the minority of topics that have
 * interacting quantities.
 */
export type Mechanic = 'sort' | 'order' | 'decide' | 'trace';

/** Order: put the steps of a process into sequence. Works on any procedure. */
export interface OrderSpec {
  prompt: string;
  runLabel: string;
  items: Array<{ id: string; label: string; note: string }>;
  /** Item ids in their correct sequence. */
  correctOrder: string[];
  consequenceIfWrong: string;
  successMessage: string;
}

/**
 * Decide: a situation, a handful of genuinely defensible actions, and meters
 * that move as a consequence. Meter movements are authored as plain integers by
 * the model, never as formulas, so nothing numeric is computed from invented rules.
 */
export interface DecideSpec {
  prompt: string;
  situation: string;
  meters: Array<{ id: string; label: string; value: number; max: number; goodDirection: 'up' | 'down' }>;
  options: Array<{
    id: string;
    label: string;
    quality: 'best' | 'defensible' | 'risky';
    consequence: string;
    deltas: Array<{ meterId: string; delta: number }>;
  }>;
  successMessage: string;
}

/** Trace: predict where something goes in a system, then watch it flow. */
export interface TraceSpec {
  prompt: string;
  runLabel: string;
  nodes: Array<{ id: string; label: string; detail: string }>;
  edges: Array<[string, string]>;
  /** Commit before reveal: the learner names the step that does the real work. */
  question: string;
  correctNodeId: string;
  meterLabel: string;
  meterRisesAtNodeId: string;
  successMessage: string;
  failureMessage: string;
}

export type StepKind = 'simulate' | 'inquire' | 'explain';

export interface JourneyStep {
  id: string;
  kind: StepKind;
  /** Which mechanic a 'simulate' step runs. Ignored for the other two kinds. */
  mechanic?: Mechanic;
  label: Localized;
  xp: number;
  narrative: Localized;
  sim?: SimSpec;
  order?: OrderSpec;
  decide?: DecideSpec;
  trace?: TraceSpec;
  inquire?: InquireSpec;
  explain?: ExplainSpec;
}

/**
 * How the material is framed.
 *  - 'scenario': applied material the learner can be dropped into (a bedside, a
 *    counter, an incident). Default, and where the engine is strongest.
 *  - 'explain': definitional or vocabulary material where forcing a scenario
 *    would feel contrived. Leads with a short explanation and an analogy, then
 *    asks the learner to find a real example of their own.
 */
export type JourneyMode = 'scenario' | 'explain';

/**
 * The teaching part that comes BEFORE any scenario: what the thing is, in plain
 * sentences, then the key points, then a worked example for this learner.
 * Scenario-first without this is testing, not teaching.
 */
export interface Lesson {
  whatItIs: string;
  keyPoints: string[];
  example: string;
  whyItMatters: string;
}

export interface JourneyMedia {
  /** Prompt for a free, key-less diagram service. Empty string disables it. */
  imagePrompt: string;
  /** YouTube search terms for an optional two-minute explainer. */
  videoSearchQuery: string;
}

export interface Journey {
  id: string;
  createdAt: string;
  mode: JourneyMode;
  /**
   * Plain grounding, before any scenario: what this thing actually IS, in two
   * to four sentences. Dropping a learner straight into "sort these components"
   * without ever saying what a lithium battery is fails the person who came to
   * learn — the scenario tests judgement, the primer supplies the substance.
   */
  primer: Localized;
  /** A real-life comparison. The thing learners actually remember a week later. */
  analogy: Localized;
  media: JourneyMedia;
  /** Plain-sentence lesson shown before the scenario. */
  lesson?: Lesson;
  /**
   * Accurate short facts the model wrote about the topic. For a one-line topic
   * there is no document, so this is the knowledge base the role-play persona
   * answers from — without it the chat has nothing to say and refuses everything.
   */
  knowledge?: string[];
  /** 'topic' = the learner only named a subject; 'document' = real source text. */
  sourceKind?: 'topic' | 'document';
  /** Free-text constraint the learner typed under "Other". */
  constraintNote?: string;
  title: Localized;
  missionLabel: Localized;
  topic: string;
  sourceName: string;
  sourceRef: string;
  concepts: Concept[];
  conceptCount: number;
  learnerType: string;
  tone: Tone;
  difficulty: number;
  language: Language;
  constraint: OperatingConstraint;
  contextPanel: ContextPanel;
  steps: JourneyStep[];
  /** Provenance - surfaced in the UI and the admin report. */
  provider: string;
  model: string;
  latencyMs: number;
  grounded: boolean;
  groundingNotes: string[];
  degraded: boolean;
}

/* ------------------------------------------------------------------ mastery */

export type MasterySignalId =
  | 'explain_back_quality'
  | 'decisions_in_simulation'
  | 'working_without_hints'
  | 'self_correction'
  | 'confidence_matches_accuracy'
  | 'recall_after_break';

export interface MasterySignal {
  id: MasterySignalId;
  label: string;
  /** 0..1 observed quality. Meaningless when evidence === 0. */
  value: number;
  /** How many observations back this signal. Drives confidence, not just value. */
  evidence: number;
  weight: number;
  note: string;
}

export interface MasteryState {
  overall: number;
  confidence: number;
  signals: MasterySignal[];
  /** Human-readable justification - the "Why this number?" disclosure. */
  rationale: string[];
  hasEvidence: boolean;
}

/* ------------------------------------------------- gamification / adaptation */

export interface Badge {
  id: string;
  label: string;
  description: string;
  icon: string;
  /** Shown instead of a line icon. Falls back to a per-icon default. */
  emoji?: string;
}

export interface LearnerProgress {
  xp: number;
  level: number;
  xpIntoLevel: number;
  xpForLevel: number;
  badges: string[];
  streakDays: number;
}

export type AdaptationLevel = 'low' | 'medium' | 'high';

export interface AdaptationState {
  level: AdaptationLevel;
  difficulty: number;
  hintStyle: 'direct' | 'socratic' | 'minimal';
  pace: 'slower' | 'steady' | 'faster';
  summary: string;
  reasons: string[];
}

/* ----------------------------------------------------------------- events */

export type EventType =
  | 'journey_built'
  | 'step_started'
  | 'step_completed'
  | 'sim_run'
  | 'hint_used'
  | 'question_asked'
  | 'explain_submitted'
  | 'self_corrected'
  | 'confidence_stated'
  | 'badge_unlocked'
  | 'level_up'
  | 'voice_used'
  | 'language_switched'
  | 'ai_call';

export interface LearningEvent {
  id: string;
  sessionId: string;
  learnerId: string;
  journeyId: string;
  type: EventType;
  stepId?: string;
  payload: Record<string, unknown>;
  latencyMs?: number;
  createdAt: string;
}

/* ----------------------------------------------------------------- config */

export interface EngineConfig {
  xpPerStep: [number, number, number];
  xpPerLevel: number;
  hintPenaltyXp: number;
  masteryUnlockThreshold: number;
  masteryWeights: Record<MasterySignalId, number>;
  masteryPriorStrength: number;
  adaptationSensitivity: number;
  defaultLanguage: Language;
  defaultTone: Tone;
  defaultDifficulty: number;
  defaultLearnerType: string;
  providerOrder: string[];
  aiTimeoutMs: number;
  maxSourceChars: number;
  requireGrounding: boolean;
  /** Off drops mission/XP language from generated copy without losing the interaction. */
  gamificationEnabled: boolean;
  badges: Badge[];
  learnerTypes: string[];
  constraints: OperatingConstraint[];
}

export interface BuildJourneyInput {
  topic?: string;
  text?: string;
  sourceName?: string;
  learnerType: string;
  language: Language;
  constraint: OperatingConstraint;
  tone?: Tone;
  difficulty?: number;
  /** Free text used when the learner picks "Other" for the constraint. */
  constraintNote?: string;
}

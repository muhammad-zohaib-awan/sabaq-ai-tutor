import type { EngineConfig, Journey } from './types';
import { DEFAULT_CONFIG } from './config';

/**
 * The hand-authored cardiac mission used as the landing experience and as the
 * guaranteed offline demo. Everything here is also producible by the generator —
 * this copy exists so the first screen the panel sees never waits on a network.
 */
export function sampleJourney(cfg: EngineConfig = DEFAULT_CONFIG): Journey {
  return {
    id: 'sample_cardiac',
    createdAt: new Date().toISOString(),
    mode: 'scenario',
    analogy: {
      en: 'Think of the heart as a four-room house where every door only opens one way. A murmur is the sound of a door that was supposed to be shut, letting people back through.',
      ur: 'دل کو چار کمروں کا ایک گھر سمجھیں جہاں ہر دروازہ صرف ایک ہی طرف کھلتا ہے۔ مرمر اُس دروازے کی آواز ہے جسے بند ہونا چاہیے تھا مگر وہ لوگوں کو واپس آنے دے رہا ہے۔',
      mix: 'Dil ko chaar kamron ka ghar samjhein jahan har darwaza sirf ek taraf khulta hai. Murmur us darwaze ki awaaz hai jo band hona chahiye tha magar logon ko wapas aane de raha hai.',
    },
    media: {
      imagePrompt:
        'clean labelled medical diagram of the human heart, four chambers, mitral tricuspid aortic pulmonary valves labelled, arrows showing blood flow direction, flat vector, white background, no watermark',
      videoSearchQuery: 'cardiac cycle systole diastole heart sounds explained',
    },
    title: {
      en: 'The Heart Sound Mystery',
      ur: 'دل کی آواز کا معمہ',
      mix: 'Dil ki Awaaz ka Mamla',
    },
    missionLabel: {
      en: 'Mission 1 · Cardiology basics',
      ur: 'مشن ۱ · دل کے بنیادی اصول',
      mix: 'Mission 1 · Cardiology basics',
    },
    topic: 'The cardiac cycle and heart sounds',
    sourceName: 'Cardiac_Cycle_Notes.pdf',
    sourceRef: 'Cardiac_Cycle_Notes.pdf, p.3–4',
    conceptCount: 47,
    concepts: [
      {
        id: 'c_systole',
        label: 'Systole',
        summary:
          'Systole is the phase between the first heart sound (S1) and the second (S2), when the ventricles contract and push blood out to the lungs and the body.',
        sourceRef: 'Cardiac_Cycle_Notes.pdf, p.3–4',
      },
      {
        id: 'c_av_valves',
        label: 'Atrioventricular valves',
        summary:
          'The mitral and tricuspid valves sit between the atria and the ventricles. They shut at the start of systole, and that closure is the first heart sound, S1.',
        sourceRef: 'Cardiac_Cycle_Notes.pdf, p.3',
      },
      {
        id: 'c_semilunar',
        label: 'Semilunar valves',
        summary:
          'The aortic and pulmonary valves open during systole to let blood leave the ventricles, and snap shut at the end of systole, producing the second heart sound, S2.',
        sourceRef: 'Cardiac_Cycle_Notes.pdf, p.4',
      },
      {
        id: 'c_murmur',
        label: 'Systolic murmur',
        summary:
          'A whooshing sound heard between S1 and S2 means blood is moving turbulently during systole, most often because a valve that should be shut is leaking backwards.',
        sourceRef: 'Cardiac_Cycle_Notes.pdf, p.4',
      },
      {
        id: 'c_diastole',
        label: 'Diastole',
        summary:
          'Diastole is the filling phase between S2 and the next S1, when the atrioventricular valves are open and the ventricles refill.',
        sourceRef: 'Cardiac_Cycle_Notes.pdf, p.3',
      },
    ],
    learnerType: 'Nursing trainee',
    tone: 'coaching',
    difficulty: 3,
    language: 'en',
    constraint: 'standard',
    contextPanel: {
      title: 'Bed 4 · 58 y · breathless',
      subtitle: 'ECG lead II / heart sound (PCG)',
      metrics: [
        { label: 'Heart rate', value: '96', tone: 'good' },
        { label: 'Blood pressure', value: '104/66', tone: 'warn' },
        { label: 'SpO₂ %', value: '94', tone: 'warn' },
      ],
      waveform: 'ecg',
      caption: 'Whoosh between S1 and S2',
      audioCue: { label: 'Play heart sound', kind: 'heartbeat' },
    },
    steps: [
      {
        id: 'step_sim',
        kind: 'simulate',
        mechanic: 'sort',
        xp: cfg.xpPerStep[0],
        label: {
          en: 'Set the valves',
          ur: 'والوز ترتیب دیں',
          mix: 'Valves set karein',
        },
        narrative: {
          en: "You're examining a patient who is struggling to breathe. Through the stethoscope you hear a clear whoosh right after the first heart sound (S1) and before the second (S2). That window is systole, when the ventricles squeeze blood out to the body. Before you plan the next test, work out which doors inside the heart must be open or shut during that squeeze.",
          ur: 'آپ ایک ایسے مریض کا معائنہ کر رہے ہیں جسے سانس لینے میں دشواری ہے۔ اسٹیتھو سکوپ سے آپ کو پہلی آواز (S1) کے فوراً بعد اور دوسری آواز (S2) سے پہلے ایک واضح سرسراہٹ سنائی دیتی ہے۔ یہ وقت سسٹول کا ہے، جب ونٹریکلز خون کو جسم میں پمپ کرتے ہیں۔ اگلا ٹیسٹ منصوبہ بنانے سے پہلے طے کریں کہ اس سکڑنے کے دوران دل کے کون سے دروازے کھلے اور کون سے بند ہونے چاہئیں۔',
          mix: 'Aap ek aisay mareez ka muaina kar rahe hain jise saans lene mein dushwari hai. Stethoscope par pehli awaaz (S1) ke foran baad aur doosri awaaz (S2) se pehle ek wazeh whoosh sunai deta hai. Ye systole hai, jab ventricles khoon ko jism mein pump karte hain. Agla test plan karne se pehle ye tay karein ke is squeeze ke dauran dil ke kaun se darwaze khule aur kaun se band honay chahiyen.',
        },
        sim: {
          prompt: 'The heart is filling (diastole). Tap each valve to flip it to its systole position, then run the beat.',
          runLabel: 'Run the beat',
          visual: 'heart',
          elements: [
            {
              id: 'tricuspid',
              label: 'Tricuspid',
              states: ['open', 'closed'],
              correct: 1,
              hint: 'If this stayed open while the ventricle squeezed, blood would be pushed backwards into the atrium.',
              group: 'left',
            },
            {
              id: 'mitral',
              label: 'Mitral',
              states: ['open', 'closed'],
              correct: 1,
              hint: 'Its closure is what you hear as S1, right at the start of the squeeze.',
              group: 'right',
            },
            {
              id: 'pulmonary',
              label: 'Pulmonary',
              states: ['open', 'closed'],
              correct: 0,
              hint: 'Blood has to reach the lungs somehow during systole.',
              group: 'left',
            },
            {
              id: 'aortic',
              label: 'Aortic',
              states: ['open', 'closed'],
              correct: 0,
              hint: 'This is the only exit to the body. Shut it and nothing leaves.',
              group: 'right',
            },
          ],
          successMessage:
            'Both inlet valves shut, both outlet valves open — that is systole, and now the whoosh has nowhere legitimate to come from.',
          failureMessage:
            'Blood went the wrong way. Look at which door you left open while the ventricle was squeezing.',
          legend: [
            { label: 'Low-oxygen blood', color: '#3b82f6' },
            { label: 'Oxygen-rich blood', color: '#ef4444' },
            { label: 'Going the wrong way', color: '#f59e0b' },
          ],
        },
      },
      {
        id: 'step_inquire',
        kind: 'inquire',
        xp: cfg.xpPerStep[1],
        label: {
          en: 'Question the case',
          ur: 'کیس سے سوال کریں',
          mix: 'Case se sawal karein',
        },
        narrative: {
          en: 'You have the mechanics. Now find out what is actually going on with this patient — ask whatever you would ask at the bedside.',
          ur: 'آپ کو میکانزم معلوم ہو گیا۔ اب یہ جانیں کہ اس مریض کے ساتھ اصل میں کیا ہو رہا ہے — وہی پوچھیں جو آپ بیڈ سائڈ پر پوچھتے۔',
          mix: 'Mechanism samajh aa gaya. Ab ye pata karein ke is mareez ke saath asal mein ho kya raha hai — wohi poochein jo aap bedside par poochte.',
        },
        inquire: {
          persona: 'the patient in bed 4, tired and a little short of breath',
          openingLine:
            "It gets worse when I lie flat, doctor. I have to sleep on two pillows now. Ask me whatever you need — but please be quick, I'm tired.",
          suggestedQuestions: [
            'When did the breathlessness start, and has it got worse?',
            'Does it change when you lie down or walk up stairs?',
            'Have you ever been told you have a heart murmur?',
            'Any swelling in your ankles by the end of the day?',
          ],
          mustSurfaceFacts: [
            {
              id: 'f_orthopnoea',
              fact: 'The breathlessness is worse lying flat, which points at fluid backing up behind the left side of the heart.',
              keywords: ['flat', 'lie', 'pillow', 'night', 'lying'],
            },
            {
              id: 'f_timing',
              fact: 'The murmur falls between S1 and S2, which makes it systolic.',
              keywords: ['systole', 'systolic', 'between', 's1', 's2', 'timing'],
            },
            {
              id: 'f_leak',
              fact: 'A valve that should be shut during systole leaking backwards produces exactly this sound.',
              keywords: ['leak', 'regurgitation', 'backwards', 'back', 'mitral'],
            },
          ],
        },
      },
      {
        id: 'step_explain',
        kind: 'explain',
        xp: cfg.xpPerStep[2],
        label: {
          en: 'Explain it back',
          ur: 'اپنے الفاظ میں سمجھائیں',
          mix: 'Apnay alfaz mein samjhayen',
        },
        narrative: {
          en: 'Last beat. A first-year student is standing next to you and has no idea what just happened. Explain it to them in your own words — out loud is fine.',
          ur: 'آخری مرحلہ۔ ایک فرسٹ ایئر طالبِ علم آپ کے ساتھ کھڑا ہے اور اسے کچھ سمجھ نہیں آیا۔ اسے اپنے الفاظ میں سمجھائیں — بول کر بھی سمجھا سکتے ہیں۔',
          mix: 'Aakhri step. Ek first-year student aap ke saath khara hai aur usay kuch samajh nahi aaya. Usay apnay alfaz mein samjhayen — bol kar bhi keh sakte hain.',
        },
        explain: {
          prompt:
            'Explain to a first-year student why a whooshing murmur heard between S1 and S2 means a valve is leaking, and which valve you would suspect in this patient.',
          rubric: [
            {
              id: 'r_timing',
              label: 'Places the murmur in systole, between S1 and S2',
              keywords: ['systole', 'systolic', 's1', 's2', 'between', 'squeeze', 'contract'],
              weight: 0.3,
            },
            {
              id: 'r_valves',
              label: 'States that the AV valves are shut and the outlet valves are open in systole',
              keywords: ['mitral', 'tricuspid', 'closed', 'shut', 'aortic', 'pulmonary', 'open'],
              weight: 0.3,
            },
            {
              id: 'r_mechanism',
              label: 'Links turbulent backward flow through a valve that should be shut to the sound',
              keywords: ['leak', 'backwards', 'regurgitation', 'turbulent', 'back', 'flow'],
              weight: 0.25,
            },
            {
              id: 'r_suspect',
              label: 'Names a plausible culprit valve and says why',
              keywords: ['mitral', 'regurgitation', 'left', 'lungs', 'flat', 'breathless'],
              weight: 0.15,
            },
          ],
          modelAnswer:
            'Between S1 and S2 the ventricles are squeezing, so the mitral and tricuspid valves should be shut tight and the aortic and pulmonary valves open. If you hear a whoosh in that window, blood is moving somewhere it should not — the commonest reason is that one of the shut valves is leaking backwards into the atrium. In a patient who is breathless lying flat, mitral regurgitation is the one to suspect, because the leak pushes pressure back into the lungs.',
        },
      },
    ],
    provider: 'authored',
    model: 'sample-cardiac-v1',
    latencyMs: 0,
    grounded: true,
    groundingNotes: ['Authored sample mission, fully source-consistent.'],
    degraded: false,
  };
}

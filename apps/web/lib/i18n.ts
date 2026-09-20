export type Lang = 'en' | 'ur' | 'mix';

type Dict = Record<string, [string, string, string]>;

/** [en, ur, mix] — mix is Roman Urdu code-switched with English, as spoken. */
const T: Dict = {
  learn: ['Learn', 'سیکھیں', 'Learn'],
  configure: ['Configure', 'ترتیبات', 'Configure'],
  insights: ['Insights', 'رپورٹس', 'Insights'],
  liveTest: ['Live test', 'لائیو ٹیسٹ', 'Live test'],
  viewingAs: ['Viewing as', 'بطور', 'Viewing as'],
  admin: ['Admin', 'ایڈمن', 'Admin'],
  learner: ['Learner', 'سیکھنے والا', 'Learner'],
  manager: ['Manager', 'مینیجر', 'Manager'],
  changeContent: ['Change content', 'مواد بدلیں', 'Content badlein'],
  conceptsExtracted: ['concepts extracted', 'تصورات نکالے گئے', 'concepts extracted'],
  learnerLabel: ['Learner', 'سیکھنے والا', 'Learner'],
  tone: ['Tone', 'انداز', 'Tone'],
  difficulty: ['Difficulty', 'مشکل', 'Difficulty'],
  constraint: ['Constraint', 'پابندی', 'Constraint'],
  listen: ['Listen', 'سنیں', 'Suniye'],
  stop: ['Stop', 'روکیں', 'Rokein'],
  source: ['Source', 'ماخذ', 'Source'],
  inferredMastery: ['Inferred mastery', 'اندازہ شدہ مہارت', 'Inferred mastery'],
  noEvidence: ['No evidence yet', 'ابھی کوئی ثبوت نہیں', 'No evidence yet'],
  builtFrom: [
    'Built from what you do, not from a test.',
    'یہ آپ کے عمل سے بنا ہے، کسی ٹیسٹ سے نہیں۔',
    'Ye aap ke amal se bana hai, kisi test se nahi.',
  ],
  whyThisNumber: ['Why this number?', 'یہ نمبر کیوں؟', 'Ye number kyun?'],
  adaptation: ['Adaptation', 'موافقت', 'Adaptation'],
  level: ['Level', 'لیول', 'Level'],
  trainee: ['Trainee', 'زیرِ تربیت', 'Trainee'],
  hint: ['Hint', 'اشارہ', 'Ishara'],
  runBeat: ['Run the beat', 'دھڑکن چلائیں', 'Dhadkan chalayen'],
  playSound: ['Play heart sound', 'دل کی آواز چلائیں', 'Dil ki awaaz chalayen'],
  askPlaceholder: [
    'Ask the case anything…',
    'کیس سے کچھ بھی پوچھیں…',
    'Case se kuch bhi poochein…',
  ],
  explainPlaceholder: [
    'Explain it in your own words…',
    'اپنے الفاظ میں سمجھائیں…',
    'Apnay alfaz mein samjhayen…',
  ],
  send: ['Send', 'بھیجیں', 'Bhejein'],
  submit: ['Submit', 'جمع کریں', 'Submit karein'],
  speak: ['Speak', 'بولیں', 'Bolein'],
  listening: ['Listening…', 'سن رہے ہیں…', 'Sun rahe hain…'],
  nextStep: ['Next step', 'اگلا مرحلہ', 'Agla step'],
  missionComplete: ['Mission complete', 'مشن مکمل', 'Mission mukammal'],
  iWasWrong: ['I spotted my own mistake', 'میں نے اپنی غلطی پکڑی', 'Apni ghalti pakri'],
  suggested: ['Try asking', 'یہ پوچھ کر دیکھیں', 'Ye pooch kar dekhein'],
  degraded: [
    'Running on the local engine — the API is unreachable right now.',
    'مقامی انجن پر چل رہا ہے — API ابھی دستیاب نہیں۔',
    'Local engine par chal raha hai — API abhi available nahi.',
  ],
  badgeUnlocked: ['Badge unlocked', 'بیج کھل گیا', 'Badge unlock hua'],
  levelUp: ['Level up', 'لیول بڑھ گیا', 'Level up'],
  continue: ['Continue', 'جاری رکھیں', 'Jari rakhein'],
  streak: ['day streak', 'دن مسلسل', 'day streak'],
  nextMission: [
    'Next mission opens at',
    'اگلا مشن کھلے گا',
    'Agla mission khulega',
  ],
  mastery: ['mastery', 'مہارت', 'mastery'],
};

export function t(key: keyof typeof T | string, lang: Lang): string {
  const row = T[key as keyof typeof T];
  if (!row) return String(key);
  return lang === 'ur' ? row[1] : lang === 'mix' ? row[2] : row[0];
}

export const pick = (l: { en: string; ur: string; mix: string } | undefined, lang: Lang): string =>
  !l ? '' : lang === 'ur' ? l.ur : lang === 'mix' ? l.mix : l.en;

export const isRtl = (lang: Lang) => lang === 'ur';

export const langName = (lang: Lang) =>
  lang === 'ur' ? 'اردو' : lang === 'mix' ? 'Urdu + English' : 'English';

/** BCP-47 tag for speech synthesis / recognition. */
export const speechLocale = (lang: Lang) => (lang === 'ur' ? 'ur-PK' : lang === 'mix' ? 'ur-PK' : 'en-US');

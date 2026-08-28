import { demoComponentIds } from './forge-data';

export const DEFAULT_DESIGN_PROMPT = 'Build a machine that sorts red and blue boxes into separate bins at 20+ boxes per minute using no more than 7 components.';

export const SORTER_LIMITS = {
  minThroughputBpm: 5,
  maxThroughputBpm: 40,
  minAccuracyPct: 50,
  maxAccuracyPct: 100,
  minComponents: 7,
  maxComponents: 12,
} as const;

export interface CompiledSorterPlan {
  brief: string;
  goal: {
    throughputBpm: number;
    minAccuracyPct: number;
    maxComponents: number;
    colors: ['red', 'blue'];
  };
  componentIds: readonly string[];
  motorSpeed: number;
  initialDelayMs: number;
  actuatorHoldMs: number;
  assumptions: string[];
}

const NUMBER_WORDS: Record<string, number> = {
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const numberToken = '(?:\\d+(?:\\.\\d+)?|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const unsupportedColors = ['green', 'yellow', 'orange', 'purple', 'white', 'black', 'pink', 'brown', 'gray', 'grey', 'teal', 'cyan', 'magenta', 'violet', 'indigo', 'gold', 'silver', 'beige', 'maroon', 'navy', 'lime', 'aqua', 'turquoise', 'crimson', 'amber'];

function normalizeBrief(raw: string) {
  return raw.normalize('NFKC').replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim();
}

function parseNumber(value: string) {
  return NUMBER_WORDS[value.toLowerCase()] ?? Number(value);
}

function unique(values: number[]) {
  return [...new Set(values.map((value) => Number(value.toFixed(2))))];
}

function collectNumbers(text: string, patterns: RegExp[]) {
  const values: number[] = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) values.push(parseNumber(match[1]));
  }
  return unique(values.filter(Number.isFinite));
}

function oneValue(values: number[], label: string) {
  if (values.length > 1) throw new Error(`AMBIGUOUS_GOAL: I found conflicting ${label} values (${values.join(' and ')}). Keep one measurable target.`);
  return values[0];
}

function assertRange(value: number, label: string, min: number, max: number, unit: string) {
  if (value < min || value > max) throw new Error(`OUT_OF_RANGE: ${label} must be between ${min} and ${max}${unit} in this validated sorting cell.`);
}

export function compileDesignBrief(raw: string): CompiledSorterPlan {
  const brief = normalizeBrief(raw);
  const text = brief.toLowerCase();
  if (brief.length < 12) throw new Error('VAGUE_GOAL: Describe what to sort and include at least one measurable constraint.');
  if (brief.length > 500) throw new Error('OUT_OF_RANGE: Keep the engineering brief under 500 characters.');

  const hasSortIntent = /\b(sort|sorts|sorter|sorting|separate|separates|separating|route|routes|routing|classify|classifies|divert|diverts)\b/.test(text);
  const hasSupportedObject = /\b(box|boxes|package|packages|parcel|parcels|item|items|product|products)\b/.test(text);
  if (!hasSortIntent || !hasSupportedObject) throw new Error('UNSUPPORTED_GOAL: This lab currently engineers conveyor-based package sorters. Try “Sort red and blue boxes at 20 boxes/min using at most 7 components.”');
  if (/\b(?:do\s+not|don['’]?t|dont|never|not)\s+(?:\w+\s+){0,3}(?:sort|separate|route|classify|divert)\b/.test(text)) {
    throw new Error('NEGATED_GOAL: The brief says not to perform the sorting task, so ForgeTwin will not build the opposite of your request.');
  }

  const negatedColor = text.match(/\b(?:without|exclude|excluding|omit|omitting)\s+(?:sorting\s+)?(?:any\s+|all\s+|the\s+)?(red|blue)\b|\bnot\s+(?:any\s+|the\s+)?(red|blue)\b/);
  const excludedColor = negatedColor?.[1] ?? negatedColor?.[2];
  if (excludedColor) throw new Error(`UNSUPPORTED_COLOR: The validated fixture requires both red and blue routes; “${excludedColor}” was explicitly excluded.`);
  const namedUnsupported = unsupportedColors.filter((color) => new RegExp(`\\b${color}\\b`).test(text));
  if (namedUnsupported.length) throw new Error(`UNSUPPORTED_COLOR: I understood ${namedUnsupported.join(' and ')}, but this validated fixture currently supports red and blue routes only.`);
  const hasRed = /\bred\b/.test(text);
  const hasBlue = /\bblue\b/.test(text);
  if (hasRed !== hasBlue) throw new Error(`MISSING_SECOND_COLOR: Add the ${hasRed ? 'blue' : 'red'} route so the two-lane sorter has a complete goal.`);

  if (new RegExp(`\\b(?:at least|minimum(?: of)?|min(?:imum)?(?: of)?|(?<!no )more than|greater than|over)\\s+${numberToken}\\s+(?:components?|parts?)\\b`).test(text)
    || new RegExp(`\\b${numberToken}\\s*\\+\\s*(?:components?|parts?)\\b`).test(text)
    || new RegExp(`\\b${numberToken}\\s+(?:components?|parts?)\\s*(?:minimum|min(?:imum)?|or more)\\b`).test(text)) {
    throw new Error('UNSUPPORTED_COMPARATOR: Component count must be a maximum budget, such as “at most 7 components.”');
  }
  if (new RegExp(`\\b(?:less than|fewer than|under|below)\\s+${numberToken}\\s+(?:components?|parts?)\\b`).test(text)) {
    throw new Error('UNSUPPORTED_COMPARATOR: Use an inclusive component budget such as “at most 7 components” so the design limit is exact.');
  }
  const upperComparator = '(?:at most|no more than|maximum(?: of)?|max(?:imum)?(?: of)?|less than|fewer than|under|below|up to)';
  const throughputUnit = '(?:boxes?|packages?|parcels?|items?)?\\s*(?:per\\s+minute|\\/\\s*min(?:ute)?|bpm)';
  if (new RegExp(`\\b${upperComparator}\\s+${numberToken}\\s*${throughputUnit}\\b`).test(text)
    || new RegExp(`\\bthroughput(?:\\s+(?:of|at|target(?:\\s+of)?))?\\s+${upperComparator}\\s+${numberToken}\\b`).test(text)
    || new RegExp(`\\b${numberToken}\\s*${throughputUnit}\\s*(?:maximum|max|or less)\\b`).test(text)) {
    throw new Error('UNSUPPORTED_COMPARATOR: Throughput must be a minimum target, such as “at least 20 boxes per minute.”');
  }
  if (/\d+(?:\.\d+)?\s*(?:-|to)\s*\d+(?:\.\d+)?\s*(?:boxes?|packages?|parcels?|items?)?\s*(?:per\s+minute|\/\s*min(?:ute)?|bpm)\b/.test(text)) {
    throw new Error('AMBIGUOUS_GOAL: Use one minimum throughput target instead of a range.');
  }
  if (/\b(?:as fast as possible|maximum throughput|maximize throughput)\b/.test(text)) {
    throw new Error('VAGUE_GOAL: Replace “as fast as possible” with a numeric boxes-per-minute target.');
  }
  if (new RegExp(`\\b${upperComparator}\\s+${numberToken}\\s*(?:%|percent)\\s*(?:sorting\\s*)?(?:accuracy|accurate)\\b`).test(text)
    || new RegExp(`\\b(?:accuracy|accurate(?:ly)?)\\s*(?:of|at|target(?:\\s+of)?)?\\s*${upperComparator}\\s+${numberToken}\\s*(?:%|percent)(?!\\w)`).test(text)
    || new RegExp(`\\b${numberToken}\\s*(?:%|percent)\\s*(?:sorting\\s*)?(?:accuracy|accurate)?\\s*(?:maximum|max|or less)\\b`).test(text)) {
    throw new Error('UNSUPPORTED_COMPARATOR: Accuracy must be a minimum target, such as “at least 95% accuracy.”');
  }
  if (/\d+(?:\.\d+)?\s*(?:-|to)\s*\d+(?:\.\d+)?\s*(?:%|percent)(?!\w)/.test(text)) {
    throw new Error('AMBIGUOUS_GOAL: Use one minimum accuracy target instead of a range.');
  }

  const throughputValues = collectNumbers(text, [
    /(\d+(?:\.\d+)?)\s*\+?\s*(?:boxes?|packages?|parcels?|items?)\s*(?:per\s+minute|\/\s*min(?:ute)?|\/min)\b/g,
    /(\d+(?:\.\d+)?)\s*\+?\s*bpm\b/g,
    /\bthroughput(?:\s+(?:of|at|target(?:\s+of)?))?\s+(\d+(?:\.\d+)?)\b/g,
  ]);
  const accuracyValues = collectNumbers(text, [
    /(\d+(?:\.\d+)?)\s*(?:%|percent)\s*(?:sorting\s*)?(?:accuracy|accurate)\b/g,
    /\b(?:accuracy|accurate(?:ly)?)\s*(?:of|at|>=|at least|minimum(?: of)?|min(?:imum)?(?: of)?)?\s*(\d+(?:\.\d+)?)\s*(?:%|percent)(?!\w)/g,
  ]);
  const componentValues = collectNumbers(text, [
    new RegExp(`\\b(?:no more than|at most|max(?:imum)?(?: of)?|limit(?:ed)? to|within|using(?: no more than)?)\\s+(${numberToken})\\s+(?:components?|parts?)\\b`, 'g'),
    new RegExp(`\\b(${numberToken})[- ]component\\s+limit\\b`, 'g'),
    new RegExp(`\\b(${numberToken})\\s+(?:components?|parts?)\\s*(?:max(?:imum)?|limit)\\b`, 'g'),
  ]);

  const assumptions: string[] = [];
  const throughputBpm = oneValue(throughputValues, 'throughput') ?? 20;
  const minAccuracyPct = oneValue(accuracyValues, 'accuracy') ?? 95;
  const maxComponents = oneValue(componentValues, 'component-budget') ?? 7;
  if (!throughputValues.length) assumptions.push('20 boxes/min minimum');
  if (!accuracyValues.length) assumptions.push('95% minimum accuracy');
  if (!componentValues.length) assumptions.push('7-component maximum');
  if (!hasRed && !hasBlue) assumptions.push('red + blue routes');

  assertRange(throughputBpm, 'Throughput', SORTER_LIMITS.minThroughputBpm, SORTER_LIMITS.maxThroughputBpm, ' boxes/min');
  assertRange(minAccuracyPct, 'Accuracy', SORTER_LIMITS.minAccuracyPct, SORTER_LIMITS.maxAccuracyPct, '%');
  assertRange(maxComponents, 'Component budget', 3, SORTER_LIMITS.maxComponents, ' components');
  if (!Number.isInteger(maxComponents)) throw new Error('INVALID_GOAL: Component budget must be a whole number.');
  if (maxComponents < SORTER_LIMITS.minComponents) throw new Error(`INFEASIBLE_GOAL: The verified two-lane sorter needs ${SORTER_LIMITS.minComponents} components: a conveyor, sensor, diverter, two ramps, and two bins.`);

  const motorSpeed = Number(Math.min(2.25, Math.max(1.8, 2 + (throughputBpm - 20) * 0.0125)).toFixed(2));
  const initialDelayMs = Math.round((2 / motorSpeed) * 1000 + 40);

  return {
    brief,
    goal: { throughputBpm, minAccuracyPct, maxComponents, colors: ['red', 'blue'] },
    componentIds: demoComponentIds,
    motorSpeed,
    initialDelayMs,
    actuatorHoldMs: 520,
    assumptions,
  };
}

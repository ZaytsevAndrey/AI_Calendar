/**
 * Reference-resolution keys for the entity experiment.
 * These keys are not benchmark gold. Gold files are not imported for writing.
 * A stem only aligns a mention to a key. It does not decide the entity link.
 */

export type SampleSource = 'voice-regression' | 'fold-experiment';

export type MentionLink = 'group' | 'none' | 'ambiguous';

export type MentionExpect = {
  /** Stems that identify this mention. Alignment only. */
  stems: string[];
  role: 'head' | 'dependent';
  link: MentionLink;
  /** Object group. Same group must share one entity. Different groups must not. */
  group: string;
};

export type SampleExpect = {
  id: string;
  source: SampleSource;
  category: string;
  /** Locked to the existing fixture. A mismatch fails the static check. */
  utterance: string;
  decision: 'steps' | 'final';
  mentions: MentionExpect[];
  /** Titles that must not replace a mention whose entity is null. */
  closedTitles: string[];
};

export const ENTITY_SAMPLE: SampleExpect[] = [
  {
    id: 'dep-create-then-time',
    source: 'voice-regression',
    category: 'create-then-move',
    utterance: 'Купи молоко і перенеси його на завтра на десяту',
    decision: 'steps',
    mentions: [
      { stems: ['молок'], role: 'head', link: 'group', group: 'milk' },
      { stems: ['його'], role: 'dependent', link: 'group', group: 'milk' },
    ],
    closedTitles: ['звіт', 'нарад'],
  },
  {
    id: 'dep-several-changes',
    source: 'voice-regression',
    category: 'create-then-several',
    utterance: 'Купи молоко на сьогодні, перенеси його на завтра і зроби його на годину',
    decision: 'steps',
    mentions: [
      { stems: ['молок'], role: 'head', link: 'group', group: 'milk' },
      { stems: ['його'], role: 'dependent', link: 'group', group: 'milk' },
      { stems: ['його'], role: 'dependent', link: 'group', group: 'milk' },
    ],
    closedTitles: ['звіт', 'нарад'],
  },
  {
    id: 'dep-create-cancel',
    source: 'voice-regression',
    category: 'create-then-cancel',
    utterance: 'Купи молоко, ні, скасуй',
    decision: 'final',
    mentions: [],
    closedTitles: ['звіт', 'нарад'],
  },
  {
    id: 'dep-independent',
    source: 'voice-regression',
    category: 'independent',
    utterance: 'Купи молоко і перенеси звіт на завтра',
    decision: 'steps',
    mentions: [
      { stems: ['молок'], role: 'head', link: 'group', group: 'milk' },
      { stems: ['звіт'], role: 'head', link: 'group', group: 'report' },
    ],
    closedTitles: ['нарад'],
  },
  {
    id: 'dep-same-name',
    source: 'voice-regression',
    category: 'same-title',
    utterance: 'Створи нову Звіт і видали стару Звіт',
    decision: 'steps',
    mentions: [
      { stems: ['нов'], role: 'head', link: 'group', group: 'new-report' },
      { stems: ['стар'], role: 'head', link: 'group', group: 'old-report' },
    ],
    closedTitles: ['нарад'],
  },
  {
    id: 'dep-pronoun-two-antecedents',
    source: 'voice-regression',
    category: 'several-antecedents',
    utterance: 'Купи молоко і перенеси звіт на завтра, а його зроби на годину',
    decision: 'steps',
    mentions: [
      { stems: ['молок'], role: 'head', link: 'group', group: 'milk' },
      { stems: ['звіт'], role: 'head', link: 'group', group: 'report' },
      { stems: ['його'], role: 'dependent', link: 'ambiguous', group: 'hour' },
    ],
    closedTitles: ['нарад', 'gym', 'подат'],
  },
  {
    id: 'pronoun-bare',
    source: 'fold-experiment',
    category: 'no-antecedent',
    utterance: 'Перенеси це на вечір',
    decision: 'steps',
    mentions: [
      { stems: ['це'], role: 'dependent', link: 'none', group: 'pointer' },
    ],
    closedTitles: ['звіт', 'нарад'],
  },
  {
    id: 'plan-not-a-list',
    source: 'voice-regression',
    category: 'one-action-several-objects',
    utterance: 'Додай молоко і хліб на сьогодні',
    decision: 'steps',
    mentions: [
      { stems: ['молок'], role: 'head', link: 'group', group: 'milk' },
      { stems: ['хліб'], role: 'head', link: 'group', group: 'bread' },
    ],
    closedTitles: [],
  },
  {
    id: 'dep-existing-two-fields',
    source: 'voice-regression',
    category: 'existing-two-changes',
    utterance: 'Перенеси звіт на завтра і зроби його на годину',
    decision: 'steps',
    mentions: [
      { stems: ['звіт'], role: 'head', link: 'group', group: 'report' },
      { stems: ['його'], role: 'dependent', link: 'group', group: 'report' },
    ],
    closedTitles: ['нарад', 'молок'],
  },
];

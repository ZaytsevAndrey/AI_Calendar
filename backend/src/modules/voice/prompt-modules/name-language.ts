import { languageInstruction } from '../voice-parse.shared.prompt';

export function createNameLanguageModule(language?: string | null): string {
  return `${languageInstruction(language)}
Name: one task. Short title in the transcript language. Do not translate.
Strip create-boilerplate, politeness, the day, and the clock yourself (any language). Spoken hours, ordinals, softeners, and lengths are not part of the title. Do not keep the raw sentence, and do not add facts they did not say.
Example shape: "need to go to the shop" → a short errand title. Two errands in one breath → one title that covers both.
Create with no errand ("create a task", "I need a task", etc. in any language) → needs_clarification, empty name, ask what to call it in the transcript language. Do not invent a title from the create verb.
A clarification answer is only the title. Do not repeat the previous create sentence in the title.
description null unless a detail is not already in the title.
priority medium unless they named urgency (any language).
Clarify only for a missing name, a missing length on a clearly long task, or a span that might be either the event length or the placement window. Not for a missing day.`;
}

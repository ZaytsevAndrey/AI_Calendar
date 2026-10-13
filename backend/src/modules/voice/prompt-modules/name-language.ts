import { languageInstruction } from '../voice-parse.shared.prompt';

export function createNameLanguageModule(language?: string | null): string {
  return `${languageInstruction(language)}
Name: one task. Short title in the transcript language. Do not translate.
Drop "створи задачу", "треба", "потрібно", "не забудь", the day, and the clock. Do not keep the raw sentence, and do not add facts they did not say.
"треба поїхати в магаз" → "Поїздка в магазин". Two errands in one breath → one title that covers both.
"треба задачу створити", "хочу створити задачу", "create a task" name no errand → needs_clarification, ask what to call it. Do not use that sentence as the title.
A clarification answer is only the title. "Назви її молоко" → "Молоко". "Назви її задачу" → "Задача". Do not repeat the previous sentence in the title.
description null unless a detail is not already in the title.
priority medium unless they said терміново / urgent / не горить / low priority.
Clarify only for a missing name, a missing length on a clearly long task, or a span that might be either the event length or the placement window. Not for a missing day.`;
}

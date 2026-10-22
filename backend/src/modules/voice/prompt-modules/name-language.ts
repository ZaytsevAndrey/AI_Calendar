import { languageInstruction } from '../voice-parse.shared.prompt';

export function createNameLanguageModule(language?: string | null): string {
  return `${languageInstruction(language)}
Name: one task. The title is the errand itself, as a calendar heading in the transcript language. Do not translate.

The spoken sentence is a request. The title is not that request. Drop the frame: obligation, desire, politeness, the verb that only asks to create or schedule, the day, the clock, softeners, and the length. A length is the duration. It is never a reason the name is missing.

A verb whose only job is to take the listener to a place or a person is frame. The heading is that place or person, in the citation form a label uses, or a short noun phrase for the visit. Not the grammatical case the sentence required.

A verb that says what is done to a thing stays in the heading together with that thing. Do not reduce the errand to the bare thing. Write both in citation form.

A verb that is the activity itself, with no separate object, is the title. Write that activity as a heading. Do not ask for a name because the activity was a verb.

Do not keep the inflected fragment. Do not keep the raw sentence. Do not add a place, person, or purpose they did not name.

Two objects of one errand stay one heading that covers both. Two different errands are not one title.

When the frame is gone and neither an object nor an activity remains, the name is missing. needs_clarification, empty name, ask what to call it in the transcript language. Do not invent a title from the create verb.
A clarification answer is only the title, still a heading in citation form. Do not repeat the previous request in the title.
description null unless a detail is not already in the title.
priority medium unless they named urgency (any language).
Clarify only for a missing name, a missing length on a clearly long task, or a span that might be either the event length or the placement window. Not for a missing day.`;
}

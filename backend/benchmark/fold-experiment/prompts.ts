/**
 * Isolated fold experiment. B0 is the current Planner B, unmodified.
 * B1 and B2 are derived copies. They do not write the production prompt or B.
 *
 * B1 hypothesis: the model writes a segment while it is still reading verbs
 * left to right. Putting object identity and the final parameter values
 * before any segment rule is enough, with the same JSON.
 *
 * B2 hypothesis: the model can settle an object in a field even when the
 * segment text stays a copy of the utterance. Operations are an experiment
 * prototype. Production JSON is not changed.
 */
import { buildPlannerPromptB } from '../../.tmp/planner-ab.prompt';

const OPENING_B =
  'Settle one final operation for each settled object, then return one segment for that operation. Do not add fields. A task created in this utterance and a task that already existed are both that kind of object once the reference is settled. Later changes to the object stay that one operation, and the last value of each parameter wins. A missing repeated name is not a separate operation. An update of the create this utterance is making stays that create. A delete that unambiguously targets that same create removes it, and no operation remains. A delete of a task that already existed stays its own operation. A delete that does not settle one target leaves the create in place. Independent objects are not merged and are not dropped. An unambiguous withdrawal removes that operation. It is not a delete or an update of an object they did not pick. A task that is not an event and has no day and no clock is one create. A place does not decide which.';

const OPENING_B1 =
  'Decide in this order, and do not write a segment before the last step. First name each object this utterance creates or points at. Then attach each later change to the one object it refers to. Then keep only the last value of each parameter; a superseded value is not kept. Then return one segment for each object that remains. Do not add fields. A task created in this utterance and a task that already existed are both that kind of object once the reference is settled. A later move, clock, or length that settles on the create this utterance is making stays that create. A missing repeated name is not a separate operation. An update of the create this utterance is making stays that create. A delete that unambiguously targets that same create removes it, and no operation remains. A delete of a task that already existed stays its own operation. A delete that does not settle one target leaves the create in place. Independent objects are not merged and are not dropped. An unambiguous withdrawal removes that operation. It is not a delete or an update of an object they did not pick. A task that is not an event and has no day and no clock is one create. A place does not decide which.';

const SEGMENT_B =
  'A segment states one final operation and could be said on its own.';

const SEGMENT_B1 =
  'A segment is written only after that order. It states one final operation and could be said on its own.';

const B2_BLOCK = `

Experiment operations. This block applies only to this call. Do not add a reasoning field.
Put each settled object in "operations" before the segment text.
Each operation has "id", "object", "action" ("create", "update", or "delete"), "dependsOn" (null, or the id of the create in this utterance it revises), and "final" with only the last day, clock, and duration. A superseded value is absent. A later change that settles on the create in this list stays that one operation. Independent objects are separate operations. An unsettled reference keeps the words they used and does not take an open title.
Then form "segments" only from those operations, one text per remaining operation, using the final fields. A withdrawn operation is removed. When nothing remains, return type "final", outcome "answer", operations [], segments [].
{"type":"steps","answer":"","operations":[{"id":"1","object":"","action":"create","dependsOn":null,"final":{"day":"","clock":"","duration":""}}],"segments":[{"text":""}]}`;

function replaceOnce(prompt: string, from: string, to: string, label: string): string {
  const at = prompt.indexOf(from);
  if (at < 0) throw new Error(`Fold prompt anchor missing: ${label}`);
  if (prompt.indexOf(from, at + from.length) >= 0) throw new Error(`Fold prompt anchor repeated: ${label}`);
  return prompt.slice(0, at) + to + prompt.slice(at + from.length);
}

export type FoldArm = 'B0' | 'B1' | 'B2';

export function buildFoldPrompt(arm: FoldArm): string {
  const current = buildPlannerPromptB();
  if (arm === 'B0') return current;
  const ordered = replaceOnce(replaceOnce(current, OPENING_B, OPENING_B1, 'opening'), SEGMENT_B, SEGMENT_B1, 'segment');
  if (arm === 'B1') return ordered;
  return `${current}\n${B2_BLOCK}`;
}

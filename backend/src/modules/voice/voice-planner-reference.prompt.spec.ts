import { QUESTION_PROPOSAL_MODULE } from './prompt-modules/question-proposal';
import { buildPlannerSystemPrompt } from './voice-agent.planner.prompt';

describe('planner reference resolution', () => {
  const prompt = buildPlannerSystemPrompt('uk');

  it('settles final operations and then writes one segment each', () => {
    expect(prompt).toMatch(/First settle the final independent operations/);
    expect(prompt).toMatch(/one self-contained segment for each/);
    expect(prompt).toMatch(/Several verbs can describe one operation/);
    expect(prompt).toMatch(/Independent operations are not merged and are not dropped/);
    expect(prompt).not.toMatch(/Each segment keeps its own verb/);
    expect(prompt).not.toMatch(/keeps only that verb/);
    expect(prompt).not.toMatch(/Every write \(create/);
  });

  it('merges a revision and removes a withdrawn create', () => {
    expect(prompt).toMatch(/revises the one create this utterance is making stays that create/);
    expect(prompt).toMatch(/unambiguous withdrawal removes that create/);
    expect(prompt).toMatch(/not a delete or an update of an open task they did not pick/);
    expect(prompt).toMatch(/that operation stays its own segment/);
    expect(prompt).not.toMatch(/do not emit the unfinished operation/);
  });

  it('keeps remaining operations when only one create is withdrawn', () => {
    expect(prompt).toMatch(/return final, outcome answer/);
    expect(prompt).toMatch(/Do not return steps with an empty segment list for that withdrawal/);
    expect(prompt).toMatch(/When other independent operations remain, return steps/);
    expect(prompt).toMatch(/Do not use final to drop them/);
  });

  it('does not treat the number of open tasks as the target set', () => {
    expect(prompt).toMatch(/how many are open is not a set of targets/);
    expect(prompt).toMatch(/list of every open task is not that history/);
    expect(prompt).toMatch(/No position in the history wins by itself/);
    expect(prompt).toMatch(/Do not ask only because the chat has not mentioned it/);
    expect(prompt).toMatch(/pass the command on/);
    expect(prompt).toMatch(/Do not invent an id/);
    expect(prompt).not.toMatch(/If that history does not settle one entity, ask/);
  });

  it('treats an empty day agenda as an empty schedule, not a missing task', () => {
    expect(prompt).toMatch(/empty get_day_agenda means that day has no scheduled entries/);
    expect(prompt).toMatch(/Existence is match_task, get_task, or list_unscheduled/);
    expect(prompt).toMatch(/Do not create a task because a day agenda is empty/);
  });

  it('uses the task happening now only when they asked for the current task', () => {
    expect(prompt).toMatch(/Do not fill an unsettled reference with the task happening now/);
    expect(prompt).toMatch(/target only when they asked for the current task/);
  });

  it('states each structural rule once', () => {
    expect(prompt.split(QUESTION_PROPOSAL_MODULE).length - 1).toBe(1);
    expect(prompt.split('Dates named once').length - 1).toBe(1);
    expect(prompt.split('from Wake to Sleep').length - 1).toBe(1);
    expect(prompt.split('twelve hours apart').length - 1).toBe(1);
  });

  it('keeps clock arithmetic in plan edits and sufficiency on segments', () => {
    const planOps = prompt.indexOf('Plan edit ops');
    const rules = prompt.indexOf('\nRules:');
    const arithmetic = prompt.indexOf('twelve hours apart');
    const wake = prompt.indexOf('from Wake to Sleep');
    expect(arithmetic).toBeGreaterThan(planOps);
    expect(wake).toBeGreaterThan(planOps);
    expect(arithmetic).toBeLessThan(rules);
    expect(wake).toBeLessThan(rules);
    expect(prompt.slice(rules)).not.toMatch(/twelve hours apart|from Wake to Sleep|HH:MM/);
    expect(prompt.slice(0, planOps)).not.toMatch(/twelve hours apart|from Wake to Sleep/);
    expect(prompt).toMatch(/named day and no clock is a complete time/);
    expect(prompt).toMatch(/If both places of a spoken hour have passed, that is a question/);
    expect(prompt).toMatch(/named week with no day inside it is a question which day/);
    expect(prompt).toMatch(/named part of the day that has not ended is enough for a segment/);
  });

  it('treats a named day without a clock as a complete time', () => {
    expect(prompt).toMatch(/named day and no clock is a complete time/);
    expect(prompt).toMatch(/Do not ask for a clock then/);
    expect(prompt).toMatch(/named day and no clock is not a clarification/);
    expect(prompt).not.toMatch(/An event with no time is a question when, not a segment/);
  });

  it('keeps an unfinished specialist operation as a segment', () => {
    expect(prompt).toMatch(/reference that still does not settle one entity stays its own segment/);
    expect(prompt).toMatch(/pass the command on as its own segment/);
    expect(prompt).toMatch(/When that check leaves more than one, that command stays a segment/);
    expect(prompt).not.toMatch(/is a question in answer/);
    expect(prompt).not.toMatch(/do not emit the unfinished operation/);
  });

  it('does not use steps.answer as a clarification slot', () => {
    expect(prompt).toMatch(/not a question back to the user/);
    expect(prompt).toMatch(/not where a missing fact of a write is asked/);
    expect(prompt).toMatch(/Do not put that question in answer/);
    expect(prompt).toMatch(/Do not ask which task in answer/);
    expect(prompt).toMatch(/Do not ask a missing fact of a write in answer/);
    expect(prompt).toMatch(/A pure calendar question: segments \[\] with the answer/);
  });

  it('does not use final for an unfinished operation that has siblings', () => {
    expect(prompt).toMatch(
      /Do not use final to ask about an unfinished operation when any other independent operation remains/,
    );
    expect(prompt).toMatch(/keep that unfinished operation as a segment/);
    expect(prompt).toMatch(/A time question that is the whole utterance is final, outcome clarify/);
    expect(prompt).toMatch(/when the utterance asks nothing else, is a question when, not a segment/);
  });

  it('uses answer_pending only for the open question', () => {
    expect(prompt).toMatch(/this utterance answers that one question/);
    expect(prompt).toMatch(/No segments and no new command are added to it/);
    expect(prompt).toMatch(/is not answer_pending/);
    expect(prompt).toMatch(/Do not mix it into that answer/);
    expect(prompt).not.toMatch(/repeat the question already asked/);
    expect(prompt).toMatch(/cancel_pending is how they decline that whole batch/);
    expect(prompt).not.toMatch(/Decide this utterance on its own/);
    expect(prompt).not.toMatch(/ignored question is skipped/);
    expect(prompt).not.toMatch(/A question is asked once/);
    expect(prompt).toMatch(/no clarification counter/);
    expect(prompt).toMatch(/An open question stays until this utterance answers it or they cancel the batch/);
  });
});

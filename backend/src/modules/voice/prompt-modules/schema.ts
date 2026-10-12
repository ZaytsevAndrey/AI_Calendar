/** Create specialist: JSON shape only. One LLM call still sends this with the other modules. */
export const CREATE_SCHEMA_MODULE = `{
  "intent": "create",
  "understanding": "complete" | "needs_clarification",
  "clarifyingQuestion": string | null,
  "task": {
    "name": string,
    "kind": "fixed" | "flexible" | "unscheduled" | "recurring",
    "estimatedTimeInMinutes": number | null,
    "deadline": string | null,
    "earliestStartTime": string | null,
    "scheduledStartTime": string | null,
    "scheduledEndTime": string | null,
    "isRecurring": boolean,
    "recurrencePattern": "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY" | null,
    "recurrenceWeekDays": number[] | null,
    "phaseId": string | null,
    "priority": "low" | "medium" | "high" | "urgent",
    "description": string | null,
    "isUnscheduled": boolean
  }
}`;

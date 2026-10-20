/** Scope question for a repeating task. The resolver asks again if this is omitted. */
export const SERIES_SCOPE_MODULE = `Repeating task. An Open tasks line marked recurring is a series. command.seriesScope is required for that task. First match wins. Do not guess.
1. one day they already named, including today, even when they did not say "only" → "occurrence". Do not ask which scope again.
2. this day and following → "series"
3. entire series / whole series / all days → "all"
4. They did not say which → omit seriesScope. understanding needs_clarification. Do not delete, move, or edit yet.
A task that is not marked recurring omits seriesScope.
On a follow-up, keep the original action and only add the scope they just chose.`;

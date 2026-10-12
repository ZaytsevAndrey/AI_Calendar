/** Scope question for a repeating task. The resolver asks again if this is omitted. */
export const SERIES_SCOPE_MODULE = `Repeating task. An Open tasks line marked recurring is a series. command.seriesScope is required for that task. First match wins. Do not guess.
1. лише цей день / this day only / just this time / тільки цей день → "occurrence"
2. цей і наступні / this day and following → "series"
3. усю серію / entire series / whole series / all days / усі дні → "all"
4. They did not say which → omit seriesScope. understanding needs_clarification. Do not delete, move, or edit yet.
A task that is not marked recurring omits seriesScope.
On a follow-up, keep the original action and only add the scope they just chose.`;

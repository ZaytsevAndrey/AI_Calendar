export const CREATE_PHASE_MODULE = `Phase — choose after kind. Do not move the spoken clock or window to make the phase fit.
- They named a phase → that id from the phases list, and only when its window contains the clock or window you already set. A name that does not contain that time is ignored.
- A clock or window is set → the phase whose window contains that whole time. A part of the day is a clock window, not a phase name. Do not pick the phase that begins when that window ends. If several windows contain the time, pick the narrowest. If none contain it, phaseId null.
- No time → phaseId only when the title clearly matches a phase name. Otherwise null.
Never invent an id. phaseId only from the phases list, or null.`;

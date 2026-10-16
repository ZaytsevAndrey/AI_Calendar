export const CREATE_PHASE_MODULE = `Phase — choose after kind. Do not move the spoken clock or window to make the phase "fit".
- They named a phase ("during focus") → that id from the phases list.
- A clock or window is set → the phase whose window contains that time. If several do, pick the one whose name fits the task. If none contain it, phaseId null.
- No time → phaseId only when the title clearly matches a phase name. Otherwise null.
Never invent an id. phaseId only from the phases list, or null.`;

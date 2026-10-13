import { phaseSetupOffersDayShape, showsAppShell } from './phaseSetupStep';

describe('phase setup gate', () => {
  it('hides the app shell only on the setup route', () => {
    expect(showsAppShell('/setup/phases')).toBe(false);
    expect(showsAppShell('/')).toBe(true);
    expect(showsAppShell('/settings')).toBe(true);
  });

  it('offers a day shape and skip only after wake and sleep', () => {
    expect(phaseSetupOffersDayShape('sleep')).toBe(false);
    expect(phaseSetupOffersDayShape('phases')).toBe(true);
  });
});

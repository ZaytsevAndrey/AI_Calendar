import { reminderCronSecretMatches } from './reminder-cron.util';

describe('reminderCronSecretMatches', () => {
  it('accepts the configured secret', () => {
    expect(reminderCronSecretMatches('tick-secret', 'tick-secret')).toBe(true);
  });

  it('rejects a missing, empty, or different secret', () => {
    expect(reminderCronSecretMatches(undefined, 'tick-secret')).toBe(false);
    expect(reminderCronSecretMatches('tick-secret', undefined)).toBe(false);
    expect(reminderCronSecretMatches('', 'tick-secret')).toBe(false);
    expect(reminderCronSecretMatches('tick-secreT', 'tick-secret')).toBe(false);
    expect(reminderCronSecretMatches('short', 'tick-secret')).toBe(false);
  });
});

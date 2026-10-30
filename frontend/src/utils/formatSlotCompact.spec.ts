import i18n from '../i18n';
import { formatDateTimeCompact, formatSlotCompact } from './formatDate';

describe('compact slot labels', () => {
  const now = new Date(2026, 9, 29, 12, 0);
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('drops the year inside the current year', () => {
    expect(formatSlotCompact(new Date(2026, 9, 30, 10).toISOString(), new Date(2026, 9, 30, 11).toISOString(), now)).toBe(
      'Fr 30 Oct, 10:00–11:00',
    );
    expect(formatDateTimeCompact(new Date(2026, 10, 3, 10).toISOString(), now)).toBe('Tu 3 Nov, 10:00');
  });

  it('keeps the year for another year', () => {
    expect(formatDateTimeCompact(new Date(2027, 0, 5, 9).toISOString(), now)).toBe('5 Jan 2027, 09:00');
  });
});

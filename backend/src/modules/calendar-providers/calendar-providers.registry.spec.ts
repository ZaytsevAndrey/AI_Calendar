import { CalendarProvidersRegistry } from './calendar-providers.registry';

describe('CalendarProvidersRegistry', () => {
  const google = {
    id: 'google' as const,
    isConnected: jest.fn().mockResolvedValue(true),
    listCalendars: jest
      .fn()
      .mockResolvedValue([{ id: 'g1', summary: 'G', provider: 'google' }]),
    listEvents: jest.fn().mockResolvedValue([]),
  };
  const microsoft = {
    id: 'microsoft' as const,
    isConfigured: () => false,
    isConnected: jest.fn(),
    listCalendars: jest.fn(),
    listEvents: jest.fn(),
  };
  const apple = {
    id: 'apple' as const,
    isConfigured: () => false,
    isConnected: jest.fn(),
    listCalendars: jest.fn(),
    listEvents: jest.fn(),
  };

  const registry = new CalendarProvidersRegistry(
    google as never,
    microsoft as never,
    apple as never,
  );

  it('lists only configured providers', () => {
    expect(registry.all().map((p) => p.id)).toEqual(['google']);
  });

  it('aggregates calendars from connected providers', async () => {
    const cals = await registry.listAllCalendars('u1');
    expect(cals).toHaveLength(1);
    expect(cals[0].id).toBe('g1');
  });
});

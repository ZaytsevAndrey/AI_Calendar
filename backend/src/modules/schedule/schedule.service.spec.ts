import { ScheduleService } from './schedule.service';

describe('ScheduleService', () => {
  it('is defined when constructed with repositories', () => {
    const service = new ScheduleService(
      { findOne: jest.fn(), create: jest.fn(), save: jest.fn(), remove: jest.fn() } as never,
      { findOne: jest.fn() } as never,
      {} as never,
    );
    expect(service).toBeDefined();
  });
});

import { NotFoundException } from '@nestjs/common';
import { ScheduleService } from './schedule.service';

describe('ScheduleService (read side)', () => {
  const mine = { id: 'slot-1', task: { userId: 'u1', phaseId: 'p1' } };
  const theirs = { id: 'slot-2', task: { userId: 'u2', phaseId: 'p1' } };

  it('lists only the caller’s slots, optionally by phase', async () => {
    const repo = { find: jest.fn().mockResolvedValue([mine, theirs]) };
    const service = new ScheduleService(repo as never);
    await expect(service.findAll('u1', {} as never)).resolves.toEqual([mine]);
    await expect(service.findAll('u1', { phaseId: 'other' } as never)).resolves.toEqual([]);
  });

  it('hides another user’s slot behind 404', async () => {
    const repo = { findOne: jest.fn().mockResolvedValue(theirs) };
    const service = new ScheduleService(repo as never);
    await expect(service.findOne('slot-2', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

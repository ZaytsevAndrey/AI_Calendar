import { validate } from 'class-validator';
import { UpdateUserSettingsDto } from './update-user-settings.dto';

describe('UpdateUserSettingsDto', () => {
  it('accepts a valid IANA time zone', async () => {
    const dto = Object.assign(new UpdateUserSettingsDto(), {
      timeZone: 'Asia/Nicosia',
    });
    const errors = await validate(dto);
    expect(errors.filter((error) => error.property === 'timeZone')).toEqual([]);
  });

  it('accepts a default task duration in range', async () => {
    const dto = Object.assign(new UpdateUserSettingsDto(), {
      defaultTaskDurationMinutes: 45,
    });
    const errors = await validate(dto);
    expect(
      errors.filter((error) => error.property === 'defaultTaskDurationMinutes'),
    ).toEqual([]);
  });

  it('rejects a default task duration outside 5–480 minutes', async () => {
    const tooShort = Object.assign(new UpdateUserSettingsDto(), {
      defaultTaskDurationMinutes: 4,
    });
    const tooLong = Object.assign(new UpdateUserSettingsDto(), {
      defaultTaskDurationMinutes: 481,
    });
    expect(
      (await validate(tooShort)).some(
        (error) => error.property === 'defaultTaskDurationMinutes',
      ),
    ).toBe(true);
    expect(
      (await validate(tooLong)).some(
        (error) => error.property === 'defaultTaskDurationMinutes',
      ),
    ).toBe(true);
  });

  it('rejects an invalid time zone', async () => {
    const dto = Object.assign(new UpdateUserSettingsDto(), {
      timeZone: 'Not/AZone',
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'timeZone')).toBe(true);
  });
});

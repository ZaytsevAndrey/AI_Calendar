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

  it('rejects an invalid time zone', async () => {
    const dto = Object.assign(new UpdateUserSettingsDto(), {
      timeZone: 'Not/AZone',
    });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'timeZone')).toBe(true);
  });
});

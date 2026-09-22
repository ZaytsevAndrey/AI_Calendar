import { timingSafeEqual } from 'crypto';

export function reminderCronSecretMatches(
  provided: string | undefined,
  expected: string | undefined,
): boolean {
  if (!expected || !provided) return false;
  const actual = Buffer.from(provided);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length) return false;
  return timingSafeEqual(actual, wanted);
}

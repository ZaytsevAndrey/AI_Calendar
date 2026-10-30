import { keyAfterFailure, keyForSubmission, newRequestKey } from './requestKey';

describe('keyAfterFailure (AUD-024)', () => {
  const sent = keyForSubmission({ key: newRequestKey(), body: null }, { name: 'Buy milk' });

  it('a 410 (the task this key made is gone) spends the key: the same Save again is a new create', () => {
    const next = keyAfterFailure(sent, { response: { status: 410 } });
    expect(next.key).not.toBe(sent.key);
    expect(keyForSubmission(next, { name: 'Buy milk' }).key).toBe(next.key);
  });

  it('a lost answer or a server error keeps the key for the retry', () => {
    expect(keyAfterFailure(sent, new Error('Network Error'))).toBe(sent);
    expect(keyAfterFailure(sent, { response: { status: 503 } })).toBe(sent);
    expect(keyAfterFailure(sent, { status: 422 })).toBe(sent);
  });
});

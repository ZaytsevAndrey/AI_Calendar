import { customBaseQuery } from './customBaseQuery';
import apiCall from '../modules/common/utils/apiCall';
import { newRequestKey } from '../utils/requestKey';

jest.mock('../modules/common/utils/apiCall', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue({ data: { id: 't1' } }),
}));

describe('customBaseQuery', () => {
  it('sends request headers such as Idempotency-Key', async () => {
    const result = await customBaseQuery(
      { url: '/tasks', method: 'POST', data: { name: 'A' }, headers: { 'Idempotency-Key': 'k1' } },
      {} as never,
      {},
    );
    expect(apiCall).toHaveBeenCalledWith({
      url: '/tasks',
      method: 'POST',
      data: { name: 'A' },
      headers: { 'Idempotency-Key': 'k1' },
    });
    expect(result).toEqual({ data: { id: 't1' } });
  });
});

describe('newRequestKey', () => {
  it('is a valid Idempotency-Key and differs per operation', () => {
    const a = newRequestKey();
    const b = newRequestKey();
    expect(a).toMatch(/^[A-Za-z0-9._:-]{1,64}$/);
    expect(a).not.toBe(b);
  });
});

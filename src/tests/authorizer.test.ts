/* eslint-env node */
import { createHash } from 'crypto';

import mysql from 'mysql2/promise';

import { authorizeKey } from '../authorizer';

const mockQuery = jest.fn();
const mockEnd = jest.fn();
const mockPool = { query: mockQuery, end: mockEnd };

jest.mock('mysql2/promise', () => ({
  __esModule: true,
  default: { createPool: jest.fn() },
}));

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function makeKey(payload: unknown): string {
  return `Bearer ${Buffer.from(JSON.stringify(payload)).toString('base64')}`;
}

const REQUEST_ID = 'test-request-id';

describe('authorizeKey', () => {
  beforeAll(() => {
    (mysql.createPool as jest.Mock).mockReturnValue(mockPool);
  });

  beforeEach(() => {
    mockQuery.mockReset();
    mockEnd.mockReset();
    mockEnd.mockResolvedValue(undefined);
  });

  describe('token parsing and validation', () => {
    it('returns unauthorized for an empty key', async () => {
      const result = await authorizeKey('', REQUEST_ID);
      expect(result).toEqual({ authorized: false });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns unauthorized when the decoded payload is not valid JSON', async () => {
      const result = await authorizeKey(
        `Bearer ${Buffer.from('not valid {json}', 'utf-8').toString('base64')}`,
        REQUEST_ID
      );
      expect(result).toEqual({ authorized: false });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns unauthorized when the value field is missing', async () => {
      const result = await authorizeKey(
        makeKey({ id: 1, expires: Date.now() + 3_600_000 }),
        REQUEST_ID
      );
      expect(result).toMatchObject({ authorized: false });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns unauthorized when the expires field is missing', async () => {
      const result = await authorizeKey(
        makeKey({ id: 1, value: '1|token' }),
        REQUEST_ID
      );
      expect(result).toMatchObject({ authorized: false });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns unauthorized for an expired token', async () => {
      const result = await authorizeKey(
        makeKey({ id: 1, value: '1|expiredtoken', expires: Date.now() - 1000 }),
        REQUEST_ID
      );
      expect(result).toMatchObject({ authorized: false });
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('database authorization', () => {
    it('returns authorized with authInfo when the hashed token matches the DB record', async () => {
      const authZ = { id: 301, value: '301|tokenA', expires: Date.now() + 3_600_000 };
      mockQuery.mockResolvedValue([[{ id: 301, token: sha256('tokenA') }], []]);

      const result = await authorizeKey(makeKey(authZ), REQUEST_ID);

      expect(result).toEqual({ authorized: true, authInfo: authZ });
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT id, token FROM personal_access_tokens WHERE id = ?',
        [301]
      );
    });

    it('returns authorized when the DB stores the plain (unhashed) token', async () => {
      const authZ = { id: 302, value: '302|tokenB', expires: Date.now() + 3_600_000 };
      mockQuery.mockResolvedValue([[{ id: 302, token: 'tokenB' }], []]);

      const result = await authorizeKey(makeKey(authZ), REQUEST_ID);

      expect(result).toMatchObject({ authorized: true });
    });

    it('returns unauthorized when the token ID is not found in the DB', async () => {
      const authZ = { id: 303, value: '303|tokenC', expires: Date.now() + 3_600_000 };
      mockQuery.mockResolvedValue([[], []]);

      const result = await authorizeKey(makeKey(authZ), REQUEST_ID);

      expect(result).toMatchObject({ authorized: false });
    });

    it('returns unauthorized when the token hash does not match', async () => {
      const authZ = { id: 304, value: '304|tokenD', expires: Date.now() + 3_600_000 };
      mockQuery.mockResolvedValue([[{ id: 304, token: sha256('differenttoken') }], []]);

      const result = await authorizeKey(makeKey(authZ), REQUEST_ID);

      expect(result).toMatchObject({ authorized: false });
    });

    it('returns unauthorized and resets the connection pool on a DB error', async () => {
      const authZ = { id: 305, value: '305|tokenE', expires: Date.now() + 3_600_000 };
      mockQuery.mockRejectedValue(new Error('DB connection lost'));

      const result = await authorizeKey(makeKey(authZ), REQUEST_ID);

      expect(result).toMatchObject({ authorized: false });
      expect(mockEnd).toHaveBeenCalled();
    });

    it('includes me fields in authInfo when present', async () => {
      const authZ = {
        id: 306,
        value: '306|tokenF',
        expires: Date.now() + 3_600_000,
        me: { entityId: 10, entityEmployeeId: 20, entityLocationId: 30 },
      };
      mockQuery.mockResolvedValue([[{ id: 306, token: sha256('tokenF') }], []]);

      const result = await authorizeKey(makeKey(authZ), REQUEST_ID);

      expect(result).toEqual({ authorized: true, authInfo: authZ });
    });

    it('includes adminId in authInfo when present', async () => {
      const authZ = {
        adminId: 999,
        id: 307,
        value: '307|tokenG',
        expires: Date.now() + 3_600_000,
      };
      mockQuery.mockResolvedValue([[{ id: 307, token: sha256('tokenG') }], []]);

      const result = await authorizeKey(makeKey(authZ), REQUEST_ID);

      expect(result).toEqual({ authorized: true, authInfo: authZ });
    });
  });

  describe('auth result caching', () => {
    it('does not hit the DB on a second call with the same key', async () => {
      const authZ = { id: 401, value: '401|cachedtoken', expires: Date.now() + 3_600_000 };
      const key = makeKey(authZ);
      mockQuery.mockResolvedValue([[{ id: 401, token: sha256('cachedtoken') }], []]);

      const first = await authorizeKey(key, 'cache-req-1a');
      expect(first).toMatchObject({ authorized: true });
      expect(mockQuery).toHaveBeenCalledTimes(1);

      mockQuery.mockReset();
      const second = await authorizeKey(key, 'cache-req-1b');
      expect(second).toMatchObject({ authorized: true });
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('does not cache failed authorization attempts', async () => {
      const authZ = { id: 402, value: '402|failtoken', expires: Date.now() + 3_600_000 };
      const key = makeKey(authZ);
      mockQuery.mockResolvedValue([[{ id: 402, token: sha256('wrongtoken') }], []]);

      await authorizeKey(key, 'cache-req-2a');
      expect(mockQuery).toHaveBeenCalledTimes(1);

      mockQuery.mockReset();
      mockQuery.mockResolvedValue([[{ id: 402, token: sha256('wrongtoken') }], []]);
      await authorizeKey(key, 'cache-req-2b');
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('hits the DB again after the cache TTL expires', async () => {
      jest.useFakeTimers();

      try {
        const now = Date.now();
        const authZ = { id: 403, value: '403|ttltoken', expires: now + 3_600_000 };
        const key = makeKey(authZ);
        mockQuery.mockResolvedValue([[{ id: 403, token: sha256('ttltoken') }], []]);

        await authorizeKey(key, 'cache-req-3a');
        expect(mockQuery).toHaveBeenCalledTimes(1);

        // Advance past AUTH_CACHE_TTL_MS (5 minutes)
        jest.advanceTimersByTime(5 * 60 * 1000 + 1);

        mockQuery.mockReset();
        mockQuery.mockResolvedValue([[{ id: 403, token: sha256('ttltoken') }], []]);
        await authorizeKey(key, 'cache-req-3b');
        expect(mockQuery).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});

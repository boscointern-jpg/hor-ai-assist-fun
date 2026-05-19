/* eslint-env node */
import { createHash } from 'crypto';

import mysql, { type FieldPacket, type Pool } from 'mysql2/promise';
import { type RowDataPacket } from "mysql2/promise";

const shortSha = process.env['SHORT_SHA'] ?? "none";

export interface AuthZ {
  adminId?: number;
  id: number;
  me?: {
    entityEmployeeId?: number;
    entityId?: number;
    entityLocationId?: number;
  };
  value: string;
  expires: number;
}

interface AuthedUser extends RowDataPacket {
  id: number;
  token: string;
}

// Create connection pool at module level (during cold start)
// This connection pool will be reused across Lambda invocations
let connectionPool: Pool | null = null;

// Cache successful auth results for up to AUTH_CACHE_TTL_MS to avoid a DB round-trip on every
// request. Capped well below typical token expiry so revoked tokens are not accepted indefinitely.
// Only successful authorizations are cached — failures always hit the DB.
const AUTH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const AUTH_CACHE_MAX_SIZE = 500;
type CachedAuth = { authorized: true; authInfo: AuthZ; expiresAt: number };
const authCache = new Map<string, CachedAuth>();

function getCachedAuth(key: string): { authorized: true; authInfo: AuthZ } | undefined {
  const entry = authCache.get(key);
  if (entry === undefined) return undefined;
  if (Date.now() >= entry.expiresAt) {
    authCache.delete(key);
    return undefined;
  }
  return { authorized: true, authInfo: entry.authInfo };
}

function setCachedAuth(key: string, authInfo: AuthZ): void {
  if (authCache.size >= AUTH_CACHE_MAX_SIZE) {
    authCache.delete(authCache.keys().next().value!);
  }
  const expiresAt = Math.min(authInfo.expires, Date.now() + AUTH_CACHE_TTL_MS);
  authCache.set(key, { authorized: true, authInfo, expiresAt });
}

function getConnectionPool(): Pool {
  if (connectionPool === null) {
    console.info(`[${shortSha}] Creating new MySQL connection pool`);
    connectionPool = mysql.createPool({
      host: process.env['DB_HOST'] ?? 'localhost',
      user: process.env['DB_USER'] ?? 'root',
      password: process.env['DB_PWD'] ?? '',
      database: process.env['DB_NAME'] ?? 'test',
      port: parseInt(process.env['DB_PORT'] ?? '3306'),
      // Connection pool configuration
      connectionLimit: 1, // Lambda typically only needs 1 connection
      waitForConnections: true,
      queueLimit: 0,
      // Keep connections alive
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  }
  return connectionPool;
}

function generateSHA256Hash(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

async function executeMySqlQuery(keyId: number): Promise<AuthedUser[] | undefined>  {
  try {
    // Get connection from pool (reuses existing connections)
    const pool = getConnectionPool();

    // Execute a query (pool automatically manages connections)
    const [rows]: [AuthedUser[], FieldPacket[]] = await pool.query<AuthedUser[]>(
        'SELECT id, token FROM personal_access_tokens WHERE id = ?', [keyId]);

    // Process the results
    return rows;
  } catch (error) {
    console.error('Error executing query:', error);
    // If connection fails, reset the pool so it can be recreated on next attempt
    if (connectionPool) {
      try {
        await connectionPool.end();
      } catch (closeError) {
        console.error('Error closing pool:', closeError);
      }
      connectionPool = null;
    }
    return undefined;
  }
}

export async function authorizeKey(key: string, requestId: string): Promise<{authorized: boolean; authInfo?: AuthZ}> {
  const cached = getCachedAuth(key);
  if (cached !== undefined) {
    return cached;
  }

  const encodedAuthObj = key.split(" ");
  let authObj: AuthZ;

  try {
    // Decode base64 string - use Buffer for Node.js compatibility
    const encodedPart = encodedAuthObj[1] ?? '';
    const decoded = Buffer.from(encodedPart, 'base64').toString('utf-8');
    authObj = JSON.parse(decoded) as AuthZ;
  } catch {
    console.error(
        `[${shortSha}-${requestId}] ERROR: AuthZ key JSON parsing error: `,
        key
    );
    return {authorized: false};
  }

  if (authObj.value === undefined) {
    console.error(
        `[${shortSha}-${requestId}] ERROR: AuthZ key missing 'token'`,
        authObj
    );
    return {authorized: false, authInfo: authObj};
  } else   if (authObj.expires === undefined) {
    console.error(
        `[${shortSha}-${requestId}] ERROR: AuthZ key missing 'expires'`,
        authObj
    );
    return {authorized: false, authInfo: authObj};
  }

  if (authObj.expires < Date.now()) {
    console.error(
        `[${shortSha}-${requestId}] ERROR: AuthZ token expired`,
        authObj
    );
    return {authorized: false, authInfo: authObj};
  }

  // The token is still active, so now let's see if it's still valid
  const splitVal = authObj.value.split('|');
  const id = splitVal[0] ?? '';
  const token = splitVal[1] ?? '';
  const hashedToken = generateSHA256Hash(token);

  // Connect to the legacy database, retrieve the 'token' column based on
  // the 'id' and compare it with the 'hashedToken' that was just generated.
  // If they match, all good.
  try {
    const rows = await executeMySqlQuery(parseInt(id));

    if (rows === undefined || rows.length === 0) {
      console.error(
          `[${shortSha}-${requestId}] ERROR: AuthZ key not found`,
          authObj
      );
      return {authorized: false, authInfo: authObj};
    }

    const firstRow = rows[0];
    if (firstRow === undefined) {
      return {authorized: false, authInfo: authObj};
    }

    const dbToken = firstRow.token;

    if (dbToken !== hashedToken && dbToken !== token) {
      console.error(
          `[${shortSha}-${requestId}] ERROR: AuthZ key invalid`,
          authObj
      );
      return {authorized: false, authInfo: authObj};
    }

    setCachedAuth(key, authObj);
    return {authorized: true, authInfo: authObj};
  } catch (error) {
    console.error(`[${shortSha}-${requestId}] Database error:`, error);
    return {authorized: false, authInfo: authObj};
  }
}

import pg from 'pg';

// Return bigint ids as numbers (safe below 2^53) so the app can compare them with ===.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set. Use the Supabase pooler connection string (Project Settings > Database).');
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: Number(process.env.DATABASE_POOL_SIZE || 5)
});

pool.on('error', (error) => console.error('Postgres pool error', error));

export async function query(sql, params = [], client = pool) {
  return (await client.query(sql, params)).rows;
}

export async function one(sql, params = [], client = pool) {
  return (await query(sql, params, client))[0];
}

// Run fn(client) inside a transaction; rolls back if it throws.
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

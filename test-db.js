require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function testConnection() {
  try {
    await client.connect();
    const res = await client.query('SELECT NOW() AS current_time');
    console.log('Connectie geslaagd!');
    console.log('Server tijd:', res.rows[0].current_time);
    await client.end();
  } catch (err) {
    console.error('Connectie mislukt:', err.message);
    process.exit(1);
  }
}

testConnection();

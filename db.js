const { Pool } = require("pg");
const dotenv = require("dotenv").config();

const pgdb = process.env.DATABASE;
const pguser = process.env.PGUSER;
const pgpass = process.env.PGPASS;

const pool = new Pool({
	user: pguser,
	database: pgdb,
	password: pgpass,
	port: 5432,
	host: 'localhost',
});

module.exports = { pool };

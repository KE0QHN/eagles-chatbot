const dotenv = require("dotenv").config()

const { Chat, ChatEvents } = require("twitch-js");
const { pool } = require("./db");

const username = process.env.USERNAME;
const token = process.env.TOKEN;
const channel = process.env.CHANNEL;

const run = async () => {
	const chat = new Chat({
		username,
		token
	});

	await chat.connect();
	await chat.join(channel);

	chat.on('PRIVMSG', (message) => {
		if (message.message.includes("!bsr")) {
			bsr_match = (message.message.match(/\!bsr\s(.*?)(\s.*)?$/));
			insertBsrPending(bsr_match[1],message.username,bsr_match[2]);
		}
	});
};

async function insertBsrPending(bsr_code,bsr_req,bsr_note) {
	const res = await pool.query("INSERT INTO bsrpending (bsr_code, bsr_req, bsr_ts, bsr_note) VALUES ($1, $2, current_timestamp, $3)",[bsr_code,bsr_req,bsr_note]);
}

run();

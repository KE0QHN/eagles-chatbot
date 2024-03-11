const dotenv = require("dotenv").config()

const { Chat, ChatEvents } = require("twitch-js");
const { pool } = require("./db");
const https = require('https');

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

		if (message.message.includes("added to queue")) {
			bsr_match = (message.message.match(/^\(bsr\s(.*?)\)\s(.*?)\s\/\s(.*?)\s(.*\%)\srequested\sby\s(.*?)\sadded\sto\squeue$/));
			movePendingToActive(bsr_match[1],bsr_match[5]);
		}

		const bsrFailMsgs = [
			'you are not allowed to make requests',
		   	'the queue is closed',
		   	'is blacklisted',
		   	'is already in queue',
		   	'you already have',
		   	'this song was already requested this session',
		   	'maps are not allowed'
		];
		
		if (bsrFailMsgs.includes(message.message)) {
			removeBsrPending(message.username);  
		}
	});
};

async function insertBsrPending(bsr_code,bsr_req,bsr_note) {
	const res = await pool.query("INSERT INTO bsrpending (bsr_code, bsr_req, bsr_ts, bsr_note) VALUES ($1, $2, current_timestamp, $3)",[bsr_code,bsr_req,bsr_note]);
}

async function insertBsrQueue(bsr_code,bsr_req,bsr_name,bsr_ts,bsr_length,bsr_note) {
	var bsr_count = (getBsrQueueLength() + 1);
	const res = await pool.query("INSERT INTO bsrqueue (req_order, bsr_code, bsr_req, bsr_name, bsr_ts, bsr_length, bsr_note) VALUES ($1, $2, $3, $4, $5, $6, $7)",
		[bsr_count,bsr_code,bsr_req,bsr_name,bsr_ts,bsr_length,bsr_note]);
}

async function getBsrQueueLength() {
	const res = await pool.query("SELECT * FROM bsrqueue");
	return res.length;
}

async function getBsrPending(bsr_code) {
	const res = await pool.query("SELECT * FROM bsrpending WHERE bsr_code = $1",[bsr_code]);
	return res.rows;
}

async function movePendingToActive(bsr_code,bsr_req) {
	var pQueue = getBsrPending(bsr_code);
	getMapInfo(bsr_code, function(response){
		var mapData = JSON.parse(response)
		const pQueueData = async () => {
			const a = await pQueue;
			console.log(a);
		}
		console.log(mapData.metadata.duration);
	});
}

async function getMapInfo(bsr_code, callback) {
	const options = {
		hostname: 'api.beatsaver.com',
		path: '/maps/id/' + bsr_code,
		port: 443,
		method: 'GET',
		headers: {
			'Content-Type': 'application/json',
		},
	};

	const getPosts = () => {
		let data = '';
		const request = https.request(options, (response) => {
			response.setEncoding('utf8');
			response.on('data', (chunk) => {
				data += chunk;
			});
			response.on('end', () => {
				callback(data);
			});
		});

		request.on('error', (error) => {
			console.error(error);
		});

		request.end();
	};
	
	getPosts();
}

async function removeBsrPending(bsr_req) {
	const res = await pool.query("DELETE FROM bsrpending WHERE bsr_req = $1", [ bsr_req ]); 
}

run();

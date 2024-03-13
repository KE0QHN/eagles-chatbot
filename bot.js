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
		// Add bsr,modadd Request to Pending Queue
		if (message.message.match(/^\!(bsr|modadd|att|mtt|remove)\s(.*?)(\s.*)?$/)) {
			bsr_match = (message.message.match(/^\!(.*?)\s(.*?)(\s.*)?$/));
			if (message.message.includes("!bsr") || message.message.includes("!modadd")) {
				insertBsrPending(bsr_match[2],message.username,bsr_match[3],false);
			}
			if (message.message.includes("!att")) {
				insertBsrPending(bsr_match[2],message.username,bsr_match[3],true);
			}
			if (message.message.includes("!mtt")) {
				moveBsrQueueTop(bsr_match[2],message.username);	
			}
		}

		if (message.message.includes("!resetcbqueue")) {
			if (message.tags.isModerator === true || message.tags.badges.broadcaster === true) {
				resetCBQueue();
				resetCBPendingQueue();
			}
		}
	
		// These only come from the BS+ User
		if (message.username === process.env.BSCHATUSER) {
			// If BS+ Adds to Queue, Remove from Pending and add to Active Queue
			if (message.message.includes("added to queue")) {
				bsr_match = (message.message.match(/^(\!\s)?\(bsr\s(.*?)\)\s(.*?)\s\/\s(.*?)\s(.*\%)\srequested\sby\s\@?(.*?)\sadded\sto\squeue\.?$/));
				movePendingToActive(bsr_match[2],bsr_match[6]);
			}
			if (message.message.includes("is now on top of queue")) {
				bsr_match = (message.message.match(/^(\!\s)?\(bsr\s(.*?)\)\s(.*?)\s\/\s(.*?)\s(.*\%\s)?requested\sby\s\@?(.*?)\sis\snow\son\stop\sof\squeue(\.|\!)?$/));
				movePendingToActive(bsr_match[2],bsr_match[6]);
			}

			// If BS+ reports a reason for failure, remove from pending.
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
			
			// When next song remove from active queue.
			if (message.message.match(/^(\!\s)?(.*?)\s\/\s(.*?)\s\d+\%\s\(bsr\s(.*?)\)\srequested\sby\s(.*?)\sis\snext\!$/)) {
				bsr_match = (message.message.match(/^(\!\s)?(.*?)\s\/\s(.*?)\s\d+\%\s\(bsr\s(.*?)\)\srequested\sby\s(.*?)\sis\snext\!$/));
				removeBsrQueue(bsr_match[4]);
			}

			// When remove command is used successfully.
			if (message.message.match(/^(\!\s)?(\@(.*?)\s)?\(bsr\s(.*?)\)\s(.*?)\s\/\s(.*?)\s(.*\%\s)?request\sby\s\@?(.*?)\sis\sremoved\sfrom\squeue(\.|\!)?$/)) {
				bsr_match = (message.message.match(/^(\!\s)?(\@(.*?)\s)?\(bsr\s(.*?)\)\s(.*?)\s\/\s(.*?)\s(.*\%\s)?request\sby\s\@?(.*?)\sis\sremoved\sfrom\squeue(\.|\!)?$/));
				removeBsrQueue(bsr_match[4]);
			}
		}
	});
};

async function resetCBQueue() {
	console.log("[BOT] Resetting the Chatbot Queue Database");
	const res = await pool.query("DROP TABLE bsrqueue");
	createCBQueueDB();
}

async function createCBQueueDB() {
	console.log("[BOT] Creating new Chatbot Queue Database");
	const res = await pool.query("CREATE TABLE bsrqueue (req_id serial PRIMARY KEY, req_order SMALLINT NOT NULL,bsr_code VARCHAR (10) NOT NULL, bsr_req VARCHAR (25) NOT NULL, bsr_name VARCHAR (2048) NOT NULL, bsr_ts TIMESTAMP NOT NULL, bsr_length INTERVAL NOT NULL, bsr_note VARCHAR (2048))");
}

async function resetCBPendingQueue() {
	console.log("[BOT] Resetting the Chatbot Pending Database");
	const res = await pool.query("DROP TABLE bsrpending");
	createPendingQueueDB();
}

async function createPendingQueueDB() {
	console.log("[BOT] Create new Chatbot Pending Database");
	const res = await pool.query("CREATE TABLE bsrpending ( req_id serial PRIMARY KEY, req_att BOOL NOT NULL, bsr_code VARCHAR (10) NOT NULL, bsr_req VARCHAR (25) NOT NULL, bsr_ts TIMESTAMP NOT NULL, bsr_note VARCHAR (2048))");
}

async function insertBsrPending(bsr_code,bsr_req,bsr_note,req_att) {
	console.log("[BOT] Adding To Pending Queue Code:[" + bsr_code + "]-Req:[" + bsr_req + "]-Note:[" + bsr_note + "]");
	const res = await pool.query("INSERT INTO bsrpending (bsr_code, bsr_req, bsr_ts, bsr_note, req_att) VALUES ($1, $2, current_timestamp, $3, $4)",[bsr_code,bsr_req,bsr_note,req_att]);
}

async function insertBsrQueue(bsr_count,bsr_code,bsr_req,bsr_name,bsr_ts,bsr_length,bsr_note) {
	bsr_count = bsr_count + 1;
	console.log("[BOT] Adding To Active Queue Code:[" + bsr_code + "]-Count:[" + bsr_count + "]-Length:[" + bsr_length + "]-Req:[" + bsr_req + "]-Note:[" + bsr_note + "]");
	const res = await pool.query("INSERT INTO bsrqueue (req_order, bsr_code, bsr_req, bsr_name, bsr_ts, bsr_length, bsr_note) VALUES ($1, $2, $3, $4, $5, $6, $7)",	
		[bsr_count,bsr_code,bsr_req,bsr_name,bsr_ts,bsr_length,bsr_note]);
}

async function moveBsrQueueTop(bsr_code,mtt_req) {
	console.log("[BOT Moving To Top of Active Queue Code:[" + bsr_code + "]-ModRan:[" + mtt_req + "]");
	const res = await pool.query(" UPDATE bsrqueue SET req_order = req_order + 1 WHERE req_order > 0 AND bsr_code != '" + bsr_code + "';");
	const mov = await pool.query(" UPDATE bsrqueue SET req_order = 1 WHERE bsr_code = '" + bsr_code + "';"); 
}

async function insertBsrQueueTop(bsr_count,bsr_code,bsr_req,bsr_name,bsr_ts,bsr_length,bsr_note) {
	console.log("[BOT] Adding To Top of Active Queue Code:[" + bsr_code + "]-Count:[" + bsr_count + "]-Length:[" + bsr_length + "]-Req:[" + bsr_req + "]-Note:[" + bsr_note + "]");
	const res = await pool.query(" UPDATE bsrqueue SET req_order = req_order + 1 WHERE req_order > 0;");
	const mov = await pool.query(" INSERT INTO bsrqueue (req_order, bsr_code, bsr_req, bsr_name, bsr_ts, bsr_length, bsr_note) VALUES ($1, $2, $3, $4, $5, $6, $7)",[1,bsr_code,bsr_req,bsr_name,bsr_ts,bsr_length,bsr_note]);
}

async function getBsrQueueLength(callback) {
	const res = await pool.query("SELECT * FROM bsrqueue");
	callback(res.rowCount);
}

async function getBsrPending(bsr_code, callback) {
	const res = await pool.query("SELECT * FROM bsrpending WHERE bsr_code = $1",[bsr_code]);
	callback(res.rows[0]);
}

async function movePendingToActive(bsr_code,bsr_req) {
	console.log("[BOT] Moving from Pending to Active Code:[" + bsr_code + "]-Req:[" + bsr_req + "]");
	getBsrPending(bsr_code, function(pQueue){
		if (typeof pQueue !== 'undefined' && pQueue !== null) {
			getMapInfo(bsr_code, function(response){
				var mapData = JSON.parse(response)
				console.log(pQueue.bsr_req);
				bsr_name = mapData.name;
				bsr_ts = pQueue.bsr_ts;
				bsr_length = mapData.metadata.duration;
				bsr_note = pQueue.bsr_note;
				getBsrQueueLength( function(bsr_count){
					removeBsrPending(bsr_req);
					if (pQueue.req_att === true) {
						insertBsrQueueTop(bsr_count,bsr_code,bsr_req,bsr_name,bsr_ts,bsr_length,bsr_note);
					} else {
						insertBsrQueue(bsr_count,bsr_code,bsr_req,bsr_name,bsr_ts,bsr_length,bsr_note);
					}
				});
			});
		} else {
			console.log("[BOT] Map with bsr code of [" + bsr_code + "] not found in pending queue.");
		}
	});
}

async function getMapInfo(bsr_code, callback) {
	console.log("[BOT] Getting Map Info from BeatSaver API Code:[" + bsr_code + "]");
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

async function queryBsrQueueByCode(bsr_code, callback) {
	const res = await pool.query("SELECT * FROM bsrqueue WHERE bsr_code = $1", [ bsr_code ]);
	callback( res );
}

async function queryBsrQueueByUsername(bsr_req, callback) {
	const res = await pool.query("SELECT * FROM bsrqueue WHERE bsr_req = $1", [ bsr_req ]);
	callback( res );
}

async function removeBsrPending(bsr_req) {
	console.log("[BOT] Removing from Pending Queue Code:[" + bsr_req + "]");
	const res = await pool.query("DELETE FROM bsrpending WHERE bsr_req = $1", [ bsr_req ]); 
}

async function removeBsrQueue(bsr_code) {
	queryBsrQueueByCode ( bsr_code, async function(by_code){
		console.log("[BOT] Removing from Active Queue Code:[" + bsr_code + "]");
		const res = await pool.query("DELETE FROM bsrqueue WHERE bsr_code = $1", [ bsr_code ]);
		const upd = await pool.query("UPDATE bsrqueue SET req_order = req_order - 1 WHERE req_order > $1", [ by_code.rows[0].req_order ]);
	});
}

async function removeBsrQueueByUser(bsr_req) {
	console.log("[BOT] Removing from Active Queue User:[" + bsr_req + "]");
	const res = await pool.query("DELETE FROM bsrqueue WHERE bsr_req = $1", [ bsr_req ]);
}

run();

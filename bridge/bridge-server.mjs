// PrusaLink bridge for iCUE Prusa Status widget.
// Endpoints: GET /health , POST /data

import http from "node:http";
import crypto from "node:crypto";

const PORT = Number(process.env.PORT) || 37655;
const HOST = "127.0.0.1";
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 60_000;
const UPSTREAM_TIMEOUT_MS = 8000;

/** @type {Map<string, { at: number, payload: object }>} */
const cache = new Map();

function log(...args) {
	console.log(new Date().toISOString(), ...args);
}

function md5(input) {
	return crypto.createHash("md5").update(input).digest("hex");
}

function parseDigestChallenge(header) {
	const params = {};
	const regex = /(\w+)=(?:"([^"]*)"|([^\s,]+))/g;
	let match;
	while ((match = regex.exec(header)) !== null) {
		params[match[1]] = match[2] ?? match[3];
	}
	return params;
}

function buildDigestAuth(method, uri, user, pass, challenge) {
	const realm = challenge.realm || "";
	const nonce = challenge.nonce || "";
	const qop = challenge.qop || "";
	const opaque = challenge.opaque || "";
	const algorithm = (challenge.algorithm || "MD5").toUpperCase();
	const nc = "00000001";
	const cnonce = crypto.randomBytes(8).toString("hex");

	const ha1 = md5(`${user}:${realm}:${pass}`);
	const ha2 = md5(`${method}:${uri}`);
	let response;
	if (qop === "auth" || qop === "auth-int") {
		response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
	} else {
		response = md5(`${ha1}:${nonce}:${ha2}`);
	}

	let header =
		`Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
	if (opaque) header += `, opaque="${opaque}"`;
	if (qop) header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
	if (algorithm) header += `, algorithm=${algorithm}`;
	return header;
}

async function digestFetch(url, method, user, pass) {
	const parsed = new URL(url);
	const uri = parsed.pathname + parsed.search;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

	try {
		const first = await fetch(url, {
			method,
			headers: { Accept: "application/json" },
			signal: controller.signal,
		});

		if (first.status !== 401 && first.status !== 407) {
			clearTimeout(timer);
			return first;
		}

		const wwwAuth = first.headers.get("www-authenticate") || first.headers.get("WWW-Authenticate");
		if (!wwwAuth || !wwwAuth.toLowerCase().startsWith("digest")) {
			clearTimeout(timer);
			return first;
		}

		const challenge = parseDigestChallenge(wwwAuth);
		const authHeader = buildDigestAuth(method, uri, user, pass, challenge);
		const second = await fetch(url, {
			method,
			headers: {
				Accept: "application/json",
				Authorization: authHeader,
			},
			signal: controller.signal,
		});
		clearTimeout(timer);
		return second;
	} catch (err) {
		clearTimeout(timer);
		throw err;
	}
}

function cacheKey(config) {
	return crypto
		.createHash("sha256")
		.update(`${config.printerIp}|${config.apiUser || ""}`)
		.digest("hex")
		.slice(0, 16);
}

function humanizeState(state) {
	if (!state) return "—";
	return String(state)
		.toLowerCase()
		.replace(/_/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDuration(seconds) {
	if (seconds == null || seconds < 0) return "—";
	const total = Math.round(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}h ${m}m`;
	if (m > 0) return `${m}m ${s}s`;
	return `${s}s`;
}

function formatTempValue(value) {
	if (value == null || Number.isNaN(value)) return null;
	const n = Number(value);
	if (Math.abs(n - Math.round(n)) < 0.05) return `${Math.round(n)}°`;
	return `${n.toFixed(1)}°`;
}

function formatTemp(current, target) {
	const cur = formatTempValue(current);
	if (!cur) return "—";
	if (target == null || target <= 0) return cur;
	const tgt = formatTempValue(target);
	return tgt ? `${cur} / ${tgt}` : cur;
}

function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			try {
				const raw = Buffer.concat(chunks).toString("utf8").trim();
				resolve(raw ? JSON.parse(raw) : {});
			} catch {
				reject(new Error("INVALID_JSON"));
			}
		});
		req.on("error", reject);
	});
}

function normalizeIp(ip) {
	return String(ip || "")
		.trim()
		.replace(/^https?:\/\//i, "")
		.replace(/\/+$/, "");
}

function validateConfig(config) {
	const printerIp = normalizeIp(config?.printerIp);
	const apiKey = String(config?.apiKey || "").trim();
	const apiUser = String(config?.apiUser || "").trim();

	if (!printerIp) {
		return { ok: false, error: "MISSING_CONFIG", message: "Printer IP address is required." };
	}
	if (!apiKey) {
		return { ok: false, error: "MISSING_CONFIG", message: "API key is required." };
	}
	return { ok: true, printerIp, apiKey, apiUser };
}

async function fetchPrusa(path, config) {
	const url = `http://${config.printerIp}${path}`;

	try {
		const res = await digestFetch(url, "GET", config.apiUser || "", config.apiKey);

		if (res.status === 401 || res.status === 403) {
			const err = new Error("Authentication failed. Check API key and username.");
			err.code = "AUTH_FAILED";
			throw err;
		}

		if (res.status === 204) {
			return null;
		}

		if (!res.ok) {
			const err = new Error(`Printer returned HTTP ${res.status}`);
			err.code = "PRINTER_ERROR";
			throw err;
		}

		return res.json();
	} catch (err) {
		if (err.code) throw err;
		if (err.name === "AbortError") {
			const timeoutErr = new Error("Printer request timed out.");
			timeoutErr.code = "PRINTER_OFFLINE";
			throw timeoutErr;
		}
		const offlineErr = new Error(err.message || "Could not reach printer.");
		offlineErr.code = "PRINTER_OFFLINE";
		throw offlineErr;
	}
}

function shouldFetchJob(printerState) {
	return ["PRINTING", "PAUSED", "BUSY"].includes(String(printerState || "").toUpperCase());
}

function normalizePayload(status, job) {
	const printer = status?.printer || {};
	const statusJob = status?.job || {};
	const printerStateRaw = printer.state || "";
	const printerState = humanizeState(printerStateRaw);
	const activeJob = job || null;
	const isActive = shouldFetchJob(printerStateRaw);

	const fileName =
		activeJob?.file?.display_name ||
		activeJob?.file?.name ||
		"—";

	const jobState = activeJob?.state ? humanizeState(activeJob.state) : "—";

	const timeRemainingSec =
		activeJob?.time_remaining ??
		statusJob?.time_remaining ??
		null;

	const progressVal = activeJob?.progress ?? statusJob?.progress ?? null;
	let progressPercent = null;
	if (isActive) {
		if (progressVal != null && !Number.isNaN(Number(progressVal))) {
			progressPercent = Math.max(0, Math.min(100, Math.round(Number(progressVal))));
		} else {
			progressPercent = 0;
		}
	}

	const nozzle = formatTemp(printer.temp_nozzle, printer.target_nozzle);
	const bed = formatTemp(printer.temp_bed, printer.target_bed);

	return {
		ok: true,
		fetchedAt: new Date().toISOString(),
		isActive,
		printerState,
		printerStateRaw: String(printerStateRaw).toUpperCase(),
		jobState,
		fileName,
		timeRemaining: formatDuration(timeRemainingSec),
		progressPercent,
		nozzle: nozzle !== "—" ? nozzle : null,
		bed: bed !== "—" ? bed : null,
	};
}

async function fetchData(config) {
	const status = await fetchPrusa("/api/v1/status", config);
	let job = null;

	if (shouldFetchJob(status?.printer?.state)) {
		job = await fetchPrusa("/api/v1/job", config);
	}

	return normalizePayload(status, job);
}

async function getData(config) {
	const key = cacheKey(config);
	const now = Date.now();
	const hit = cache.get(key);

	if (hit && now - hit.at < CACHE_TTL_MS) {
		return { payload: hit.payload, cached: true };
	}

	try {
		const payload = await fetchData(config);
		cache.set(key, { at: now, payload });
		return { payload, cached: false };
	} catch (err) {
		if (hit) {
			log(`fetch failed (${err.message}); serving stale cache`);
			return {
				payload: { ...hit.payload, stale: true, error: err.code || "ERROR" },
				cached: true,
			};
		}
		return {
			payload: {
				ok: false,
				error: err.code || "ERROR",
				message: err.message,
				fetchedAt: new Date().toISOString(),
			},
			cached: false,
		};
	}
}

const cors = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type",
};

const server = http.createServer(async (req, res) => {
	if (req.method === "OPTIONS") {
		res.writeHead(204, cors);
		res.end();
		return;
	}

	const url = new URL(req.url, `http://${HOST}:${PORT}`);

	if (url.pathname === "/health" && req.method === "GET") {
		res.writeHead(200, { "Content-Type": "application/json", ...cors });
		res.end(JSON.stringify({ ok: true, service: "prusa-status-bridge", port: PORT }));
		return;
	}

	if (url.pathname === "/data" && req.method === "POST") {
		let body;
		try {
			body = await readJsonBody(req);
		} catch {
			res.writeHead(400, { "Content-Type": "application/json", ...cors });
			res.end(JSON.stringify({ ok: false, error: "INVALID_JSON", message: "Invalid JSON body." }));
			return;
		}

		const validated = validateConfig(body);
		if (!validated.ok) {
			res.writeHead(400, { "Content-Type": "application/json", ...cors });
			res.end(JSON.stringify(validated));
			return;
		}

		const { payload } = await getData(validated);
		const status = payload.ok === false ? 502 : 200;
		res.writeHead(status, {
			"Content-Type": "application/json",
			"Cache-Control": "no-store",
			...cors,
		});
		res.end(JSON.stringify(payload));
		return;
	}

	res.writeHead(404, { "Content-Type": "application/json", ...cors });
	res.end(JSON.stringify({ ok: false, error: "NOT_FOUND" }));
});

server.listen(PORT, HOST, () => {
	log(`Bridge listening on http://${HOST}:${PORT}`);
	log("Endpoints: POST /data , GET /health");
});

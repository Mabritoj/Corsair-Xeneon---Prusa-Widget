"use strict";

var FETCH_TIMEOUT_MS = 8000;

var DEFAULTS = {
	printerName: "",
	printerIp: "",
	apiKey: "",
	apiUser: "",
	bridgePort: "37655",
	pollSeconds: "30",
	accentColor: "#FA6831",
	textColor: "#F5F4F2",
	backgroundColor: "#1B1A19",
};

var FONT_MIN_PX = 11;
var FONT_MAX_PX = 24;

var STATE_CLASS = {
	PRINTING: "state-printing",
	BUSY: "state-printing",
	PAUSED: "state-paused",
	ERROR: "state-error",
	STOPPED: "state-error",
	IDLE: "state-idle",
	READY: "state-idle",
	FINISHED: "state-idle",
	ATTENTION: "state-paused",
};

var state = {
	data: null,
	pollTimer: null,
	started: false,
	resizeObserver: null,
};

function prop(name) {
	try {
		if (typeof window !== "undefined" && Object.prototype.hasOwnProperty.call(window, name)) {
			var windowValue = window[name];
			if (windowValue !== undefined && windowValue !== null && windowValue !== "") {
				return String(windowValue).trim();
			}
		}
	} catch (e) {}
	try {
		var globalValue = Function('return typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined')();
		if (globalValue !== undefined && globalValue !== null && globalValue !== "") {
			return String(globalValue).trim();
		}
	} catch (e2) {}
	var fallback = DEFAULTS[name];
	return fallback !== undefined && fallback !== null ? fallback : "";
}

function getDisplayName() {
	var name = prop("printerName");
	return name || "Prusa Printer";
}

function $(id) {
	return document.getElementById(id);
}

function applyHeader() {
	var displayName = $("display-name");
	if (displayName) displayName.textContent = getDisplayName();
}

function applyTheme() {
	var root = document.documentElement.style;
	root.setProperty("--accent", prop("accentColor"));
	root.setProperty("--text", prop("textColor"));
	root.setProperty("--bg", prop("backgroundColor"));
	applyHeader();
}

function getPollMs() {
	var n = parseInt(String(prop("pollSeconds")).replace(/[^0-9]/g, ""), 10);
	if (isNaN(n)) n = parseInt(DEFAULTS.pollSeconds, 10);
	n = Math.max(10, Math.min(3600, n));
	return n * 1000;
}

function setStatusChip(kind, title) {
	var chip = $("status-chip");
	if (!chip) return;
	chip.className = "status-chip status-" + kind;
	chip.textContent = kind === "online" ? "Live" : kind === "stale" ? "Cached" : "Offline";
	chip.title = title || "";
}

function showMessage(text) {
	var msg = $("message");
	msg.textContent = text;
	msg.classList.remove("hidden");
}

function hideMessage() {
	$("message").classList.add("hidden");
}

function stateBadgeClass(raw) {
	var key = String(raw || "IDLE").toUpperCase();
	return STATE_CLASS[key] || "state-idle";
}

function setText(id, value, title) {
	var el = $(id);
	if (!el) return;
	el.textContent = value || "—";
	if (title !== undefined) el.title = title || "";
}

function updateProgress(percent, isActive) {
	var bar = $("progress-bar");
	var fill = $("progress-fill");
	var label = $("progress-label");
	var widget = $("widget");
	var show = isActive || percent != null;

	if (widget) {
		if (show) widget.classList.add("has-progress");
		else widget.classList.remove("has-progress");
	}

	if (!show) {
		if (bar) bar.classList.add("hidden");
		if (fill) fill.style.width = "0%";
		if (label) label.textContent = "";
		return;
	}

	var width = percent != null ? Math.max(0, Math.min(100, percent)) : 0;

	if (bar) bar.classList.remove("hidden");
	if (fill) fill.style.width = width + "%";
	if (label) label.textContent = percent != null ? width + "%" : "";
}

function render(data) {
	state.data = data;

	applyHeader();

	var badge = $("state-badge");
	var displayState = data.jobState && data.jobState !== "—" ? data.jobState : data.printerState;
	if (badge) {
		badge.textContent = displayState || "—";
		badge.className = "state-badge " + stateBadgeClass(data.printerStateRaw);
	}

	var fileName = data.fileName || "—";
	setText("file-name", fileName, fileName !== "—" ? fileName : "");
	setText("time-left", data.timeRemaining || "—");
	setText("nozzle-temp", data.nozzle || "—");
	setText("bed-temp", data.bed || "—");
	updateProgress(data.progressPercent, data.isActive || data.progressPercent != null);

	setStatusChip(data.stale ? "stale" : "online", data.stale ? "Cached data" : "Live");
	$("widget").classList.remove("dim");
	hideMessage();
	fitFont();
}

function handleFailure(text) {
	setStatusChip("offline", text.split("\n")[0]);
	if (state.data) $("widget").classList.add("dim");
	updateProgress(null, false);
	showMessage(text);
}

function probeBridgeHealth(port, done) {
	fetch("http://127.0.0.1:" + port + "/health", { cache: "no-store" })
		.then(function (res) {
			return res.json().catch(function () {
				return null;
			});
		})
		.then(function (health) {
			done(health);
		})
		.catch(function () {
			done(null);
		});
}

function explainBridgeError(port, payload, done) {
	if (payload && payload.error !== "NOT_FOUND") {
		done("Unavailable\n" + (payload.message || payload.error || ""));
		return;
	}

	probeBridgeHealth(port, function (health) {
		if (!health) {
			done("Bridge offline\nStart bridge/start-bridge.ps1 on your PC.");
			return;
		}
		if (health.service && health.service !== "prusa-status-bridge") {
			done(
				"Wrong bridge on port " +
					port +
					"\nFound " +
					health.service +
					". Start bridge/start-bridge.ps1 (default port 37655) and set Bridge Port to match."
			);
			return;
		}
		done("Unavailable\n" + (payload && (payload.message || payload.error) ? payload.message || payload.error : "Bridge endpoint not found."));
	});
}

function poll() {
	var port = String(prop("bridgePort")).replace(/[^0-9]/g, "") || DEFAULTS.bridgePort;
	var printerIp = prop("printerIp");
	var apiKey = prop("apiKey");
	var apiUser = prop("apiUser");

	if (!printerIp || !apiKey) {
		handleFailure("Configure printer\nSet Printer IP and API Key in widget settings.");
		return;
	}

	var url = "http://127.0.0.1:" + port + "/data";
	var controller = new AbortController();
	var to = setTimeout(function () {
		controller.abort();
	}, FETCH_TIMEOUT_MS);

	fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			printerIp: printerIp,
			apiKey: apiKey,
			apiUser: apiUser,
		}),
		signal: controller.signal,
		cache: "no-store",
	})
		.then(function (res) {
			return res.json().catch(function () {
				return null;
			});
		})
		.then(function (payload) {
			clearTimeout(to);
			if (!payload) {
				handleFailure("Unavailable\nUnexpected response from bridge.");
				return;
			}
			if (payload.ok === false) {
				explainBridgeError(port, payload, handleFailure);
				return;
			}
			render(payload);
		})
		.catch(function () {
			clearTimeout(to);
			handleFailure("Bridge offline\nStart bridge/start-bridge.ps1 on your PC.");
		});
}

function startPolling() {
	if (state.pollTimer) clearInterval(state.pollTimer);
	state.pollTimer = setInterval(poll, getPollMs());
}

function fitFont() {
	var widget = $("widget");
	if (!widget) return;
	var rootStyle = document.documentElement.style;
	var size = Math.min(FONT_MAX_PX, Math.max(FONT_MIN_PX, widget.clientWidth / 24));
	rootStyle.fontSize = size + "px";
	while (size > FONT_MIN_PX && widget.scrollHeight > widget.clientHeight + 1) {
		size -= 0.5;
		rootStyle.fontSize = size + "px";
	}
}

function observeResize() {
	if (state.resizeObserver) return;
	var widget = $("widget");
	if (!widget) return;
	if (typeof ResizeObserver !== "undefined") {
		state.resizeObserver = new ResizeObserver(function () {
			fitFont();
		});
		state.resizeObserver.observe(widget);
	} else {
		window.addEventListener("resize", fitFont);
	}
	fitFont();
}

function start() {
	if (!state.started) {
		state.started = true;
		observeResize();
		startPolling();
	}
	applyTheme();
	poll();
}

function onDataUpdated() {
	applyTheme();
	poll();
	startPolling();
}

window.PrusaWidget = { start: start, onDataUpdated: onDataUpdated };

window.onerror = function (message, source, line, col) {
	console.error("js:", message, line + ":" + col);
};

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", function () {
		start();
	});
} else {
	start();
}

if (typeof iCUE_initialized !== "undefined" && iCUE_initialized) {
	start();
}

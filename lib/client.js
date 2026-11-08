window.__ModuleLoader__.load({
	id: "@kewen/dsh-voice",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_dom = require("react-dom");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/pacing.ts
		/**
		* 跟读的节奏：什么时候把一步的文字交出去，一轮最多念多少字。
		*
		* 单独放一个文件、不 import 别的模块：Node 能直接跑测试。
		*/
		const ENDERS = "。！？!?；;…";
		/** 句末标点后面紧跟的收尾符号（引号、括号），算在这句里。 */
		const CLOSERS = "\"'”’）)」』】";
		/** 把可念文字切成一句一句（保留标点）。英文句号后面跟数字或小写字母的不算句末（1.5、a.b）。 */
		function splitSentences(text) {
			const out = [];
			let start = 0;
			let i = 0;
			while (i < text.length) {
				const ch = text[i];
				const next = text[i + 1];
				if (!(ENDERS.includes(ch) || ch === "." && (next === void 0 || !/[0-9a-z]/.test(next)))) {
					i++;
					continue;
				}
				let end = i + 1;
				while (end < text.length && (ENDERS.includes(text[end]) || text[end] === "." || CLOSERS.includes(text[end]))) end++;
				out.push(text.slice(start, end));
				start = end;
				i = end;
			}
			if (start < text.length) out.push(text.slice(start));
			return out.filter((s) => s.trim() !== "");
		}
		/**
		* 这一步的文字现在能不能交出去。
		* 边写边念：随时都行。整段念：等这一步写完，或者开始调工具（工具前说的话先念）。
		*/
		function stepReady(whole, step) {
			return !whole || step.done || step.flush;
		}
		/** 一轮最多念多少字。超过上限的那句照样念完，再往后的不念。 */
		var TurnBudget = class {
			spent = 0;
			/**
			* 从一段可念文字里取出还能念的部分。
			* @param limit 上限，0 表示不限。
			* @returns text 能念的部分（可能是空串）；over 是不是已经念到上限、后面的被截掉了。
			*/
			take(piece, limit) {
				if (piece === "") return {
					text: "",
					over: false
				};
				if (limit <= 0) {
					this.spent += piece.length;
					return {
						text: piece,
						over: false
					};
				}
				let text = "";
				for (const sentence of splitSentences(piece)) {
					if (this.spent >= limit) return {
						text,
						over: true
					};
					this.spent += sentence.length;
					text += sentence;
				}
				return {
					text,
					over: false
				};
			}
			reset() {
				this.spent = 0;
			}
		};
		//#endregion
		//#region src/client/speakify.ts
		/**
		* 把正在流式写出的 Markdown 回复，一段一段转成适合念出来的文字。
		*
		* - 整行写完，或者行内出现句末标点（。！？等）时就交出去，不用等整条回复写完。
		* - 代码块换成「代码见屏幕。」，表格换成「表格见屏幕。」，各只说一次。
		* - 链接只念文字，裸网址念「链接」，去掉标题、列表、加粗等符号。
		* - 行内代码：短的照念（比如 useEffect），路径只念文件名，长的念「代码」。
		* - 主代理出错重试、把这一步重写时，已经念过的句子不再念，从说法变了的那句接着念。
		*
		* 只用可擦除的 TypeScript 语法，Node 可以直接跑测试。
		*/
		/** 句末标点：念到这里可以先交出去。 */
		const SENTENCE_END = /[。！？!?；;…]|\.(?=\s)/g;
		/** text[i] 是不是一句话的结尾。英文句号后面跟数字或小写字母的不算（1.5、a.b）。 */
		function endsSentence(text, i) {
			const ch = text[i];
			if (ch === void 0) return false;
			if ("。！？!?；;…".includes(ch)) return true;
			if (ch !== ".") return false;
			const next = text[i + 1];
			return next === void 0 || !/[0-9a-z]/.test(next);
		}
		var Speakify = class {
			/** 原文里已经处理过的长度。 */
			consumed = 0;
			/** 当前在不在 ``` 代码块里。 */
			inFence = false;
			/** 当前这个代码块有没有说过「代码见屏幕」。 */
			fenceAnnounced = false;
			/** 上一行是不是表格行（连续的表格只说一次）。 */
			inTable = false;
			/** 当前行前面一部分已经交出去了（只处理了行首符号一次）。 */
			midLine = false;
			/** 已经处理过的那段原文（用来发现原文被重写了）。 */
			source = "";
			/** 这一遍交出的全部可念文字（包括重写后跳过没念的）。 */
			said = "";
			/** 重写之前，听的人已经听到的内容。 */
			heard = "";
			/** 重写后还在跳过已经念过的部分。 */
			replaying = false;
			/**
			* 喂入到目前为止的完整原文，返回新增的可念文字（可能是空串）。
			* @param raw 到目前为止的完整原文。通常只会变长；开头和之前不一样了（主代理出错重试、把这一步重写了），
			*   就从头再处理一遍，但已经念过的句子不再交出去。
			* @param final 原文不会再变了，把剩下的半行也交出去。
			*/
			push(raw, final = false) {
				if (!raw.startsWith(this.source)) this.rewrite();
				let out = "";
				while (this.consumed < raw.length) {
					const rest = raw.slice(this.consumed);
					const newline = rest.indexOf("\n");
					if (newline >= 0) {
						out += this.emit(this.piece(rest.slice(0, newline), true));
						this.consumed += newline + 1;
						continue;
					}
					if (final) {
						out += this.emit(this.piece(rest, true));
						this.consumed = raw.length;
						break;
					}
					const cut = this.sentenceCut(rest);
					if (cut <= 0) break;
					out += this.emit(this.piece(rest.slice(0, cut), false));
					this.consumed += cut;
				}
				this.source = raw.slice(0, this.consumed);
				return out;
			}
			/** 从头处理一段新的原文（念过什么也一起忘掉）。 */
			reset() {
				this.restartParse();
				this.source = "";
				this.said = "";
				this.heard = "";
				this.replaying = false;
			}
			restartParse() {
				this.consumed = 0;
				this.inFence = false;
				this.fenceAnnounced = false;
				this.inTable = false;
				this.midLine = false;
			}
			/** 原文被重写了：从头再处理一遍，先跳过听的人已经听过的部分。 */
			rewrite() {
				if (!this.replaying) this.heard = this.said;
				this.replaying = this.heard !== "";
				this.said = "";
				this.source = "";
				this.restartParse();
			}
			/** 交出一段可念文字。重写之后，已经念过的部分不再交出，从说法变了的那句话开头接着念。 */
			emit(text) {
				if (text === "") return "";
				const start = this.said.length;
				this.said += text;
				if (!this.replaying) return text;
				if (this.heard.startsWith(this.said)) return "";
				this.replaying = false;
				let same = start;
				const limit = Math.min(this.said.length, this.heard.length);
				while (same < limit && this.said[same] === this.heard[same]) same++;
				if (same >= this.heard.length) return this.said.slice(same);
				let from = same;
				while (from > start && !endsSentence(this.said, from - 1)) from--;
				return this.said.slice(from);
			}
			/** 半行里最后一个能安全断开的位置（句末标点之后），0 表示还不能断。 */
			sentenceCut(partial) {
				if (this.inFence) return 0;
				if (!this.midLine) {
					const head = partial.trimStart();
					if (head.startsWith("`") || head.startsWith("|") || head === "" || head.startsWith("~")) return 0;
				}
				let cut = 0;
				SENTENCE_END.lastIndex = 0;
				for (const match of partial.matchAll(SENTENCE_END)) {
					const end = (match.index ?? 0) + match[0].length;
					const before = partial.slice(0, end);
					if ((before.match(/`/g)?.length ?? 0) % 2 === 1) continue;
					if ((before.match(/\[/g)?.length ?? 0) > (before.match(/\]/g)?.length ?? 0)) continue;
					if ((before.match(/\(/g)?.length ?? 0) > (before.match(/\)/g)?.length ?? 0)) continue;
					cut = end;
				}
				return cut;
			}
			/** 处理一段文字。lineEnd 为 true 表示这段之后就是换行（或全文结束）。 */
			piece(text, lineEnd) {
				let body;
				if (this.midLine) body = inline(text);
				else body = this.block(text);
				this.midLine = !lineEnd;
				if (body === null) return "";
				body = body.trim();
				if (body === "") return "";
				if (lineEnd && !/[。！？!?；;…，,：:、.]$/.test(body)) body += "。";
				return body;
			}
			/** 行首的块级语法。返回 null 表示这一行不念。 */
			block(line) {
				const trimmed = line.trim();
				if (/^(```|~~~)/.test(trimmed)) {
					if (this.inFence) {
						this.inFence = false;
						return null;
					}
					this.inFence = true;
					this.inTable = false;
					if (this.fenceAnnounced) return null;
					this.fenceAnnounced = true;
					return "代码见屏幕。";
				}
				if (this.inFence) return null;
				this.fenceAnnounced = false;
				if (trimmed === "") {
					this.inTable = false;
					return null;
				}
				if (trimmed.startsWith("|")) {
					if (this.inTable) return null;
					this.inTable = true;
					return "表格见屏幕。";
				}
				this.inTable = false;
				if (/^([-*_]\s*){3,}$/.test(trimmed)) return null;
				let content = trimmed.replace(/^>+\s*/, "").replace(/^#{1,6}\s+/, "").replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "").replace(/^\d+[.)]\s+/, "");
				content = inline(content);
				return content;
			}
		};
		/** 行内语法：链接、网址、代码、强调、HTML。 */
		function inline(text) {
			return text.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt) => alt.trim() === "" ? "图片" : alt).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/<https?:\/\/[^>]+>/g, "链接").replace(/https?:\/\/[^\s)）\]，。]+/g, "链接").replace(/`([^`]+)`/g, (_m, code) => speakCode(code)).replace(/\*\*([^*]+)\*\*/g, "$1").replace(/__([^_]+)__/g, "$1").replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?!\w)/g, "$1$2").replace(/~~([^~]+)~~/g, "$1").replace(/<\/?[a-zA-Z][^>]*>/g, "").replace(/[*`]/g, "");
		}
		/** 行内代码念法：路径只念文件名，短标识照念，长的念「代码」。 */
		function speakCode(code) {
			const value = code.trim();
			if (value === "") return "";
			if (/[/\\]/.test(value)) {
				const tail = value.split(/[/\\]/).filter(Boolean).at(-1) ?? "";
				return tail !== "" && tail.length <= 40 ? tail : "代码";
			}
			if (value.length <= 32 && !/[{};=<>]/.test(value)) return value;
			return "代码";
		}
		//#endregion
		//#region src/client/settings.ts
		/**
		* 朗读设置（音色、模型、每轮最多念多少字）：存在服务端（~/.config/dsh-voice/voice-reply.json），
		* 电脑和手机打开的是同一份。这里缓存一份，给设置页和跟读用。
		*/
		const BASE$4 = "/voice-reply";
		/** 设置还没读到时的每轮字数上限（和服务端默认一致）。 */
		const DEFAULT_TURN_LIMIT = 800;
		const DEFAULT_CALL_SILENCE_MS = 1200;
		let state = {
			view: null,
			error: null
		};
		let loading = null;
		let saveQueue = Promise.resolve();
		let pendingRate;
		let rateRevision = 0;
		let confirmedRate;
		const listeners$2 = /* @__PURE__ */ new Set();
		function set(next) {
			state = next;
			for (const listener of listeners$2) listener();
		}
		async function request(init, path = "/settings") {
			const res = await fetch(`${BASE$4}${path}`, {
				credentials: "same-origin",
				...init
			});
			let data;
			try {
				data = await res.json();
			} catch {
				data = void 0;
			}
			if (!res.ok) {
				const error = data?.error;
				throw new Error(typeof error === "string" ? error : `HTTP ${res.status}`);
			}
			return data;
		}
		function acceptView(view) {
			confirmedRate = view.settings.speechRate;
			return pendingRate === void 0 ? view : {
				...view,
				settings: {
					...view.settings,
					speechRate: pendingRate.value
				}
			};
		}
		/** 读设置（读过就用缓存，fresh 为 true 时重读）。失败不抛错，原因放在 useSettings().error。 */
		function loadSettings(fresh = false) {
			if (loading !== null) return loading;
			if (state.view !== null && !fresh) return Promise.resolve();
			const run = (async () => {
				try {
					set({
						view: acceptView(await request()),
						error: null
					});
				} catch (error) {
					set({
						view: state.view,
						error: error instanceof Error ? error.message : String(error)
					});
				} finally {
					loading = null;
				}
			})();
			loading = run;
			return run;
		}
		/** 改一部分设置。失败时抛错（带原因）。 */
		function saveSettings(patch) {
			const result = saveQueue.then(async () => {
				const view = acceptView(await request({
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(patch)
				}));
				set({
					view,
					error: null
				});
				return view;
			});
			saveQueue = result.then(() => {}, () => {});
			return result;
		}
		/** 保存百炼 Key，与其他设置共用队列；服务端只返回不含 Key 的设置视图。 */
		function saveApiKey(key) {
			const result = saveQueue.then(async () => {
				const view = acceptView(await request({
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ key })
				}, "/key"));
				set({
					view,
					error: null
				});
				return view;
			});
			saveQueue = result.then(() => {}, () => {});
			return result;
		}
		/** 当前的每轮字数上限，0 表示不限。 */
		function turnLimit() {
			return state.view?.settings.turnLimit ?? DEFAULT_TURN_LIMIT;
		}
		/** 语音通话停顿多久算说完（毫秒）。 */
		function callSilenceMs() {
			return state.view?.settings.callSilenceMs ?? DEFAULT_CALL_SILENCE_MS;
		}
		/** 语音通话里能不能说话打断朗读（默认关：外放时麦克风会录到朗读）。 */
		function callBargeIn() {
			return state.view?.settings.callBargeIn === true;
		}
		/** 语音通话里要不要听语气判断说完没有（smart-turn，默认关）。 */
		function callSmartTurn() {
			return state.view?.settings.callSmartTurn === true;
		}
		/** 语音通话的收音灵敏度（默认中档）。 */
		function callSensitivity() {
			return state.view?.settings.callSensitivity ?? "medium";
		}
		/** 语音通话锁屏、切到后台后继续（默认关：暂停，回来点一下继续）。 */
		function callKeepOnLock() {
			return state.view?.settings.callKeepOnLock === true;
		}
		/**
		* 语音通话用不用人声模型：服务端有模型文件（给了 vadVersion）且设置没关掉，返回版本号；否则 undefined。
		* 默认开。
		*/
		function callVoiceModel() {
			const view = state.view;
			if (typeof view?.vadVersion !== "string" || view.settings.callVoiceModel === false) return void 0;
			return view.vadVersion;
		}
		/** 语音通话用百炼识别（默认关：用官方本机 SenseVoice）。 */
		function callCloudAsr() {
			return state.view?.settings.callCloudAsr === true;
		}
		/** 当前朗读语速；服务端不支持（旧版）时 undefined，朗读就不带这个参数。 */
		function speechRate() {
			const rate = state.view?.settings.speechRate;
			return typeof rate === "number" ? rate : void 0;
		}
		/**
		* 换语速：先改本地缓存（按钮马上变、下一段朗读马上用上），再存到服务端。
		* 存失败就退回原来的值，并把原因抛出去。
		*/
		async function changeSpeechRate(rate) {
			const view = state.view;
			if (view === null) return;
			const revision = ++rateRevision;
			pendingRate = {
				value: rate,
				revision
			};
			set({
				view: {
					...view,
					settings: {
						...view.settings,
						speechRate: rate
					}
				},
				error: null
			});
			try {
				await saveSettings({ speechRate: rate });
				if (pendingRate?.revision === revision) pendingRate = void 0;
			} catch (error) {
				if (pendingRate?.revision === revision) {
					pendingRate = void 0;
					const now = state.view;
					if (now !== null) set({
						view: {
							...now,
							settings: {
								...now.settings,
								speechRate: confirmedRate
							}
						},
						error: error instanceof Error ? error.message : String(error)
					});
				}
				throw error;
			}
		}
		/** 语速显示成「1.25×」这样。 */
		function formatRate(rate) {
			return `${rate}×`;
		}
		/** 跟读时每一步整段写完再念（默认关：边写边念）。 */
		function speakWhole() {
			return state.view?.settings.speakWhole === true;
		}
		function subscribeSettings(listener) {
			listeners$2.add(listener);
			return () => listeners$2.delete(listener);
		}
		function getSettingsState() {
			return state;
		}
		function useSettings() {
			return (0, react.useSyncExternalStore)(subscribeSettings, getSettingsState, getSettingsState);
		}
		//#endregion
		//#region src/client/speaker.ts
		/**
		* 浏览器端播放：每段朗读（Utterance）对应服务端一个 utterance，
		* 文字用 POST 发过去，音频从 GET /voice-reply/audio 分帧流回来，用 Web Audio 接着播。
		* 多段朗读按开始的先后排队播，不会叠在一起。
		*
		* 手机浏览器只在用户点按的那一下里允许创建或恢复播放（AudioContext）。
		* 语音模式开着时，页面上每次点按都顺手解锁（installUnlock）；
		* 声音被拦住（没点按过、来电或切到后台之后）超过一小会儿，blocked 变成 true，开关提示「轻点开启声音」。
		*/
		const BASE$3 = "/voice-reply";
		const SAMPLE_RATE = 24e3;
		/** 一段新声音开始前留一点余量，吸收网络抖动。 */
		const LEAD_IN_S = .08;
		/** 声音被拦住超过这么久才提示，免得正常恢复的那一瞬间闪一下。 */
		const BLOCKED_HINT_MS = 600;
		/** 回声判断看最近这么久念过的字。 */
		const RECENT_MS = 3e4;
		/** 打断时朗读压到原来的多少。 */
		const DUCK_GAIN = .25;
		const FRAME_PCM = 1;
		const FRAME_ERROR = 2;
		const FRAME_END = 3;
		/** 只有这些事件算用户手势：手指按下（pointerdown）不算，抬起才算。 */
		const GESTURE_EVENTS = [
			"pointerup",
			"touchend",
			"click",
			"keydown"
		];
		async function post(path, body) {
			const res = await fetch(`${BASE$3}/${path}`, {
				method: "POST",
				credentials: "same-origin",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				let message = `HTTP ${res.status}`;
				try {
					const data = await res.json();
					if (typeof data.error === "string") message = data.error;
				} catch {}
				throw new Error(message);
			}
		}
		/** crypto.randomUUID 只在安全上下文里有（手机用局域网 http 访问时没有），退回 getRandomValues。 */
		function newId() {
			if (typeof crypto.randomUUID === "function" && window.isSecureContext) return crypto.randomUUID();
			const bytes = crypto.getRandomValues(/* @__PURE__ */ new Uint8Array(16));
			return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
		}
		var Utterance = class {
			tag;
			speaker;
			id = newId();
			/** 解码好、还没排进播放的声音。 */
			chunks = [];
			/** 音频流结束了（念完、出错或取消）。 */
			ended = false;
			cancelled = false;
			failed = false;
			finished = false;
			leftover = null;
			chain;
			pendingText = "";
			flushQueued = false;
			abort = new AbortController();
			constructor(tag, speaker, options = {}) {
				this.tag = tag;
				this.speaker = speaker;
				const rate = options.speechRate ?? speechRate();
				this.chain = post("open", {
					id: this.id,
					...options,
					...rate === void 0 ? {} : { speechRate: rate }
				}).then(() => {
					this.listen();
				}, (error) => {
					this.fail(error);
				});
			}
			/** 追加要念的文字。连续多次调用会合并成一个请求。 */
			append(text) {
				if (text === "" || this.cancelled || this.finished) return;
				this.speaker.remember(text);
				this.pendingText += text;
				if (this.flushQueued) return;
				this.flushQueued = true;
				this.step(async () => {
					this.flushQueued = false;
					const text = this.pendingText;
					this.pendingText = "";
					if (text !== "") await post("append", {
						id: this.id,
						text
					});
				});
			}
			/** 没有更多文字了。 */
			finish() {
				if (this.cancelled || this.finished) return;
				this.finished = true;
				this.step(() => post("finish", { id: this.id }));
			}
			cancel() {
				if (this.cancelled) return;
				this.cancelled = true;
				this.ended = true;
				this.chunks = [];
				this.abort.abort();
				this.chain = this.chain.then(() => post("cancel", { id: this.id })).catch(() => {});
			}
			step(run) {
				this.chain = this.chain.then(async () => {
					if (this.failed || this.cancelled) return;
					try {
						await run();
					} catch (error) {
						this.fail(error);
					}
				});
			}
			fail(error) {
				if (this.cancelled) return;
				this.failed = true;
				this.ended = true;
				this.speaker.reportError(error instanceof Error ? error.message : String(error));
				this.speaker.pump();
			}
			async listen() {
				try {
					const res = await fetch(`${BASE$3}/audio?id=${encodeURIComponent(this.id)}`, {
						credentials: "same-origin",
						signal: this.abort.signal
					});
					if (!res.ok || res.body === null) throw new Error(`取音频失败：HTTP ${res.status}`);
					const reader = res.body.getReader();
					let buffer = /* @__PURE__ */ new Uint8Array(0);
					for (;;) {
						const { value, done } = await reader.read();
						if (done) break;
						const merged = new Uint8Array(buffer.length + value.length);
						merged.set(buffer);
						merged.set(value, buffer.length);
						buffer = merged;
						let offset = 0;
						while (buffer.length - offset >= 5) {
							const view = new DataView(buffer.buffer, buffer.byteOffset + offset);
							const type = view.getUint8(0);
							const length = view.getUint32(1);
							if (buffer.length - offset - 5 < length) break;
							const payload = buffer.subarray(offset + 5, offset + 5 + length);
							offset += 5 + length;
							if (type === FRAME_PCM) this.pushPcm(payload);
							else if (type === FRAME_ERROR) {
								let message = "语音合成出错";
								try {
									const data = JSON.parse(new TextDecoder().decode(payload));
									if (typeof data.message === "string") message = data.message;
								} catch {}
								this.fail(new Error(message));
							} else if (type === FRAME_END) {}
						}
						buffer = buffer.slice(offset);
					}
				} catch (error) {
					if (!this.cancelled) this.fail(error);
				} finally {
					this.ended = true;
					this.speaker.pump();
				}
			}
			/** 16 位小端 PCM 转成 Float32；帧之间可能把一个采样拆开，留着拼下一帧。 */
			pushPcm(bytes) {
				if (this.cancelled || bytes.length === 0) return;
				let data = bytes;
				if (this.leftover !== null) {
					const joined = new Uint8Array(bytes.length + 1);
					joined[0] = this.leftover;
					joined.set(bytes, 1);
					data = joined;
					this.leftover = null;
				}
				const whole = data.length - data.length % 2;
				if (whole < data.length) this.leftover = data[data.length - 1] ?? null;
				const samples = new Float32Array(whole / 2);
				const view = new DataView(data.buffer, data.byteOffset, whole);
				for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
				if (samples.length === 0) return;
				this.chunks.push(samples);
				this.speaker.clearError();
				this.speaker.pump();
			}
		};
		var Speaker = class {
			/** 每次 stopAll 加一，跟读的人据此知道被打断了。 */
			stops = 0;
			lastError = null;
			/** 有声音在等着播，但浏览器还没允许出声（要用户点一下）。 */
			blocked = false;
			context;
			master;
			analyser;
			meterBuffer;
			recent = [];
			queue = [];
			playing = /* @__PURE__ */ new Map();
			nextTime = 0;
			listeners = /* @__PURE__ */ new Set();
			version = 0;
			unlockInstalled = false;
			blockedTimer;
			/**
			* 开始一段朗读。tag 用来标记来源（比如哪条回复），按钮据此显示「正在念」。
			* options 临时指定音色、模型（试听用），不给就用设置里的。
			*/
			start(tag, options) {
				const u = new Utterance(tag, this, options);
				this.queue.push(u);
				this.notify();
				return u;
			}
			/** 把能播的声音排进时间线：排在最前的那段念完（流结束）才轮到下一段。 */
			pump() {
				while (this.queue.length > 0) {
					const head = this.queue[0];
					if (head.cancelled) {
						this.queue.shift();
						continue;
					}
					const ctx = this.ensureContext();
					if (ctx === void 0) {
						head.cancel();
						this.queue.shift();
						this.lastError = "这个浏览器不能播放声音";
						continue;
					}
					for (const samples of head.chunks.splice(0)) this.schedule(ctx, samples, head.tag);
					if (!head.ended) break;
					this.queue.shift();
				}
				this.notify();
			}
			schedule(ctx, samples, tag) {
				const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
				buffer.getChannelData(0).set(samples);
				const source = ctx.createBufferSource();
				source.buffer = buffer;
				source.connect(this.output(ctx));
				const now = ctx.currentTime;
				const start = this.playing.size === 0 || this.nextTime < now ? now + LEAD_IN_S : this.nextTime;
				source.start(start);
				this.nextTime = start + buffer.duration;
				this.playing.set(source, tag);
				source.onended = () => {
					this.playing.delete(source);
					this.notify();
				};
			}
			ensureContext() {
				if (this.context === void 0) {
					try {
						this.context = new AudioContext({ sampleRate: SAMPLE_RATE });
					} catch {
						try {
							this.context = new AudioContext();
						} catch {
							return;
						}
					}
					this.context.addEventListener("statechange", () => this.notify());
				}
				const state = this.context.state;
				if (state !== "running" && state !== "closed") this.context.resume().catch(() => {});
				return this.context;
			}
			/**
			* 页面上每次点按都顺手解锁播放。听抬起类事件和按键（只有它们算用户手势）；
			* 解锁后不摘掉，来电、切后台被系统停掉之后，下一次点按还能恢复。
			* @param wanted 还没建过播放时要不要建：语音模式关着就不建，免得白白占用手机的声音通道。
			*/
			installUnlock(wanted = () => true) {
				if (this.unlockInstalled) return () => {};
				this.unlockInstalled = true;
				const onGesture = () => {
					if (this.context === void 0 && !wanted()) return;
					if (this.context?.state === "running") return;
					this.unlock();
				};
				const onVisible = () => {
					if (document.visibilityState !== "visible" || this.context === void 0) return;
					if (this.context.state !== "running") this.context.resume().catch(() => {});
				};
				for (const type of GESTURE_EVENTS) window.addEventListener(type, onGesture, {
					capture: true,
					passive: true
				});
				document.addEventListener("visibilitychange", onVisible);
				return () => {
					for (const type of GESTURE_EVENTS) window.removeEventListener(type, onGesture, { capture: true });
					document.removeEventListener("visibilitychange", onVisible);
					this.unlockInstalled = false;
				};
			}
			/** 在用户点按里调用：创建或恢复播放，之后自动朗读才能出声。 */
			unlock() {
				const ctx = this.ensureContext();
				if (ctx === void 0 || ctx.state === "running") return;
				try {
					const source = ctx.createBufferSource();
					source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
					source.connect(ctx.destination);
					source.start();
				} catch {}
			}
			/** 立刻停下所有朗读（正在播的和还在合成的）。 */
			stopAll() {
				this.stops++;
				for (const u of this.queue) u.cancel();
				this.queue = [];
				for (const source of this.playing.keys()) {
					source.onended = null;
					try {
						source.stop();
					} catch {}
				}
				this.playing.clear();
				this.nextTime = 0;
				this.notify();
			}
			/** 有没有在念（tag 不给就是任何一段）。还在合成、没出声的也算。 */
			isSpeaking(tag) {
				for (const u of this.queue) if (!u.cancelled && (tag === void 0 || u.tag === tag)) return true;
				for (const playingTag of this.playing.values()) if (tag === void 0 || playingTag === tag) return true;
				return false;
			}
			/** 有没有 tag 以 prefix 开头的那一类在念（如自动朗读的 `turn:`）。 */
			isSpeakingPrefix(prefix) {
				for (const u of this.queue) if (!u.cancelled && u.tag.startsWith(prefix)) return true;
				for (const playingTag of this.playing.values()) if (playingTag.startsWith(prefix)) return true;
				return false;
			}
			/** 已经有声音排进播放了（不只是还在合成）。通话里思考音据此在第一句出声时停。 */
			/** 记一下念过的字（通话里判断麦克风录到的是不是朗读的回声）。 */
			remember(text) {
				const now = Date.now();
				this.recent.push({
					at: now,
					text
				});
				while (this.recent.length > 0 && now - this.recent[0].at > RECENT_MS) this.recent.shift();
			}
			/** 最近 RECENT_MS 里念过的字。 */
			recentText() {
				const now = Date.now();
				return this.recent.filter((r) => now - r.at <= RECENT_MS).map((r) => r.text).join("");
			}
			/** 通话里用户开口打断时，先把朗读压小；识别完再恢复或停掉。 */
			duck(on) {
				const ctx = this.context;
				const master = this.master;
				if (ctx === void 0 || master === void 0) return;
				const target = on ? DUCK_GAIN : 1;
				try {
					master.gain.cancelScheduledValues(ctx.currentTime);
					master.gain.setTargetAtTime(target, ctx.currentTime, .05);
				} catch {
					master.gain.value = target;
				}
			}
			/** 所有朗读先经过这个音量节点（打断时压小），再经过分析节点（通话波浪看朗读音量）出声。 */
			output(ctx) {
				if (this.master === void 0 || this.master.context !== ctx) {
					this.master = ctx.createGain();
					this.analyser = void 0;
					try {
						const analyser = ctx.createAnalyser();
						analyser.fftSize = 1024;
						this.master.connect(analyser);
						analyser.connect(ctx.destination);
						this.analyser = analyser;
						this.meterBuffer = new Float32Array(analyser.fftSize);
					} catch {
						this.master.connect(ctx.destination);
					}
				}
				return this.master;
			}
			/** 朗读输出现在的均方根（压小后的，就是你听到的）。没在出声是 0。 */
			outputRms() {
				const analyser = this.analyser;
				const buffer = this.meterBuffer;
				if (analyser === void 0 || buffer === void 0 || this.playing.size === 0) return 0;
				analyser.getFloatTimeDomainData(buffer);
				let sum = 0;
				for (let i = 0; i < buffer.length; i++) {
					const v = buffer[i];
					sum += v * v;
				}
				return Math.sqrt(sum / buffer.length);
			}
			isSounding() {
				return this.playing.size > 0;
			}
			/** 播放还能不能出声：还没建过算能（第一次念时再建），建过就要在跑。不会创建或恢复。 */
			get playbackRunning() {
				return this.context === void 0 || this.context.state === "running";
			}
			/** 通话用：拿到（必要时创建）播放用的 AudioContext，提示音也用它播。要在点按里第一次调用。 */
			audioContext() {
				return this.ensureContext();
			}
			reportError(message) {
				this.lastError = message;
				this.notify();
			}
			clearError() {
				if (this.lastError === null) return;
				this.lastError = null;
				this.notify();
			}
			subscribe(listener) {
				this.listeners.add(listener);
				return () => this.listeners.delete(listener);
			}
			getVersion() {
				return this.version;
			}
			notify() {
				this.updateBlocked();
				this.version++;
				for (const listener of this.listeners) listener();
			}
			/** 有声音在等、播放却没在运行：等一小会儿还没恢复，就提示用户点一下。 */
			updateBlocked() {
				if (!(this.context !== void 0 && this.context.state !== "running" && this.isSpeaking())) {
					clearTimeout(this.blockedTimer);
					this.blockedTimer = void 0;
					this.blocked = false;
					return;
				}
				if (this.blocked || this.blockedTimer !== void 0) return;
				this.blockedTimer = setTimeout(() => {
					this.blockedTimer = void 0;
					if (this.context === void 0 || this.context.state === "running" || !this.isSpeaking()) return;
					this.blocked = true;
					this.version++;
					for (const listener of this.listeners) listener();
				}, BLOCKED_HINT_MS);
			}
			dispose() {
				this.stopAll();
				clearTimeout(this.blockedTimer);
				this.blockedTimer = void 0;
				this.context?.close().catch(() => {});
				this.context = void 0;
			}
		};
		const speaker = new Speaker();
		//#endregion
		//#region src/client/follow.ts
		/**
		* 跟读：盯着当前对话最新一轮里主代理的每一步（assistant-step），边写边念。
		*
		* - 每一步对应一段朗读；步骤里的文字一边流出来一边交给 Speakify 清理，再发去合成。
		* - 设置里开了「整段写完再念」：等这一步写完（或开始调工具）再把整段交给合成，语调更连贯，开口晚一些。
		* - 中间回复（调工具之前说的话）也念。
		* - 打开开关、切换对话时，已经存在的步骤一律当作念过了，不会把旧回复重读一遍。
		* - 每一轮最多念的字数在「插件 → 语音朗读」里设置（默认 800 字，可以不限），超过就说一句「后面的内容请看屏幕」。
		* - 用户手动停止（点开关、按住说话）之后，这一轮剩下的都不念了，下一轮照常。
		*/
		/** 自动朗读的朗读段都用这个前缀（手动点回复下方喇叭是 message:，通话是另一套）。 */
		const AUTO_READ_TAG = "turn:";
		const OVER_BUDGET = "后面的内容请看屏幕。";
		var Follower = class {
			turn;
			steps = /* @__PURE__ */ new Map();
			primed = false;
			budget = new TurnBudget();
			noticeGiven = false;
			muted = false;
			stopsSeen = speaker.stops;
			update(view) {
				if (view === null) return;
				if (!this.primed) {
					this.primed = true;
					this.turn = view.turn;
					for (const step of view.steps) this.steps.set(step.key, this.newState(true));
					this.stopsSeen = speaker.stops;
					return;
				}
				if (view.turn !== this.turn) {
					this.finishAll();
					this.turn = view.turn;
					this.steps.clear();
					this.budget.reset();
					this.noticeGiven = false;
					this.muted = false;
					this.stopsSeen = speaker.stops;
					loadSettings(true);
				}
				if (speaker.stops !== this.stopsSeen) {
					this.stopsSeen = speaker.stops;
					this.muted = true;
				}
				for (const step of view.steps) {
					let state = this.steps.get(step.key);
					if (state === void 0) {
						state = this.newState(this.muted);
						this.steps.set(step.key, state);
					}
					if (state.skip || state.closed) continue;
					if (this.muted || step.interrupted) {
						this.close(state, false);
						continue;
					}
					if (!stepReady(speakWhole(), step)) continue;
					const piece = state.speakify.push(step.text, step.done || step.flush);
					this.say(state, piece);
					if (step.done) this.close(state, true);
				}
			}
			/** 不再跟读（关开关、切对话、卸载）：在念的念完，不再追加。 */
			detach() {
				this.finishAll();
			}
			newState(skip) {
				return {
					skip,
					speakify: new Speakify(),
					utterance: void 0,
					closed: false
				};
			}
			say(state, piece) {
				if (piece === "") return;
				const { text, over } = this.budget.take(piece, turnLimit());
				if (text !== "") this.utter(state).append(text);
				if (over && !this.noticeGiven) {
					this.noticeGiven = true;
					this.utter(state).append(OVER_BUDGET);
				}
			}
			utter(state) {
				if (state.utterance === void 0) state.utterance = speaker.start(`${AUTO_READ_TAG}${this.turn ?? ""}`);
				return state.utterance;
			}
			close(state, finish) {
				state.closed = true;
				if (state.utterance === void 0) return;
				if (finish) state.utterance.finish();
				else state.utterance.cancel();
			}
			finishAll() {
				for (const state of this.steps.values()) if (!state.skip && !state.closed) this.close(state, true);
			}
		};
		/**
		* useChat 选择器：把最新一轮的主代理步骤压成一个字符串。
		* 返回字符串是为了让 useChat 用 Object.is 比较时，内容没变就不重渲染。
		*/
		function selectTurn(snapshot) {
			try {
				const s = snapshot;
				const turn = s.timeline?.turnOrder?.at(-1);
				if (turn === void 0) return "";
				const keys = s.locations?.getTurn?.(turn) ?? [];
				const steps = [];
				for (const key of keys) {
					const node = s.nodes?.get?.(key);
					if (node?.kind !== "assistant-step") continue;
					const blocks = node.data?.blocks ?? [];
					const status = node.data?.status;
					const text = blocks.filter((block) => block.kind === "text" && typeof block.text === "string").map((block) => block.text).join("\n");
					const last = blocks.at(-1);
					steps.push({
						key: String(key),
						text,
						flush: last !== void 0 && last.kind !== "text",
						done: status === "settled" || status === "interrupted",
						interrupted: status === "interrupted"
					});
				}
				return JSON.stringify({
					turn: String(turn),
					steps
				});
			} catch {
				return "";
			}
		}
		function parseTurn(signature) {
			if (signature === "") return null;
			try {
				return JSON.parse(signature);
			} catch {
				return null;
			}
		}
		//#endregion
		//#region src/client/call/intent.ts
		const PUNCT = /[\s，。、,.!?！？；;：:…~～"'“”‘’（）()【】[\]]/gu;
		const LEADING = /^(嗯+|好+|好的|那|那个|哎|诶|喂|行|你)+/u;
		const TRAILING = /(吧|啊|呀|了|哈|啦|嘛|哦|噢|呢|好吗|行吗|可以吗)+$/u;
		/** 去掉标点、开头的「嗯/好/那」、结尾的「吧/了/啊」。 */
		function normalizeCommand(text) {
			let s = text.replace(PUNCT, "");
			for (let i = 0; i < 3; i++) s = s.replace(LEADING, "").replace(TRAILING, "");
			return s;
		}
		const STOP = /* @__PURE__ */ new Set([
			"停",
			"停停",
			"停下",
			"停一下",
			"停下来",
			"停止",
			"打住",
			"先停",
			"先停下",
			"先停一下",
			"先停下来",
			"先别做",
			"先别干",
			"别做",
			"别干",
			"别弄",
			"不做",
			"不用做",
			"不要做",
			"不用干",
			"不要干",
			"不用弄",
			"取消",
			"中断",
			"算了停",
			"算了别做"
		]);
		const PROGRESS = [
			/^(现在|目前)?的?(进度|进展)(怎么样|如何|咋样|到哪|到哪了|到哪一步)?$/u,
			/^(现在)?(做|干|弄|搞|跑)(到哪|到哪一步|得怎么样|完没|完了没|好没|好了没|完了吗|好了吗)$/u,
			/^(现在)?(怎么样|咋样|到哪|到哪一步|好了没|完了没|还要多久|还要多长时间|还要等多久)$/u,
			/^(你)?(还在(干|做|弄|忙)(什么|啥))$/u,
			/^(你)?在(干|做|弄|忙)(什么|啥)$/u
		];
		/** 这句话是不是通话命令。不是返回 undefined（照常发给 agent）。 */
		function commandOf(text) {
			const raw = text.replace(PUNCT, "");
			for (const s of [normalizeCommand(text), raw]) {
				if (s === "" || s.length > 12) continue;
				if (STOP.has(s)) return "stop";
				if (PROGRESS.some((re) => re.test(s))) return "progress";
			}
		}
		function compact(text) {
			return text.replace(PUNCT, "").toLowerCase();
		}
		/**
		* 识别出的话是不是朗读的回声：整句都在刚念过的话里，或者大部分「两字组合」都在。
		* 太短（不到 2 个字）的不判断（命令另外处理）。
		*/
		function isEcho(heard, recentSpeech) {
			const h = compact(heard);
			const r = compact(recentSpeech);
			if (h.length < 2 || r.length < 2) return false;
			if (r.includes(h)) return true;
			const pairs = /* @__PURE__ */ new Set();
			for (let i = 0; i + 1 < r.length; i++) pairs.add(r.slice(i, i + 2));
			let hit = 0;
			let total = 0;
			for (let i = 0; i + 1 < h.length; i++) {
				total++;
				if (pairs.has(h.slice(i, i + 2))) hit++;
			}
			return total > 0 && hit / total >= .6;
		}
		const TOOL_WORDS = [
			[/^(bash|terminal_|shell)/, "跑命令"],
			[/^read/, "看文件"],
			[/^(grep|glob)/, "搜代码"],
			[/^(edit|write)/, "改文件"],
			[/^web_/, "查资料"],
			[/^(subagent|spawn|workflow)/, "派子代理"],
			[/^computer_/, "操作电脑"],
			[/^(job_|wait_)/, "等后台任务"],
			[/^todo/, "整理待办"],
			[/^notes_/, "看笔记"]
		];
		function toolWords(name) {
			for (const [re, words] of TOOL_WORDS) if (re.test(name)) return words;
			return `用 ${name}`;
		}
		function duration(ms) {
			const total = Math.max(0, Math.round(ms / 1e3));
			const minutes = Math.floor(total / 60);
			const seconds = total % 60;
			if (minutes === 0) return `${seconds} 秒`;
			return seconds === 0 ? `${minutes} 分钟` : `${minutes} 分 ${seconds} 秒`;
		}
		/** 念给用户听的一句进度。 */
		function progressText(progress, elapsedMs, running) {
			if (!running) return "它这一轮已经做完了。";
			const parts = [`还在干活，已经 ${duration(elapsedMs)}`];
			if (progress !== void 0 && progress.steps > 0) parts[0] += `，走了 ${progress.steps} 步`;
			let text = `${parts[0]}。`;
			if (progress !== void 0 && progress.lastTool !== "") text += `刚才在${toolWords(progress.lastTool)}。`;
			if (progress !== void 0 && progress.lastSaid !== "") {
				const said = progress.lastSaid.length > 40 ? `${progress.lastSaid.slice(0, 40)}……` : progress.lastSaid;
				text += `它最近说：${said}`;
			}
			return text;
		}
		/** 最后一句（按句末标点切），去掉 markdown 符号。 */
		function lastSentence(text) {
			return text.replace(/[`*#>_|]/g, "").replace(/\s+/g, " ").trim().split(/(?<=[。！？!?；;])/u).map((p) => p.trim()).filter((p) => p !== "").at(-1) ?? "";
		}
		/**
		* useChat 选择器：最新一轮的步数、最近的工具、最近一句话。返回字符串（内容没变就不重渲染）。
		*/
		function selectProgress(snapshot) {
			try {
				const s = snapshot;
				const turn = s.timeline?.turnOrder?.at(-1);
				if (turn === void 0) return "";
				const progress = {
					steps: 0,
					lastTool: "",
					lastSaid: ""
				};
				for (const key of s.locations?.getTurn?.(turn) ?? []) {
					const node = s.nodes?.get?.(key);
					if (node?.kind !== "assistant-step") continue;
					progress.steps++;
					for (const block of node.data?.blocks ?? []) {
						if (block.kind === "tool-call" && typeof block.name === "string" && block.name !== "") progress.lastTool = block.name;
						if (block.kind === "text" && typeof block.text === "string") {
							const said = lastSentence(block.text);
							if (said !== "") progress.lastSaid = said;
						}
					}
				}
				return JSON.stringify(progress);
			} catch {
				return "";
			}
		}
		function parseProgress(signature) {
			if (signature === "") return void 0;
			try {
				return JSON.parse(signature);
			} catch {
				return;
			}
		}
		//#endregion
		//#region src/client/call/vad.ts
		const DEFAULTS = {
			frameMs: 20,
			silenceMs: 1200,
			minSpeechMs: 400,
			maxSpeechMs: 3e4,
			preRollMs: 300,
			onsetFrames: 3,
			marginDb: 12,
			minThresholdDb: -50,
			maxThresholdDb: -28,
			holdDb: 4,
			checkMs: 0,
			resumeFrames: 3
		};
		const SENSITIVITY = {
			lowest: {
				marginDb: 24,
				minThresholdDb: -38,
				maxThresholdDb: -18
			},
			low: {
				marginDb: 18,
				minThresholdDb: -44,
				maxThresholdDb: -24
			},
			medium: {
				marginDb: 12,
				minThresholdDb: -50,
				maxThresholdDb: -28
			},
			high: {
				marginDb: 8,
				minThresholdDb: -54,
				maxThresholdDb: -28
			}
		};
		/** 某档在这个底噪下的说话门限（dBFS）。 */
		function thresholdFor(level, noiseDb) {
			const p = SENSITIVITY[level];
			return Math.min(p.maxThresholdDb, Math.max(p.minThresholdDb, noiseDb + p.marginDb));
		}
		/** 说话中（门限降了 holdDb）门限比底噪高多少：太小的话底噪一波动就当成还在说，这句结束不了。 */
		function holdGapDb(level, noiseDb) {
			return thresholdFor(level, noiseDb) - DEFAULTS.holdDb - noiseDb;
		}
		/**
		* 按底噪建议档位：中、低、很低里挑最灵敏、又够用的那档（高档只给说话轻的人，不主动建议）。
		* 很低也不够时返回 null：只能靠「说完了」按钮或戴耳机。
		*/
		function suggestSensitivity(noiseDb) {
			for (const level of [
				"medium",
				"low",
				"lowest"
			]) if (holdGapDb(level, noiseDb) >= 8) return level;
			return null;
		}
		/** 模型概率比音量晚这么多帧（20ms 一帧）：算一句多长时，结尾静音里这几帧还按音量算。 */
		const VOICE_LAG_FRAMES = 8;
		/** 音量的最小值，免得 log(0)。 */
		const FLOOR_DB = -100;
		/** 刚开麦这么久只学底噪。 */
		const WARMUP_MS = 300;
		function rmsDb(samples, start = 0, end = samples.length) {
			let sum = 0;
			for (let i = start; i < end; i++) {
				const v = samples[i] ?? 0;
				sum += v * v;
			}
			const n = end - start;
			if (n <= 0 || sum === 0) return FLOOR_DB;
			return Math.max(FLOOR_DB, 10 * Math.log10(sum / n));
		}
		var Vad = class {
			sampleRate;
			frameSize;
			opts;
			/** 还没凑够一帧的采样。 */
			partial;
			partialLength = 0;
			/** 估计的环境底噪（dBFS）。 */
			noiseDb = -60;
			/** 已经看过多少帧（前几帧快速校准底噪）。 */
			framesSeen = 0;
			/** 开口前的最近几帧。 */
			preRoll = [];
			preRollFrames;
			/** 连续够响的帧数（还没算开口时）。 */
			loudRun = 0;
			/** 开口前够响的那几帧，开口后并进这句话里。 */
			pendingOnset = [];
			speaking = false;
			/** 这一句开口时人声模型在用（长度门槛放低、按音量数）。 */
			gated = false;
			/** 这一句到目前为止的帧。 */
			frames = [];
			/** 这一句里最后一帧够响的帧之后，又过了几帧。 */
			silentRun = 0;
			/** 停顿中连续够响的帧数（够 resumeFrames 才算又开口）。 */
			resumeRun = 0;
			/** 这一句里够响的帧（不含开头补的）一共多少。 */
			voicedFrames = 0;
			/** 这一句、这一段停顿的编号：再开口或这句结束就换一个，旧的 pause 判断随之作废。 */
			token = 0;
			/** 这一段停顿已经发过 pause 了。 */
			pauseSent = false;
			/** 最近一帧的音量，界面画声波用。 */
			lastDb = FLOOR_DB;
			/**
			* 人声模型（Silero）给的「现在是人声」的概率 0–1，外面每次 push 前更新；undefined 表示没有模型，只看音量。
			* 有模型时，够响还要像人声才算在说：风扇、空调、敲键盘再响也不算。
			*/
			voiceProb = void 0;
			constructor(options) {
				this.sampleRate = options.sampleRate;
				this.opts = { ...DEFAULTS };
				for (const key of Object.keys(DEFAULTS)) {
					const value = options[key];
					if (typeof value === "number" && Number.isFinite(value)) this.opts[key] = value;
				}
				this.frameSize = Math.max(1, Math.round(this.sampleRate * this.opts.frameMs / 1e3));
				this.partial = new Float32Array(this.frameSize);
				this.preRollFrames = Math.max(0, Math.round(this.opts.preRollMs / this.opts.frameMs));
			}
			/** 现在在不在说话（开口之后、说完之前）。 */
			get isSpeaking() {
				return this.speaking;
			}
			/** 现在的说话门限（dBFS），调试用。 */
			get thresholdDb() {
				const { marginDb, minThresholdDb, maxThresholdDb } = this.opts;
				return Math.min(maxThresholdDb, Math.max(minThresholdDb, this.noiseDb + marginDb));
			}
			get noiseFloorDb() {
				return this.noiseDb;
			}
			/** 改停顿时长（设置里调）。 */
			setSilenceMs(ms) {
				if (Number.isFinite(ms) && ms > 0) this.opts.silenceMs = ms;
			}
			/** 改「停顿多久先问一次说完没有」，0 关掉。 */
			setCheckMs(ms) {
				if (Number.isFinite(ms) && ms >= 0) this.opts.checkMs = ms;
			}
			/** 改收音灵敏度（设置里调）：低档要比底噪响得多才算说话，高档小声也算。认不出的值按中档。 */
			setSensitivity(level) {
				const preset = SENSITIVITY[level] ?? SENSITIVITY.medium;
				this.opts.marginDb = preset.marginDb;
				this.opts.minThresholdDb = preset.minThresholdDb;
				this.opts.maxThresholdDb = preset.maxThresholdDb;
			}
			/** pause 事件之后，外面判断说完了：token 还有效（没再开口、这句没结束）就结束这句。 */
			finishIf(token) {
				if (!this.speaking || token !== this.token) return [];
				const events = [];
				this.endSpeech(events, false, true);
				return events;
			}
			/** 喂入一段采样，返回这段里发生的事件。 */
			push(samples) {
				const events = [];
				let offset = 0;
				while (offset < samples.length) {
					const take = Math.min(this.frameSize - this.partialLength, samples.length - offset);
					this.partial.set(samples.subarray(offset, offset + take), this.partialLength);
					this.partialLength += take;
					offset += take;
					if (this.partialLength === this.frameSize) {
						const frame = this.partial;
						this.partial = new Float32Array(this.frameSize);
						this.partialLength = 0;
						this.frame(frame, events);
					}
				}
				return events;
			}
			/** 手动结束这一句（「说完了」按钮）：在说就交出来，没在说就什么都不做。 */
			finish() {
				if (!this.speaking) return [];
				const events = [];
				this.endSpeech(events, true, false);
				return events;
			}
			/** 丢掉进行中的一切（朗读时不听、静音、挂断）。底噪估计保留。 */
			reset() {
				this.speaking = false;
				this.gated = false;
				this.frames = [];
				this.preRoll = [];
				this.pendingOnset = [];
				this.loudRun = 0;
				this.silentRun = 0;
				this.resumeRun = 0;
				this.voicedFrames = 0;
				this.partialLength = 0;
				this.token++;
				this.pauseSent = false;
			}
			frame(frame, events) {
				const db = rmsDb(frame);
				this.lastDb = db;
				this.framesSeen++;
				const threshold = this.thresholdDb;
				if (!this.speaking && this.framesSeen * this.opts.frameMs <= WARMUP_MS) {
					this.keepPreRoll(frame);
					this.trackNoise(db);
					return;
				}
				if (!this.speaking) {
					if (db >= threshold && this.voiced(.5)) {
						this.loudRun++;
						this.pendingOnset.push(frame);
						if (this.loudRun >= this.opts.onsetFrames) {
							this.speaking = true;
							this.gated = this.voiceProb !== void 0;
							this.frames = [...this.preRoll, ...this.pendingOnset];
							this.voicedFrames = this.pendingOnset.length;
							this.preRoll = [];
							this.pendingOnset = [];
							this.silentRun = 0;
							this.token++;
							this.pauseSent = false;
							events.push({ kind: "start" });
						}
						return;
					}
					for (const f of this.pendingOnset) this.keepPreRoll(f);
					this.pendingOnset = [];
					this.loudRun = 0;
					this.keepPreRoll(frame);
					this.trackNoise(db);
					return;
				}
				this.frames.push(frame);
				const frameMs = this.opts.frameMs;
				const loud = db >= threshold - this.opts.holdDb && this.voiced(.35);
				if (loud && this.silentRun === 0) this.voicedFrames++;
				else if (loud && ++this.resumeRun >= this.opts.resumeFrames) {
					this.token++;
					this.pauseSent = false;
					this.voicedFrames += this.resumeRun;
					this.silentRun = 0;
					this.resumeRun = 0;
				} else {
					if (!loud) this.resumeRun = 0;
					this.silentRun++;
					const { checkMs, minSpeechMs } = this.opts;
					if (checkMs > 0 && !this.pauseSent && this.silentRun * frameMs >= checkMs && this.voicedFrames * frameMs >= minSpeechMs) {
						this.pauseSent = true;
						events.push({
							kind: "pause",
							samples: this.joined(this.silentRun),
							token: this.token
						});
					}
				}
				if (this.silentRun * frameMs >= this.opts.silenceMs) {
					this.endSpeech(events, false, true);
					return;
				}
				if (this.frames.length * frameMs >= this.opts.maxSpeechMs) this.endSpeech(events, true, false);
			}
			endSpeech(events, forced, trimSilence) {
				const frameMs = this.opts.frameMs;
				let speechMs = this.voicedFrames * frameMs;
				let minSpeechMs = this.opts.minSpeechMs;
				if (this.gated) {
					speechMs = Math.max(speechMs, this.energyFrames(trimSilence ? this.silentRun : 0) * frameMs);
					minSpeechMs = Math.min(minSpeechMs, 200);
				}
				this.gated = false;
				const samples = this.joined(trimSilence ? this.silentRun : 0);
				this.speaking = false;
				this.frames = [];
				this.silentRun = 0;
				this.resumeRun = 0;
				this.voicedFrames = 0;
				this.loudRun = 0;
				this.token++;
				this.pauseSent = false;
				if (speechMs < minSpeechMs) {
					events.push({
						kind: "discard",
						speechMs
					});
					return;
				}
				events.push({
					kind: "end",
					samples,
					speechMs,
					forced
				});
			}
			/** 这一句到目前为止的音频，结尾的静音只留 200ms（silentFrames 是结尾有几帧静音）。 */
			joined(silentFrames) {
				const keepTail = Math.round(200 / this.opts.frameMs);
				const drop = Math.max(0, silentFrames - keepTail);
				const count = Math.max(0, this.frames.length - drop);
				const samples = new Float32Array(count * this.frameSize);
				for (let i = 0; i < count; i++) samples.set(this.frames[i], i * this.frameSize);
				return samples;
			}
			/** 这一句里按音量够响（说话中的门限）的帧数；结尾静音只看模型晚到的那几帧。 */
			energyFrames(silentFrames) {
				const drop = Math.max(0, silentFrames - VOICE_LAG_FRAMES);
				const count = Math.max(0, this.frames.length - drop);
				const min = this.thresholdDb - this.opts.holdDb;
				let n = 0;
				for (let i = 0; i < count; i++) if (rmsDb(this.frames[i]) >= min) n++;
				return n;
			}
			/** 没有模型时总算像人声；有模型时看概率。 */
			voiced(min) {
				return this.voiceProb === void 0 || this.voiceProb >= min;
			}
			keepPreRoll(frame) {
				if (this.preRollFrames === 0) return;
				this.preRoll.push(frame);
				if (this.preRoll.length > this.preRollFrames) this.preRoll.shift();
			}
			/** 底噪：前 0.5 秒快速校准；之后变吵慢慢升（约 3 秒跟上），变静很快降。 */
			trackNoise(db) {
				if (this.framesSeen === 1) {
					this.noiseDb = db;
					return;
				}
				const alpha = this.framesSeen * this.opts.frameMs <= 500 ? .3 : db > this.noiseDb ? .007 : .15;
				this.noiseDb += (db - this.noiseDb) * alpha;
			}
		};
		//#endregion
		//#region src/client/call/controller.ts
		/**
		* 一通语音通话的状态机（半双工）：
		*   在听 → 你说话 → 识别 → 发出去 → 等它（思考音 / 干活轻响 / 朗读）→ 这一轮结束、读完 → 提示音 → 在听 …
		*
		* - 麦克风整通电话开着，但只在「在听」且没静音、没朗读、没提示音时才把声音交给断句；其余时间直接丢掉。
		* - 点一下屏幕：停止朗读，马上轮到你说；agent 在后台照常干活，你说的话排队发出。
		* - agent 弹出提问或审批：读一句「需要你在屏幕上确认」，等你在屏幕上处理完。
		* - 切到后台：暂停，回来点一下继续。
		*
		* 浏览器、DSH 的东西都通过 CallEnv 注入，这个文件 Node 里能直接测。只用可擦除的 TypeScript 语法。
		*/
		/** smart-turn 打开时：停顿这么久先问一次说完没有。 */
		const SMART_CHECK_MS = 500;
		/** smart-turn 判断没说完时，最多等这么久（再长就按停顿当说完）。 */
		const SMART_FALLBACK_MS = 3e3;
		/** 说完的概率超过这个就提前结束这句。 */
		const SMART_THRESHOLD = .5;
		/** 这轮结束要连续这么久都安静（不在跑、不在念、没在等你），才算真的结束。 */
		const SETTLE_MS$1 = 800;
		/** 发出去后这么久 agent 都没开始跑，就当没发出去。 */
		const START_TIMEOUT_MS = 8e3;
		/** 思考音最多响这么久，之后改成干活时的定时轻响。 */
		const THINKING_MAX_MS = 2e4;
		const TICK_EVERY_MS = 15e3;
		const HEARTBEAT_MS = 3e4;
		const NOTICE_MS = 4e3;
		const NEED_YOU_TEXT = "需要你在屏幕上确认。";
		/** 输入框里有字时，说的话接到末尾后给的提示。 */
		const APPENDED_NOTICE = "已接到输入框末尾，发送时一起发";
		/** 输入框里有字、但接不进去（比如正在用命令）。 */
		const APPEND_FAILED_NOTICE = "没接进输入框，请再说一遍";
		/** 只有语气词、标点：当作没听清，不发。 */
		const FILLER = /^[\s，。,.!?！？、…~～嗯啊呃额唔哦噢哈呀]*$/u;
		var CallController = class {
			vad;
			env;
			mode = "connecting";
			muted = false;
			paused = false;
			hostOk = true;
			heard = "";
			notice = "";
			noticeAt = 0;
			level = 0;
			run = 0;
			lastHeartbeat = 0;
			gateWasOpen = false;
			bargeIn = false;
			/** 打断的那句正在识别（这时不再收音）。 */
			barging = false;
			/** 设置里的停顿时长（smart-turn 关着时就按它断句）。 */
			silenceMs = 1200;
			smartTurn = false;
			/** smart-turn 出过错就整通电话不再用，提示只说一次。 */
			smartTurnFailed = false;
			/** 等它的这一轮的情况。 */
			turn = {
				since: 0,
				sawRunning: false,
				quietSince: -1,
				spoke: false,
				mine: false,
				needAnnounced: false,
				lastTick: 0
			};
			listeners = /* @__PURE__ */ new Set();
			view;
			sampleRate = 16e3;
			constructor(env, sampleRate, options = {}) {
				this.env = env;
				this.sampleRate = sampleRate;
				this.vad = new Vad({
					sampleRate,
					silenceMs: options.silenceMs,
					maxSpeechMs: options.maxSpeechMs
				});
				if (typeof options.silenceMs === "number") this.silenceMs = options.silenceMs;
				this.bargeIn = options.bargeIn === true;
				this.setSmartTurn(options.smartTurn === true);
				if (options.sensitivity !== void 0) this.vad.setSensitivity(options.sensitivity);
				this.view = this.compute();
			}
			/** 设置里改了收音灵敏度。 */
			setSensitivity(level) {
				this.vad.setSensitivity(level);
			}
			/** 设置里改了「说话打断」。 */
			setBargeIn(on) {
				this.bargeIn = on;
				this.publish();
			}
			/** 设置里改了停顿时长。 */
			setSilenceMs(ms) {
				if (!Number.isFinite(ms) || ms <= 0) return;
				this.silenceMs = ms;
				this.applyTurnTiming();
			}
			/**
			* 设置里改了「听语气判断说完没有」。打开后：停顿 0.5 秒先问 smart-turn，说完了马上发；
			* 没说完就接着等，最多等 3 秒（或者设置的停顿时长，取长的）。环境没有 turnComplete 时不生效。
			*/
			setSmartTurn(on) {
				this.smartTurn = on && this.env.turnComplete !== void 0;
				this.applyTurnTiming();
			}
			applyTurnTiming() {
				if (this.smartTurn) {
					this.vad.setCheckMs(SMART_CHECK_MS);
					this.vad.setSilenceMs(Math.max(this.silenceMs, SMART_FALLBACK_MS));
				} else {
					this.vad.setCheckMs(0);
					this.vad.setSilenceMs(this.silenceMs);
				}
			}
			/** 接通：告诉后台、等麦克风。麦克风好了调 micReady。 */
			start() {
				this.lastHeartbeat = this.env.now();
				this.env.setActive(true).then((ok) => {
					this.hostOk = ok;
				}, () => {
					this.hostOk = false;
				});
				this.publish();
			}
			/** 麦克风打开了。agent 正在跑就先等它这一轮完，否则直接轮到你说。 */
			micReady() {
				if (this.mode !== "connecting") return;
				this.env.tone("connect");
				if (this.env.running() || this.env.speaking() || this.env.pending()) this.enterAwait(false);
				else this.mode = "open";
				this.publish();
			}
			/** 麦克风打不开、识别服务不可用等：结束通话。 */
			fail(message) {
				if (this.mode === "ended") return;
				this.finish(message, false);
			}
			/** 麦克风来的一段采样。 */
			audio(samples) {
				if (this.mode === "ended") return;
				if (!this.gateOpen()) {
					if (this.gateWasOpen) {
						this.vad.reset();
						this.env.voice?.reset();
					}
					this.gateWasOpen = false;
					if (this.level !== 0) {
						this.level = 0;
						this.publish();
					}
					return;
				}
				this.gateWasOpen = true;
				const voice = this.env.voice;
				if (voice !== void 0) {
					voice.push(samples);
					this.vad.voiceProb = voice.probability();
				}
				for (const event of this.vad.push(samples)) this.onVad(event);
				const level = Math.max(0, Math.min(1, (this.vad.lastDb + 60) / 45));
				const bucket = Math.round(level * 10) / 10;
				if (bucket !== this.level) {
					this.level = bucket;
					this.publish();
				}
			}
			/** 每 200ms 左右调一次：判断这一轮结束没有、思考音、定时轻响、心跳。 */
			tick() {
				if (this.mode === "ended") return;
				const now = this.env.now();
				if (now - this.lastHeartbeat >= HEARTBEAT_MS) {
					this.lastHeartbeat = now;
					this.env.setActive(true).then((ok) => {
						this.hostOk = ok;
					}, () => {
						this.hostOk = false;
					});
				}
				if (this.notice !== "" && !this.paused && now - this.noticeAt > NOTICE_MS) this.notice = "";
				if (this.mode === "open" && this.env.pending() && !this.vad.isSpeaking) this.enterAwait(false);
				if (this.mode === "await") this.tickAwait(now);
				else this.env.thinking(false);
				this.publish();
			}
			/** 点一下屏幕：暂停中就继续；等它的时候就停止朗读、轮到你说。 */
			tap() {
				if (this.mode === "ended") return;
				if (this.paused) {
					this.paused = false;
					this.notice = "";
					this.publish();
					return;
				}
				if (this.mode === "await") {
					this.env.stopSpeech();
					this.env.thinking(false);
					this.mode = "open";
					this.publish();
				}
			}
			/** 「说完了」：正在说就立刻交出去。 */
			done() {
				if (this.mode !== "open") return;
				for (const event of this.vad.finish()) this.onVad(event);
				this.publish();
			}
			toggleMute() {
				if (this.mode === "ended") return;
				this.muted = !this.muted;
				this.publish();
			}
			/**
			* 切到后台：暂停（不收音、不放提示音），回来点一下继续。
			* reason 是暂停的原因，一直显示到用户点继续（用户在锁屏时看不到，回来才看到）。
			*/
			pause(reason = "") {
				if (this.mode === "ended" || this.paused) return;
				this.paused = true;
				this.env.thinking(false);
				if (reason !== "") {
					this.notice = reason;
					this.noticeAt = this.env.now();
				}
				this.publish();
			}
			get isPaused() {
				return this.paused;
			}
			hangup() {
				if (this.mode === "ended") return;
				this.env.stopSpeech();
				this.finish("", true);
			}
			getView() {
				return this.view;
			}
			/** 现在是不是轮到用户说（自测录音据此决定什么时候「说」下一段）。等它的时候能打断不算。 */
			get listening() {
				return this.mode === "open" && this.gateOpen();
			}
			subscribe(listener) {
				this.listeners.add(listener);
				return () => {
					this.listeners.delete(listener);
				};
			}
			gateOpen() {
				if (this.muted || this.paused) return false;
				if (this.mode === "open") return !this.env.speaking() && !this.env.toneBusy();
				if (this.mode === "await") return this.bargeIn && !this.barging && !this.env.pending();
				return false;
			}
			onVad(event) {
				if (event.kind === "pause") {
					this.checkTurn(event.samples, event.token);
					return;
				}
				if (this.mode === "await") {
					if (event.kind === "start") this.env.duck?.(true);
					else if (event.kind === "discard") this.env.duck?.(false);
					else this.bargeRecognize(event.samples);
					return;
				}
				if (event.kind === "start") {
					this.notice = "";
					return;
				}
				if (event.kind === "discard") return;
				this.recognize(event.samples);
			}
			/**
			* 说话中停顿了一下：问 smart-turn 说完没有。说完了就结束这句（照常识别发出）；
			* 没说完就什么都不做，VAD 接着等（再开口，或者停够 3 秒）。
			* 出错就整通电话退回只按停顿判断，提示一次。
			*/
			async checkTurn(samples, token) {
				if (!this.smartTurn || this.env.turnComplete === void 0) return;
				let probability;
				try {
					probability = await this.env.turnComplete(samples, this.sampleRate);
				} catch {
					if (!this.smartTurnFailed) {
						this.smartTurnFailed = true;
						this.say("听语气判断用不了，改成按停顿判断");
					}
					this.smartTurn = false;
					this.applyTurnTiming();
					this.publish();
					return;
				}
				if (this.mode === "ended" || !(probability >= SMART_THRESHOLD)) return;
				for (const event of this.vad.finishIf(token)) this.onVad(event);
				this.publish();
			}
			/** 识别结果是不是要本地处理的命令。「停」在 agent 跑或在念时才算；「进度」在跑时才算。 */
			commandFor(text) {
				const command = commandOf(text);
				if (command === "stop") return this.env.running() || this.env.speaking() ? "stop" : void 0;
				if (command === "progress") return this.env.running() ? "progress" : void 0;
			}
			/** 处理命令。处理完都回到「等它」：这一轮真结束了才响提示音轮到你。 */
			runCommand(command) {
				this.env.duck?.(false);
				if (command === "stop") {
					this.env.stopSpeech();
					this.env.thinking(false);
					if (this.env.running()) {
						if (!(this.env.stopAgent?.() ?? false)) {
							this.say("停不了：请点屏幕上的停止按钮");
							this.mode = "open";
							this.publish();
							return;
						}
						this.say("已经让它停下");
					} else this.say("不念了");
					this.env.tone("ack");
					this.enterAwait(false);
					this.turn.sawRunning = true;
					this.publish();
					return;
				}
				const elapsed = this.mode === "await" ? this.env.now() - this.turn.since : 0;
				const text = this.env.progress?.(elapsed) ?? "它还在干活。";
				this.env.stopSpeech();
				this.env.say(text);
				if (this.mode !== "await") this.enterAwait(false);
				this.publish();
			}
			/** 等它的时候用户开口了（说话打断）：先识别，再看是回声、命令还是新的话。 */
			async bargeRecognize(samples) {
				const run = ++this.run;
				this.barging = true;
				this.vad.reset();
				this.publish();
				let result;
				try {
					result = await this.env.transcribe(samples, this.sampleRate);
				} catch (error) {
					result = {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					};
				}
				this.barging = false;
				if (run !== this.run || this.mode !== "await") {
					this.env.duck?.(false);
					return;
				}
				const text = result.ok ? result.text.trim() : "";
				if (text === "" || FILLER.test(text)) {
					this.env.duck?.(false);
					this.publish();
					return;
				}
				const command = this.commandFor(text);
				if (command === void 0 && isEcho(text, this.env.recentSpeech?.() ?? "")) {
					this.env.duck?.(false);
					this.publish();
					return;
				}
				if (command !== void 0) {
					this.runCommand(command);
					return;
				}
				this.env.duck?.(false);
				this.env.stopSpeech();
				this.heard = text;
				if (this.composing()) {
					this.addToDraft(text);
					return;
				}
				if (!this.env.send(this.hostOk ? text : `${text}\n\n（语音通话中：请口语化、简短回答；调工具前先用一句话说你要做什么。）`)) {
					this.say("没发出去，请再说一遍");
					this.publish();
					return;
				}
				this.env.tone("ack");
				this.enterAwait(true);
				this.publish();
			}
			async recognize(samples) {
				const run = ++this.run;
				this.mode = "transcribing";
				this.vad.reset();
				this.publish();
				let result;
				try {
					result = await this.env.transcribe(samples, this.sampleRate);
				} catch (error) {
					result = {
						ok: false,
						error: error instanceof Error ? error.message : String(error)
					};
				}
				if (run !== this.run || this.mode !== "transcribing") return;
				if (!result.ok) {
					this.mode = "open";
					this.say(`识别失败：${result.error}`);
					return;
				}
				const text = result.text.trim();
				if (text === "" || FILLER.test(text)) {
					this.mode = "open";
					if (this.composing()) this.publish();
					else this.say("没听清，请再说一遍");
					return;
				}
				const command = this.commandFor(text);
				if (command !== void 0) {
					this.mode = "open";
					this.runCommand(command);
					return;
				}
				this.heard = text;
				if (this.composing()) {
					this.mode = "open";
					this.addToDraft(text);
					return;
				}
				if (!this.env.send(this.hostOk ? text : `${text}\n\n（语音通话中：请口语化、简短回答；调工具前先用一句话说你要做什么。）`)) {
					this.mode = "open";
					this.say("没发出去，请再说一遍");
					return;
				}
				this.env.tone("ack");
				this.enterAwait(true);
				this.publish();
			}
			composing() {
				try {
					return this.env.composing?.() === true;
				} catch {
					return false;
				}
			}
			/** 接到草稿末尾，不发送、不响提示音（你正看着屏幕）。 */
			addToDraft(text) {
				let ok = false;
				try {
					ok = this.env.appendDraft?.(text) === true;
				} catch {
					ok = false;
				}
				this.say(ok ? APPENDED_NOTICE : APPEND_FAILED_NOTICE);
			}
			enterAwait(mine) {
				this.mode = "await";
				const now = this.env.now();
				this.turn = {
					since: now,
					sawRunning: this.env.running(),
					quietSince: -1,
					spoke: false,
					mine,
					needAnnounced: false,
					lastTick: now
				};
			}
			tickAwait(now) {
				const running = this.env.running();
				const speaking = this.env.speaking();
				const pending = this.env.pending();
				const turn = this.turn;
				if (running) turn.sawRunning = true;
				if (this.env.sounding()) turn.spoke = true;
				if (pending) {
					if (!turn.needAnnounced && !this.paused) {
						turn.needAnnounced = true;
						this.env.tone("need");
						this.env.say(NEED_YOU_TEXT);
					}
				} else turn.needAnnounced = false;
				const thinking = turn.mine && !turn.spoke && !pending && !this.paused && now - turn.since < THINKING_MAX_MS;
				this.env.thinking(thinking);
				if (!thinking && !speaking && !pending && !this.paused && running && now - turn.lastTick >= TICK_EVERY_MS) {
					turn.lastTick = now;
					this.env.tone("tick");
				}
				if (speaking) turn.lastTick = now;
				if (!(!running && !speaking && !pending)) {
					turn.quietSince = -1;
					return;
				}
				if (turn.quietSince < 0) turn.quietSince = now;
				const started = turn.sawRunning || now - turn.since >= START_TIMEOUT_MS;
				if (now - turn.quietSince < SETTLE_MS$1 || !started) return;
				this.env.thinking(false);
				this.mode = "open";
				if (!turn.sawRunning && turn.mine) this.say("好像没发出去，请再说一遍");
				if (!this.paused) this.env.tone("turn");
			}
			finish(reason, byUser) {
				this.mode = "ended";
				this.run++;
				this.barging = false;
				this.env.thinking(false);
				this.env.duck?.(false);
				this.vad.reset();
				if (byUser) this.env.tone("hangup");
				this.env.setActive(false).catch(() => {});
				this.notice = reason;
				this.publish();
				this.env.ended(reason);
			}
			say(notice) {
				this.notice = notice;
				this.noticeAt = this.env.now();
				this.publish();
			}
			phase() {
				if (this.mode === "ended") return "ended";
				if (this.mode === "connecting") return "connecting";
				if (this.paused) return "paused";
				if (this.mode === "transcribing") return "transcribing";
				if (this.mode === "open") {
					if (this.muted) return "muted";
					return this.vad.isSpeaking ? "hearing" : "listening";
				}
				if (this.env.pending()) return "needs-you";
				if (this.env.sounding() || this.env.speaking() && this.turn.spoke) return "speaking";
				if (this.turn.mine && !this.turn.spoke && this.env.now() - this.turn.since < THINKING_MAX_MS) return "thinking";
				return "working";
			}
			compute() {
				return {
					phase: this.phase(),
					heard: this.heard,
					notice: this.notice,
					level: this.mode === "open" ? this.level : 0,
					muted: this.muted,
					bargeIn: this.bargeIn
				};
			}
			publish() {
				const next = this.compute();
				const prev = this.view;
				if (prev.phase === next.phase && prev.heard === next.heard && prev.notice === next.notice && prev.level === next.level && prev.muted === next.muted && prev.bargeIn === next.bargeIn) return;
				this.view = next;
				for (const listener of this.listeners) listener();
			}
		};
		//#endregion
		//#region src/client/call/voice.ts
		const BASE$2 = "/voice-reply/vad";
		/** 这么久没收到新概率，就当模型跟不上了，先只看音量。 */
		const STALE_MS = 400;
		var VoiceDetector = class {
			worker;
			state = "loading";
			prob = 0;
			lastAt = 0;
			lastPushAt = -Infinity;
			rate;
			now;
			/** 加载失败的原因（调试用）。 */
			error = "";
			onFail;
			constructor(sampleRate, version, now = () => performance.now()) {
				this.rate = sampleRate;
				this.now = now;
				try {
					const worker = new Worker(`${BASE$2}/worker.js`, {
						type: "module",
						name: "voice-reply-vad"
					});
					this.worker = worker;
					worker.onmessage = (event) => this.message(event.data);
					worker.onerror = (event) => this.fail(event.message || "人声模型的工作线程出错");
					worker.postMessage({
						type: "init",
						version
					});
				} catch (error) {
					this.fail(error instanceof Error ? error.message : String(error));
				}
			}
			get status() {
				return this.state;
			}
			push(samples) {
				if (this.state !== "ready" || this.worker === void 0) return;
				const now = this.now();
				if (now - this.lastPushAt > STALE_MS) {
					this.prob = 0;
					this.lastAt = now;
				}
				this.lastPushAt = now;
				const copy = samples.slice();
				this.worker.postMessage({
					type: "audio",
					samples: copy,
					rate: this.rate
				}, [copy.buffer]);
			}
			probability() {
				if (this.state !== "ready") return void 0;
				if (this.now() - this.lastAt > STALE_MS) return void 0;
				return this.prob;
			}
			/** 丢掉模型状态。概率先当 0（不是人声），等新的算出来；免得重新开始听的头几十毫秒只看音量。 */
			reset() {
				this.prob = 0;
				this.lastAt = this.now();
				this.worker?.postMessage({ type: "reset" });
			}
			close() {
				this.worker?.terminate();
				this.worker = void 0;
				if (this.state === "loading") this.state = "failed";
			}
			message(data) {
				const m = data;
				if (m?.type === "ready") {
					if (this.state !== "loading") return;
					this.state = "ready";
					this.prob = 0;
					this.lastAt = this.now();
				} else if (m?.type === "prob" && typeof m.p === "number") {
					this.prob = m.p;
					this.lastAt = this.now();
				} else if (m?.type === "error") this.fail(typeof m.message === "string" ? m.message : "人声模型加载失败");
			}
			fail(message) {
				if (this.state === "failed") return;
				this.state = "failed";
				this.error = message;
				this.worker?.terminate();
				this.worker = void 0;
				console.warn("[voice-reply] 人声模型不可用，断句只看音量：", message);
				this.onFail?.(message);
			}
		};
		//#endregion
		//#region src/client/call/draft.ts
		/**
		* 通话中输入框里已经有字时，识别出来的话接到草稿末尾（不自动发）。
		* 纯函数，Node 里能直接测。
		*/
		const LATIN_END = /[A-Za-z0-9]$/;
		const LATIN_START = /^[A-Za-z0-9]/;
		/** 把 text 接到 draft 后面：两边都是英文字母或数字时中间加一个空格，其余直接接上。 */
		function joinDraft(draft, text) {
			const addition = text.trim();
			if (addition === "") return draft;
			if (draft.trim() === "") return addition;
			if (/\s$/.test(draft)) return draft + addition;
			if (LATIN_END.test(draft) && LATIN_START.test(addition)) return `${draft} ${addition}`;
			return draft + addition;
		}
		/** 输入框里有没打完 / 没发的东西：有字或有附件。 */
		function isComposing(input) {
			if (input === void 0) return false;
			return input.draft.trim() !== "" || input.attachmentIds.length > 0;
		}
		//#endregion
		//#region src/client/call/meter.ts
		function toneOf(phase) {
			switch (phase) {
				case "listening":
				case "hearing": return "listen";
				case "transcribing":
				case "thinking":
				case "working": return "think";
				case "speaking": return "speak";
				case "needs-you": return "alert";
				default: return "off";
			}
		}
		/** 你说话时跟麦克风；它念的时候跟朗读（不看麦克风，免得回声把波浪带起来）。 */
		function sourceOf(tone) {
			if (tone === "listen") return "mic";
			if (tone === "speak") return "out";
			if (tone === "think" || tone === "alert") return "idle";
			return "none";
		}
		/**
		* 每个样子的三种颜色（波浪从左到右、头像柔光球的渐变）。CSS 变量和画布共用这一份。
		* 这是深色主题的；浅色主题有不同的写在 LIGHT_PALETTES 里，没写的两边一样。
		* 整体偏暖、偏柔和（不要科技感的冷色）：在听：奶桃色；在说：鼠尾草绿配奶黄；在想：淡紫配粉；需要你：琥珀。
		*/
		const PALETTES = {
			listen: [
				"#f6d9c4",
				"#f2b8a0",
				"#f9e6c8"
			],
			think: [
				"#d9c8f0",
				"#f3c6d8",
				"#cfe3f5"
			],
			speak: [
				"#b9dcc4",
				"#f0d9a8",
				"#a9d3d0"
			],
			alert: [
				"#f6c177",
				"#f4a261",
				"#f2998c"
			],
			off: [
				"#8b8b92",
				"#a1a1aa",
				"#8b8b92"
			]
		};
		/** 浅色主题：深色用的粉彩在白底上太淡，各加深一点（需要你、静音两边一样）。 */
		const LIGHT_PALETTES = {
			listen: [
				"#f0c4a6",
				"#ea9f84",
				"#f2d6a8"
			],
			think: [
				"#c9b6ec",
				"#eba9c4",
				"#a9cdea"
			],
			speak: [
				"#9fcfae",
				"#e6c987",
				"#8cc4c0"
			]
		};
		function paletteOf(tone, dark) {
			return (dark ? void 0 : LIGHT_PALETTES[tone]) ?? PALETTES[tone];
		}
		/** 不跟声音时的幅度（0–1）：在听时轻轻起伏，在想时慢慢流动，平线是 0。 */
		const IDLE_LEVEL = {
			listen: .06,
			think: .2,
			speak: .08,
			alert: .16,
			off: 0
		};
		/** 一段采样的均方根。 */
		function rms(samples) {
			if (samples.length === 0) return 0;
			let sum = 0;
			for (let i = 0; i < samples.length; i++) {
				const v = samples[i];
				sum += v * v;
			}
			return Math.sqrt(sum / samples.length);
		}
		/** 均方根换成 0–1：-55 dB 以下算 0，-15 dB 以上算 1，中间按分贝线性。 */
		function levelOf(value) {
			if (!(value > 0)) return 0;
			const db = 20 * Math.log10(value);
			return Math.max(0, Math.min(1, (db + 55) / 40));
		}
		/** 波浪的目标幅度：跟声音时取声音和底幅里大的那个。 */
		function targetLevel(tone, levels) {
			const idle = IDLE_LEVEL[tone];
			const source = sourceOf(tone);
			if (source === "mic") return Math.max(idle, levelOf(levels.mic));
			if (source === "out") return Math.max(idle, levelOf(levels.out));
			return idle;
		}
		/** 起得快、落得慢。dtMs 是距上一帧的毫秒数。 */
		function smooth(current, target, dtMs) {
			const tau = target > current ? 60 : 260;
			const k = 1 - Math.exp(-Math.max(0, dtMs) / tau);
			return current + (target - current) * k;
		}
		/** '#rrggbb' → [r, g, b]；认不出来返回 undefined。 */
		function parseHex(hex) {
			const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
			if (m === null) return void 0;
			const n = Number.parseInt(m[1], 16);
			return [
				n >> 16 & 255,
				n >> 8 & 255,
				n & 255
			];
		}
		/** 两种颜色按 t（0–1）混合。 */
		function mixRgb(a, b, t) {
			const k = Math.max(0, Math.min(1, t));
			return [
				a[0] + (b[0] - a[0]) * k,
				a[1] + (b[1] - a[1]) * k,
				a[2] + (b[2] - a[2]) * k
			];
		}
		//#endregion
		//#region src/client/call/wav.ts
		/**
		* 把一句话的采样转成识别要的格式：16 kHz 单声道 PCM16 WAV，再转 base64。
		* 和 dsh-voice-hold 送给官方 speech Remote 的格式一样。
		*
		* 纯计算，Node 里能直接测。只用可擦除的 TypeScript 语法。
		*/
		const TARGET_RATE = 16e3;
		/**
		* 重采样到 16 kHz。降采样时把落进同一个输出采样的输入取平均（简单的低通，比直接抽点少些混叠）；
		* 升采样用线性插值。
		*/
		function resample(samples, fromRate, toRate = TARGET_RATE) {
			if (fromRate === toRate || samples.length === 0) return samples.slice();
			const ratio = fromRate / toRate;
			const length = Math.max(1, Math.floor(samples.length / ratio));
			const out = new Float32Array(length);
			if (ratio > 1) {
				for (let i = 0; i < length; i++) {
					const start = Math.floor(i * ratio);
					const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
					let sum = 0;
					for (let j = start; j < end; j++) sum += samples[j] ?? 0;
					out[i] = sum / (end - start);
				}
				return out;
			}
			for (let i = 0; i < length; i++) {
				const at = i * ratio;
				const left = Math.floor(at);
				const right = Math.min(samples.length - 1, left + 1);
				const t = at - left;
				out[i] = (samples[left] ?? 0) * (1 - t) + (samples[right] ?? 0) * t;
			}
			return out;
		}
		/** 16 位单声道 WAV。 */
		function encodeWav(samples, sampleRate = TARGET_RATE) {
			const bytes = new Uint8Array(44 + samples.length * 2);
			const view = new DataView(bytes.buffer);
			const text = (at, value) => {
				for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i);
			};
			text(0, "RIFF");
			view.setUint32(4, bytes.length - 8, true);
			text(8, "WAVE");
			text(12, "fmt ");
			view.setUint32(16, 16, true);
			view.setUint16(20, 1, true);
			view.setUint16(22, 1, true);
			view.setUint32(24, sampleRate, true);
			view.setUint32(28, sampleRate * 2, true);
			view.setUint16(32, 2, true);
			view.setUint16(34, 16, true);
			text(36, "data");
			view.setUint32(40, samples.length * 2, true);
			for (let i = 0; i < samples.length; i++) {
				const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
				view.setInt16(44 + i * 2, v < 0 ? v * 32768 : v * 32767, true);
			}
			return bytes;
		}
		/** 裸 16 位小端 PCM（不带 WAV 头），给 smart-turn 用。 */
		function encodePcm16(samples) {
			const bytes = new Uint8Array(samples.length * 2);
			const view = new DataView(bytes.buffer);
			for (let i = 0; i < samples.length; i++) {
				const v = Math.max(-1, Math.min(1, samples[i] ?? 0));
				view.setInt16(i * 2, v < 0 ? v * 32768 : v * 32767, true);
			}
			return bytes;
		}
		/** 读 16 位单声道 PCM WAV（自测录音用）。返回采样和采样率；格式不对返回 null。 */
		function decodeWav(bytes) {
			if (bytes.length < 44) return null;
			const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			const tag = (at) => String.fromCharCode(...bytes.subarray(at, at + 4));
			if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
			let offset = 12;
			let sampleRate = 0;
			let channels = 0;
			let bits = 0;
			while (offset + 8 <= bytes.length) {
				const id = tag(offset);
				const size = view.getUint32(offset + 4, true);
				const body = offset + 8;
				if (id === "fmt ") {
					channels = view.getUint16(body + 2, true);
					sampleRate = view.getUint32(body + 4, true);
					bits = view.getUint16(body + 14, true);
				} else if (id === "data") {
					if (bits !== 16 || channels < 1 || sampleRate <= 0) return null;
					const end = Math.min(bytes.length, body + size);
					const frames = Math.floor((end - body) / (2 * channels));
					const samples = new Float32Array(frames);
					for (let i = 0; i < frames; i++) samples[i] = view.getInt16(body + i * 2 * channels, true) / 32768;
					return {
						samples,
						sampleRate
					};
				}
				offset = body + size + size % 2;
			}
			return null;
		}
		function toBase64$1(bytes) {
			let binary = "";
			const chunk = 32768;
			for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
			return btoa(binary);
		}
		//#endregion
		//#region src/client/call/mic.ts
		/**
		* 通话的麦克风：整通电话只开一次，原始采样一块块交给 sink（通话状态机决定要不要）。
		*
		* - 播放上下文（AudioContext）必须在点「通话」的那一下里同步建好、resume，不然手机上会一直是 suspended。
		*   所以分两步：create() 在点按里同步调用；open() 之后再异步申请麦克风。
		* - 麦克风设备跟官方「语音输入」详情页里选的走（浏览器本地存储 dsh.voice-input.microphone），和按住说话一致。
		* - 开发自测：~/.config/dsh-voice/call-test.json 里列了录音时，不开麦克风，改成按实时速度
		*   把这些录音一段段喂进来（轮到你说时才放下一段），其余时间喂很小的底噪。夜里测试不用对着麦克风说话。
		*/
		const BASE$1 = "/voice-reply";
		/** 官方语音插件保存的麦克风选择；空字符串表示跟随系统默认。 */
		const DEVICE_KEY$1 = "dsh.voice-input.microphone";
		const PROCESSOR_SIZE = 2048;
		/** 自测：每次喂 20ms。 */
		const CLIP_STEP_MS = 20;
		var MicError = class extends Error {};
		function selectedDevice$1() {
			try {
				const saved = JSON.parse(localStorage.getItem(DEVICE_KEY$1) ?? "null");
				return typeof saved?.id === "string" ? saved.id : "";
			} catch {
				return "";
			}
		}
		async function readCallTest() {
			try {
				const res = await fetch(`${BASE$1}/call/test`, { credentials: "same-origin" });
				if (!res.ok) return {
					enabled: false,
					clips: [],
					gapMs: 1500
				};
				const data = await res.json();
				return {
					enabled: data.enabled === true && Array.isArray(data.clips) && data.clips.length > 0,
					clips: Array.isArray(data.clips) ? data.clips.filter((c) => typeof c === "string") : [],
					gapMs: typeof data.gapMs === "number" ? data.gapMs : 1500
				};
			} catch {
				return {
					enabled: false,
					clips: [],
					gapMs: 1500
				};
			}
		}
		var Mic = class Mic {
			context;
			stream;
			nodes = [];
			timer;
			closed = false;
			/** 自测模式（用录音代替麦克风）。 */
			testMode = false;
			constructor(context) {
				this.context = context;
			}
			/** 在点按里同步调用：建好采集用的 AudioContext 并 resume。建不了返回 undefined。 */
			static create() {
				let context;
				try {
					context = new AudioContext();
				} catch {
					return;
				}
				context.resume().catch(() => {});
				return new Mic(context);
			}
			get sampleRate() {
				return this.context.sampleRate;
			}
			/** 申请麦克风（或进入自测）。首次使用会弹授权框。 */
			async open(sink) {
				const test = await readCallTest();
				if (this.closed) return;
				if (test.enabled) {
					this.testMode = true;
					await this.openClips(sink, test);
					return;
				}
				const devices = navigator.mediaDevices;
				if (!devices?.getUserMedia) throw new MicError("这个浏览器不能录音（需要 HTTPS 或本机地址）");
				let stream;
				try {
					const deviceId = selectedDevice$1();
					stream = await devices.getUserMedia({
						audio: {
							echoCancellation: true,
							noiseSuppression: true,
							autoGainControl: true,
							...deviceId === "" ? {} : { deviceId: { exact: deviceId } }
						},
						video: false
					});
				} catch (error) {
					if (error instanceof DOMException) {
						if (error.name === "NotAllowedError") throw new MicError("麦克风权限被拒绝，请在浏览器或系统设置里允许");
						if (error.name === "NotFoundError" || error.name === "OverconstrainedError") throw new MicError("找不到选定的麦克风：请插好设备，或到「语音输入」详情页换一个");
					}
					throw new MicError(`打不开麦克风：${error instanceof Error ? error.message : String(error)}`);
				}
				if (this.closed) {
					stream.getTracks().forEach((track) => track.stop());
					return;
				}
				this.stream = stream;
				for (const track of stream.getTracks()) track.addEventListener("ended", () => {
					if (!this.closed) sink.lost("麦克风断开了");
				});
				const ctx = this.context;
				const source = ctx.createMediaStreamSource(stream);
				const processor = ctx.createScriptProcessor(PROCESSOR_SIZE, 1, 1);
				processor.onaudioprocess = (event) => {
					if (this.closed) return;
					sink.audio(event.inputBuffer.getChannelData(0).slice());
				};
				const mute = ctx.createGain();
				mute.gain.value = 0;
				source.connect(processor);
				processor.connect(mute);
				mute.connect(ctx.destination);
				this.nodes = [
					source,
					processor,
					mute
				];
			}
			/**
			* 采集还在不在正常工作：AudioContext 在跑，麦克风轨道没结束、没被系统静音。
			* 锁屏后继续通话时据此判断系统有没有把麦克风停掉。
			*/
			get healthy() {
				if (this.closed || this.context.state !== "running") return false;
				if (this.testMode) return true;
				const tracks = this.stream?.getAudioTracks() ?? [];
				return tracks.length > 0 && tracks.every((track) => track.readyState === "live" && !track.muted);
			}
			/** 切回前台后恢复采集（手机上后台会把 AudioContext 挂起）。要在点按里调用才保证成功。 */
			resume() {
				if (this.context.state !== "running" && this.context.state !== "closed") this.context.resume().catch(() => {});
			}
			close() {
				if (this.closed) return;
				this.closed = true;
				clearInterval(this.timer);
				this.timer = void 0;
				for (const node of this.nodes) try {
					node.disconnect();
				} catch {}
				this.nodes = [];
				this.stream?.getTracks().forEach((track) => track.stop());
				this.stream = void 0;
				this.context.close().catch(() => {});
			}
			/** 自测：按实时速度喂录音。轮到用户说、隔了 gapMs 之后放下一段；其余时间喂很小的底噪。 */
			async openClips(sink, test) {
				const rate = this.sampleRate;
				const clips = [];
				for (const name of test.clips) {
					const res = await fetch(`${BASE$1}/call/test?clip=${encodeURIComponent(name)}`, { credentials: "same-origin" });
					if (!res.ok) throw new MicError(`自测录音读不到：${name}`);
					const decoded = decodeWav(new Uint8Array(await res.arrayBuffer()));
					if (decoded === null) throw new MicError(`自测录音格式不对（要 16 位 PCM WAV）：${name}`);
					const body = resample(decoded.samples, decoded.sampleRate, rate);
					const pad = Math.round(rate * .3);
					const padded = new Float32Array(body.length + pad * 2);
					padded.set(body, pad);
					clips.push(padded);
				}
				if (this.closed) return;
				let next = 0;
				let current;
				let offset = 0;
				let wantedSince = -1;
				let last = performance.now();
				let seed = 1;
				const hiss = () => {
					seed = seed * 16807 % 2147483647;
					return (seed / 2147483647 - .5) * 6e-4;
				};
				this.timer = setInterval(() => {
					if (this.closed) return;
					const now = performance.now();
					const due = Math.min(Math.round((now - last) * rate / 1e3), Math.round(rate * .2));
					last = now;
					if (due <= 0) return;
					if (current === void 0) if (sink.wantsAudio()) {
						if (wantedSince < 0) wantedSince = now;
						if (next < clips.length && now - wantedSince >= test.gapMs) {
							current = clips[next++];
							offset = 0;
							wantedSince = -1;
						}
					} else wantedSince = -1;
					const out = new Float32Array(due);
					for (let i = 0; i < due; i++) if (current !== void 0 && offset < current.length) out[i] = (current[offset++] ?? 0) + hiss();
					else out[i] = hiss();
					if (current !== void 0 && offset >= current.length) current = void 0;
					sink.audio(out);
				}, CLIP_STEP_MS);
			}
		};
		//#endregion
		//#region src/client/call/tones.ts
		const TONES = {
			connect: [[
				523,
				0,
				.09,
				.12
			], [
				784,
				.1,
				.14,
				.12
			]],
			hangup: [[
				784,
				0,
				.09,
				.12
			], [
				523,
				.1,
				.16,
				.12
			]],
			ack: [[
				660,
				0,
				.08,
				.09
			]],
			turn: [[
				784,
				0,
				.07,
				.11
			], [
				988,
				.09,
				.11,
				.11
			]],
			tick: [[
				1047,
				0,
				.05,
				.045
			]],
			need: [[
				660,
				0,
				.08,
				.1
			], [
				660,
				.15,
				.08,
				.1
			]]
		};
		const THINKING_PULSE = [[
			440,
			0,
			.2,
			.03
		], [
			554,
			.22,
			.2,
			.03
		]];
		const THINKING_EVERY_MS = 1800;
		/** 提示音结束后再等这么久才开始收音。 */
		const TAIL_S = .15;
		var Tones = class {
			context;
			busyUntil = 0;
			thinkingTimer;
			constructor(context) {
				this.context = context;
			}
			play(name) {
				this.notes(TONES[name]);
			}
			/** 有提示音在响（麦克风这时不收音）。 */
			get busy() {
				const ctx = this.context();
				return ctx !== void 0 && ctx.currentTime < this.busyUntil;
			}
			/** 开关思考音。重复调用没关系。 */
			thinking(on) {
				if (on === (this.thinkingTimer !== void 0)) return;
				if (!on) {
					clearInterval(this.thinkingTimer);
					this.thinkingTimer = void 0;
					return;
				}
				this.notes(THINKING_PULSE);
				this.thinkingTimer = setInterval(() => this.notes(THINKING_PULSE), THINKING_EVERY_MS);
			}
			dispose() {
				this.thinking(false);
			}
			notes(notes) {
				const ctx = this.context();
				if (ctx === void 0 || ctx.state !== "running") return;
				const t0 = ctx.currentTime + .02;
				let end = t0;
				for (const [freq, offset, duration, peak] of notes) {
					const start = t0 + offset;
					const osc = ctx.createOscillator();
					const gain = ctx.createGain();
					osc.type = "sine";
					osc.frequency.value = freq;
					gain.gain.setValueAtTime(1e-4, start);
					gain.gain.linearRampToValueAtTime(peak, start + .012);
					gain.gain.exponentialRampToValueAtTime(1e-4, start + duration);
					osc.connect(gain).connect(ctx.destination);
					osc.start(start);
					osc.stop(start + duration + .02);
					osc.onended = () => {
						osc.disconnect();
						gain.disconnect();
					};
					end = Math.max(end, start + duration);
				}
				this.busyUntil = Math.max(this.busyUntil, end + TAIL_S);
			}
		};
		//#endregion
		//#region src/client/call/session.ts
		/**
		* 浏览器里的一通电话：把状态机（controller）接到麦克风、识别、输入框、朗读、提示音和 DSH 的会话状态上。
		*
		* 同一时间只有一通电话（current）。它是模块级的，不挂在 React 组件上：
		* agent 弹出审批 / 提问时 DSH 会把整个输入栏换掉，通话面板随之卸载，但电话不能断。
		* 面板挂着时，把聊天内容（跟读用）和输入框状态喂进来；卸载太久（切到别的会话）才自动挂断。
		*/
		const BASE = "/voice-reply";
		const TICK_MS$1 = 200;
		/** 面板卸载、又没有审批 / 提问在等，这么久还没回来就挂断（多半是切到别的会话了）。 */
		const ORPHAN_HANGUP_MS = 1e4;
		/** 挂断后，按钮旁的提示留这么久。 */
		const ENDED_NOTICE_MS = 6e3;
		const USABLE$1 = /* @__PURE__ */ new Set([
			"ready",
			"standby",
			"waking"
		]);
		/** 开了「锁屏后继续通话」，但系统在锁屏后停了麦克风或声音。 */
		const LOCK_STOPPED_NOTICE = "锁屏后系统停了麦克风或声音，点这里继续";
		let speech$1;
		let status;
		let sessions;
		function setSpeech$1(remote) {
			speech$1 = remote;
		}
		function setStatus(store) {
			status = store;
		}
		function setSessions(api) {
			sessions = api;
		}
		/** 让这个会话的 agent 停下（和输入框的停止按钮同一条路）。拿不到会话层返回 false。 */
		function cancelSession(sessionId) {
			const conversation = sessions?.scope(sessionId)?.get("conversation");
			if (typeof conversation?.cancel !== "function") return false;
			conversation.cancel().catch(() => {});
			return true;
		}
		var ActiveCall = class {
			sessionId;
			controller;
			follower = new Follower();
			mic;
			tones;
			actions;
			input;
			/** 麦克风最近一块采样的均方根（给波浪用；静音时也照算，波浪按状态决定看不看）。 */
			micRms = 0;
			catalog;
			timer;
			wakeLock;
			cleanups = [];
			viewers = 0;
			orphanSince = -1;
			/** 面板挂着时它从 useSession 读到的 running（比状态表新一点）；没挂着是 undefined。 */
			panelRunning;
			/** 人声模型（设置里关了、服务端太旧时没有）。整通电话只起一次，中途改设置下一通生效。 */
			voice;
			ended = false;
			constructor(sessionId, mic, actions, input) {
				this.sessionId = sessionId;
				this.mic = mic;
				this.actions = actions;
				this.input = input;
				this.tones = new Tones(() => speaker.audioContext());
				this.controller = new CallController(this.env(), mic.sampleRate, {
					silenceMs: callSilenceMs(),
					bargeIn: callBargeIn(),
					smartTurn: callSmartTurn(),
					sensitivity: callSensitivity()
				});
				loadSettings(true).then(() => {
					this.controller.setSilenceMs(callSilenceMs());
					this.controller.setBargeIn(callBargeIn());
					this.controller.setSmartTurn(callSmartTurn());
					this.controller.setSensitivity(callSensitivity());
					this.startVoice();
				});
			}
			startVoice() {
				if (this.ended || this.voice !== void 0) return;
				const version = callVoiceModel();
				if (version === void 0) return;
				this.voice = new VoiceDetector(this.mic.sampleRate, version);
			}
			/** 接通（已经在点按里建好了播放和采集的 AudioContext）。 */
			begin() {
				const controller = this.controller;
				controller.start();
				const catalogReady = (async () => {
					if (speech$1 === void 0) throw new MicError("语音识别服务不可用：请在插件页启用官方「语音输入」");
					const result = await speech$1.catalog();
					if (!result.ok) throw new MicError(`语音识别不可用：${result.error.message}`);
					const catalog = result.value;
					const provider = catalog.providers.find((item) => item.id === catalog.selection.providerId);
					if (provider === void 0 || !USABLE$1.has(provider.preparation.phase)) throw new MicError("语音模型还没准备好：请到插件页「语音输入」里下载并准备");
					this.catalog = catalog;
				})();
				const micReady = this.mic.open({
					audio: (samples) => {
						this.micRms = rms(samples);
						controller.audio(samples);
						if (document.visibilityState === "hidden") this.maybeTick();
					},
					wantsAudio: () => controller.listening,
					lost: (message) => controller.fail(message)
				});
				Promise.all([catalogReady, micReady]).then(() => {
					if (!this.ended) controller.micReady();
				}, (error) => controller.fail(error instanceof Error ? error.message : String(error)));
				this.timer = setInterval(() => this.maybeTick(), TICK_MS$1);
				const onVisibility = () => {
					if (document.visibilityState === "hidden") {
						if (!callKeepOnLock()) controller.pause();
						else if (!this.mediaHealthy()) controller.pause(LOCK_STOPPED_NOTICE);
					} else {
						this.requestWakeLock();
						this.mic.resume();
					}
				};
				document.addEventListener("visibilitychange", onVisibility);
				this.cleanups.push(() => document.removeEventListener("visibilitychange", onVisibility));
				const onPageHide = () => postActive(this.sessionId, false, true);
				window.addEventListener("pagehide", onPageHide);
				this.cleanups.push(() => window.removeEventListener("pagehide", onPageHide));
				this.requestWakeLock();
			}
			lastTickAt = 0;
			/** 定时器和（后台时的）麦克风回调都会调；最多每 TICK_MS 推一次状态机。 */
			maybeTick() {
				if (this.ended) return;
				const now = Date.now();
				if (now - this.lastTickAt < TICK_MS$1 - 20) return;
				this.lastTickAt = now;
				this.controller.tick();
				this.watchOrphan();
				this.watchBackground();
			}
			/** 锁屏后继续通话时：系统中途停了麦克风或朗读，就暂停并留一句原因，回来点一下继续。 */
			watchBackground() {
				if (document.visibilityState !== "hidden" || this.controller.isPaused) return;
				if (!callKeepOnLock()) return;
				if (!this.mediaHealthy()) this.controller.pause(LOCK_STOPPED_NOTICE);
			}
			/** 麦克风还在采、朗读的播放还在跑。 */
			mediaHealthy() {
				return this.mic.healthy && speaker.playbackRunning;
			}
			/** 点面板：顺手解锁声音（这一下是用户手势），恢复采集，再交给状态机。 */
			tap() {
				speaker.unlock();
				this.mic.resume();
				this.controller.tap();
			}
			hangup() {
				this.controller.hangup();
			}
			done() {
				this.controller.done();
			}
			toggleMute() {
				this.controller.toggleMute();
			}
			/** 波浪每帧来取：麦克风和朗读输出的均方根。 */
			levels() {
				if (this.ended) return {
					mic: 0,
					out: 0
				};
				return {
					mic: this.micRms,
					out: speaker.outputRms()
				};
			}
			/** 输入框里有没发的字或附件（面板据此换提示）。 */
			get composing() {
				return isComposing(this.input);
			}
			fedChat = false;
			feedChat(signature) {
				if (this.ended) return;
				const view = parseTurn(signature);
				if (!this.fedChat) {
					this.fedChat = true;
					if (view === null) this.follower.update({
						turn: "",
						steps: []
					});
				}
				this.follower.update(view);
			}
			observeInput(actions, input, running) {
				if (actions !== void 0) this.actions = actions;
				if (input !== void 0) this.input = input;
				this.panelRunning = running;
			}
			/** 停止生成的函数（输入栏给的，和「停止生成」按钮同一个），面板卸载后也留着。 */
			stopFn;
			/** 最新一轮的进度（selectProgress 的结果）。 */
			progressSignature = "";
			observeAgent(stop, progressSignature) {
				if (stop !== void 0) this.stopFn = stop;
				this.progressSignature = progressSignature;
			}
			addViewer() {
				this.viewers++;
				return () => {
					this.viewers--;
					if (this.viewers <= 0) this.panelRunning = void 0;
				};
			}
			statusEntry() {
				return status?.getSnapshot().get(this.sessionId);
			}
			isRunning() {
				return this.panelRunning ?? this.statusEntry()?.running === true;
			}
			env() {
				const tag = `call:${this.sessionId}`;
				return {
					now: () => Date.now(),
					running: () => this.isRunning(),
					pending: () => this.statusEntry()?.pendingInteraction !== void 0,
					speaking: () => speaker.isSpeaking(),
					sounding: () => speaker.isSounding(),
					stopSpeech: () => speaker.stopAll(),
					say: (text) => {
						const u = speaker.start(tag);
						u.append(text);
						u.finish();
					},
					tone: (name) => this.tones.play(name),
					toneBusy: () => this.tones.busy,
					thinking: (on) => this.tones.thinking(on),
					transcribe: (samples, sampleRate) => this.transcribe(samples, sampleRate),
					send: (text) => this.send(text),
					composing: () => isComposing(this.input),
					appendDraft: (text) => this.appendDraft(text),
					setActive: (active) => postActive(this.sessionId, active, false),
					ended: (reason) => this.cleanup(reason),
					stopAgent: () => {
						try {
							if (cancelSession(this.sessionId)) return true;
						} catch {}
						const stop = this.stopFn;
						if (stop === void 0) return false;
						try {
							stop();
							return true;
						} catch {
							return false;
						}
					},
					progress: (elapsedMs) => progressText(parseProgress(this.progressSignature), elapsedMs, this.isRunning()),
					recentSpeech: () => speaker.recentText(),
					duck: (on) => speaker.duck(on),
					turnComplete: (samples, sampleRate) => turnComplete(samples, sampleRate),
					voice: {
						push: (samples) => this.voice?.push(samples),
						probability: () => this.voice?.probability(),
						reset: () => this.voice?.reset()
					}
				};
			}
			/** 识别一句话：设置里开了「百炼识别」就先用百炼，出错再退回本机；没开就用本机（官方语音输入）。 */
			async transcribe(samples, sampleRate) {
				if (!callCloudAsr()) return this.transcribeLocal(samples, sampleRate);
				const cloud = await cloudTranscribe(samples, sampleRate);
				if (cloud.ok) return cloud;
				console.warn("[voice-reply] 百炼识别失败，改用本机识别：", cloud.error);
				const local = await this.transcribeLocal(samples, sampleRate);
				return local.ok ? local : cloud;
			}
			async transcribeLocal(samples, sampleRate) {
				const remote = speech$1;
				const catalog = this.catalog;
				if (remote === void 0 || catalog === void 0) return {
					ok: false,
					error: "语音识别服务不可用"
				};
				let audio = resample(samples, sampleRate, TARGET_RATE);
				const maxSamples = Math.floor(catalog.maxDurationSeconds * TARGET_RATE);
				if (audio.length > maxSamples) audio = audio.subarray(0, maxSamples);
				const wav = encodeWav(audio);
				if (wav.byteLength > catalog.maxAudioBytes) return {
					ok: false,
					error: "这句太长了"
				};
				const result = await remote.transcribe({
					audioBase64: toBase64$1(wav),
					...catalog.selection
				});
				return result.ok ? {
					ok: true,
					text: result.value.text
				} : {
					ok: false,
					error: result.error.message
				};
			}
			/** 写进草稿并发送。草稿在提交中、有附件等写不进去时返回 false。 */
			send(text) {
				const input = this.input;
				if (input.phase !== "plain") return false;
				if (input.attachmentIds.length > 0) return false;
				try {
					this.actions.setDraft(text);
					this.actions.submit(this.isRunning() ? "steer" : "queue");
				} catch {
					return false;
				}
				return true;
			}
			/** 接到草稿末尾，不发送。正在用命令（/xxx）等写不进去时返回 false。 */
			appendDraft(text) {
				const input = this.input;
				if (input.phase !== "plain") return false;
				const next = joinDraft(input.draft, text);
				try {
					this.actions.setDraft(next);
				} catch {
					return false;
				}
				this.input = {
					...input,
					draft: next
				};
				return true;
			}
			watchOrphan() {
				if (this.ended || this.viewers > 0 || this.statusEntry()?.pendingInteraction !== void 0) {
					this.orphanSince = -1;
					return;
				}
				const now = Date.now();
				if (this.orphanSince < 0) this.orphanSince = now;
				else if (now - this.orphanSince > ORPHAN_HANGUP_MS) this.controller.hangup();
			}
			async requestWakeLock() {
				if (this.ended || this.wakeLock !== void 0 || document.visibilityState !== "visible") return;
				const nav = navigator;
				if (nav.wakeLock === void 0) return;
				try {
					const lock = await nav.wakeLock.request("screen");
					if (this.ended) {
						lock.release().catch(() => {});
						return;
					}
					this.wakeLock = lock;
					lock.addEventListener("release", () => {
						if (this.wakeLock === lock) this.wakeLock = void 0;
					});
				} catch {}
			}
			cleanup(reason) {
				if (this.ended) return;
				this.ended = true;
				clearInterval(this.timer);
				this.timer = void 0;
				this.mic.close();
				this.voice?.close();
				this.voice = void 0;
				this.tones.dispose();
				this.wakeLock?.release().catch(() => {});
				this.wakeLock = void 0;
				for (const cleanup of this.cleanups.splice(0)) cleanup();
				this.follower.detach();
				if (current === this) {
					current = void 0;
					endedNotice = reason === "" ? void 0 : {
						sessionId: this.sessionId,
						text: reason,
						at: Date.now()
					};
					notify();
					if (endedNotice !== void 0) {
						const shown = endedNotice;
						setTimeout(() => {
							if (endedNotice === shown) {
								endedNotice = void 0;
								notify();
							}
						}, ENDED_NOTICE_MS);
					}
				}
			}
		};
		/** 百炼识别一句话最长这么多秒（通话一句最长 30 秒）。 */
		const CLOUD_MAX_SECONDS = 60;
		/** 百炼识别（经本插件后台，Key 不出后台）。出错返回 ok: false，不抛。 */
		async function cloudTranscribe(samples, sampleRate) {
			let audio = resample(samples, sampleRate, TARGET_RATE);
			if (audio.length > CLOUD_MAX_SECONDS * 16e3) audio = audio.subarray(0, CLOUD_MAX_SECONDS * TARGET_RATE);
			try {
				const res = await fetch(`${BASE}/asr`, {
					method: "POST",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ audio: toBase64$1(encodeWav(audio)) })
				});
				const data = await res.json().catch(() => void 0);
				if (!res.ok || typeof data?.text !== "string") return {
					ok: false,
					error: typeof data?.error === "string" ? data.error : `HTTP ${res.status}`
				};
				return {
					ok: true,
					text: data.text
				};
			} catch (error) {
				return {
					ok: false,
					error: error instanceof Error ? error.message : String(error)
				};
			}
		}
		/** 告诉后台这个会话在不在通话。后台不认（老版本、出错）返回 false。 */
		/** smart-turn：把这一句到目前为止的声音（最后 8 秒，16 kHz PCM16）发给后台，拿回「说完了」的概率。出错就抛。 */
		async function turnComplete(samples, sampleRate) {
			let audio = resample(samples, sampleRate, TARGET_RATE);
			const max = TARGET_RATE * 8;
			if (audio.length > max) audio = audio.subarray(audio.length - max);
			const res = await fetch(`${BASE}/turn`, {
				method: "POST",
				credentials: "same-origin",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ audio: toBase64$1(encodePcm16(audio)) })
			});
			const data = await res.json().catch(() => void 0);
			if (!res.ok || typeof data?.probability !== "number") throw new Error(typeof data?.error === "string" ? data.error : `HTTP ${res.status}`);
			return data.probability;
		}
		async function postActive(sessionId, active, keepalive) {
			try {
				return (await fetch(`${BASE}/call`, {
					method: "POST",
					credentials: "same-origin",
					keepalive,
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						sessionId,
						active
					})
				})).ok;
			} catch {
				return false;
			}
		}
		let current;
		let endedNotice;
		const listeners$1 = /* @__PURE__ */ new Set();
		function notify() {
			for (const listener of listeners$1) listener();
		}
		function subscribe(listener) {
			listeners$1.add(listener);
			return () => listeners$1.delete(listener);
		}
		function currentCall() {
			return current;
		}
		/** 有电话在打（任何会话）。语音模式的跟读据此让位，免得念两遍。 */
		function isCallActive() {
			return current !== void 0;
		}
		/**
		* 接通。必须在点按的同步代码里调用：解锁播放、建采集用的 AudioContext 都要在用户手势里。
		* 返回一句不能接通的原因，能接通返回 undefined。
		*/
		function startCall(request) {
			if (current !== void 0) {
				if (current.sessionId === request.sessionId) return void 0;
				current.hangup();
			}
			const { actions, input } = request;
			if (actions === void 0 || input === void 0) return "输入框还没准备好，稍后再试";
			if (input.attachmentIds.length > 0) return "草稿里有附件：先发出去或删掉，再打电话";
			if (speech$1 === void 0) return "语音识别服务不可用：请在插件页启用官方「语音输入」";
			speaker.unlock();
			const mic = Mic.create();
			if (mic === void 0) return "这个浏览器不能录音";
			endedNotice = void 0;
			const call = new ActiveCall(request.sessionId, mic, actions, input);
			current = call;
			call.controller.subscribe(notify);
			notify();
			call.begin();
		}
		function hangupCall() {
			current?.hangup();
		}
		const NO_VIEW = void 0;
		/** 这个会话的通话画面；没在通话返回 undefined。 */
		function useCall(sessionId) {
			return (0, react.useSyncExternalStore)(subscribe, () => {
				const call = current;
				if (call === void 0 || sessionId === void 0 || call.sessionId !== sessionId) return NO_VIEW;
				return call.controller.getView();
			});
		}
		/** 任何会话在通话。 */
		function useCallActive() {
			return (0, react.useSyncExternalStore)(subscribe, isCallActive);
		}
		/** 刚挂断（出错）时给按钮旁显示的一句话。 */
		function useEndedNotice(sessionId) {
			return (0, react.useSyncExternalStore)(subscribe, () => endedNotice !== void 0 && endedNotice.sessionId === sessionId ? endedNotice.text : void 0);
		}
		//#endregion
		//#region src/client/icons.tsx
		/**
		* 喇叭图标：off 带叉，on 带声波，stop 是方块。
		* 照官方 *OutlineRegular 的画法：16 格、空心线条、线宽 1、圆头圆角，和回复下面的复制、点赞、分享一致。
		* 官方图标库里没有喇叭，所以是自己画的；停止沿用官方 StopFill 的实心方块。
		* 外框照官方的占位：横向 1.5–14.5、纵向约 2–14，否则看着比旁边的图标小。
		*/
		function SpeakerIcon({ mode, size = 16 }) {
			if (mode === "stop") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
					x: "4.5",
					y: "4.5",
					width: "7",
					height: "7",
					rx: "1.5",
					fill: "currentColor"
				})
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M1.5 6.5a1 1 0 0 1 1-1h2l3.2-3.1c.3-.3.8-.1.8.4v10.4c0 .5-.5.7-.8.4L4.5 10.5h-2a1 1 0 0 1-1-1z" }), mode === "on" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M10.8 5.6a3.4 3.4 0 0 1 0 4.8" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M12.6 3.4a6.5 6.5 0 0 1 0 9.2" })] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M10.8 6.2l3.6 3.6M14.4 6.2l-3.6 3.6" })]
			});
		}
		/** 电话听筒。hangup 时转 135 度（挂断）。 */
		function PhoneIcon({ hangup = false, size = 16 }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				style: hangup ? { transform: "rotate(135deg)" } : void 0,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					fill: "currentColor",
					d: "M4.2 1.6c.4-.2.9 0 1.1.4l1.2 2.4c.2.4.1.8-.2 1.1l-.9.8c.6 1.4 1.7 2.6 3.2 3.3l.8-.9c.3-.3.8-.4 1.1-.2l2.4 1.2c.4.2.6.7.4 1.1l-.6 1.6c-.2.6-.8.9-1.4.9C6 13.1 2.9 10 2.7 4.2c0-.6.3-1.2.9-1.4z"
				})
			});
		}
		/** 麦克风斜杠（静音）。 */
		function MicIcon({ muted }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "16",
				height: "16",
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.4",
				strokeLinecap: "round",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "5.5",
						y: "1.8",
						width: "5",
						height: "8",
						rx: "2.5",
						fill: muted ? "none" : "currentColor",
						stroke: muted ? "currentColor" : "none"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v2.2" }),
					muted && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M2.5 2.5l11 11" })
				]
			});
		}
		//#endregion
		//#region src/client/CallButton.tsx
		const noInput$1 = (select) => select(void 0);
		const noSession$1 = (select) => select({});
		/** 官方的发送 / 停止按钮（InputBar 的 primary）。没有 data 属性，只能按类名认；有两个时（在跑又打了字）取最后一个。 */
		function findPrimary(card) {
			const list = card.querySelectorAll("button[class*=\"_primary\"]:not(.vr-call-send)");
			return list[list.length - 1] ?? null;
		}
		/** 发送按钮外面可能包了一层只装它的元素（悬停提示）：电话放在这一层外面，免得悬停时弹出「发送」。 */
		function outerOf(primary, card, host) {
			let node = primary;
			for (;;) {
				const parent = node.parentElement;
				if (parent === null || parent === card) return node;
				let others = 0;
				for (const child of Array.from(parent.children)) if (child !== host) others++;
				if (others !== 1) return node;
				node = parent;
			}
		}
		/**
		* 语音通话的入口，和 ChatGPT 一样放在发送按钮的位置：
		* 输入框空着、没附件、agent 没在跑、不在通话时，官方那个灰掉的发送按钮换成电话（同样大小颜色，点一下接通）；
		* 其余时候（有字、有附件、在跑、通话中）都是官方按钮原样。挂断用胶囊上的红色按钮。
		*
		* 官方发送按钮没给插件留位置：本组件挂在 conversation.input.right（同一张卡片里），找到发送按钮后
		* 在它前面放一个占位元素、把电话画进去，并给那个官方按钮打 data-vr-replaced 让 CSS 藏起它。
		* 只在官方按钮是禁用的（空着发不了）时才换，官方认为能发（比如有排队的消息）就不动。
		* 找不到发送按钮（DSH 改了结构）：退回以前那个小电话按钮，保证还能打电话。
		*
		* 接通要在这一下点按里同步完成（解锁声音、建采集），所以不放进 effect。
		*/
		function CallButton({ sessionId, useInput, useSession, inputActions }) {
			const view = useCall(sessionId);
			const ended = useEndedNotice(sessionId);
			const [refusal, setRefusal] = (0, react.useState)(void 0);
			const draft = (useInput ?? noInput$1)((input) => input?.draft ?? "");
			const phase = (useInput ?? noInput$1)((input) => input?.phase ?? "");
			const attachments = (useInput ?? noInput$1)((input) => (input?.attachmentIds ?? []).join("\n"));
			const unavailable = (useSession ?? noSession$1)((session) => session.removed === true || (session.subagent ?? null) !== null);
			const running = (useSession ?? noSession$1)((session) => session.running === true);
			const active = view !== void 0;
			const enabled = sessionId !== void 0 && !unavailable;
			const want = enabled && !active && !running && draft.trim() === "" && attachments === "" && (phase === "plain" || phase === "");
			const anchor = (0, react.useRef)(null);
			const [seat, setSeat] = (0, react.useState)(null);
			const [fallback, setFallback] = (0, react.useState)(false);
			const wantRef = (0, react.useRef)(want);
			wantRef.current = want;
			const syncRef = (0, react.useRef)(() => {});
			(0, react.useLayoutEffect)(() => {
				const card = anchor.current?.closest("[data-composer-card]") ?? null;
				if (card === null) {
					setFallback(true);
					return;
				}
				let host = null;
				/** 被换掉（藏起来）的那个官方按钮。只藏它，不按类名一把藏，免得误藏停止按钮。 */
				let replaced = null;
				let frame = 0;
				const unmark = () => {
					replaced?.removeAttribute("data-vr-replaced");
					replaced = null;
				};
				const hide = () => {
					unmark();
					host?.remove();
					setSeat(null);
				};
				const sync = () => {
					frame = 0;
					const primary = findPrimary(card);
					setFallback(primary === null);
					if (primary === null || !wantRef.current || !primary.disabled) {
						hide();
						return;
					}
					const before = outerOf(primary, card, host);
					if (host === null) {
						host = document.createElement("span");
						host.className = "vr-call-send-seat";
					}
					if (host.nextSibling !== before || host.parentElement !== before.parentElement) before.parentElement?.insertBefore(host, before);
					if (replaced !== primary) {
						unmark();
						primary.setAttribute("data-vr-replaced", "");
						replaced = primary;
					}
					const next = {
						host,
						className: primary.className
					};
					setSeat((current) => current?.host === next.host && current.className === next.className ? current : next);
				};
				syncRef.current = sync;
				sync();
				const observer = new MutationObserver(() => {
					if (frame === 0) frame = requestAnimationFrame(sync);
				});
				observer.observe(card, {
					subtree: true,
					childList: true,
					attributes: true,
					attributeFilter: ["disabled"]
				});
				return () => {
					observer.disconnect();
					cancelAnimationFrame(frame);
					syncRef.current = () => {};
					hide();
				};
			}, []);
			(0, react.useLayoutEffect)(() => {
				syncRef.current();
			}, [want]);
			(0, react.useEffect)(() => {
				if (refusal === void 0) return;
				const timer = setTimeout(() => setRefusal((current) => current === refusal ? void 0 : current), 4e3);
				return () => clearTimeout(timer);
			}, [refusal]);
			if (!enabled) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				ref: anchor,
				className: "vr-call-anchor"
			});
			const notice = refusal ?? ended;
			const onClick = () => {
				if (active) {
					hangupCall();
					return;
				}
				setRefusal(startCall({
					sessionId,
					actions: inputActions,
					input: inputActions === void 0 ? void 0 : {
						draft,
						phase,
						attachmentIds: attachments === "" ? [] : attachments.split("\n")
					}
				}));
			};
			const noticeEl = notice !== void 0 && !active ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "vr-call-notice",
				role: "status",
				children: notice
			}) : null;
			if (fallback) {
				const label = active ? "挂断语音通话" : "语音通话：说话直接发送，回复读给你听";
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					ref: anchor,
					className: "vr-call-wrap",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "vr-call",
						"data-active": active ? "" : void 0,
						"aria-label": label,
						title: label,
						onClick,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PhoneIcon, { hangup: active })
					}), noticeEl]
				});
			}
			const label = "语音通话：说话直接发送，回复读给你听";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				ref: anchor,
				className: "vr-call-anchor",
				children: seat !== null && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
					className: "vr-call-wrap",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: `${seat.className} vr-call-send`,
						"aria-label": label,
						title: label,
						onClick,
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PhoneIcon, {})
					}), noticeEl]
				}), seat.host)
			});
		}
		//#endregion
		//#region src/client/call/glass.ts
		/** 「没有阴影」：要放进逗号分隔的阴影列表里，不能用 none。 */
		const NO_SHADOW = "0 0 #0000";
		const TRANSPARENT = /^(transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)|#0000(0000)?)$/i;
		function isTransparent(color) {
			const value = color.trim();
			return value === "" || TRANSPARENT.test(value);
		}
		/** 按顶层逗号拆阴影列表（rgba(…) 里的逗号不拆）。 */
		function splitShadows(value) {
			const out = [];
			let depth = 0;
			let start = 0;
			for (let i = 0; i < value.length; i++) {
				const ch = value[i];
				if (ch === "(") depth++;
				else if (ch === ")") depth = Math.max(0, depth - 1);
				else if (ch === "," && depth === 0) {
					out.push(value.slice(start, i).trim());
					start = i + 1;
				}
			}
			out.push(value.slice(start).trim());
			return out.filter((shadow) => shadow !== "" && shadow !== "none");
		}
		/** 卡片的样子 → 胶囊的 CSS 变量（名字见 call-styles.ts 的 .vr-call-panel）。 */
		function glassVars(card, under) {
			const inset = [];
			const outer = [];
			if (Number.parseFloat(card.borderWidth) > 0 && card.borderStyle !== "none" && card.borderStyle !== "hidden" && !isTransparent(card.borderColor)) inset.push(`inset 0 0 0 ${card.borderWidth.trim()} ${card.borderColor.trim()}`);
			for (const shadow of splitShadows(card.boxShadow)) (/\binset\b/.test(shadow) ? inset : outer).push(shadow);
			const drawn = under !== void 0 && under.content !== "none" && under.content !== "normal";
			const vars = {};
			const radius = (card.borderRadius ?? "").trim().split(/\s+/)[0] ?? "";
			if (/^\d+(\.\d+)?px$/.test(radius) && Number.parseFloat(radius) > 0) vars["--vr-glass-radius"] = radius;
			const shape = (card.cornerShape ?? "").trim();
			if (shape !== "") vars["--vr-glass-corner"] = shape;
			return {
				...vars,
				"--vr-glass-face": card.backgroundColor.trim() || "transparent",
				"--vr-glass-face-image": card.backgroundImage.trim() || "none",
				"--vr-glass-inset": inset.length > 0 ? inset.join(", ") : NO_SHADOW,
				"--vr-glass-outer": outer.length > 0 ? outer.join(", ") : NO_SHADOW,
				"--vr-glass-under": drawn ? under.backgroundColor.trim() || "transparent" : "transparent",
				"--vr-glass-under-image": drawn ? under.backgroundImage.trim() || "none" : "none",
				"--vr-glass-blur": drawn ? under.backdropFilter.trim() || "none" : "none"
			};
		}
		//#endregion
		//#region src/client/call-glass.ts
		/**
		* 胶囊跟着输入框卡片的玻璃走：读卡片（和它 ::before）的计算样式，写成 CSS 变量挂在胶囊的位置（.vr-call-seat）上。
		* 换外观（插件页切单层 / 双层 / 原版、玻璃款式、调透明度）、换深浅色、手机横竖屏时重新读。
		* 换算规则见 call/glass.ts。
		*/
		/** 外观变了以后，等过渡动画走完再读一次。 */
		const SETTLE_MS = 450;
		function backdrop(style) {
			return style.getPropertyValue("backdrop-filter") || style.getPropertyValue("-webkit-backdrop-filter");
		}
		/** 开始跟随；返回停止跟随的函数（会把写上去的变量拿掉）。 */
		function mirrorGlass(card, host) {
			let frame = 0;
			let timer;
			let written = [];
			const apply = () => {
				frame = 0;
				if (!card.isConnected || !host.isConnected) return;
				const look = getComputedStyle(card);
				const under = getComputedStyle(card, "::before");
				const vars = glassVars({
					backgroundColor: look.backgroundColor,
					backgroundImage: look.backgroundImage,
					boxShadow: look.boxShadow,
					borderWidth: look.borderTopWidth,
					borderStyle: look.borderTopStyle,
					borderColor: look.borderTopColor,
					borderRadius: Number.parseFloat(look.borderTopLeftRadius) > 0 ? look.borderTopLeftRadius : look.borderBottomLeftRadius,
					cornerShape: look.getPropertyValue("corner-shape")
				}, {
					content: under.content,
					backgroundColor: under.backgroundColor,
					backgroundImage: under.backgroundImage,
					backdropFilter: backdrop(under)
				});
				for (const name of written) if (!(name in vars)) host.style.removeProperty(name);
				written = Object.keys(vars);
				for (const [name, value] of Object.entries(vars)) host.style.setProperty(name, value);
			};
			const schedule = () => {
				if (frame === 0) frame = requestAnimationFrame(apply);
				clearTimeout(timer);
				timer = setTimeout(apply, SETTLE_MS);
			};
			apply();
			const observer = new MutationObserver(schedule);
			observer.observe(document.documentElement, { attributes: true });
			observer.observe(document.body, { attributes: true });
			observer.observe(card, {
				attributes: true,
				attributeFilter: ["class", "style"]
			});
			observer.observe(document.head, {
				childList: true,
				subtree: true,
				characterData: true
			});
			const dark = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : void 0;
			dark?.addEventListener("change", schedule);
			window.addEventListener("resize", schedule);
			timer = setTimeout(apply, SETTLE_MS);
			return () => {
				observer.disconnect();
				dark?.removeEventListener("change", schedule);
				window.removeEventListener("resize", schedule);
				cancelAnimationFrame(frame);
				clearTimeout(timer);
				for (const name of written) host.style.removeProperty(name);
			};
		}
		//#endregion
		//#region src/client/call-visual.ts
		/**
		* 通话胶囊底部的波浪和左边头像的光边：一个 requestAnimationFrame 循环，每帧直接取麦克风 / 朗读的音量，
		* 画到 canvas 上，并把音量写进头像的 --vr-level（不经过 React 重渲染）。
		*
		* - 你说话时跟麦克风，它念的时候跟朗读，在想 / 在干活时低幅度慢慢流动，静音、暂停变成平线（见 meter.ts）。
		* - 换状态时颜色在 0.4 秒里渐变过去。
		* - 系统开了「减少动态效果」：不流动，只按状态画一条静止的波浪。
		*/
		const COLOR_FADE_MS = 400;
		/** 一帧最多按这么久算（切回前台时别一下跳太远）。 */
		const MAX_DT_MS = 100;
		/** 波浪最高到胶囊高度的这么多（再高就压到字了）。 */
		const MAX_AMP_RATIO = .42;
		/** 波浪的基线离底边这么远（平线时看得到）。 */
		const BASELINE_INSET = 4;
		const STEP_PX = 4;
		function rgbOf(tone, dark) {
			return paletteOf(tone, dark).map((hex) => parseHex(hex) ?? [
				128,
				128,
				128
			]);
		}
		/** DSH 深色主题时 body 上有 data-ds-dark-theme（和 call-styles.ts 的选择器一致）。 */
		function isDark() {
			return document.body.hasAttribute("data-ds-dark-theme");
		}
		function rgba([r, g, b], alpha) {
			return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha.toFixed(3)})`;
		}
		const LAYERS = [
			{
				freq: 1.3,
				speed: .9,
				offset: 0,
				scale: 1,
				alpha: .2,
				from: 2,
				to: 0,
				stroke: false
			},
			{
				freq: 1.9,
				speed: -1.3,
				offset: 2,
				scale: .72,
				alpha: .24,
				from: 0,
				to: 1,
				stroke: false
			},
			{
				freq: 1.05,
				speed: .6,
				offset: 4,
				scale: .88,
				alpha: .3,
				from: 1,
				to: 2,
				stroke: true
			}
		];
		function draw(ctx, w, h, dpr, level, time, colors) {
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, w, h);
			if (w <= 0 || h <= 0) return;
			const base = h - BASELINE_INSET;
			const amp = level * h * MAX_AMP_RATIO;
			for (const layer of LAYERS) {
				const points = [];
				for (let x = 0; x <= w + STEP_PX; x += STEP_PX) {
					const u = Math.min(1, x / w);
					const envelope = Math.sin(Math.PI * u) ** 1.5;
					const wave = .55 + .45 * Math.sin(2 * Math.PI * (layer.freq * u + layer.speed * time) + layer.offset);
					points.push(Math.min(x, w), base - amp * layer.scale * envelope * wave);
				}
				const across = ctx.createLinearGradient(0, 0, w, 0);
				across.addColorStop(0, rgba(colors[layer.from], 0));
				across.addColorStop(.2, rgba(colors[layer.from], layer.alpha));
				across.addColorStop(.8, rgba(colors[layer.to], layer.alpha));
				across.addColorStop(1, rgba(colors[layer.to], 0));
				ctx.beginPath();
				ctx.moveTo(0, h);
				for (let i = 0; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
				ctx.lineTo(w, h);
				ctx.closePath();
				ctx.fillStyle = across;
				ctx.fill();
				if (!layer.stroke) continue;
				const line = ctx.createLinearGradient(0, 0, w, 0);
				line.addColorStop(0, rgba(colors[layer.from], 0));
				line.addColorStop(.25, rgba(colors[layer.from], .85));
				line.addColorStop(.75, rgba(colors[layer.to], .85));
				line.addColorStop(1, rgba(colors[layer.to], 0));
				ctx.beginPath();
				ctx.moveTo(points[0], points[1]);
				for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
				ctx.lineWidth = 1.5;
				ctx.lineJoin = "round";
				ctx.strokeStyle = line;
				ctx.shadowColor = rgba(colors[1], .6);
				ctx.shadowBlur = 6;
				ctx.stroke();
				ctx.shadowBlur = 0;
			}
		}
		/** 返回给 canvas（波浪）和头像用的 ref。 */
		function useCallVisual(phase) {
			const canvasRef = (0, react.useRef)(null);
			const avatarRef = (0, react.useRef)(null);
			const tone = toneOf(phase);
			const toneRef = (0, react.useRef)(tone);
			(0, react.useLayoutEffect)(() => {
				toneRef.current = tone;
			}, [tone]);
			(0, react.useEffect)(() => {
				const canvas = canvasRef.current;
				const ctx = canvas?.getContext("2d") ?? null;
				if (canvas === null || ctx === null) return;
				const reduce = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : void 0;
				let width = 0;
				let height = 0;
				let dpr = 1;
				let dirty = true;
				const resize = () => {
					dpr = Math.min(2, window.devicePixelRatio || 1);
					width = canvas.clientWidth;
					height = canvas.clientHeight;
					canvas.width = Math.max(1, Math.round(width * dpr));
					canvas.height = Math.max(1, Math.round(height * dpr));
					dirty = true;
				};
				resize();
				const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : void 0;
				observer?.observe(canvas);
				let shown = toneRef.current;
				let dark = isDark();
				let from = rgbOf(shown, dark);
				let to = from;
				let fade = 1;
				let level = 0;
				let time = 0;
				let last = performance.now();
				let frame = 0;
				const step = (now) => {
					frame = requestAnimationFrame(step);
					const dt = Math.min(MAX_DT_MS, Math.max(0, now - last));
					last = now;
					const current = toneRef.current;
					const nowDark = isDark();
					if (current !== shown || nowDark !== dark) {
						from = from.map((c, i) => mixRgb(c, to[i], fade));
						to = rgbOf(current, nowDark);
						fade = 0;
						shown = current;
						dark = nowDark;
						dirty = true;
					}
					const still = reduce?.matches === true;
					const fading = fade < 1;
					fade = still ? 1 : Math.min(1, fade + dt / COLOR_FADE_MS);
					const previous = level;
					if (still) level = IDLE_LEVEL[current];
					else {
						const target = targetLevel(current, currentCall()?.levels() ?? {
							mic: 0,
							out: 0
						});
						level = smooth(level, target, dt);
						time += dt / 1e3 * (.25 + level * .9) * (current === "think" ? 1.6 : 1);
					}
					avatarRef.current?.style.setProperty("--vr-level", level.toFixed(3));
					if (!dirty && !fading && !(!still && level > .002) && Math.abs(level - previous) < .001) return;
					dirty = false;
					const colors = from.map((c, i) => mixRgb(c, to[i], fade));
					draw(ctx, width, height, dpr, level, time, colors);
				};
				frame = requestAnimationFrame(step);
				return () => {
					cancelAnimationFrame(frame);
					observer?.disconnect();
				};
			}, []);
			return {
				canvasRef,
				avatarRef,
				tone
			};
		}
		//#endregion
		//#region src/client/CallPanel.tsx
		const noChat$1 = (select) => select(void 0);
		const noInput = (select) => select(void 0);
		const noSession = (select) => select({});
		const nothing$1 = () => "";
		const STATUS = {
			connecting: "正在接通",
			listening: "在听",
			hearing: "在听你说",
			transcribing: "识别中",
			thinking: "在想",
			working: "在干活",
			speaking: "在说",
			"needs-you": "需要你在屏幕上确认",
			muted: "已静音",
			paused: "已暂停",
			ended: "已挂断"
		};
		const HINT = {
			connecting: "请允许使用麦克风",
			listening: "说吧，停一下就发出去",
			hearing: "说完停一下，或点「说完了」",
			transcribing: "",
			thinking: "点这里可以直接说",
			working: "点这里可以插话",
			speaking: "点这里打断",
			"needs-you": "处理完会接着通话",
			muted: "点麦克风取消静音",
			paused: "点这里继续",
			ended: ""
		};
		/** 输入框里有字时，说的话不自动发，接到草稿末尾。 */
		const COMPOSING_HINT = {
			listening: "输入框里有字：说的话会接在末尾，不自动发",
			hearing: "说完停一下，会接到输入框末尾"
		};
		/**
		* 通话胶囊：通话中出现在输入框正上方，输入框照常露着、能打字。
		* 胶囊插在输入框卡片（data-composer-card）前面、跟它同一层，输入区整体变高，不会盖住对话。
		* 它只是视图：通话本身在 call/session 里，审批、提问把输入栏换掉时胶囊卸载，电话照常进行。
		* 挂着的时候顺手把对话内容（给跟读）和输入框状态（给自动发送、接草稿）喂给通话。
		*/
		function CallPanel({ sessionId, useChat, useInput, useSession, inputActions, stop }) {
			const view = useCall(sessionId);
			const active = view !== void 0;
			const anchor = (0, react.useRef)(null);
			const [seat, setSeat] = (0, react.useState)(null);
			const signature = (useChat ?? noChat$1)(active ? selectTurn : nothing$1);
			const progress = (useChat ?? noChat$1)(active ? selectProgress : nothing$1);
			const draft = (useInput ?? noInput)((input) => input?.draft ?? "");
			const phase = (useInput ?? noInput)((input) => input?.phase ?? "");
			const attachments = (useInput ?? noInput)((input) => (input?.attachmentIds ?? []).join("\n"));
			const running = (useSession ?? noSession)((session) => session.running === true);
			const composing = draft.trim() !== "" || attachments !== "";
			(0, react.useLayoutEffect)(() => {
				if (!active) return;
				const card = anchor.current?.closest("[data-composer-card]");
				const parent = card?.parentElement;
				if (card == null || parent == null) return;
				const host = document.createElement("div");
				host.className = "vr-call-seat";
				parent.insertBefore(host, card);
				const stopGlass = mirrorGlass(card, host);
				setSeat(host);
				return () => {
					stopGlass();
					host.remove();
					setSeat(null);
				};
			}, [active]);
			(0, react.useEffect)(() => {
				if (!active) return;
				const call = currentCall();
				if (call === void 0 || call.sessionId !== sessionId) return;
				return call.addViewer();
			}, [active, sessionId]);
			(0, react.useEffect)(() => {
				if (!active) return;
				const call = currentCall();
				if (call === void 0 || call.sessionId !== sessionId) return;
				call.observeInput(inputActions, {
					draft,
					phase,
					attachmentIds: attachments === "" ? [] : attachments.split("\n")
				}, running);
			}, [
				active,
				sessionId,
				inputActions,
				draft,
				phase,
				attachments,
				running
			]);
			(0, react.useEffect)(() => {
				if (!active) return;
				const call = currentCall();
				if (call === void 0 || call.sessionId !== sessionId) return;
				call.feedChat(signature);
			}, [
				active,
				sessionId,
				signature
			]);
			(0, react.useEffect)(() => {
				if (!active) return;
				const call = currentCall();
				if (call === void 0 || call.sessionId !== sessionId) return;
				call.observeAgent(stop, progress);
			}, [
				active,
				sessionId,
				stop,
				progress
			]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: anchor,
				className: "vr-call-anchor",
				children: view !== void 0 && seat !== null && (0, react_dom.createPortal)(/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Panel, {
					view,
					composing
				}), seat)
			});
		}
		function Panel({ view, composing }) {
			const call = () => currentCall();
			const { canvasRef, avatarRef, tone } = useCallVisual(view.phase);
			const heardShown = view.heard !== "" && (view.phase === "thinking" || view.phase === "working" || view.phase === "transcribing");
			const hint = (composing ? COMPOSING_HINT[view.phase] : void 0) ?? HINT[view.phase];
			const sub = view.notice !== "" ? view.notice : heardShown ? `你说：${view.heard}` : hint;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "vr-call-panel",
				"data-phase": view.phase,
				"data-tone": tone,
				role: "region",
				"aria-label": "语音通话",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("canvas", {
						ref: canvasRef,
						className: "vr-call-wave",
						"aria-hidden": "true"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
						type: "button",
						className: "vr-call-main",
						onClick: () => call()?.tap(),
						"aria-label": `${STATUS[view.phase]}${sub === "" ? "" : `，${sub}`}`,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							ref: avatarRef,
							className: "vr-call-avatar",
							"aria-hidden": "true",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "vr-call-avatar-ring" })
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
							className: "vr-call-text",
							"aria-live": "polite",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "vr-call-status",
								children: STATUS[view.phase]
							}), sub !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "vr-call-sub",
								"data-notice": view.notice === "" ? void 0 : view.notice === "已接到输入框末尾，发送时一起发" ? "info" : "warn",
								children: sub
							})]
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "vr-call-actions",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "vr-call-btn vr-call-done",
								hidden: view.phase !== "hearing",
								onClick: () => call()?.done(),
								children: "说完了"
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)(RateButton, {}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "vr-call-btn vr-call-icon",
								"data-on": view.muted ? "" : void 0,
								"aria-label": view.muted ? "取消静音" : "静音",
								"aria-pressed": view.muted,
								title: view.muted ? "取消静音" : "静音",
								onClick: () => call()?.toggleMute(),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(MicIcon, { muted: view.muted })
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "vr-call-btn vr-call-icon vr-call-hangup",
								"aria-label": "挂断",
								title: "挂断",
								onClick: () => call()?.hangup(),
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PhoneIcon, { hangup: true })
							})
						]
					})
				]
			});
		}
		/**
		* 语速按钮：点一下换下一档（1× → 1.25× → 1.5× → 2× → 1×），存进设置，语音模式的朗读也用这个语速。
		* 百炼一段朗读开始后改不了语速，所以正在念的这段照旧，从下一段起变。旧版服务端没有语速就不显示。
		*/
		function RateButton() {
			const { view } = useSettings();
			const rates = view?.catalog.speechRates ?? [];
			const current = view?.settings.speechRate;
			if (rates.length === 0 || typeof current !== "number") return null;
			const next = rates[(rates.indexOf(current) + 1) % rates.length] ?? rates[0];
			const label = `语速 ${formatRate(current)}，点一下换成 ${formatRate(next)}（下一句起生效）`;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "vr-call-btn vr-call-rate",
				"data-on": current !== 1 ? "" : void 0,
				"aria-label": label,
				title: label,
				onClick: () => {
					changeSpeechRate(next).catch((error) => console.warn("[voice-reply] 换语速失败", error));
				},
				children: formatRate(current)
			});
		}
		//#endregion
		//#region src/client/call-styles.ts
		/**
		* 语音通话的样式：输入框右侧的电话按钮，通话中出现在输入框上方的胶囊。
		* 颜色跟 DSH 的主题变量走；官方元素只用稳定的 data 属性（data-composer-card）定位。
		* 头像柔光球和波浪的颜色来自 meter.ts 的 PALETTES / LIGHT_PALETTES（画布也用这一份）。
		*/
		const darkToneVars = Object.keys(PALETTES).map((tone) => {
			const [c1, c2, c3] = PALETTES[tone];
			return `.vr-call-panel[data-tone="${tone}"] { --vr-c1: ${c1}; --vr-c2: ${c2}; --vr-c3: ${c3}; }`;
		});
		/** 浅色主题（body 上没有 data-ds-dark-theme）单独换的那几个，选择器更具体，盖过上面的。 */
		const lightToneVars = Object.keys(LIGHT_PALETTES).map((tone) => {
			const [c1, c2, c3] = LIGHT_PALETTES[tone];
			return `body:not([data-ds-dark-theme]) .vr-call-panel[data-tone="${tone}"] { --vr-c1: ${c1}; --vr-c2: ${c2}; --vr-c3: ${c3}; }`;
		});
		const toneVars = [...darkToneVars, ...lightToneVars].join("\n");
		const [off1, off2, off3] = PALETTES.off;
		const callCss = `
.vr-call-wrap { position: relative; display: inline-flex; flex: none; }
.vr-call {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; flex: none;
  border: none; border-radius: 8px; cursor: pointer;
  color: var(--dsw-alias-label-secondary, #a1a1aa);
  background: transparent;
  transition: background-color .12s ease, color .12s ease;
}
.vr-call:hover { color: var(--dsw-alias-label-primary, #f9fafb); background: color-mix(in srgb, currentColor 10%, transparent); }
.vr-call:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4c8dff); outline-offset: 1px; }
.vr-call[data-active] { color: var(--dsw-alias-state-danger, #f2555a); }
.vr-call-notice {
  position: absolute; right: 0; bottom: calc(100% + 8px); z-index: 6;
  width: max-content; max-width: min(320px, 80vw); padding: 6px 10px; border-radius: 8px;
  font-size: 12px; line-height: 18px; white-space: normal;
  color: var(--dsw-alias-label-primary, #f9fafb);
  background: var(--dsw-specific-menu, rgba(30, 32, 36, .96));
  box-shadow: var(--dsw-elevation-panel, 0 4px 16px rgba(0,0,0,.3));
  pointer-events: none;
}

/* 颜色注册成 <color>，换状态时能渐变（不支持的浏览器直接切换） */
@property --vr-c1 { syntax: '<color>'; inherits: true; initial-value: ${off1}; }
@property --vr-c2 { syntax: '<color>'; inherits: true; initial-value: ${off2}; }
@property --vr-c3 { syntax: '<color>'; inherits: true; initial-value: ${off3}; }

.vr-call-anchor { position: absolute; width: 0; height: 0; overflow: hidden; }
/* 发送按钮位置的电话（CallButton.tsx）：占位元素不占布局，被换掉的那个官方发送按钮藏起来 */
.vr-call-send-seat { display: contents; }
[data-composer-card] [data-vr-replaced] { display: none !important; }
/* 发送位置的电话：听筒朝左（左右镜像） */
.vr-call-send svg { transform: scaleX(-1); }
/* 胶囊的位置：插在输入框卡片前面，和卡片一样宽 */
.vr-call-seat {
  box-sizing: border-box; flex: none;
  width: 100%; max-width: var(--dsh-composer-card-max-width, 100%);
  margin: 0 0 8px;
}
.vr-call-panel {
  --vr-c1: ${off1}; --vr-c2: ${off2}; --vr-c3: ${off3};
  --vr-surface: var(--dsw-alias-bg-l1, var(--dsw-specific-menu, #1e2024));
  position: relative; isolation: isolate; overflow: hidden; box-sizing: border-box;
  display: flex; align-items: center; gap: 8px;
  min-height: 60px; padding: 8px 10px 8px 8px;
  /* 圆角和圆角形状照抄输入框卡片（call-glass.ts 写的变量）；默认对齐官方超椭圆 */
  border-radius: var(--vr-glass-radius, 999px);
  corner-shape: var(--vr-glass-corner, var(--dsw-corner-shape, superellipse(1.5)));
  background: transparent;
  color: var(--dsw-alias-label-primary, #f9fafb);
  /* 外投影照抄输入框卡片（call-glass.ts 写的变量），再加一圈很淡的状态色光晕 */
  box-shadow:
    var(--vr-glass-outer, 0 0 #0000),
    0 4px 18px color-mix(in srgb, var(--vr-c2) 14%, transparent);
  transition: --vr-c1 .4s ease, --vr-c2 .4s ease, --vr-c3 .4s ease;
}
/* 玻璃：和输入框卡片同样两层。::before 是磨砂层（卡片 ::before 的底色 + 模糊），::after 是卡片底色 / 渐变和内细边。
   磨砂画在伪元素上，不写在胶囊身上（backdrop-filter 会给后代造包含块，见 harness-plus glass.css.ts 的说明）。
   读不到卡片时（变量都没有）：实色底 + 一圈状态色细边，和以前一样。 */
.vr-call-panel::before, .vr-call-panel::after {
  content: ''; position: absolute; inset: 0; z-index: -1; pointer-events: none;
  border-radius: inherit; corner-shape: var(--vr-glass-corner, var(--dsw-corner-shape, superellipse(1.5)));
}
.vr-call-panel::before {
  background-color: var(--vr-glass-under, transparent);
  background-image: var(--vr-glass-under-image, none);
  -webkit-backdrop-filter: var(--vr-glass-blur, none);
  backdrop-filter: var(--vr-glass-blur, none);
}
.vr-call-panel::after {
  background-color: var(--vr-glass-face, var(--vr-surface));
  background-image: var(--vr-glass-face-image, none);
  box-shadow: var(--vr-glass-inset, inset 0 0 0 1px color-mix(in srgb, var(--vr-c2) 28%, transparent));
}
${toneVars}
.vr-call-wave { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; pointer-events: none; }
.vr-call-main, .vr-call-actions { position: relative; z-index: 1; }
.vr-call-main {
  display: flex; align-items: center; gap: 12px; flex: 1 1 auto; min-width: 0; height: 44px;
  /* 和胶囊同心：胶囊圆角减去内边距 */
  padding: 0 8px 0 0; border: none; border-radius: max(12px, calc(var(--vr-glass-radius, 999px) - 8px));
  corner-shape: var(--vr-glass-corner, var(--dsw-corner-shape, superellipse(1.5)));
  cursor: pointer; text-align: left;
  color: inherit; background: transparent; font: inherit;
}
.vr-call-main:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4c8dff); outline-offset: -2px; }

/* 头像：一团柔和的暖色光球，不转、没有硬边，靠慢慢呼吸和随音量的柔光表达状态。
    DSH 主题给所有元素默认 corner-shape: superellipse（圆角方形），这里要改回真正的圆 */
.vr-call-avatar::before, .vr-call-avatar-ring { corner-shape: round; }
.vr-call-avatar {
  --vr-level: 0;
  position: relative; flex: none; width: 40px; height: 40px;
  transform: scale(calc(.94 + var(--vr-level) * .14));
}
.vr-call-avatar::before {
  content: ''; position: absolute; inset: -4px; z-index: -1; border-radius: 50%;
  background: radial-gradient(circle, var(--vr-c2) 30%, transparent 72%);
  filter: blur(8px);
  opacity: calc(.12 + var(--vr-level) * .55);
}
.vr-call-avatar-ring {
  position: absolute; inset: 0; border-radius: 50%;
  background: radial-gradient(circle at 36% 30%, var(--vr-c1), var(--vr-c2) 85%);
  animation: vr-call-soft 4.5s ease-in-out infinite;
}
.vr-call-panel[data-tone="think"] .vr-call-avatar-ring { animation-duration: 2.2s; }
.vr-call-panel[data-tone="speak"] .vr-call-avatar-ring { animation-duration: 3s; }
.vr-call-panel[data-tone="alert"] .vr-call-avatar { animation: vr-call-breathe .9s ease-in-out infinite alternate; }
.vr-call-panel[data-tone="off"] .vr-call-avatar-ring { animation: none; opacity: .7; }
.vr-call-panel[data-phase="connecting"] .vr-call-avatar { animation: vr-call-breathe 1.2s ease-in-out infinite alternate; }

.vr-call-text { display: flex; flex-direction: column; min-width: 0; }
.vr-call-status { font-size: 14px; line-height: 20px; font-weight: 500; }
.vr-call-sub {
  font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, #a1a1aa);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.vr-call-sub[data-notice="warn"] { color: var(--dsw-alias-state-warning, #f5a524); }
.vr-call-actions { display: flex; align-items: center; gap: 6px; flex: none; }
.vr-call-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  height: 36px; padding: 0 12px; border: none; border-radius: 18px; cursor: pointer;
  font: inherit; font-size: 13px;
  color: var(--dsw-alias-label-primary, #f9fafb);
  /* 半透明，透出胶囊的玻璃（波浪两头收窄，到按钮这里最多高 4px 左右，不会透上来） */
  background: color-mix(in srgb, var(--dsw-alias-label-primary, #f9fafb) 10%, transparent);
}
/* DSH 主题默认把圆角画成圆角方形：按钮和胶囊要真正的圆 */
.vr-call-btn { corner-shape: round; }
.vr-call-btn[hidden] { display: none; }
.vr-call-btn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary, #4c8dff); outline-offset: 1px; }
.vr-call-icon { width: 36px; padding: 0; border-radius: 50%; }
.vr-call-icon[data-on] { color: var(--dsw-alias-state-warning, #f5a524); }
.vr-call-hangup { color: #fff; background: var(--dsw-alias-state-danger, #f2555a); }
/* 语速按钮：和圆按钮一样高，宽度够放「1.25×」，数字等宽免得换档时跳 */
.vr-call-rate { min-width: 48px; padding: 0 8px; font-variant-numeric: tabular-nums; font-weight: 600; font-size: 12px; }
.vr-call-rate[data-on] { color: var(--dsw-alias-state-business-primary, #4c8dff); }
@keyframes vr-call-soft { 0%, 100% { scale: 1 } 50% { scale: 1.07 } }
@keyframes vr-call-breathe { from { opacity: .5 } to { opacity: 1 } }
@media (max-width: 480px) {
  .vr-call-panel { min-height: 56px; gap: 6px; padding: 6px 8px 6px 6px; }
  .vr-call-avatar { width: 36px; height: 36px; }
  .vr-call-main { gap: 10px; }
  .vr-call-actions { gap: 4px; }
}
@media (prefers-reduced-motion: reduce) {
  .vr-call-avatar, .vr-call-avatar-ring { animation: none !important; }
  .vr-call-avatar { transform: none; }
  .vr-call-panel { transition: none; }
}
`;
		//#endregion
		//#region src/client/call/noise-meter.ts
		/**
		* 设置页「测一下环境噪声」用的纯计算：记最近几秒的音量，估环境底噪，给出档位建议。
		*
		* 底噪取最近几秒音量的低分位（默认第 20 百分位），不跟断句的底噪估计走：
		* 断句在「当成你在说话」时不更新底噪，风扇声被误当成说话时它的读数会停住。
		*
		* 纯计算，不碰浏览器 API，Node 里能直接测。只用可擦除的 TypeScript 语法。
		*/
		const SENSITIVITY_LABELS = {
			lowest: "很低",
			low: "低",
			medium: "中",
			high: "高"
		};
		var LevelHistory = class {
			items = [];
			totalMs = 0;
			windowMs;
			percentile;
			constructor(windowMs = 3e3, percentile = .2) {
				this.windowMs = windowMs;
				this.percentile = percentile;
			}
			/** 记一块音频的音量（dBFS）和时长（毫秒）。 */
			push(db, ms) {
				if (!Number.isFinite(db) || !(ms > 0)) return;
				this.items.push({
					db,
					ms
				});
				this.totalMs += ms;
				while (this.items.length > 1 && this.totalMs - this.items[0].ms >= this.windowMs) this.totalMs -= this.items.shift().ms;
			}
			/** 记满多久了（毫秒，最多 windowMs）。 */
			get coveredMs() {
				return Math.min(this.totalMs, this.windowMs);
			}
			/** 估计的环境底噪：音量的低分位。还没数据时 null。 */
			floorDb() {
				if (this.items.length === 0) return null;
				const sorted = this.items.map((i) => i.db).sort((a, b) => a - b);
				return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * this.percentile))];
			}
			clear() {
				this.items = [];
				this.totalMs = 0;
			}
		};
		/** 按底噪给一句建议；current 是现在选的档。 */
		function adviceFor(noiseDb, current) {
			const suggested = suggestSensitivity(noiseDb);
			if (suggested === null) return "环境太吵，很低档也不够用：说完点「说完了」，或戴耳机麦克风。";
			const label = SENSITIVITY_LABELS[suggested];
			if (current === suggested) return `现在的「${label}」档合适。`;
			if (current === "high" && suggested === "medium") return "这个环境用「中」档就够；你说话轻、常听不到时再用「高」。";
			return `建议用「${label}」档。`;
		}
		//#endregion
		//#region src/client/NoiseMeter.tsx
		/** 测多久自动停。 */
		const AUTO_STOP_MS = 6e4;
		/** 界面刷新间隔。 */
		const TICK_MS = 150;
		/** 至少记这么久的音量再给建议。 */
		const ADVICE_AFTER_MS = 2500;
		/** 音量条的范围（dBFS）。 */
		const BAR_MIN_DB = -70;
		const BAR_MAX_DB = -10;
		function asLevel(value) {
			return value in SENSITIVITY_LABELS ? value : "medium";
		}
		function barPercent(db) {
			return Math.round(Math.min(1, Math.max(0, (db - BAR_MIN_DB) / (BAR_MAX_DB - BAR_MIN_DB))) * 100);
		}
		/**
		* 设置页「测一下环境噪声」：开麦克风，实时显示音量、环境底噪、现在这档的说话门限，
		* 以及断句认为你在说还是安静了。按选的档位和停顿时长判断，和通话里一致。
		*/
		function NoiseMeter({ sensitivity, silenceMs }) {
			const run = (0, react.useRef)(null);
			const [reading, setReading] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const level = asLevel(sensitivity);
			const stop = () => {
				const r = run.current;
				if (r === null) return;
				run.current = null;
				clearInterval(r.timer);
				r.mic.close();
				setReading(null);
			};
			(0, react.useEffect)(() => {
				run.current?.vad.setSensitivity(level);
				run.current?.vad.setSilenceMs(silenceMs);
			}, [level, silenceMs]);
			(0, react.useEffect)(() => stop, []);
			const start = () => {
				setError(null);
				const mic = Mic.create();
				if (mic === void 0) {
					setError("这个浏览器不能录音");
					return;
				}
				const vad = new Vad({
					sampleRate: mic.sampleRate,
					silenceMs
				});
				vad.setSensitivity(level);
				const r = {
					mic,
					vad,
					history: new LevelHistory(),
					stopAt: performance.now() + AUTO_STOP_MS,
					last: "",
					timer: setInterval(() => {
						if (run.current !== r) return;
						if (performance.now() >= r.stopAt) {
							stop();
							return;
						}
						setReading({
							levelDb: r.vad.lastDb,
							floorDb: r.history.floorDb(),
							thresholdDb: r.vad.thresholdDb,
							coveredMs: r.history.coveredMs,
							speaking: r.vad.isSpeaking,
							last: r.last
						});
					}, TICK_MS)
				};
				run.current = r;
				setReading({
					levelDb: BAR_MIN_DB,
					floorDb: null,
					thresholdDb: vad.thresholdDb,
					coveredMs: 0,
					speaking: false,
					last: ""
				});
				mic.open({
					audio(samples) {
						if (run.current !== r) return;
						r.history.push(rmsDb(samples), samples.length / mic.sampleRate * 1e3);
						for (const event of r.vad.push(samples)) if (event.kind === "end") r.last = `认出一句 ${(event.speechMs / 1e3).toFixed(1)} 秒，通话里这时会发出去`;
						else if (event.kind === "discard") r.last = "刚才那下太短，当成杂音丢掉了";
					},
					wantsAudio: () => true,
					lost(message) {
						if (run.current !== r) return;
						stop();
						setError(message);
					}
				}).catch((e) => {
					if (run.current !== r) return;
					stop();
					setError(e instanceof MicError ? e.message : `打不开麦克风：${e instanceof Error ? e.message : String(e)}`);
				});
			};
			const threshold = reading === null || reading.coveredMs < 300 ? null : reading.thresholdDb;
			const ready = reading !== null && reading.floorDb !== null && reading.coveredMs >= ADVICE_AFTER_MS;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "vr-meter",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "vr-settings-control",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "vr-settings-button",
							onClick: reading === null ? start : stop,
							children: reading === null ? "测一下环境噪声" : "停止"
						}), reading !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "vr-settings-value",
							"data-speaking": reading.speaking ? "" : void 0,
							children: reading.speaking ? "当成你在说话" : "安静"
						}) : null]
					}),
					reading !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "vr-meter-bar",
							"aria-hidden": "true",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "vr-meter-fill",
									"data-speaking": reading.speaking ? "" : void 0,
									style: { width: `${barPercent(reading.levelDb)}%` }
								}),
								reading.floorDb !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "vr-meter-mark",
									"data-kind": "floor",
									style: { left: `${barPercent(reading.floorDb)}%` }
								}) : null,
								threshold !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: "vr-meter-mark",
									"data-kind": "threshold",
									style: { left: `${barPercent(threshold)}%` }
								}) : null
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "vr-settings-note",
							children: `音量 ${Math.round(reading.levelDb)} dB · 底噪 ${reading.floorDb === null ? "—" : Math.round(reading.floorDb)} dB · 「${SENSITIVITY_LABELS[level]}」档门限 ${threshold === null ? "—" : Math.round(threshold)} dB`
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "vr-settings-note vr-settings-ok",
							children: ready ? adviceFor(reading.floorDb, level) : "先别出声，等 3 秒…"
						}),
						reading.last !== "" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "vr-settings-note",
							children: reading.last
						}) : null
					] }) : null,
					error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "vr-settings-note vr-settings-error",
						children: error
					}) : null
				]
			});
		}
		//#endregion
		//#region src/client/SettingsParts.tsx
		/** 带标题的设置卡片。 */
		function Card({ title, children, disabled }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
				className: "vr-set-section",
				children: [title !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h4", {
					className: "vr-settings-title",
					children: title
				}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("fieldset", {
					className: "vr-set-card",
					disabled,
					"data-disabled": disabled === true ? "" : void 0,
					children
				})]
			});
		}
		/** 卡片里可折叠的一组（调一次就不再动的设置）。 */
		function Fold({ summary, children }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("details", {
				className: "vr-set-fold",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("summary", {
					className: "vr-set-fold-summary",
					children: summary
				}), children]
			});
		}
		/** 标题旁的小标签：本机运行 / 云端计费。 */
		function Badge({ kind }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "vr-badge",
				"data-kind": kind,
				children: kind === "local" ? "本机" : "云端·计费"
			});
		}
		/**
		* 一行设置：左边标题 + 一句话说明（有长说明时带「详情」展开），右边是控件。
		* stack 为真时控件放到下面，占满整行（噪声测试用）。
		*/
		function Row({ label, htmlFor, badge, hint, help, stack, children }) {
			const [open, setOpen] = (0, react.useState)(false);
			const helpId = (0, react.useId)();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "vr-row",
				"data-stack": stack === true ? "" : void 0,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "vr-row-text",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "vr-row-head",
							children: [htmlFor === void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "vr-row-label",
								children: label
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("label", {
								className: "vr-row-label",
								htmlFor,
								children: label
							}), badge !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Badge, { kind: badge }) : null]
						}),
						hint !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
							className: "vr-row-hint",
							children: [hint, help !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "vr-row-more",
								"aria-expanded": open,
								"aria-controls": helpId,
								onClick: () => setOpen(!open),
								children: open ? "收起" : "详情"
							}) : null]
						}) : null,
						open && help !== void 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "vr-row-help",
							id: helpId,
							children: help
						}) : null
					]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "vr-row-control",
					children
				})]
			});
		}
		/** 开关：仍是 checkbox（读屏和键盘照旧），外观是 switch。 */
		function Switch({ id, checked, disabled, onChange }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
				id,
				type: "checkbox",
				role: "switch",
				className: "vr-switch",
				checked,
				disabled,
				onChange: (e) => onChange(e.target.checked)
			});
		}
		//#endregion
		//#region src/client/HoldSettings.tsx
		/** 可嵌入语音插件设置页的按住说话开关。 */
		function HoldSettings() {
			const { view, error } = useSettings();
			const id = (0, react.useId)();
			const [saving, setSaving] = (0, react.useState)(false);
			const [saveError, setSaveError] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				loadSettings();
			}, []);
			const change = async (holdEnabled) => {
				setSaving(true);
				setSaveError(null);
				try {
					await saveSettings({ holdEnabled });
				} catch (cause) {
					setSaveError(cause instanceof Error ? cause.message : String(cause));
				} finally {
					setSaving(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
					label: "按住说话",
					htmlFor: id,
					hint: "在输入框按住说话，松开后识别并插入草稿。关闭后恢复官方语音输入按钮。",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
						id,
						checked: view?.settings.holdEnabled !== false,
						disabled: view === null || saving,
						onChange: (next) => void change(next)
					})
				}),
				view === null && error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: "vr-settings-note vr-settings-error",
					children: ["读不到设置：", error]
				}),
				saveError !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: "vr-settings-note vr-settings-error",
					role: "alert",
					children: ["没保存上：", saveError]
				})
			] });
		}
		//#endregion
		//#region src/client/bridge.ts
		/**
		* 和 dsh-harness-plus「对话信息」面板之间的约定（不 import 任何东西，方便测试）。
		*
		* - 本插件在 window.__dshVoiceReply 登记「自动朗读回复」开关，变化时发 VOICE_EVENT。
		*   harness-plus 读到它就在面板里画一行开关；读不到（本插件没装或已停用）就不画。
		* - harness-plus 的面板挂载时在 window.__dshHarnessPlus 上标 sessionInfo.voice = true，发 HARNESS_EVENT。
		*   本插件看到它，输入框里就不放常驻开关，只在正在念 / 声音被拦住 / 出错时临时冒出一个按钮。
		*   看不到（harness-plus 没装、已停用、旧版）就退回原来的常驻开关，开关不会丢。
		*/
		const VOICE_EVENT = "dsh-voice-reply:change";
		const HARNESS_EVENT = "dsh-harness-plus:change";
		/** 在 window 上登记开关；返回撤销函数（只撤自己登记的那个）。 */
		function publishVoiceApi(win, api) {
			win.__dshVoiceReply = api;
			win.dispatchEvent(new Event(VOICE_EVENT));
			return () => {
				if (win.__dshVoiceReply === api) delete win.__dshVoiceReply;
				win.dispatchEvent(new Event(VOICE_EVENT));
			};
		}
		/** harness-plus 的对话信息面板在不在、有没有「自动朗读」那一行。 */
		function hostHasVoiceRow(win) {
			try {
				const host = win.__dshHarnessPlus;
				return host?.version === 1 && host.sessionInfo?.voice === true;
			} catch {
				return false;
			}
		}
		function toggleView(s) {
			if (s.blocked) return "unlock";
			if (s.speaking) return "stop";
			if (s.panel) return s.error ? "error" : "hidden";
			return s.enabled ? "on" : "off";
		}
		//#endregion
		//#region src/client/store.ts
		/** 「语音模式」开关，存在本机浏览器里，所有对话共用。 */
		const STORAGE_KEY = "@kewen/dsh-voice-reply:enabled";
		const listeners = /* @__PURE__ */ new Set();
		function read() {
			try {
				return window.localStorage.getItem(STORAGE_KEY) === "1";
			} catch {
				return false;
			}
		}
		let enabled = read();
		function isEnabled() {
			return enabled;
		}
		function setEnabled(next) {
			if (next === enabled) return;
			enabled = next;
			try {
				window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
			} catch {}
			for (const listener of listeners) listener();
		}
		function subscribeEnabled(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
		function useEnabled() {
			return (0, react.useSyncExternalStore)(subscribeEnabled, isEnabled, isEnabled);
		}
		/** 外部（对话信息面板）改开关时也通知订阅者。 */
		function onEnabledChange(listener) {
			return subscribeEnabled(listener);
		}
		function subscribeHost(listener) {
			window.addEventListener(HARNESS_EVENT, listener);
			return () => window.removeEventListener(HARNESS_EVENT, listener);
		}
		const readHost = () => hostHasVoiceRow(window);
		/** dsh-harness-plus 的对话信息面板里有没有「自动朗读」那一行。 */
		function useHostVoiceRow() {
			return (0, react.useSyncExternalStore)(subscribeHost, readHost, () => false);
		}
		/** 播放状态一变就重渲染（返回值本身不用，读 speaker 上的字段）。 */
		function useSpeakerVersion() {
			return (0, react.useSyncExternalStore)((listener) => speaker.subscribe(listener), () => speaker.getVersion(), () => speaker.getVersion());
		}
		//#endregion
		//#region src/client/SettingsSection.tsx
		const PKG = "@kewen/dsh-voice";
		const PREVIEW_TAG = "settings-preview";
		/** 试听用的话：中英混合，听得出 useEffect、WebSocket 这类词念得怎么样。 */
		const PREVIEW_TEXT = "你好，我是你的语音助手。这个方案整体可行，我建议先把 useEffect 里的请求挪到服务端，再用 WebSocket 推送结果。";
		/**
		* 「插件」页里本插件详情的「朗读设置」分区。该 slot 在每个插件的详情页都渲染，
		* 只认本插件的 bundle 页（行配置页 kind: 'row' 也带 pkg，不限定的话会重复出现）。
		*/
		function SettingsSection({ subject }) {
			if (subject?.kind !== "bundle" || subject.pkg.name !== PKG) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "vr-settings",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, {
					title: "语音输入",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HoldSettings, {})
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SettingsPanel, {})]
			});
		}
		function SettingsPanel() {
			const { view, error } = useSettings();
			useSpeakerVersion();
			const id = (0, react.useId)();
			/** 刚选、还没保存完的值：先显示出来，保存失败再退回。 */
			const [draft, setDraft] = (0, react.useState)({});
			const [status, setStatus] = (0, react.useState)(null);
			(0, react.useEffect)(() => {
				loadSettings(true);
			}, []);
			if (view === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, {
				title: "朗读与通话",
				children: error === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: "vr-settings-note",
					children: "正在读取设置…"
				}) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "vr-settings-control",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
						className: "vr-settings-note vr-settings-error",
						children: ["读不到设置：", error]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "vr-settings-button",
						onClick: () => void loadSettings(true),
						children: "重试"
					})]
				})
			});
			const current = {
				...view.settings,
				...draft
			};
			const models = view.catalog.models;
			const model = models.find((m) => m.id === current.model) ?? models[0];
			const previewing = speaker.isSpeaking(PREVIEW_TAG);
			const save = async (patch) => {
				setDraft((d) => ({
					...d,
					...patch
				}));
				setStatus(null);
				try {
					if (typeof patch.speechRate === "number") await changeSpeechRate(patch.speechRate);
					else await saveSettings(patch);
					setDraft((d) => {
						const next = { ...d };
						for (const key of Object.keys(patch)) if (next[key] === patch[key]) delete next[key];
						return next;
					});
					setStatus({
						kind: "saved",
						text: "已保存，下一段朗读开始生效。"
					});
				} catch (e) {
					setDraft({});
					setStatus({
						kind: "error",
						text: `没保存上：${e instanceof Error ? e.message : String(e)}`
					});
				}
			};
			const onModel = (next) => {
				const target = models.find((m) => m.id === next);
				if (target === void 0) return;
				const voice = target.voices.some((v) => v.id === current.voice) ? current.voice : target.voices[0]?.id;
				save(voice === void 0 ? { model: next } : {
					model: next,
					voice
				});
			};
			const onPreview = () => {
				speaker.unlock();
				speaker.clearError();
				if (previewing) {
					speaker.stopAll();
					return;
				}
				speaker.stopAll();
				const u = speaker.start(PREVIEW_TAG, {
					voice: current.voice,
					model: current.model
				});
				u.append(PREVIEW_TEXT);
				u.finish();
			};
			const on = current.replyEnabled !== false;
			const s = view.settings;
			const hasCallEntries = view.catalog.callSilences !== void 0 || typeof s.callSensitivity === "string" || typeof s.callCloudAsr === "boolean" || typeof s.callBargeIn === "boolean" || typeof s.callSmartTurn === "boolean" || typeof s.callKeepOnLock === "boolean";
			const hasListening = typeof s.callSensitivity === "string" || typeof s.callVoiceModel === "boolean" && typeof view.vadVersion === "string";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Card, {
					title: "百炼 API Key",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ApiKeyForm, { ready: view.ready })
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Card, {
					title: "朗读与通话",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
						label: "启用朗读与通话",
						htmlFor: `${id}-reply-enabled`,
						hint: "关闭后停止朗读并挂断通话，按住说话不受影响。",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
							id: `${id}-reply-enabled`,
							checked: on,
							onChange: (next) => void save({ replyEnabled: next })
						})
					}), !view.ready && view.error !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "vr-settings-note vr-settings-error",
						children: view.error
					}) : null]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Card, {
					title: "朗读",
					disabled: !on,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Row, {
							label: "音色",
							htmlFor: `${id}-voice`,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
								id: `${id}-voice`,
								className: "vr-settings-select",
								value: current.voice,
								onChange: (e) => void save({ voice: e.target.value }),
								children: voiceOptions(model?.voices ?? [])
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "vr-settings-button",
								onClick: onPreview,
								children: previewing ? "停止" : "试听"
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: "模型",
							htmlFor: models.length > 1 ? `${id}-model` : void 0,
							children: models.length > 1 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
								id: `${id}-model`,
								className: "vr-settings-select",
								value: current.model,
								onChange: (e) => onModel(e.target.value),
								children: models.map((m) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: m.id,
									children: `${m.label}（${m.price}）`
								}, m.id))
							}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "vr-settings-value",
								children: model === void 0 ? current.model : `${model.label}（${model.price}）`
							})
						}),
						view.catalog.speechRates !== void 0 && view.catalog.speechRates.length > 0 && typeof s.speechRate === "number" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: "语速",
							htmlFor: `${id}-rate`,
							hint: "从下一段起生效，音调不变。",
							help: "由百炼直接合成快的声音，正在念的那一段不会变。通话胶囊上也有按钮能直接切。",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
								id: `${id}-rate`,
								className: "vr-settings-select",
								value: String(current.speechRate ?? 1),
								onChange: (e) => void save({ speechRate: Number(e.target.value) }),
								children: view.catalog.speechRates.map((r) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: String(r),
									children: r === 1 ? "1×（正常）" : formatRate(r)
								}, r))
							})
						}) : null,
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: "每轮最多念",
							htmlFor: `${id}-limit`,
							hint: "念到这么多字就停，提示「后面的内容请看屏幕」。",
							help: "每条回复下面的小喇叭不受这个限制。",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
								id: `${id}-limit`,
								className: "vr-settings-select",
								value: String(current.turnLimit),
								onChange: (e) => void save({ turnLimit: Number(e.target.value) }),
								children: view.catalog.turnLimits.map((n) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: String(n),
									children: n === 0 ? "不限" : `${n} 字`
								}, n))
							})
						}),
						typeof s.speakWhole === "boolean" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: "整段写完再念",
							htmlFor: `${id}-whole`,
							hint: "语调更连贯，但要多等一会儿才开口。关着是边写边念。",
							help: "打开后，等它写完一段再整段念，长回复可能要等十几秒。调工具之前说的话照样先念。语音模式和通话都按这个来。",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
								id: `${id}-whole`,
								checked: current.speakWhole === true,
								onChange: (next) => void save({ speakWhole: next })
							})
						}) : null
					]
				}),
				hasCallEntries ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Card, {
					title: "通话",
					disabled: !on,
					children: [
						typeof s.callCloudAsr === "boolean" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: "百炼识别",
							htmlFor: `${id}-cloud-asr`,
							badge: "cloud",
							hint: "识别更准，录音会上传到阿里云。出错自动改用本机。",
							help: "通话里你说的话用百炼 qwen3-asr-flash 识别（比本机的 SenseVoice 准），用朗读的同一个 Key，按秒计费。关掉就只用本机识别（官方「语音输入」）。只影响通话，按住说话不变，马上生效。",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
								id: `${id}-cloud-asr`,
								checked: current.callCloudAsr === true,
								onChange: (next) => void save({ callCloudAsr: next })
							})
						}) : null,
						view.catalog.callSilences !== void 0 && view.catalog.callSilences.length > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: "通话停顿",
							htmlFor: `${id}-silence`,
							hint: "停顿这么久就当作说完，自动发出去。常被打断就调长。",
							help: "也可以说完直接点「说完了」。",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("select", {
								id: `${id}-silence`,
								className: "vr-settings-select",
								value: String(current.callSilenceMs ?? 1200),
								onChange: (e) => void save({ callSilenceMs: Number(e.target.value) }),
								children: view.catalog.callSilences.map((ms) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
									value: String(ms),
									children: `${(ms / 1e3).toFixed(1)} 秒`
								}, ms))
							})
						}) : null,
						typeof s.callSmartTurn === "boolean" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: "听语气断句",
							htmlFor: `${id}-smart`,
							badge: "local",
							hint: "停顿半秒后判断是说完了还是在想，在想就再等。",
							help: "用本机 smart-turn 模型听语气：像说完了就马上发出去，像还在想就接着等，最多等 3 秒。每次判断约 0.3 秒，不联网、不花钱。",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
								id: `${id}-smart`,
								checked: current.callSmartTurn === true,
								onChange: (next) => void save({ callSmartTurn: next })
							})
						}) : null,
						typeof s.callBargeIn === "boolean" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: "说话打断",
							htmlFor: `${id}-barge`,
							hint: "戴耳机时打开。外放时别开，麦克风会录到朗读的声音。",
							help: "它在念或在干活时，你直接开口就能打断；说「停」能让它停下，说「进度怎么样」会念一句进度。",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
								id: `${id}-barge`,
								checked: current.callBargeIn === true,
								onChange: (next) => void save({ callBargeIn: next })
							})
						}) : null,
						typeof s.callKeepOnLock === "boolean" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
							label: "锁屏后继续",
							htmlFor: `${id}-keep`,
							hint: "锁屏或切到别的 App 时通话不暂停。",
							help: "照常收音、发送、朗读。手机系统要是把麦克风或声音停了，通话会自动暂停，回来点一下继续。手机放进口袋时，摩擦声、旁边人说话也可能被识别发出去，用的时候留意。",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
								id: `${id}-keep`,
								checked: current.callKeepOnLock === true,
								onChange: (next) => void save({ callKeepOnLock: next })
							})
						}) : null,
						hasListening ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Fold, {
							summary: "收音设置",
							children: [typeof s.callVoiceModel === "boolean" && typeof view.vadVersion === "string" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
								label: "只听人声",
								htmlFor: `${id}-voice-model`,
								badge: "local",
								hint: "风扇、空调、键盘声不当成你在说话。下一通电话生效。",
								help: "在本机用 Silero 模型判断是不是人在说话，停下来就能断句。电视、旁人说话仍然会被听进去。第一次通话要下载约 6 MB（之后有缓存），不联网、不花钱。",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Switch, {
									id: `${id}-voice-model`,
									checked: current.callVoiceModel !== false,
									onChange: (next) => void save({ callVoiceModel: next })
								})
							}) : null, typeof s.callSensitivity === "string" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
								label: "收音灵敏度",
								htmlFor: `${id}-sensitivity`,
								hint: "说完了发不出去就调低，常听不到你就调高。",
								help: "声音要比环境底噪响多少才算你在说话。键盘、风扇、旁边有人说话被当成你还在说，就调低；说话轻、常听不到，就调高。「很低」给风扇、空调声很大的环境用，要说得响一点。",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("select", {
									id: `${id}-sensitivity`,
									className: "vr-settings-select",
									value: current.callSensitivity ?? "medium",
									onChange: (e) => void save({ callSensitivity: e.target.value }),
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "lowest",
											children: "很低（风扇、空调声大）"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "low",
											children: "低"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "medium",
											children: "中"
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
											value: "high",
											children: "高"
										})
									]
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Row, {
								label: "环境噪声",
								hint: "先安静 3 秒看建议，再说一句看多快变回「安静」。别在通话中测。",
								stack: true,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(NoiseMeter, {
									sensitivity: current.callSensitivity ?? "medium",
									silenceMs: current.callSilenceMs ?? 1200
								})
							})] }) : null]
						}) : null
					]
				}) : null,
				status !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
					className: status.kind === "error" ? "vr-settings-note vr-settings-error" : "vr-settings-note vr-settings-ok",
					role: "status",
					children: status.text
				}) : null,
				speaker.lastError !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("p", {
					className: "vr-settings-note vr-settings-error",
					children: ["朗读出错：", speaker.lastError]
				}) : null
			] });
		}
		function ApiKeyForm({ ready }) {
			const id = (0, react.useId)();
			const input = (0, react.useRef)(null);
			const [key, setKey] = (0, react.useState)("");
			const [saving, setSaving] = (0, react.useState)(false);
			const [invalid, setInvalid] = (0, react.useState)(false);
			const [status, setStatus] = (0, react.useState)(null);
			const submit = async (event) => {
				event.preventDefault();
				if (saving) return;
				if (key.trim() === "") {
					setInvalid(true);
					setStatus({
						kind: "error",
						text: "请输入百炼 API Key。"
					});
					input.current?.focus();
					return;
				}
				setSaving(true);
				setStatus(null);
				try {
					await saveApiKey(key);
					setKey("");
					setStatus({
						kind: "saved",
						text: "API Key 已保存。"
					});
				} catch (error) {
					setStatus({
						kind: "error",
						text: `没保存上：${error instanceof Error ? error.message : String(error)}`
					});
				} finally {
					setSaving(false);
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "vr-row",
				"data-stack": "",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "vr-row-text",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
						className: "vr-row-label",
						htmlFor: `${id}-key`,
						children: [
							"API Key（",
							ready ? "已配置" : "未配置",
							"）"
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						className: "vr-row-hint",
						id: `${id}-hint`,
						children: "请使用百炼中国（北京）地域的 API Key。输入的 Key 将发送到 DSH 服务端保存。"
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("form", {
					className: "vr-key-form",
					onSubmit: (event) => void submit(event),
					noValidate: true,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "vr-key-controls",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
							ref: input,
							id: `${id}-key`,
							className: "vr-settings-input",
							type: "password",
							name: "apiKey",
							autoComplete: "off",
							value: key,
							disabled: saving,
							"aria-describedby": `${id}-hint ${id}-status`,
							"aria-invalid": invalid || void 0,
							onChange: (event) => {
								setKey(event.target.value);
								setInvalid(false);
								setStatus(null);
							}
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "submit",
							className: "vr-settings-button",
							disabled: saving,
							children: [ready ? "替换" : "保存", saving ? "中…" : ""]
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
						id: `${id}-status`,
						className: status?.kind === "error" ? "vr-settings-note vr-settings-error" : "vr-settings-note vr-settings-ok",
						role: "status",
						children: status?.text ?? ""
					})]
				})]
			});
		}
		/** 音色下拉：多于一组（普通话、方言……）时分组显示。 */
		function voiceOptions(voices) {
			const option = (v) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("option", {
				value: v.id,
				children: `${v.name}（${v.id}${v.gender === void 0 ? "" : `，${v.gender}`}）· ${brief(v.desc ?? "")}`
			}, v.id);
			const groups = /* @__PURE__ */ new Map();
			for (const v of voices) {
				const key = v.group ?? "";
				const list = groups.get(key);
				if (list === void 0) groups.set(key, [v]);
				else list.push(v);
			}
			if (groups.size <= 1) return voices.map(option);
			return [...groups].map(([group, list]) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("optgroup", {
				label: group === "" ? "其他" : group,
				children: list.map(option)
			}, group));
		}
		/** 下拉里一行放不下长介绍：截短。 */
		function brief(text) {
			return text.length > 22 ? `${text.slice(0, 22)}…` : text;
		}
		//#endregion
		//#region src/client/settings-styles.ts
		/**
		* 「轻点开启声音」提示，和「插件」页本插件详情里的「朗读设置」分区。
		* 设置分区的版式对齐官方详情分区（14px/500 标题、12px 间距），颜色只用官方的 --dsw-* 变量。
		*/
		const settingsCss = `
.vr-toggle[data-blocked] {
  display: inline-flex; align-items: center; gap: 4px; width: auto; padding: 0 10px 0 6px;
  border-radius: 999px;
  color: var(--dsw-alias-state-business-primary, #4c8dff);
  background: var(--dsw-alias-interactive-bg-hover, rgba(76, 141, 255, .12));
  animation: vr-blocked-pulse 1.2s ease-in-out infinite alternate;
}
.vr-toggle-label { font-size: 12px; line-height: 16px; white-space: nowrap; }
@keyframes vr-blocked-pulse { from { opacity: .6 } to { opacity: 1 } }
@media (prefers-reduced-motion: reduce) { .vr-toggle[data-blocked] { animation: none; } }

.vr-settings { display: flex; flex-direction: column; gap: 20px; }
.vr-set-section { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.vr-settings-title { margin: 0; font-size: 14px; font-weight: 500; line-height: 20px; color: var(--dsw-alias-label-primary); }
.vr-set-card {
  display: flex; flex-direction: column; min-width: 0; margin: 0; padding: 0 16px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .3)); border-radius: 12px;
}
.vr-set-card[data-disabled] { opacity: .5; }
.vr-set-card > .vr-settings-note { padding: 8px 0; }
.vr-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; }
.vr-row + .vr-row, .vr-set-fold > .vr-row:first-of-type { border-top: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .3)); }
.vr-row-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.vr-row-head { display: flex; align-items: center; gap: 8px; }
.vr-row-label { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); }
.vr-row-hint, .vr-row-help { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, #a1a1aa); }
.vr-row-help { padding-top: 2px; }
.vr-row-more {
  margin-left: 6px; padding: 0; border: none; background: none; cursor: pointer;
  font: inherit; color: var(--dsw-alias-state-business-primary, #4c8dff);
}
.vr-row-control { flex: 0 1 auto; display: flex; align-items: center; justify-content: flex-end; gap: 8px; min-width: 0; max-width: 60%; }
.vr-row[data-stack] { flex-direction: column; align-items: stretch; gap: 8px; }
.vr-row[data-stack] .vr-row-control { max-width: none; justify-content: flex-start; }
.vr-badge {
  flex: none; padding: 0 6px; border-radius: 999px; font-size: 11px; line-height: 16px;
  color: var(--dsw-alias-label-secondary, #a1a1aa);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .3));
}
.vr-badge[data-kind="cloud"] { color: var(--dsw-alias-state-warning, #e0a030); border-color: currentColor; }
.vr-set-fold { border-top: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .3)); }
.vr-set-fold-summary {
  padding: 12px 0; cursor: pointer; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary, #a1a1aa);
}
.vr-set-fold[open] > .vr-set-fold-summary { color: var(--dsw-alias-label-primary); }
.vr-set-fold-summary:focus-visible, .vr-row-more:focus-visible, .vr-switch:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4c8dff));
  outline-offset: 2px; border-radius: 4px;
}
.vr-switch {
  appearance: none; -webkit-appearance: none; flex: none; position: relative; margin: 0; cursor: pointer;
  width: 36px; height: 20px; border-radius: 999px;
  background: var(--dsw-alias-border-l2, rgba(128, 128, 128, .45));
  transition: background .15s;
}
.vr-switch::after {
  content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%;
  background: #fff; transition: transform .15s;
}
.vr-switch:checked { background: var(--dsw-alias-state-business-primary, #4c8dff); }
.vr-switch:checked::after { transform: translateX(16px); }
.vr-switch:disabled { cursor: not-allowed; }
.vr-set-card:disabled, .vr-set-card:disabled * { cursor: not-allowed; }
@media (prefers-reduced-motion: reduce) { .vr-switch, .vr-switch::after { transition: none; } }
.vr-key-form { display: flex; flex-direction: column; gap: 6px; width: 100%; min-width: 0; }
.vr-key-controls { display: flex; align-items: center; gap: 8px; min-width: 0; }
.vr-settings-select, .vr-settings-input {
  flex: 0 1 280px; min-width: 0; height: 32px; padding: 0 8px; border-radius: 8px;
  font: inherit; font-size: 13px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-elevated, transparent);
  border: 1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, .3));
}
.vr-settings-value { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-primary); }
.vr-settings-button {
  flex: none; height: 32px; padding: 0 14px; border: none; border-radius: 8px; cursor: pointer;
  font: inherit; font-size: 13px; color: #fff;
  background: var(--dsw-alias-button-info-fill, #4c8dff);
}
.vr-settings-select:focus-visible, .vr-settings-input:focus-visible, .vr-settings-button:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary, #4c8dff));
  outline-offset: 2px;
}
.vr-settings-note { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary, #a1a1aa); }
.vr-settings-error { color: var(--dsw-alias-state-danger, #f2555a); }
.vr-settings-ok { color: var(--dsw-alias-state-business-primary, #4c8dff); }
.vr-meter { display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; }
.vr-meter .vr-settings-value[data-speaking] { color: var(--dsw-alias-state-business-primary, #4c8dff); }
.vr-meter-bar {
  position: relative; height: 8px; max-width: 380px; border-radius: 999px; overflow: hidden;
  background: var(--dsw-alias-border-l2, rgba(128, 128, 128, .3));
}
.vr-meter-fill {
  position: absolute; inset: 0 auto 0 0; border-radius: inherit;
  background: var(--dsw-alias-label-secondary, #a1a1aa);
  transition: width .12s linear;
}
.vr-meter-fill[data-speaking] { background: var(--dsw-alias-state-business-primary, #4c8dff); }
.vr-meter-mark { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; }
.vr-meter-mark[data-kind="floor"] { background: var(--dsw-alias-label-primary, #e4e4e7); opacity: .5; }
.vr-meter-mark[data-kind="threshold"] { background: var(--dsw-alias-state-danger, #f2555a); }
@media (prefers-reduced-motion: reduce) { .vr-meter-fill { transition: none; } }
@media (max-width: 560px) {
  .vr-row { flex-wrap: wrap; }
  .vr-row-control { max-width: none; flex: 1 1 100%; justify-content: flex-start; }
  .vr-row:has(.vr-switch) .vr-row-control { flex: none; }
  .vr-row:has(.vr-switch) { flex-wrap: nowrap; }
  .vr-settings-select { flex: 1 1 auto; }
}
`;
		//#endregion
		//#region src/client/SpeakButton.tsx
		/** 手动朗读一条回复最多念这么多字。 */
		const MANUAL_LIMIT = 5e3;
		/** 和官方「复制」按钮取同样的文字：这条回复所有 text 块拼起来。 */
		function textOf(snapshot, messageId) {
			const nodes = snapshot?.legacy?.nodes;
			if (!nodes) return "";
			for (const node of nodes) {
				if (node.kind !== "assistant" || node.messageId !== messageId) continue;
				return (node.blocks ?? []).filter((block) => block.kind === "text" && typeof block.text === "string").map((block) => block.text).join("");
			}
			return "";
		}
		/** 回复下方的喇叭：点一下念这条回复，再点一下停。 */
		function SpeakButton({ messageId, useChat }) {
			useSpeakerVersion();
			const select = (0, react.useCallback)((snapshot) => textOf(snapshot, messageId), [messageId]);
			const text = useChat?.(select) ?? "";
			const tag = `message:${messageId}`;
			if (text.trim() === "") return null;
			const speaking = speaker.isSpeaking(tag);
			const onClick = () => {
				speaker.unlock();
				speaker.clearError();
				speaker.stopAll();
				if (speaking) return;
				const spoken = new Speakify().push(text, true).slice(0, MANUAL_LIMIT);
				if (spoken === "") return;
				const u = speaker.start(tag);
				u.append(spoken);
				u.finish();
			};
			const label = speaking ? "停止朗读" : "朗读这条回复";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
				type: "button",
				className: "vr-speak",
				"data-speaking": speaking ? "" : void 0,
				"aria-label": label,
				title: label,
				onClick,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SpeakerIcon, { mode: speaking ? "stop" : "on" })
			});
		}
		//#endregion
		//#region src/client/styles.ts
		/** 两个按钮的样式：输入框左侧的「语音模式」开关，回复下方的喇叭。颜色跟 DSH 的主题变量走。 */
		const css$1 = `
.vr-toggle, .vr-speak {
  position: relative;
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; padding: 0; flex: none;
  border: none; border-radius: 8px; cursor: pointer;
  color: var(--dsw-alias-label-secondary, #a1a1aa);
  background: transparent;
  transition: background-color .12s ease, color .12s ease;
}
.vr-toggle:hover, .vr-speak:hover {
  color: var(--dsw-alias-label-primary, #f9fafb);
  background: color-mix(in srgb, currentColor 10%, transparent);
}
.vr-toggle:focus-visible, .vr-speak:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #4c8dff);
  outline-offset: 1px;
}
.vr-toggle[data-on] { color: var(--dsw-alias-state-business-primary, #4c8dff); }
.vr-toggle[data-speaking], .vr-speak[data-speaking] { color: var(--dsw-alias-state-business-primary, #4c8dff); }
.vr-toggle[data-speaking]::after, .vr-speak[data-speaking]::after {
  content: ''; position: absolute; inset: 3px; border-radius: 7px;
  border: 1.5px solid currentColor; opacity: .5;
  animation: vr-pulse 1s ease-in-out infinite alternate;
}
.vr-toggle[data-error]::before {
  content: ''; position: absolute; top: 4px; right: 4px; width: 6px; height: 6px; border-radius: 50%;
  background: var(--dsw-alias-state-danger, #f2555a);
}
/* 面板模式下临时冒出的按钮：和输入框里「+」、权限按钮一样的圆形灰底 */
.vr-toggle[data-transient] {
  width: 28px; height: 28px; border-radius: 50%; corner-shape: round;
  background: color-mix(in srgb, var(--dsw-alias-label-primary, #f9fafb) 6%, transparent);
}
.vr-toggle[data-transient]:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary, #f9fafb) 10%, transparent); }
.vr-toggle[data-transient][data-speaking]::after { inset: 2px; border-radius: 50%; corner-shape: round; }
.vr-toggle[data-transient][data-blocked] { width: auto; padding: 0 10px 0 8px; gap: 4px; border-radius: 14px; }
@keyframes vr-pulse { from { opacity: .2 } to { opacity: .7 } }
@media (prefers-reduced-motion: reduce) {
  .vr-toggle[data-speaking]::after, .vr-speak[data-speaking]::after { animation: none; }
}
`;
		//#endregion
		//#region src/client/VoiceToggle.tsx
		const noChat = (selector) => selector(void 0);
		const nothing = () => "";
		/**
		* 输入框左边的喇叭：打开「自动朗读回复」后，主代理的回复边写边念（跟读也在这个组件里跑）。
		* - 有 dsh-harness-plus 的对话信息面板时，开关在面板里；这里平时不画，只在正在念（停止）、
		*   声音被拦住（轻点开启声音）、出错时临时冒出来，见 bridge.ts 的 toggleView。
		* - 没有面板时还是原来的常驻开关。
		* - 正在念时变成方块，点一下停（这一轮剩下的不念了，下一轮照常）。
		* - 手机上声音被浏览器拦住时显示「轻点开启声音」，点一下就恢复（这一下点按本身就是解锁要的手势）。
		*/
		function VoiceToggle({ sessionId, useChat }) {
			const enabled = useEnabled();
			const panel = useHostVoiceRow();
			const calling = useCallActive();
			const following = enabled && !calling;
			useSpeakerVersion();
			const signature = (useChat ?? noChat)(following ? selectTurn : nothing);
			const follower = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				loadSettings();
			}, []);
			(0, react.useEffect)(() => {
				if (!following) return;
				const current = new Follower();
				follower.current = current;
				return () => {
					current.detach();
					if (follower.current === current) follower.current = null;
				};
			}, [following, sessionId]);
			(0, react.useEffect)(() => {
				follower.current?.update(parseTurn(signature));
			}, [
				signature,
				following,
				sessionId
			]);
			const blocked = speaker.blocked;
			const speaking = !blocked && (panel ? speaker.isSpeakingPrefix("turn:") : speaker.isSpeaking());
			const error = blocked ? null : speaker.lastError;
			const view = toggleView({
				panel,
				enabled,
				speaking,
				blocked,
				error: error !== null
			});
			if (view === "hidden") return null;
			const transient = panel;
			const mode = view === "stop" ? "stop" : view === "off" ? "off" : "on";
			const title = view === "unlock" ? "浏览器暂时不让出声，轻点这里开启声音" : error !== null ? `朗读出错：${error}${transient ? "。点一下关掉提示" : ""}` : view === "stop" ? "停止朗读" : enabled ? "自动朗读已打开（所有对话），回复边写边念。点一下关闭" : "打开自动朗读（所有对话）：回复边写边念";
			const onClick = () => {
				speaker.unlock();
				if (blocked) return;
				speaker.clearError();
				if (speaking) speaker.stopAll();
				else if (!transient) setEnabled(!enabled);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "vr-toggle",
				"data-transient": transient ? "" : void 0,
				"data-on": enabled && !transient ? "" : void 0,
				"data-speaking": speaking ? "" : void 0,
				"data-blocked": blocked ? "" : void 0,
				"data-error": error !== null ? "" : void 0,
				"aria-pressed": transient ? void 0 : enabled,
				"aria-label": title,
				title,
				onClick,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SpeakerIcon, { mode }), blocked ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "vr-toggle-label",
					children: "轻点开启声音"
				}) : null]
			});
		}
		//#endregion
		//#region src/hold/recorder.ts
		/**
		* 一次录音：麦克风采集 + 停止后重采样成 Host 要的 16 kHz 单声道 PCM16 WAV。
		* 做法照搬官方 dsh-experimental-client-ui-voice-input 的 Recording（MediaRecorder 录、Web Audio 转），
		* 麦克风设备跟官方「语音输入」详情页里选的走（浏览器本地存储 dsh.voice-input.microphone）。
		*/
		/** 官方语音插件保存的麦克风选择；空字符串表示跟随系统默认。 */
		const DEVICE_KEY = "dsh.voice-input.microphone";
		function selectedDevice() {
			try {
				const saved = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? "null");
				return typeof saved?.id === "string" ? saved.id : "";
			} catch {
				return "";
			}
		}
		var RecordingError = class extends Error {
			kind;
			constructor(kind) {
				super(kind);
				this.kind = kind;
				this.name = "RecordingError";
			}
		};
		var Recording$1 = class {
			stream;
			recorder;
			context;
			analyser;
			samples = /* @__PURE__ */ new Float32Array(256);
			chunks = [];
			disposed = false;
			/** 拿到麦克风并开始录。首次使用会弹授权框，这时 Promise 会一直等到用户点完。 */
			async start(onInterrupted) {
				const devices = navigator.mediaDevices;
				if (!devices || typeof MediaRecorder === "undefined") throw new RecordingError("unavailable");
				let stream;
				try {
					const deviceId = selectedDevice();
					stream = await devices.getUserMedia({
						audio: {
							echoCancellation: true,
							noiseSuppression: true,
							...deviceId === "" ? {} : { deviceId: { exact: deviceId } }
						},
						video: false
					});
				} catch (error) {
					if (error instanceof DOMException) {
						if (error.name === "NotAllowedError") throw new RecordingError("permission");
						if (error.name === "NotFoundError" || error.name === "OverconstrainedError") throw new RecordingError("deviceMissing");
					}
					throw error;
				}
				if (this.disposed) {
					stream.getTracks().forEach((track) => track.stop());
					throw new RecordingError("cancelled");
				}
				this.stream = stream;
				try {
					this.context = new AudioContext();
					this.analyser = this.context.createAnalyser();
					this.analyser.fftSize = this.samples.length;
					this.context.createMediaStreamSource(stream).connect(this.analyser);
					for (const track of stream.getTracks()) track.addEventListener("ended", () => {
						if (!this.disposed) onInterrupted();
					});
					this.recorder = new MediaRecorder(stream);
					this.recorder.ondataavailable = (event) => {
						if (!this.disposed && event.data.size > 0) this.chunks.push(event.data);
					};
					this.recorder.onerror = () => {
						if (!this.disposed) onInterrupted();
					};
					this.recorder.start();
				} catch (error) {
					await this.dispose();
					throw error;
				}
			}
			/** 当前音量（RMS），用来画声波。 */
			amplitude() {
				if (!this.analyser) return 0;
				this.analyser.getFloatTimeDomainData(this.samples);
				let sum = 0;
				for (const sample of this.samples) sum += sample * sample;
				return Math.sqrt(sum / this.samples.length);
			}
			/** 停止录音，返回整段 WAV；超过 maxSeconds 的部分截掉。 */
			async stop(maxSeconds) {
				const recorder = this.recorder;
				const context = this.context;
				if (!recorder || !context || recorder.state !== "recording") {
					await this.dispose();
					throw new RecordingError("empty");
				}
				try {
					await new Promise((resolve, reject) => {
						recorder.onstop = () => resolve();
						recorder.onerror = () => reject(new RecordingError("empty"));
						recorder.stop();
					});
					this.stream?.getTracks().forEach((track) => track.stop());
					if (this.disposed) throw new RecordingError("cancelled");
					const blob = new Blob(this.chunks, { type: recorder.mimeType });
					if (blob.size === 0) throw new RecordingError("empty");
					const decoded = await context.decodeAudioData(await blob.arrayBuffer());
					const frames = Math.max(1, Math.floor(Math.min(decoded.duration, maxSeconds) * 16e3));
					const offline = new OfflineAudioContext(1, frames, 16e3);
					const source = offline.createBufferSource();
					source.buffer = decoded;
					source.connect(offline.destination);
					source.start();
					return encodeWave((await offline.startRendering()).getChannelData(0));
				} finally {
					await this.dispose();
				}
			}
			/** 释放麦克风；授权框还没点完时调用，之后拿到的流会立刻关掉。 */
			async dispose() {
				if (this.disposed) return;
				this.disposed = true;
				if (this.recorder?.state === "recording") this.recorder.stop();
				this.stream?.getTracks().forEach((track) => track.stop());
				this.stream = void 0;
				const context = this.context;
				this.context = void 0;
				this.analyser = void 0;
				this.chunks = [];
				if (context && context.state !== "closed") await context.close().catch(() => {});
			}
		};
		/** 16 kHz 单声道 PCM16 WAV。 */
		function encodeWave(samples) {
			const bytes = new Uint8Array(44 + samples.length * 2);
			const view = new DataView(bytes.buffer);
			const text = (at, value) => {
				for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i);
			};
			text(0, "RIFF");
			view.setUint32(4, bytes.length - 8, true);
			text(8, "WAVE");
			text(12, "fmt ");
			view.setUint32(16, 16, true);
			view.setUint16(20, 1, true);
			view.setUint16(22, 1, true);
			view.setUint32(24, 16e3, true);
			view.setUint32(28, 32e3, true);
			view.setUint16(32, 2, true);
			view.setUint16(34, 16, true);
			text(36, "data");
			view.setUint32(40, samples.length * 2, true);
			for (let i = 0; i < samples.length; i++) {
				const value = Math.max(-1, Math.min(1, samples[i]));
				view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
			}
			return bytes;
		}
		/** 给 JSON Remote 用的 base64（不带 data: 前缀）。 */
		function toBase64(bytes) {
			let text = "";
			for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
			return btoa(text);
		}
		//#endregion
		//#region src/hold/controller.ts
		const USABLE = /* @__PURE__ */ new Set([
			"ready",
			"standby",
			"waking"
		]);
		/** 按住不到这么久就松手，当作误触，不送去识别。 */
		const MIN_RECORDING_MS = 400;
		/** 麦克风准备超过这么久，多半是弹了授权框：松手后提示再按一次。 */
		const PERMISSION_PROMPT_MS = 1200;
		const FAILURE_TEXT = {
			unavailable: "这个浏览器不能录音",
			permission: "麦克风权限被拒绝，请在浏览器或系统设置里允许",
			deviceMissing: "找不到选定的麦克风：请插好设备，或到「语音输入」详情页换一个",
			interrupted: "录音被打断了",
			empty: "没有录到声音",
			cancelled: "已取消"
		};
		/**
		* 一个会话里的录音控制：开始、结束、取消。一次只有一段录音。
		* 界面只通过 setPhase 看到状态变化。
		*/
		var HoldController = class {
			speech;
			ui;
			generation = 0;
			active;
			messageTimer;
			constructor(speech, ui) {
				this.speech = speech;
				this.ui = ui;
			}
			get busy() {
				return this.active !== void 0;
			}
			/** 按下：申请麦克风并开始录。麦克风真正开了才进入 recording。 */
			start() {
				if (this.active) return;
				if (this.pendingText !== void 0) {
					this.insertPending();
					if (this.pendingText !== void 0) return;
				}
				const speech = this.speech();
				if (!speech) {
					this.show("语音识别服务不可用：请在插件页启用官方「语音输入」");
					return;
				}
				const run = ++this.generation;
				const recording = new Recording$1();
				const active = {
					run,
					recording,
					abort: new AbortController(),
					requestedAt: Date.now(),
					released: false,
					catalog: speech.catalog().then((result) => result.ok ? result.value : result.error.message, (error) => error instanceof Error ? error.message : String(error))
				};
				this.active = active;
				this.setPhase({ kind: "requesting" });
				window.dispatchEvent(new Event("dsh-voice-hold:recording"));
				recording.start(() => {
					if (this.active === active) {
						this.drop();
						this.show(FAILURE_TEXT.interrupted);
					}
				}).then(async () => {
					if (this.active !== active) return;
					const catalog = await active.catalog;
					if (this.active !== active) return;
					const problem = unusable(catalog);
					if (problem !== void 0) {
						this.drop();
						this.show(problem);
						return;
					}
					if (Date.now() - active.requestedAt > PERMISSION_PROMPT_MS) {
						this.drop();
						this.show("麦克风已就绪，请再按住说话");
						return;
					}
					if (active.released) {
						this.drop();
						this.show("按住的时间太短");
						return;
					}
					active.startedAt = Date.now();
					active.maxSeconds = catalog.maxDurationSeconds;
					active.timer = setTimeout(() => {
						this.finish();
					}, active.maxSeconds * 1e3);
					this.setPhase({
						kind: "recording",
						recording,
						cancelArmed: false,
						startedAt: active.startedAt,
						maxSeconds: active.maxSeconds
					});
				}, (error) => {
					if (this.active !== active) return;
					this.active = void 0;
					this.show(failureText(error));
				});
			}
			/** 上滑取消的「预备」提示（手机）。 */
			armCancel(armed) {
				const active = this.active;
				if (!active?.startedAt || active.released) return;
				this.setPhase({
					kind: "recording",
					recording: active.recording,
					cancelArmed: armed,
					startedAt: active.startedAt,
					maxSeconds: active.maxSeconds ?? 0
				});
			}
			/** 松手：录够了就送去识别。 */
			async finish() {
				const active = this.active;
				if (!active || active.released) return;
				active.released = true;
				if (active.startedAt === void 0) return;
				clearTimeout(active.timer);
				if (Date.now() - active.startedAt < MIN_RECORDING_MS) {
					this.drop();
					this.show("按住的时间太短");
					return;
				}
				this.setPhase({ kind: "transcribing" });
				try {
					const catalog = await active.catalog;
					const audio = await active.recording.stop(catalog.maxDurationSeconds);
					if (this.active !== active) return;
					if (audio.byteLength > catalog.maxAudioBytes) {
						this.active = void 0;
						this.show("录音太长了");
						return;
					}
					const speech = this.speech();
					if (!speech) throw new Error("语音识别服务已断开");
					const result = await speech.transcribe({
						audioBase64: toBase64(audio),
						...catalog.selection
					}, active.abort.signal);
					if (this.active !== active) return;
					this.active = void 0;
					if (!result.ok) {
						this.show(`识别失败：${result.error.message}`);
						return;
					}
					const text = result.value.text.trim();
					if (text === "") {
						this.show("没有识别到说话内容");
						return;
					}
					if (!this.ui.insert(text)) {
						this.setPhase({
							kind: "pending",
							text
						});
						return;
					}
					this.setPhase({ kind: "idle" });
				} catch (error) {
					if (this.active !== active) return;
					this.active = void 0;
					await active.recording.dispose();
					this.show(failureText(error));
				}
			}
			/** 取消：丢掉录音，不识别。quiet 为 true 时不显示「已取消」。 */
			cancel(quiet = false) {
				if (!this.active) return;
				this.drop();
				if (quiet) this.setPhase({ kind: "idle" });
				else this.show(FAILURE_TEXT.cancelled);
			}
			/** 「插入」：把留着的结果再写一次；还是写不进就继续留着。 */
			insertPending() {
				if (this.pendingText === void 0) return;
				if (this.ui.insert(this.pendingText)) this.setPhase({ kind: "idle" });
			}
			discardPending() {
				if (this.pendingText !== void 0) this.setPhase({ kind: "idle" });
			}
			get pendingText() {
				return this.lastPhase?.kind === "pending" ? this.lastPhase.text : void 0;
			}
			dispose() {
				this.drop();
				clearTimeout(this.messageTimer);
			}
			drop() {
				const active = this.active;
				this.active = void 0;
				this.generation++;
				if (!active) return;
				clearTimeout(active.timer);
				active.abort.abort();
				active.recording.dispose();
			}
			show(text) {
				this.setPhase({
					kind: "message",
					text
				});
				clearTimeout(this.messageTimer);
				this.messageTimer = setTimeout(() => {
					if (!this.active) this.setPhase({ kind: "idle" });
				}, 2600);
			}
			lastPhase;
			setPhase(phase) {
				if (phase.kind !== "message") clearTimeout(this.messageTimer);
				this.lastPhase = phase;
				this.ui.setPhase(phase);
			}
		};
		function unusable(catalog) {
			if (typeof catalog === "string") return `语音识别不可用：${catalog}`;
			const provider = catalog.providers.find((item) => item.id === catalog.selection.providerId);
			if (provider === void 0 || !USABLE.has(provider.preparation.phase)) return "语音模型还没准备好：请到插件页「语音输入」里下载并准备";
		}
		function failureText(error) {
			if (error instanceof RecordingError) return FAILURE_TEXT[error.kind] ?? error.kind;
			if (error instanceof DOMException && error.name === "AbortError") return FAILURE_TEXT.cancelled;
			return `语音输入失败：${error instanceof Error ? error.message : String(error)}`;
		}
		//#endregion
		//#region src/hold/store.ts
		let speech;
		const entries = /* @__PURE__ */ new Map();
		function setSpeech(remote) {
			speech = remote;
		}
		/** 每个会话一份录音状态。 */
		function sessionEntry(sessionId) {
			let entry = entries.get(sessionId);
			if (entry !== void 0) return entry;
			const created = {
				phase: { kind: "idle" },
				insertAt: "caret",
				listeners: /* @__PURE__ */ new Set(),
				controller: void 0
			};
			const notify = () => created.listeners.forEach((listener) => listener());
			created.controller = new HoldController(() => speech, {
				setPhase(phase) {
					created.phase = phase;
					notify();
				},
				insert(text) {
					const actions = created.actions;
					if (actions === void 0) return false;
					const span = caretSpan(actions);
					const end = created.insertAt === "end" ? created.draftEnd?.() : void 0;
					return actions.insertText(text, end === void 0 ? span : {
						...span,
						start: end,
						end
					});
				}
			});
			entries.set(sessionId, created);
			return created;
		}
		function usePhase(sessionId) {
			const entry = sessionEntry(sessionId);
			return (0, react.useSyncExternalStore)(subscriber(entry), () => entry.phase);
		}
		const subscribers = /* @__PURE__ */ new WeakMap();
		function subscriber(entry) {
			let subscribe = subscribers.get(entry);
			if (subscribe === void 0) {
				subscribe = (listener) => {
					entry.listeners.add(listener);
					return () => {
						entry.listeners.delete(listener);
					};
				};
				subscribers.set(entry, subscribe);
			}
			return subscribe;
		}
		/** 当前光标位置；有选中文字时收成选区末尾，避免识别结果把选中的字替换掉。 */
		function caretSpan(actions) {
			const span = actions.captureInsertion();
			if (typeof span.start === "number" && typeof span.end === "number" && span.start !== span.end) return {
				...span,
				start: Math.max(span.start, span.end),
				end: Math.max(span.start, span.end)
			};
			return span;
		}
		function disposeAll() {
			for (const entry of entries.values()) entry.controller.dispose();
			entries.clear();
		}
		//#endregion
		//#region src/hold/HoldOverlay.tsx
		/** 宽度 ≤ 600 或主要靠触摸操作时，用手机方案。 */
		const PHONE_QUERY = "(width <= 600px), (pointer: coarse)";
		/** 按住不动这么久才开始录音，短按仍是放光标 / 弹键盘。 */
		const HOLD_DELAY_MS = 400;
		/** 电脑：按住期间鼠标移动超过这个距离，当作在选字，不录音。 */
		const MOVE_TOLERANCE_PX = 6;
		/** 手机：录音开始前手指移动超过这个距离，当作在滚动，不录音。 */
		const TOUCH_SLOP_PX = 10;
		/** 手机：录音中手指上移超过这个距离，松手就取消。 */
		const CANCEL_SWIPE_PX = 60;
		/** 输入框为空时的提示文字（只替换官方默认那一句）。 */
		const HINT_DESKTOP = (official) => `${official}, 按住鼠标语音输入`;
		const HINT_PHONE = () => "按住说话，轻点打字";
		function usePhone() {
			const [phone, setPhone] = (0, react.useState)(() => window.matchMedia(PHONE_QUERY).matches);
			(0, react.useEffect)(() => {
				const media = window.matchMedia(PHONE_QUERY);
				const update = () => setPhone(media.matches);
				media.addEventListener("change", update);
				return () => media.removeEventListener("change", update);
			}, []);
			return phone;
		}
		/**
		* 输入卡片里的「按住说话」：
		* - 电脑：在输入框文字区按住鼠标左键不动 0.4 秒开始录，松开结束；移动鼠标就是选字，不录。
		*   识别结果插到光标处。
		* - 手机：键盘没弹出（输入框没获得焦点）时，在输入框上按住 0.4 秒开始录，松手结束，上滑取消；
		*   轻点一下照常弹出键盘打字。键盘弹出后长按就是系统的选字、粘贴。识别结果追加到草稿末尾。
		* 两端都不自动发送。
		*/
		function HoldOverlay({ sessionId, useInput, useSession, inputActions }) {
			const anchor = (0, react.useRef)(null);
			const [card, setCard] = (0, react.useState)(null);
			const phone = usePhone();
			const phase = usePhase(sessionId);
			const inputPlain = useInput?.((input) => input?.phase === "plain") ?? false;
			const unavailable = useSession?.((session) => session.removed === true || (session.subagent ?? null) !== null) ?? true;
			const entry = sessionEntry(sessionId);
			entry.actions = inputActions;
			entry.insertAt = phone ? "end" : "caret";
			entry.draftEnd = () => draftEnd(card);
			(0, react.useLayoutEffect)(() => {
				setCard(anchor.current?.closest("[data-composer-card]") ?? null);
			}, []);
			(0, react.useEffect)(() => () => {
				entry.controller.cancel(true);
			}, [sessionId, entry]);
			const allowed = !unavailable && inputActions !== void 0 && inputPlain;
			useDesktopHold(card, sessionId, !phone && allowed);
			usePhoneHold(card, sessionId, phone && allowed);
			usePlaceholder(card, allowed ? phone ? HINT_PHONE : HINT_DESKTOP : void 0);
			useNoAutoKeyboard(card, sessionId, phone && allowed);
			useBlurOnKeyboardClose(card, phone && allowed);
			useEscapeCancel(sessionId, phase);
			(0, react.useEffect)(() => {
				if (card === null) return;
				const touch = phone && allowed;
				card.toggleAttribute("data-vh-touch", touch);
				return () => card.removeAttribute("data-vh-touch");
			}, [
				card,
				phone,
				allowed
			]);
			(0, react.useEffect)(() => {
				if (card === null) return;
				card.toggleAttribute("data-vh-holding", phase.kind === "requesting" || phase.kind === "recording");
				return () => card.removeAttribute("data-vh-holding");
			}, [card, phase.kind]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				ref: anchor,
				className: "vh-anchor",
				children: phase.kind !== "idle" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Status, {
					phase,
					phone,
					sessionId
				})
			});
		}
		function editorOf(card) {
			return card?.querySelector("[data-input-scroll] [contenteditable]") ?? null;
		}
		/**
		* 草稿末尾在官方坐标里的位置：草稿里只有纯文字时等于文字长度。
		* 有引用 chip 等装饰节点时坐标对不上，返回 undefined（退回插到光标处）。
		*/
		function draftEnd(card) {
			const editor = editorOf(card);
			if (editor === null) return void 0;
			if (editor.querySelector("[data-lexical-decorator]") !== null) return void 0;
			return Array.from(editor.children).map((p) => p.textContent ?? "").join("\n").length;
		}
		/**
		* 官方提示文字：只在显示官方默认那一句时换成我们的提示（禁用、已归档、计划模式等其他提示保留原文）。
		* 官方每次渲染会写回自己的值，所以用 MutationObserver 跟着改。
		*/
		function usePlaceholder(card, hintFor) {
			(0, react.useEffect)(() => {
				if (card === null || hintFor === void 0) return;
				const DEFAULTS = /* @__PURE__ */ new Set(["发消息或创建任务, / 调用指令, @ 文件或对话", "Message or run a task, / commands, @ files or sessions"]);
				const originals = /* @__PURE__ */ new Map();
				const hints = /* @__PURE__ */ new Set();
				let applying = false;
				const apply = () => {
					if (applying) return;
					applying = true;
					try {
						const editor = editorOf(card);
						if (editor !== null) {
							const value = editor.getAttribute("data-placeholder");
							if (value !== null && DEFAULTS.has(value)) {
								const hint = hintFor(value);
								hints.add(hint);
								originals.set(editor, value);
								editor.setAttribute("data-placeholder", hint);
								if (editor.getAttribute("aria-label") === value) editor.setAttribute("aria-label", hint);
							}
						}
						const shown = card.querySelector("[data-composer-placeholder]");
						if (shown !== null && shown.textContent !== null && DEFAULTS.has(shown.textContent)) {
							const hint = hintFor(shown.textContent);
							hints.add(hint);
							originals.set(shown, shown.textContent);
							shown.textContent = hint;
						}
					} finally {
						applying = false;
					}
				};
				apply();
				const observer = new MutationObserver(apply);
				observer.observe(card, {
					subtree: true,
					childList: true,
					characterData: true,
					attributes: true,
					attributeFilter: ["data-placeholder"]
				});
				return () => {
					observer.disconnect();
					for (const [element, value] of originals) {
						if (!element.isConnected) continue;
						if (element.hasAttribute("data-composer-placeholder")) {
							if (hints.has(element.textContent ?? "")) element.textContent = value;
						} else if (hints.has(element.getAttribute("data-placeholder") ?? "")) {
							element.setAttribute("data-placeholder", value);
							if (hints.has(element.getAttribute("aria-label") ?? "")) element.setAttribute("aria-label", value);
						}
					}
				};
			}, [card, hintFor]);
		}
		/** 手指在输入卡片里按下后这么久之内获得的焦点，算用户自己点的。 */
		const USER_FOCUS_WINDOW_MS = 1e3;
		/**
		* 手机：官方打开对话时会自动聚焦输入框，安卓上会直接弹出键盘，就没法按住说话了。
		* 这里只放行「手指刚在输入卡片里按过」之后的聚焦（轻点输入框、点 / 按钮等），
		* 其他自动聚焦（打开对话、切换对话）立刻取消，键盘不弹。键盘已经在时不受影响。
		*/
		function useNoAutoKeyboard(card, sessionId, enabled) {
			(0, react.useEffect)(() => {
				if (card === null || !enabled) return;
				let touchedAt = -Infinity;
				const onDown = () => {
					touchedAt = Date.now();
				};
				const onFocus = (event) => {
					const editor = editorOf(card);
					if (editor === null || !(event.target instanceof Node) || !editor.contains(event.target)) return;
					if (Date.now() - touchedAt <= USER_FOCUS_WINDOW_MS) return;
					editor.blur();
				};
				card.addEventListener("pointerdown", onDown, true);
				card.addEventListener("touchstart", onDown, {
					capture: true,
					passive: true
				});
				card.addEventListener("focusin", onFocus);
				const editor = editorOf(card);
				if (editor !== null && (document.activeElement === editor || editor.contains(document.activeElement))) editor.blur();
				return () => {
					card.removeEventListener("pointerdown", onDown, true);
					card.removeEventListener("touchstart", onDown, { capture: true });
					card.removeEventListener("focusin", onFocus);
				};
			}, [
				card,
				sessionId,
				enabled
			]);
		}
		/** 可视区域比同宽度下见过的最大高度矮这么多，就当键盘是开着的。 */
		const KEYBOARD_MIN_PX = 150;
		/**
		* 手机：键盘收起后（安卓返回键、键盘上的收起键），输入框仍然保留焦点和光标，
		* 长按就还是系统选字，没法按住说话。这里在键盘收起时让输入框失焦，回到「按住说话，轻点打字」。
		* 草稿内容和光标位置由编辑器自己保存，失焦不会丢字。
		*/
		function useBlurOnKeyboardClose(card, enabled) {
			(0, react.useEffect)(() => {
				if (card === null || !enabled) return;
				const viewport = window.visualViewport;
				if (!viewport) return;
				let width = viewport.width;
				let tallest = viewport.height;
				let open = false;
				const onResize = () => {
					if (Math.abs(viewport.width - width) > 1) {
						width = viewport.width;
						tallest = viewport.height;
						open = false;
						return;
					}
					tallest = Math.max(tallest, viewport.height);
					const nowOpen = tallest - viewport.height > KEYBOARD_MIN_PX;
					if (open && !nowOpen) {
						const editor = editorOf(card);
						if (editor !== null && (document.activeElement === editor || editor.contains(document.activeElement))) editor.blur();
					}
					open = nowOpen;
				};
				viewport.addEventListener("resize", onResize);
				return () => viewport.removeEventListener("resize", onResize);
			}, [card, enabled]);
		}
		/**
		* 手机：键盘没弹出时，在输入框上按住开始录。
		* 触摸开始时拦住系统默认行为（否则长按会弹出选字 / 粘贴菜单），所以轻点要我们自己把焦点和光标放回去。
		* 输入框已经获得焦点（键盘在）时完全不管，长按是系统的选字、粘贴。
		*/
		function usePhoneHold(card, sessionId, enabled) {
			(0, react.useEffect)(() => {
				if (card === null || !enabled) return;
				const scroll = card.querySelector("[data-input-scroll]");
				if (scroll === null) return;
				const controller = sessionEntry(sessionId).controller;
				let touch;
				const editor = () => editorOf(card);
				const focused = () => {
					const el = editor();
					return el !== null && (document.activeElement === el || el.contains(document.activeElement));
				};
				const reset = () => {
					if (touch !== void 0) clearTimeout(touch.timer);
					touch = void 0;
				};
				const onStart = (event) => {
					if (event.touches.length !== 1) {
						if (touch?.recording) controller.cancel();
						reset();
						return;
					}
					if (focused() || controller.busy) return;
					if (event.target?.closest("button, a, [role=\"button\"], [data-lexical-decorator]")) return;
					const point = event.touches[0];
					event.preventDefault();
					reset();
					touch = {
						id: point.identifier,
						x: point.clientX,
						y: point.clientY,
						recording: false,
						armed: false,
						moved: false,
						timer: setTimeout(() => {
							if (touch === void 0 || touch.moved) return;
							touch.recording = true;
							if ("vibrate" in navigator) navigator.vibrate?.(15);
							controller.start();
						}, HOLD_DELAY_MS)
					};
				};
				const onMove = (event) => {
					if (touch === void 0) return;
					const point = Array.from(event.changedTouches).find((t) => t.identifier === touch.id);
					if (point === void 0) return;
					event.preventDefault();
					if (touch.recording) {
						const armed = touch.y - point.clientY > CANCEL_SWIPE_PX;
						if (armed !== touch.armed) {
							touch.armed = armed;
							controller.armCancel(armed);
						}
						return;
					}
					const dy = point.clientY - touch.y;
					if (!touch.moved && Math.hypot(point.clientX - touch.x, dy) > TOUCH_SLOP_PX) {
						touch.moved = true;
						clearTimeout(touch.timer);
					}
					if (touch.moved) {
						scroll.scrollTop -= dy;
						touch.y = point.clientY;
					}
				};
				const onEnd = (event) => {
					const current = touch;
					if (current === void 0) return;
					const point = Array.from(event.changedTouches).find((t) => t.identifier === current.id);
					if (point === void 0) return;
					event.preventDefault();
					reset();
					if (current.recording) {
						if (current.armed) controller.cancel();
						else controller.finish();
						return;
					}
					if (!current.moved) focusAt(editor(), point.clientX, point.clientY);
				};
				const onCancel = () => {
					if (touch?.recording) controller.cancel();
					reset();
				};
				const onContextMenu = (event) => {
					if (!focused()) event.preventDefault();
				};
				scroll.addEventListener("touchstart", onStart, { passive: false });
				scroll.addEventListener("touchmove", onMove, { passive: false });
				scroll.addEventListener("touchend", onEnd, { passive: false });
				scroll.addEventListener("touchcancel", onCancel);
				scroll.addEventListener("contextmenu", onContextMenu);
				return () => {
					scroll.removeEventListener("touchstart", onStart);
					scroll.removeEventListener("touchmove", onMove);
					scroll.removeEventListener("touchend", onEnd);
					scroll.removeEventListener("touchcancel", onCancel);
					scroll.removeEventListener("contextmenu", onContextMenu);
					if (touch?.recording) controller.cancel(true);
					reset();
				};
			}, [
				card,
				sessionId,
				enabled
			]);
		}
		/** 轻点：聚焦输入框（弹出键盘），光标放到手指点的位置；点在文字外面就放到末尾。 */
		function focusAt(editor, x, y) {
			if (editor === null) return;
			let range = caretRange(x, y);
			if (range === null || !editor.contains(range.startContainer)) {
				range = document.createRange();
				range.selectNodeContents(editor);
				range.collapse(false);
			}
			const place = () => {
				const selection = window.getSelection();
				if (selection === null || !range.startContainer.isConnected) return;
				selection.removeAllRanges();
				selection.addRange(range);
			};
			editor.focus({ preventScroll: true });
			place();
			requestAnimationFrame(place);
		}
		function caretRange(x, y) {
			const doc = document;
			if (typeof doc.caretPositionFromPoint === "function") {
				const position = doc.caretPositionFromPoint(x, y);
				if (position === null) return null;
				const range = document.createRange();
				range.setStart(position.offsetNode, position.offset);
				range.collapse(true);
				return range;
			}
			return doc.caretRangeFromPoint?.(x, y) ?? null;
		}
		function useDesktopHold(card, sessionId, enabled) {
			(0, react.useEffect)(() => {
				if (card === null || !enabled) return;
				const controller = sessionEntry(sessionId).controller;
				let pending;
				const clear = () => {
					if (pending !== void 0) clearTimeout(pending.timer);
					pending = void 0;
					window.removeEventListener("pointermove", onMove, true);
					window.removeEventListener("pointerup", onUp, true);
					window.removeEventListener("pointercancel", onCancel, true);
				};
				const onDown = (event) => {
					if (event.pointerType !== "mouse" || event.button !== 0) return;
					if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey || event.detail > 1) return;
					const target = event.target;
					const editor = target?.closest("[data-input-scroll]");
					if (!editor || !card.contains(editor)) return;
					if (target?.closest("button, a, [role=\"button\"], [data-lexical-decorator]")) return;
					if (editor.querySelector("[contenteditable=\"true\"]") === null) return;
					if (controller.busy) return;
					clear();
					pending = {
						x: event.clientX,
						y: event.clientY,
						recording: false,
						timer: setTimeout(() => {
							if (pending === void 0) return;
							pending.recording = true;
							controller.start();
						}, HOLD_DELAY_MS)
					};
					window.addEventListener("pointermove", onMove, true);
					window.addEventListener("pointerup", onUp, true);
					window.addEventListener("pointercancel", onCancel, true);
				};
				const onMove = (event) => {
					if (pending === void 0) return;
					if (Math.hypot(event.clientX - pending.x, event.clientY - pending.y) <= MOVE_TOLERANCE_PX) return;
					if (pending.recording) controller.cancel();
					clear();
				};
				const onUp = () => {
					const recording = pending?.recording === true;
					clear();
					if (recording) controller.finish();
				};
				const onCancel = () => {
					const recording = pending?.recording === true;
					clear();
					if (recording) controller.cancel();
				};
				const onBlur = () => {
					if (pending?.recording) controller.cancel();
					clear();
				};
				card.addEventListener("pointerdown", onDown);
				window.addEventListener("blur", onBlur);
				return () => {
					card.removeEventListener("pointerdown", onDown);
					window.removeEventListener("blur", onBlur);
					if (pending?.recording) controller.cancel(true);
					clear();
				};
			}, [
				card,
				sessionId,
				enabled
			]);
		}
		function useEscapeCancel(sessionId, phase) {
			const active = phase.kind === "requesting" || phase.kind === "recording" || phase.kind === "transcribing";
			(0, react.useEffect)(() => {
				if (!active) return;
				const onKey = (event) => {
					if (event.key !== "Escape") return;
					event.preventDefault();
					event.stopPropagation();
					sessionEntry(sessionId).controller.cancel();
				};
				document.addEventListener("keydown", onKey, true);
				return () => document.removeEventListener("keydown", onKey, true);
			}, [active, sessionId]);
		}
		/** 剩这么多秒时开始显示倒计时。 */
		const COUNTDOWN_SECONDS = 10;
		/** 卡片上方的状态条：准备中 / 声波 / 识别中 / 提示 / 待插入的结果。 */
		function Status({ phase, phone, sessionId }) {
			if (phase.kind === "message") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "vh-status",
				role: "status",
				children: phase.text
			});
			if (phase.kind === "requesting") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "vh-status",
				role: "status",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "vh-dot" }), "正在打开麦克风…"]
			});
			if (phase.kind === "transcribing") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "vh-status",
				role: "status",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "vh-dot" }), "正在识别…"]
			});
			if (phase.kind === "pending") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PendingResult, {
				text: phase.text,
				sessionId
			});
			if (phase.kind !== "recording") return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Recording, {
				phase,
				phone
			});
		}
		function Recording({ phase, phone }) {
			const left = useSecondsLeft(phase.startedAt, phase.maxSeconds);
			const ending = left !== void 0 && left <= COUNTDOWN_SECONDS;
			const hint = phase.cancelArmed ? "松开手指，取消" : ending ? `${left} 秒后自动结束` : phone ? "上滑取消" : "松开结束 · 移动鼠标或 Esc 取消";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "vh-status vh-recording",
				"data-armed": phase.cancelArmed || void 0,
				"data-ending": ending || void 0,
				role: "status",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "vh-rec" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(Waveform, { recording: phase.recording }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "vh-hint",
						children: hint
					})
				]
			});
		}
		function useSecondsLeft(startedAt, maxSeconds) {
			const compute = () => maxSeconds > 0 ? Math.max(0, Math.ceil(maxSeconds - (Date.now() - startedAt) / 1e3)) : void 0;
			const [left, setLeft] = (0, react.useState)(compute);
			(0, react.useEffect)(() => {
				setLeft(compute());
				const timer = setInterval(() => setLeft(compute()), 250);
				return () => clearInterval(timer);
			}, [startedAt, maxSeconds]);
			return left;
		}
		/** 识别结果写不进输入框（比如正在提交）：结果留着，点「插入」再写，或丢弃。 */
		function PendingResult({ text, sessionId }) {
			const controller = sessionEntry(sessionId).controller;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "vh-status vh-pending",
				role: "status",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "vh-pending-text",
						title: text,
						children: text
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "vh-action",
						onMouseDown: (e) => e.preventDefault(),
						onClick: () => controller.insertPending(),
						children: "插入"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "vh-action vh-quiet",
						"aria-label": "丢弃识别结果",
						onMouseDown: (e) => e.preventDefault(),
						onClick: () => controller.discardPending(),
						children: "丢弃"
					})
				]
			});
		}
		function Waveform({ recording }) {
			const svg = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const lines = Array.from(svg.current?.querySelectorAll("line") ?? []).reverse();
				const levels = lines.map(() => 0);
				let frame = 0;
				let last = -Infinity;
				const draw = (now) => {
					if (now - last >= 50) {
						last = now;
						levels.unshift(recording.amplitude());
						levels.length = lines.length;
						lines.forEach((line, i) => {
							const h = 1 + Math.min(1, (levels[i] ?? 0) * 5) * 8;
							line.setAttribute("y1", String(10 - h));
							line.setAttribute("y2", String(10 + h));
						});
					}
					frame = requestAnimationFrame(draw);
				};
				frame = requestAnimationFrame(draw);
				return () => cancelAnimationFrame(frame);
			}, [recording]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				ref: svg,
				className: "vh-wave",
				viewBox: "0 0 120 20",
				preserveAspectRatio: "none",
				"aria-hidden": true,
				children: Array.from({ length: 20 }, (_, i) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("line", {
					x1: i * 6 + 3,
					x2: i * 6 + 3,
					y1: "9",
					y2: "11",
					stroke: "currentColor",
					strokeWidth: "2.4",
					strokeLinecap: "round"
				}, i))
			});
		}
		//#endregion
		//#region src/hold/styles.ts
		/**
		* 样式。官方元素的 class 带哈希，这里只按片段（_primary、_triggerAnchor、_activity）匹配；
		* DSH 改了输入栏结构时这几条可能失效，需要跟着改。
		*/
		const css = `
/* 去掉官方语音输入的麦克风按钮（它所在的那一格一起收掉，不留空隙） */
[data-composer-card] [class*="_activity"]:has([class*="_triggerAnchor"]) { display: none !important; }

.vh-anchor { position: absolute; inset: 0 0 auto; height: 0; }

.vh-status {
  position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%);
  display: flex; align-items: center; gap: 8px; max-width: calc(100% - 24px);
  padding: 6px 12px; border-radius: 999px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-size: 13px; line-height: 20px;
  color: var(--dsw-alias-label-primary, #f9fafb);
  background: var(--dsw-specific-menu, rgba(30, 32, 36, .96));
  box-shadow: var(--dsw-elevation-panel, 0 4px 16px rgba(0,0,0,.3));
  backdrop-filter: var(--dsw-menu-backdrop-filter, none);
  pointer-events: none; z-index: 5;
}
.vh-recording { color: var(--dsw-alias-state-business-primary, #4c8dff); }
.vh-recording[data-ending] .vh-hint { color: var(--dsw-alias-state-warning, #f5a524); }
.vh-pending { pointer-events: auto; gap: 6px; padding: 4px 6px 4px 12px; max-width: min(520px, calc(100% - 24px)); }
.vh-pending-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.vh-action {
  flex: none; border: none; cursor: pointer; border-radius: 999px; padding: 2px 10px; font: inherit; font-size: 12px;
  color: #fff; background: var(--dsw-alias-button-info-fill, #4c8dff);
}
.vh-action.vh-quiet { color: var(--dsw-alias-label-secondary, #a1a1aa); background: transparent; }
.vh-recording[data-armed] { color: var(--dsw-alias-state-danger, #f2555a); }
.vh-hint { color: var(--dsw-alias-label-secondary, #a1a1aa); font-size: 12px; }
.vh-wave { width: 72px; height: 20px; flex: none; }
.vh-rec { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-danger, #f2555a); flex: none; animation: vh-pulse 1s ease-in-out infinite alternate; }
.vh-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-state-business-primary, #4c8dff); flex: none; animation: vh-pulse 1s ease-in-out infinite alternate; }
@keyframes vh-pulse { from { opacity: .35 } to { opacity: 1 } }

/* 手机：键盘没弹出时，输入框上的长按归我们（不弹系统选字菜单、放大镜） */
[data-composer-card][data-vh-touch]:not(:focus-within) [data-input-scroll] {
  -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; -webkit-tap-highlight-color: transparent;
}
[data-composer-card][data-vh-touch]:not(:focus-within) [data-input-scroll] * { -webkit-user-select: none; user-select: none; }

/* 录音中：输入框描一圈主题色 */
[data-composer-card][data-vh-holding] { box-shadow: 0 0 0 1.5px var(--dsw-alias-state-business-primary, #4c8dff), var(--dsw-elevation-soft, none); }
`;
		//#endregion
		//#region src/hold/index.ts
		const STYLE_ID$1 = "@kewen/dsh-voice-hold";
		const OVERLAY_SLOT = "conversation.input.overlay";
		/**
		* 按住说话复用官方「语音输入」提供的 speech Remote。
		* 设置尚未加载、或旧设置没有 holdEnabled 时默认启用。
		*/
		function applyHold(ctx) {
			const slots = ctx.get("slots");
			let enabled = getSettingsState().view?.settings.holdEnabled !== false;
			let slotAvailable = false;
			let unregister;
			let style;
			let disposed = false;
			const syncOverlay = () => {
				if (!disposed && enabled && slotAvailable) unregister ??= slots.register({
					name: OVERLAY_SLOT,
					id: "voice-hold",
					order: 100
				}, HoldOverlay);
				else {
					unregister?.();
					unregister = void 0;
				}
			};
			ctx.effect(() => {
				const update = () => {
					if (disposed) return;
					enabled = getSettingsState().view?.settings.holdEnabled !== false;
					if (enabled && style === void 0) {
						style = document.createElement("style");
						style.dataset.pluginCss = STYLE_ID$1;
						style.textContent = css;
						document.head.appendChild(style);
					} else if (!enabled && style !== void 0) {
						style.remove();
						style = void 0;
					}
					syncOverlay();
					if (!enabled) disposeAll();
				};
				const unsubscribe = subscribeSettings(update);
				update();
				loadSettings();
				return () => {
					disposed = true;
					unsubscribe();
					syncOverlay();
					style?.remove();
					style = void 0;
					disposeAll();
				};
			}, "voice-hold: settings and lifecycle");
			ctx.inject(["remote.speech"], (scope) => {
				scope.effect(() => {
					setSpeech(scope.get("remote").speech);
					return () => setSpeech(void 0);
				}, "voice-hold: speech remote");
			});
			slots.inject(OVERLAY_SLOT, () => {
				slotAvailable = true;
				syncOverlay();
				return () => {
					slotAvailable = false;
					syncOverlay();
				};
			});
		}
		//#endregion
		//#region src/client/reply-gate.tsx
		/** Disable the whole output/call component tree so its effects are disposed. */
		function withReplyEnabled(Component) {
			return function ReplyGate(props) {
				const { view } = useSettings();
				return view?.settings.replyEnabled === false ? null : (0, react.createElement)(Component, props);
			};
		}
		//#endregion
		//#region src/client/index.ts
		const STYLE_ID = "@kewen/dsh-voice-reply";
		const TOGGLE_SLOT = "conversation.input.left";
		const ACTIONS_SLOT = "conversation.chat.assistant-actions";
		/** 「插件」页里每个插件的详情页都会渲染这个 slot，组件里只认本插件。 */
		const DETAIL_SLOT = "plugins.detail.section";
		/** 电话按钮挂在输入框右侧这一格，实际画在发送按钮的位置（见 CallButton.tsx）；认不出发送按钮时就在这一格显示小按钮。 */
		const CALL_BUTTON_SLOT = "conversation.input.right";
		/** 通话面板挂在输入框的覆盖层里，通话中盖住输入框。 */
		const CALL_PANEL_SLOT = "conversation.input.overlay";
		/** dsh-voice-hold 开始录音时在 window 上发的事件：一开口就停止朗读。 */
		const RECORDING_EVENT = "dsh-voice-hold:recording";
		const inject = ["slots"];
		/**
		* 语音回复：输入框左侧加「语音模式」开关，打开后主代理边写边念；每条回复下方加喇叭按钮；
		* 「插件 → 语音朗读」详情页里换音色、模型，设每轮最多念多少字。
		* 合成走本插件的服务端（/voice-reply/*），Key 只在服务端。
		*/
		function apply(ctx) {
			applyHold(ctx);
			ctx.effect(() => {
				loadSettings();
				let previous = getSettingsState().view?.settings.replyEnabled !== false;
				return subscribeSettings(() => {
					const enabled = getSettingsState().view?.settings.replyEnabled !== false;
					if (previous && !enabled) {
						speaker.stopAll();
						hangupCall();
					}
					previous = enabled;
				});
			}, "voice: load feature settings");
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.pluginCss = STYLE_ID;
				style.textContent = css$1 + settingsCss + callCss;
				document.head.appendChild(style);
				return () => style.remove();
			}, "voice-reply: styles");
			ctx.effect(() => speaker.installUnlock(isEnabled), "voice-reply: audio unlock");
			ctx.effect(() => {
				const stop = () => speaker.stopAll();
				window.addEventListener(RECORDING_EVENT, stop);
				return () => window.removeEventListener(RECORDING_EVENT, stop);
			}, "voice-reply: stop on recording");
			ctx.effect(() => () => speaker.dispose(), "voice-reply: release audio");
			ctx.effect(() => {
				let unpublish;
				const sync = () => {
					const enabled = getSettingsState().view?.settings.replyEnabled !== false;
					if (enabled && !unpublish) unpublish = publishVoiceApi(window, {
						version: 1,
						autoRead: {
							get: isEnabled,
							set: setEnabled
						}
					});
					if (!enabled && unpublish) {
						unpublish();
						unpublish = void 0;
					}
				};
				sync();
				const unsubscribeSettings = subscribeSettings(sync);
				const unsubscribe = onEnabledChange(() => window.dispatchEvent(new Event(VOICE_EVENT)));
				return () => {
					unsubscribeSettings();
					unsubscribe();
					unpublish?.();
				};
			}, "voice-reply: session info bridge");
			ctx.inject(["remote.speech"], (scope) => {
				scope.effect(() => {
					setSpeech$1(scope.get("remote").speech);
					return () => setSpeech$1(void 0);
				}, "voice-reply: speech remote");
			});
			ctx.inject(["uiSession"], (scope) => {
				scope.effect(() => {
					setStatus(scope.get("uiSession").sessionStatus);
					return () => setStatus(void 0);
				}, "voice-reply: session status");
			});
			ctx.inject(["sessions"], (scope) => {
				scope.effect(() => {
					setSessions(scope.get("sessions"));
					return () => setSessions(void 0);
				}, "voice-reply: sessions");
			});
			ctx.effect(() => () => hangupCall(), "voice-reply: hang up on unload");
			const slots = ctx.get("slots");
			slots.inject(TOGGLE_SLOT, () => slots.register({
				name: TOGGLE_SLOT,
				id: "voice-reply-toggle",
				order: 50
			}, withReplyEnabled(VoiceToggle)));
			slots.inject(ACTIONS_SLOT, () => slots.register({
				name: ACTIONS_SLOT,
				id: "voice-reply-speak",
				order: 140
			}, withReplyEnabled(SpeakButton)));
			slots.inject(DETAIL_SLOT, () => slots.register({
				name: DETAIL_SLOT,
				id: "voice-reply-settings",
				order: 90
			}, SettingsSection));
			slots.inject(CALL_BUTTON_SLOT, () => slots.register({
				name: CALL_BUTTON_SLOT,
				id: "voice-reply-call",
				order: 40
			}, withReplyEnabled(CallButton)));
			slots.inject(CALL_PANEL_SLOT, () => slots.register({
				name: CALL_PANEL_SLOT,
				id: "voice-reply-call-panel",
				order: 200
			}, withReplyEnabled(CallPanel)));
		}
		//#endregion
		exports.RECORDING_EVENT = RECORDING_EVENT;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
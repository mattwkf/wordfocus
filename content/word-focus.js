/* Word Focus for Zotero. Original code, MIT licence. */
(function (root) {
  "use strict";

  const DEFAULTS = Object.freeze({
    settingsVersion: 3, enabled: true, wordEnabled: true, sentenceEnabled: true, pointRead: true,
    colour: "#ffe600", opacity: 32, outline: 0, showWord: true,
    sentenceColour: "#66b7ff", sentenceOpacity: 20, sentenceOutline: 0,
    annotationColour: "#ffd400"
  });
  const WORD_RE = /[\p{L}\p{N}\p{M}]+(?:['’\-][\p{L}\p{N}\p{M}]+)*/gu;

  function settings(input = {}) {
    const colour = (key) => /^#[\da-f]{6}$/i.test(input[key]) ? input[key] : DEFAULTS[key];
    const number = (key, max) => input[key] !== null && input[key] !== "" && Number.isFinite(+input[key])
      ? Math.max(0, Math.min(max, +input[key])) : DEFAULTS[key];
    return {
      settingsVersion: 3,
      enabled: input.enabled !== false,
      wordEnabled: input.wordEnabled !== false,
      sentenceEnabled: input.sentenceEnabled !== false,
      pointRead: input.pointRead !== false,
      colour: colour("colour"), opacity: number("opacity", 65),
      outline: input.settingsVersion !== 3 && +input.outline === 2 ? 0 : number("outline", 4),
      showWord: input.showWord !== false,
      sentenceColour: colour("sentenceColour"),
      sentenceOpacity: number("sentenceOpacity", 65), sentenceOutline: number("sentenceOutline", 4),
      annotationColour: colour("annotationColour")
    };
  }

  function sentenceRanges(text, lang) {
    let segmenter;
    try { segmenter = new Intl.Segmenter(lang || undefined, { granularity: "sentence" }); }
    catch (_) { segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" }); }
    return [...segmenter.segment(text)].map(x => ({
      start: x.index + x.segment.length - x.segment.trimStart().length,
      end: x.index + x.segment.trimEnd().length
    })).filter(x => x.end > x.start);
  }

  function sentenceAt(ranges, index) {
    return Number.isInteger(index) && index >= 0
      ? ranges.find(x => x.start <= index && index < x.end) || null : null;
  }

  function words(text, lang) {
    try {
      return [...new Intl.Segmenter(lang || undefined, { granularity: "word" }).segment(text)]
        .filter(x => x.isWordLike)
        .map(x => ({ start: x.index, end: x.index + x.segment.length, text: x.segment }));
    } catch (_) {
      return [...text.matchAll(WORD_RE)].map(x => ({ start: x.index, end: x.index + x[0].length, text: x[0] }));
    }
  }

  // Speech offsets and JS strings both use UTF-16 indices. Never split by spaces,
  // which loses punctuation, repeated spaces, combining marks and CJK words.
  function wordAt(tokens, index, length = 0) {
    if (!Number.isInteger(index) || index < 0) return null;
    const containing = tokens.find(x => x.start <= index && index < x.end);
    if (containing) return containing;
    // A voice may include leading punctuation in its boundary range.
    if (Number.isFinite(length) && length > 0) {
      return tokens.find(x => x.start >= index && x.start < index + length) || null;
    }
    return null;
  }

  function rgba(hex, opacity) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${opacity / 100})`;
  }

  function pdfRects(view, position) {
    const win = view._iframeWindow;
    const viewer = win?.PDFViewerApplication?.pdfViewer;
    if (!viewer || !Number.isInteger(position?.pageIndex)) return [];
    const groups = [{ pageIndex: position.pageIndex, rects: position.rects }];
    if (position.nextPageRects) groups.push({ pageIndex: position.pageIndex + 1, rects: position.nextPageRects });
    const results = [];
    const clip = win.document.getElementById("viewerContainer")?.getBoundingClientRect();
    for (const group of groups) {
      const page = viewer.getPageView(group.pageIndex);
      if (!page?.div?.isConnected || !page.viewport || !Array.isArray(group.rects)) continue;
      const box = page.div.getBoundingClientRect();
      // PDF.js may resize pages using CSS before it replaces their viewport.
      const sx = page.div.clientWidth / page.viewport.width;
      const sy = page.div.clientHeight / page.viewport.height;
      if (!(sx > 0 && sy > 0)) continue;
      for (const rect of group.rects) {
        if (rect.length !== 4 || !rect.every(Number.isFinite)) continue;
        const [a, b, c, d] = page.viewport.convertToViewportRectangle(rect);
        let left = box.left + page.div.clientLeft + Math.min(a, c) * sx;
        let top = box.top + page.div.clientTop + Math.min(b, d) * sy;
        let right = box.left + page.div.clientLeft + Math.max(a, c) * sx;
        let bottom = box.top + page.div.clientTop + Math.max(b, d) * sy;
        if (clip) {
          left = Math.max(left, clip.left); top = Math.max(top, clip.top);
          right = Math.min(right, clip.right); bottom = Math.min(bottom, clip.bottom);
        }
        if (right > left && bottom > top) results.push({ left, top, width: right - left, height: bottom - top });
      }
    }
    return results;
  }

  function viewRects(view, position) {
    if (!position) return [];
    if (typeof view.toDisplayedRange === "function") {
      const range = view.toDisplayedRange(position);
      if (!range) return [];
      return [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
    }
    return pdfRects(view, position);
  }

  // A new first segment contains only the clicked word and subsequent text.
  // Offset translation preserves the original document mapping for BOTH local
  // boundary events and remote voice timestamps, without editing the document.
  function playbackFromWord(source, segment, start, mapper) {
    const index = source.segments.indexOf(segment);
    if (index < 0 || !Number.isInteger(start) || start < 0 || start >= segment.text.length) throw new Error("The clicked word is no longer available.");
    if (!start) return { builder: source, segments: source.segments, index };
    const clipped = {
      ...segment, text: segment.text.slice(start),
      position: source.getWordPosition(segment, start, segment.text.length),
      sourcePosition: mapper.textNodeSpansToSourcePosition(source.getWordTextSpans(segment, start, segment.text.length)),
      wordFocusSentencePosition: segment.wordFocusSentencePosition || segment.sourcePosition,
      wordFocusSentenceText: segment.wordFocusSentenceText || segment.text
    };
    if (!clipped.position || !clipped.sourcePosition) throw new Error("The clicked word could not be mapped to the document.");
    const builder = Object.create(source);
    builder.segments = source.segments.slice(); builder.segments[index] = clipped;
    for (const name of ["getWordTextSpans", "getWordPosition"]) {
      builder[name] = (s, a, b) => source[name](s === clipped ? segment : s, a + (s === clipped ? start : 0), b + (s === clipped ? start : 0));
    }
    builder.getSegmentTextSpans = s => s === clipped ? source.getWordTextSpans(segment, start, segment.text.length) : source.getSegmentTextSpans(s);
    builder.getParagraphTextSpans = s => source.getParagraphTextSpans(s === clipped ? segment : s);
    return { builder, segments: builder.segments, index };
  }

  class PointReader {
    constructor(session) {
      this.session = session;
      this.core = session.core;
      this.entries = new Map(); this.cache = new WeakMap();
      this.hover = null; this.latest = null; this.pending = null;
      this.status = "Hover over text to preview it. Click a word to read from there.";
      const manager = this.core._readAloudManager, self = this;
      this.manager = manager;
      this.descriptor = Object.getOwnPropertyDescriptor(manager, "setSegments");
      this.originalSetSegments = manager.setSegments;
      this.wrapper = function (segments, backward, forward) {
        if (!self.session.disposed && self.pending) {
          const hit = self.pending; self.pending = null;
          try {
            const next = playbackFromWord(hit.builder, hit.segment, hit.word.start, self.core._sdt.mapper);
            self.core._readAloudSegments = next.builder;
            this._activeSegment = null;
            this._paused = false;
            self.status = "Reading from the clicked word.";
            return self.originalSetSegments.call(this, next.segments, next.index, null);
          } catch (error) { self.session.report(error); self.status = String(error.message || error); }
        }
        return self.originalSetSegments.call(this, segments, backward, forward);
      };
      manager.setSegments = this.wrapper;
    }

    get enabled() {
      return !this.session.disposed && this.session.config.enabled && this.session.config.pointRead &&
        (!this.core._state?.tool || this.core._state.tool.type === "pointer");
    }

    async load() {
      if (this.preview) return this.preview;
      if (this.loading) return this.loading;
      this.status = "Preparing text for pointing and reading…";
      this.loading = (async () => {
        const sdt = await this.core._loadSDT();
        if (!sdt || this.session.disposed) return null;
        // Reuse Zotero's own extraction and sentence builder in an isolated
        // facade. The real speech manager is never activated by hovering.
        const facade = Object.create(this.core);
        facade._sdt = sdt;
        facade._readAloudManager = {
          active: true, segmentGranularity: "sentence", lang: this.manager.lang,
          setLanguage(lang) { this.lang = lang; }, setSegments() {}, clearSegments() {}
        };
        facade._captureReadAloudStart = () => null;
        facade._findFirstVisibleSegmentIndex = () => 0;
        await this.core._requestReadAloudSegments.call(facade);
        if (this.session.disposed) return null;
        const builder = facade._readAloudSegments;
        if (!builder?.segments?.length) throw new Error("No readable text is available for pointing.");
        const byPage = new Map(), byBlock = new Map();
        const add = (map, key, segment) => { if (!map.has(key)) map.set(key, []); map.get(key).push(segment); };
        for (const segment of builder.segments) {
          const p = segment.sourcePosition;
          if (Number.isInteger(p?.pageIndex)) {
            add(byPage, p.pageIndex, segment);
            if (p.nextPageRects) add(byPage, p.pageIndex + 1, segment);
          }
          for (let b = segment.position.start[0]; b <= segment.position.end[0]; b++) add(byBlock, b, segment);
        }
        this.preview = { builder, byPage, byBlock, lang: facade._readAloudManager.lang };
        this.status = "Hover to preview. Click a word to read from there.";
        return this.preview;
      })().catch(error => { this.status = String(error.message || error); this.session.report(error); return null; })
        .finally(() => { this.loading = null; this.session.schedule(); });
      return this.loading;
    }

    sync() {
      const views = new Set(this.core._views || []);
      for (const [view, entry] of this.entries) {
        const doc = (view._iframeWindow || view.iframeWindow)?.document;
        if (!views.has(view) || doc !== entry.doc) { this.detach(entry); this.entries.delete(view); }
      }
      for (const view of views) {
        if (this.entries.has(view)) continue;
        const win = view._iframeWindow || view.iframeWindow, doc = win?.document;
        if (!doc?.body) continue;
        const entry = { view, win, doc, listeners: [], down: null };
        const listen = (target, type, fn, capture = false) => { target.addEventListener(type, fn, capture); entry.listeners.push([target, type, fn, capture]); };
        entry.style = doc.createElement("style");
        entry.style.textContent = "html[data-word-focus-pointing],html[data-word-focus-pointing] *{cursor:pointer!important}";
        doc.documentElement.append(entry.style);
        listen(win, "pointermove", event => {
          if (entry.down && Math.hypot(event.clientX - entry.down.x, event.clientY - entry.down.y) > 5) entry.down.dragged = true;
          if (!this.enabled || event.buttons || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) { this.clear(); return; }
          this.latest = { entry, x: event.clientX, y: event.clientY, target: event.target };
          if (!this.preview && !this.loading) this.load();
          this.session.schedule();
        });
        listen(win, "pointerdown", event => {
          entry.down = { x: event.clientX, y: event.clientY, dragged: false, button: event.button, selected: !!view.getSelectionPosition?.() };
        }, true);
        listen(win, "pointercancel", () => { entry.down = null; this.clear(); });
        listen(win, "click", event => {
          if (event.detail > 1) { this.cancelClick(); return; }
          const down = entry.down; entry.down = null;
          if (!this.enabled || !down || down.dragged || down.selected || down.button !== 0 || event.button !== 0 ||
            event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
          const hit = this.hitTest(entry, event.clientX, event.clientY, event.target);
          if (!hit) return;
          event.preventDefault(); event.stopImmediatePropagation();
          this.cancelClick();
          // Leave double-click selection available and never speak on a drag.
          this.clickTimer = this.session.win.setTimeout(() => { this.clickTimer = null; this.start(hit); }, 220);
        }, true);
        listen(doc.body, "pointerleave", () => this.clear());
        listen(win, "scroll", () => this.clear(), true);
        listen(win, "blur", () => this.clear());
        this.entries.set(view, entry);
      }
      if (!this.enabled) { this.cancelClick(); this.pending = null; this.clear(); }
    }

    hitTest(entry, x, y, target) {
      if (!this.preview || !this.enabled || target?.closest?.('a,button,input,textarea,select,[contenteditable="true"],[data-annotation-id],.annotation-popup,.selection-popup')) return null;
      const { view, doc } = entry;
      let candidates;
      if (typeof view.pointerEventToPosition === "function") {
        const point = view.pointerEventToPosition({ clientX: x, clientY: y });
        if (!point || view._getSelectableOverlay?.(point) || view.getSelectableAnnotations?.(point)?.length) return null;
        candidates = this.preview.byPage.get(point.pageIndex) || [];
      } else {
        const caret = doc.caretPositionFromPoint?.(x, y);
        if (!caret || caret.offsetNode.nodeType !== 3 || !caret.offsetNode.length) return null;
        const range = doc.createRange(), offset = Math.min(caret.offset, caret.offsetNode.length - 1);
        range.setStart(caret.offsetNode, offset); range.setEnd(caret.offsetNode, offset + 1);
        const pos = typeof view._rangeToSDTPosition === "function" ? view._rangeToSDTPosition(range)
          : this.core._sdt.mapper.sourceToSDTPosition(view.toSelector(range));
        candidates = pos ? this.preview.byBlock.get(pos.start[0]) || [] : [];
      }
      const contains = position => viewRects(view, position).some(r => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height);
      for (const segment of candidates) {
        if (!contains(segment.sourcePosition)) continue;
        let mapped = this.cache.get(segment);
        if (!mapped) {
          mapped = words(segment.text, this.preview.lang).map(word => ({
            word, position: this.core._sdt.mapper.textNodeSpansToSourcePosition(this.preview.builder.getWordTextSpans(segment, word.start, word.end))
          }));
          this.cache.set(segment, mapped);
        }
        const match = mapped.find(item => item.position && contains(item.position));
        if (match) return { ...match, segment, builder: this.preview.builder, view };
      }
      return null;
    }

    refresh() {
      if (!this.enabled || !this.latest) return;
      const { entry, x, y, target } = this.latest;
      const hit = this.hitTest(entry, x, y, target);
      this.hover = hit;
      for (const item of this.entries.values()) item.doc.documentElement.toggleAttribute("data-word-focus-pointing", !!hit && item === entry);
    }

    clear() {
      const changed = this.hover || this.latest;
      this.hover = null; this.latest = null;
      for (const entry of this.entries.values()) entry.doc.documentElement.removeAttribute("data-word-focus-pointing");
      if (changed) this.session.schedule();
    }

    start(hit) {
      if (!this.enabled) return;
      this.pending = hit;
      try {
        hit.view.clearSelection?.();
        this.core._lockPositionToReadAloud?.();
        if (this.manager.active && this.manager._voice) {
          this.core._updateReadAloudUIState({ popupOpen: true, annotationPopup: null });
          this.core._state.readAloudState.segmentAnnotations?.clear();
          this.manager.setSegments(hit.builder.segments, 0, null);
        } else {
          this.status = "Choose a voice in Read Aloud if prompted.";
          this.core.startReadAloudAtPosition(hit.position);
        }
        this.clear();
      } catch (error) { this.pending = null; this.session.report(error); this.status = String(error.message || error); }
    }

    cancelClick() {
      if (this.clickTimer != null) this.session.win.clearTimeout(this.clickTimer);
      this.clickTimer = null;
    }

    detach(entry) {
      for (const [target, type, fn, capture] of entry.listeners) target.removeEventListener(type, fn, capture);
      entry.doc.documentElement.removeAttribute("data-word-focus-pointing"); entry.style.remove();
      if (this.latest?.entry === entry) this.clear();
    }

    dispose() {
      this.cancelClick(); this.pending = null; this.clear();
      for (const entry of this.entries.values()) this.detach(entry);
      this.entries.clear();
      if (this.manager.setSegments === this.wrapper) {
        if (this.descriptor) Object.defineProperty(this.manager, "setSegments", this.descriptor);
        else delete this.manager.setSegments;
      }
    }
  }

  class Overlay {
    constructor(win, requestRender) {
      this.win = win;
      this.doc = win.document;
      this.host = this.doc.createElement("div");
      this.host.className = "word-focus-overlay";
      this.host.setAttribute("aria-hidden", "true");
      this.host.style.cssText = "position:fixed;inset:0;z-index:2147483000;pointer-events:none;overflow:hidden;";
      this.shadow = this.host.attachShadow({ mode: "open" });
      this.style = this.doc.createElement("style");
      this.style.textContent = ":host{pointer-events:none!important} .word,.sentence{position:absolute;box-sizing:border-box;border-radius:3px;pointer-events:none} @media print{:host{display:none!important}}";
      this.content = this.doc.createElement("div");
      this.shadow.append(this.style, this.content);
      this.doc.documentElement.append(this.host);
      this.render = requestRender;
      win.addEventListener("scroll", this.render, true);
      win.addEventListener("resize", this.render);
      this.signature = "";
    }

    draw(wordRects, sentenceRects, config) {
      const w = this.win.innerWidth, h = this.win.innerHeight;
      const visible = rects => rects.filter(r => r.left < w && r.top < h && r.left + r.width > 0 && r.top + r.height > 0);
      const word = visible(wordRects), sentence = visible(sentenceRects);
      const coords = rects => rects.map(r => [r.left, r.top, r.width, r.height]);
      const signature = JSON.stringify([config, coords(word), coords(sentence)]);
      if (signature === this.signature && this.host.isConnected) return;
      this.signature = signature;
      if (!this.host.isConnected) this.doc.documentElement.append(this.host);
      const makeNode = (r, kind) => {
        const node = this.doc.createElement("div");
        node.className = kind;
        const isWord = kind === "word";
        const colour = isWord ? config.colour : config.sentenceColour;
        const opacity = isWord ? config.opacity : config.sentenceOpacity;
        const outline = isWord ? config.outline : config.sentenceOutline;
        node.style.cssText = `left:${r.left - 2}px;top:${r.top - 1}px;width:${r.width + 4}px;height:${r.height + 2}px;` +
          `background:${rgba(colour, opacity)};border:${outline}px solid ${isWord ? "#161616" : colour};` +
          (isWord && outline > 0 ? `box-shadow:0 0 0 2px ${colour},0 0 0 3px #fff;` : "");
        return node;
      };
      // Paint sentence context first so the current word remains on top.
      const nodes = [...sentence.map(r => makeNode(r, "sentence")), ...word.map(r => makeNode(r, "word"))];
      this.content.replaceChildren(...nodes);
    }

    dispose() {
      this.win.removeEventListener("scroll", this.render, true);
      this.win.removeEventListener("resize", this.render);
      this.host.remove();
    }
  }

  class Session {
    constructor(core, win, options = {}) {
      if (typeof core?._composeReadAloudStateSnapshot !== "function" || !core._readAloudManager) {
        throw new Error("Word Focus needs the Zotero 10.0.6 Read Aloud interfaces.");
      }
      this.core = core;
      this.win = win;
      this.config = settings(options.settings);
      this.onSettings = options.onSettings || (() => {});
      this.onError = options.onError || (() => {});
      this.bridge = options.bridge || (fn => fn);
      this.overlays = new Map();
      this.nativeHooks = new Map();
      this.sentenceCache = new WeakMap();
      this.sentenceAnnotations = new Map();
      this.local = null;
      this.snapshot = null;
      this.currentWord = "";
      this.timing = "idle";
      this.disposed = false;
      this.frame = null;
      this.buttons = new Set();
      this.panelOpen = false;
      this.lastError = "";
      this.originalDescriptor = Object.getOwnPropertyDescriptor(core, "_composeReadAloudStateSnapshot");
      this.originalCompose = core._composeReadAloudStateSnapshot;
      const session = this;
      this.wrapper = this.bridge(function (...args) {
        const snapshot = session.originalCompose.apply(this, args);
        if (!session.disposed) {
          try { session.compose(snapshot); } catch (error) { session.report(error); }
        }
        return snapshot;
      }, core);
      core._composeReadAloudStateSnapshot = this.wrapper;
      try {
        this.pointReader = new PointReader(this);
        this.uiReady = this.createUI().then(() => { if (!this.disposed) this.push(); })
          .catch(error => { this.report(error); this.dispose(); });
      } catch (error) {
        this.dispose();
        throw error;
      }
    }

    report(error) {
      const message = String(error?.message || error);
      if (message !== this.lastError) { this.lastError = message; this.onError(error); }
    }

    attachUtterance() {
      const manager = this.core._readAloudManager;
      const controller = manager?._controller;
      const utterance = controller?._currentUtterance;
      if (this.local?.utterance === utterance && this.local?.controller === controller) return;
      this.detachUtterance();
      if (!utterance || typeof utterance.addEventListener !== "function") return;
      const segment = controller._currentSegment;
      if (!segment || typeof segment.text !== "string" || utterance.text !== segment.text) return;
      const record = {
        controller, utterance, segment, word: null, sentenceStart: null,
        sentences: sentenceRanges(segment.text, manager.lang),
        tokens: words(segment.text, manager.lang), listeners: []
      };
      const listen = (name, fn) => {
        utterance.addEventListener(name, fn);
        record.listeners.push([name, fn]);
      };
      this.local = record;
      listen("boundary", event => {
        // Sentence events can move the context highlight, but never identify
        // a word. Ignore stale events after skips, voice changes and resumes.
        if (this.disposed || !this.config.enabled || !["word", "sentence"].includes(event.name) ||
            manager._controller !== controller || controller._currentUtterance !== utterance ||
            manager.activeSegment !== segment || manager.paused || manager.buffering) return;
        if (event.name === "sentence") {
          const sentence = sentenceAt(record.sentences, event.charIndex);
          if (!sentence || sentence.start === record.sentenceStart) return;
          record.sentenceStart = sentence.start;
          record.word = null;
          this.push();
          return;
        }
        const word = wordAt(record.tokens, event.charIndex, event.charLength);
        if (!word || record.word?.start === word.start) return;
        record.word = word;
        record.sentenceStart = sentenceAt(record.sentences, word.start)?.start ?? null;
        this.push();
      });
      for (const eventName of ["start", "end", "error"]) {
        listen(eventName, () => {
          if (this.local !== record || this.disposed) return;
          record.word = null;
          record.sentenceStart = null;
          this.push();
        });
      }
    }

    detachUtterance() {
      if (!this.local) return;
      for (const [name, fn] of this.local.listeners) this.local.utterance.removeEventListener(name, fn);
      this.local = null;
    }

    compose(snapshot) {
      this.syncNativeHighlights();
      this.attachUtterance();
      this.snapshot = snapshot;
      this.currentWord = "";
      this.sentencePosition = null;
      this.currentSentence = null;
      this.timing = "idle";
      if (!this.config.enabled) { this.schedule(); return; }
      const manager = this.core._readAloudManager;
      const segment = snapshot.activeSegment;
      if (snapshot.popupOpen && snapshot.active && segment) {
        let index = null;
        const timestamp = manager.activeTimestamp;
        if (timestamp && Number.isInteger(timestamp.charStart) && Number.isInteger(timestamp.charEnd) &&
            timestamp.charStart >= 0 && timestamp.charEnd > timestamp.charStart &&
            timestamp.charEnd <= segment.text.length && snapshot.activeWordSourcePosition) {
          this.currentWord = segment.text.slice(timestamp.charStart, timestamp.charEnd).trim();
          index = timestamp.charStart;
          this.timing = "timestamps";
        } else if (this.local?.segment === segment && this.local.word &&
                   this.local.controller === manager._controller) {
          const word = this.local.word;
          const position = this.mapRange(segment, word.start, word.end);
          snapshot.activeWordSourcePosition = position || null;
          this.currentWord = word.text;
          index = word.start;
          this.timing = position ? "boundaries" : "unmapped";
        } else {
          this.timing = manager.buffering ? "buffering" : "waiting";
        }
        if (index === null && this.local?.segment === segment) index = this.local.sentenceStart;
        this.currentSentence = this.resolveSentenceContext(segment, snapshot.segmentGranularity, index, snapshot.lang || manager.lang);
        this.sentencePosition = this.currentSentence?.position || null;
      }
      this.schedule();
    }

    mapRange(segment, start, end) {
      const spans = this.core._readAloudSegments?.getWordTextSpans(segment, start, end);
      return spans?.length ? this.core._sdt?.mapper?.textNodeSpansToSourcePosition(spans) : null;
    }

    resolveSentencePosition(segment, granularity, index, lang) {
      return this.resolveSentenceContext(segment, granularity, index, lang)?.position || null;
    }

    resolveSentenceContext(segment, granularity, index, lang) {
      if (segment.wordFocusSentencePosition) return {
        position: segment.wordFocusSentencePosition,
        text: (segment.wordFocusSentenceText || segment.text).trim()
      };
      // Zotero already supplies sentence positions for sentence-based voices.
      if (segment.granularity === "sentence" || granularity === "sentence") {
        const position = segment.sourcePosition || this.mapRange(segment, 0, segment.text.length);
        return position ? { position, text: segment.text.trim() } : null;
      }
      this.sentenceCache ||= new WeakMap();
      let ranges = this.sentenceCache.get(segment);
      if (!ranges) { ranges = sentenceRanges(segment.text, lang); this.sentenceCache.set(segment, ranges); }
      const sentence = sentenceAt(ranges, index) || (ranges.length === 1 ? ranges[0] : null);
      // A paragraph without timing cannot identify the sentence being spoken.
      if (!sentence) return null;
      const position = this.mapRange(segment, sentence.start, sentence.end);
      return position ? { position, text: segment.text.slice(sentence.start, sentence.end) } : null;
    }

    annotationUnavailableReason() {
      if (this.disposed || !this.config.enabled) return "Enable Word Focus to add the current sentence.";
      if (this.core._state?.readOnly || this.core._annotationManager?._readOnly) return "This document is read-only.";
      if (!this.snapshot?.active || !this.snapshot.popupOpen) return "Start Read Aloud to add a sentence.";
      if (!this.currentSentence?.position || !this.currentSentence.text) return "Waiting for a mapped sentence from the voice.";
      if (!this.core._annotationManager?.addAnnotation || !this.core._getSourceAnnotationMeta) return "Annotations are unavailable in this reader.";
      return "";
    }

    sentenceKey() {
      return this.currentSentence ? JSON.stringify([this.currentSentence.text, this.currentSentence.position]) : "";
    }

    addSentenceAnnotation() {
      if (this.disposed) return null;
      let key = "";
      try {
        // Refresh from playback at click time. Hover previews never supply
        // this context, and a clipped first utterance retains its full sentence.
        this.compose(this.core._composeReadAloudStateSnapshot());
        const reason = this.annotationUnavailableReason();
        key = this.sentenceKey();
        if (reason) { this.annotationNotice = { key, message: reason }; this.updateUI(); return null; }
        const manager = this.core._annotationManager;
        this.sentenceAnnotations ||= new Map();
        const existingID = this.sentenceAnnotations.get(key);
        let annotation = existingID && manager._getAnnotationByID(existingID);
        const existing = !!annotation;
        if (!annotation) {
          const sentence = this.currentSentence;
          const meta = this.core._getSourceAnnotationMeta(sentence.position);
          if (!meta?.sortIndex) throw new Error("The sentence could not be mapped to an annotation. Try again when playback advances.");
          annotation = manager.addAnnotation({
            type: "highlight", color: this.config.annotationColour,
            text: sentence.text,
            // Zotero rounds annotation coordinates. Keep its stored copy
            // separate from the live speech position and deduplication key.
            position: JSON.parse(JSON.stringify(sentence.position)),
            sortIndex: meta.sortIndex, pageLabel: meta.pageLabel
          });
          if (!annotation) throw new Error("The sentence could not be added to this document.");
          this.sentenceAnnotations.set(key, annotation.id);
        }
        this.annotationNotice = { key, message: existing ? "This sentence is already in Annotations." : "Sentence added to Annotations." };
        this.core.setSidebarView("annotations");
        this.core.toggleSidebar(true);
        this.core.setSelectedAnnotations([annotation.id]);
        this.updateUI();
        return annotation;
      } catch (error) {
        this.report(error);
        this.annotationNotice = { key, message: "Could not add the sentence. " + String(error.message || error) };
        this.updateUI();
        return null;
      }
    }

    syncNativeHighlights() {
      this.nativeHooks ||= new Map();
      const targets = new Map();
      for (const view of this.core._views || []) {
        if (typeof view._resolveReadAloudPrimaryPosition === "function") {
          targets.set(view, ["_resolveReadAloudPrimaryPosition", "_resolveReadAloudSkipHighlightPosition"]);
        }
        if (view._readAloud) targets.set(view._readAloud, ["_resolvePrimarySelector", "_resolveSkipSpotlightSelector"]);
      }
      for (const [target, hooks] of this.nativeHooks) {
        if (!targets.has(target)) { this.restoreHooks(target, hooks); this.nativeHooks.delete(target); }
      }
      for (const [target, keys] of targets) {
        if (this.nativeHooks.has(target)) continue;
        const hooks = [];
        for (const key of keys) {
          if (typeof target[key] !== "function") continue;
          const original = target[key], descriptor = Object.getOwnPropertyDescriptor(target, key), session = this;
          const wrapper = function (...args) {
            // Our two adjustable layers replace only native visual highlights.
            // Navigation, voice playback and document positions stay native.
            return !session.disposed && session.config.enabled ? null : original.apply(this, args);
          };
          target[key] = wrapper;
          hooks.push({ key, original, descriptor, wrapper });
        }
        this.nativeHooks.set(target, hooks);
      }
    }

    restoreHooks(target, hooks) {
      for (const { key, descriptor, wrapper } of hooks) {
        if (target[key] !== wrapper) continue;
        if (descriptor) Object.defineProperty(target, key, descriptor);
        else delete target[key];
      }
    }

    async push() {
      if (this.disposed || this.pushPending) return;
      this.pushPending = true;
      try {
        await Promise.all((this.core._views || []).map(view => view.initializedPromise));
        if (!this.disposed) this.core._pushReadAloudToViews();
      } catch (error) { this.report(error); }
      finally { this.pushPending = false; }
    }

    schedule() {
      if (this.disposed || this.frame !== null) return;
      this.frame = this.win.requestAnimationFrame(() => {
        this.frame = null;
        try { this.paint(); } catch (error) { this.report(error); }
      });
    }

    // Handles newly mounted EPUB sections, split views, PDF zoom and changes
    // made by Zotero without replacing any controller or playback method.
    tick() {
      if (this.disposed) return;
      this.attachUtterance();
      this.ensureButton();
      this.pointReader?.sync();
      if (this.snapshot?.popupOpen || this.panelOpen) this.schedule();
    }

    paint() {
      this.pointReader?.refresh();
      const snapshot = this.snapshot;
      const show = this.config.enabled && snapshot?.popupOpen && snapshot.active;
      const hover = this.config.enabled && this.config.pointRead ? this.pointReader?.hover : null;
      const position = this.config.wordEnabled ? hover?.position || (show ? snapshot.activeWordSourcePosition : null) : null;
      const sentencePosition = this.config.sentenceEnabled ? hover?.segment.sourcePosition || (show ? this.sentencePosition : null) : null;
      const views = new Set(this.core._views || []);
      for (const [view, overlay] of this.overlays) {
        if (!views.has(view) || overlay.win.closed) { overlay.dispose(); this.overlays.delete(view); }
      }
      for (const view of views) {
        const win = view._iframeWindow || view.iframeWindow;
        if (!win?.document?.documentElement) continue;
        let overlay = this.overlays.get(view);
        if (overlay && overlay.doc !== win.document) {
          overlay.dispose(); this.overlays.delete(view); overlay = null;
        }
        if (!overlay && !position && !sentencePosition) continue;
        if (!overlay) {
          overlay = new Overlay(win, () => this.schedule());
          this.overlays.set(view, overlay);
        }
        overlay.host.dataset.mode = hover ? "hover" : "speech";
        try { overlay.draw(position ? viewRects(view, position) : [], sentencePosition ? viewRects(view, sentencePosition) : [], this.config); }
        catch (error) { overlay.draw([], [], this.config); this.report(error); }
      }
      this.updateUI();
    }

    updateSettings(patch) {
      this.config = settings({ ...this.config, ...patch });
      this.onSettings(this.config);
      this.push();
      this.syncControls();
    }

    setSettings(config) {
      this.config = settings(config);
      this.push();
      this.syncControls();
    }

    createButton(doc) {
      const group = doc.createElement("div");
      group.className = "word-focus-toolbar-controls";
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", "Word Focus");
      group.style.cssText = "display:inline-flex;align-items:center;gap:4px;flex-shrink:0;position:relative;";
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "toolbar-button word-focus-button";
      button.textContent = "Wf";
      button.title = "Word Focus settings";
      button.setAttribute("aria-label", "Word Focus settings");
      button.setAttribute("aria-haspopup", "dialog");
      button.style.cssText = "font-weight:800;font-size:13px;min-width:28px;border-bottom:3px solid #ffe600;";
      const click = () => {
        this.panelOpen = !this.panelOpen;
        this.lastButton = button;
        this.updateUI();
        if (this.panelOpen) this.enableControl?.focus();
      };
      button.addEventListener("click", click);
      const annotationButton = doc.createElement("button");
      annotationButton.type = "button";
      annotationButton.className = "toolbar-button word-focus-annotation-button";
      annotationButton.textContent = "Add annotation";
      annotationButton.title = "Save the sentence being read to Annotations";
      annotationButton.disabled = true;
      annotationButton.style.cssText = "width:auto;min-width:0;padding-inline:8px;white-space:nowrap;font-size:12px;";
      const annotationClick = () => this.addSentenceAnnotation();
      annotationButton.addEventListener("click", annotationClick);
      const message = doc.createElement("span");
      message.className = "word-focus-annotation-status";
      message.setAttribute("role", "status");
      message.setAttribute("aria-live", "polite");
      message.style.cssText = "position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;";
      group.append(button, annotationButton, message);
      this.buttons.add({ group, button, click, annotationButton, annotationClick, message });
      this.updateUI();
      return group;
    }

    removeButton(entry) {
      entry.button.removeEventListener("click", entry.click);
      entry.annotationButton.removeEventListener("click", entry.annotationClick);
      entry.group.remove();
    }

    ensureButton() {
      for (const entry of this.buttons) {
        if (!entry.button.isConnected) {
          this.removeButton(entry);
          this.buttons.delete(entry);
        }
      }
      if ([...this.buttons].some(x => x.button.isConnected)) return;
      const toolbar = this.win.document.querySelector(".toolbar .end");
      if (toolbar) toolbar.prepend(this.createButton(this.win.document));
    }

    async createUI() {
      let doc = this.win.document;
      this.uiHost = doc.createElement("div");
      this.uiHost.className = "word-focus-ui";
      this.uiHost.style.cssText = "position:fixed;inset:0;z-index:2147483001;pointer-events:none;";
      this.ui = this.uiHost.attachShadow({ mode: "open" });
      const style = doc.createElement("style");
      style.textContent = `
        :host{font:13px/1.5 system-ui,sans-serif;color:#17202a;pointer-events:none!important}
        *{box-sizing:border-box} [hidden]{display:none!important}
        .card{background:#fff;border:1px solid #c2c9d1;border-radius:12px;box-shadow:0 6px 24px #0003}
        .panel-frame{position:absolute;right:12px;top:50px;width:360px;max-width:calc(100vw - 24px);height:min(720px,calc(100vh - 65px));border:0;border-radius:12px;box-shadow:0 6px 24px #0003;pointer-events:auto;color-scheme:light dark}
        .panel{position:relative;width:100%;height:100%;overflow:auto;padding:16px;pointer-events:auto}
        h2{margin:0 0 10px;font-size:17px} p{margin:8px 0;color:#505964;font-size:12px}
        label{display:flex;gap:8px;align-items:center;margin:9px 0}
        fieldset{border:1px solid #bbc4d0;border-radius:8px;padding:3px 12px 6px;margin:12px 0}
        legend{font-weight:700;padding:0 5px} .setting-name{flex:1}
        .numeric-row{display:grid;grid-template-columns:minmax(48px,1fr) 92px 56px 18px;gap:6px;align-items:center;margin:9px 0}
        .numeric-row label{margin:0}.numeric-row input{min-width:0}
        input[type=range]{width:100%;margin:0} input[type=number]{width:56px;padding:3px;border:1px solid #a1acba;border-radius:4px;font:inherit;font-variant-numeric:tabular-nums}
        input[type=color]{width:40px;height:28px;border:0;padding:0}
        .preview{padding:12px 8px;text-align:center;line-height:2}.preview span{border-radius:3px;padding:1px 2px}
        input{accent-color:#2f60ad} button{font:inherit;color:inherit;background:#f0f3f8;border:1px solid #bbc4d0;border-radius:6px;padding:5px 10px;cursor:pointer}
        button:focus-visible,input:focus-visible{outline:3px solid #2471d6;outline-offset:2px}
        button:disabled{opacity:.55;cursor:default}
        .line{display:flex;justify-content:space-between;align-items:center;gap:12px}
        .readout{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);min-width:210px;max-width:min(560px,90vw);padding:8px 18px;text-align:center}
        .word{font-size:28px;font-weight:750;line-height:1.3;overflow-wrap:anywhere;color:#171717}
        .status{font-size:11px;color:#505964}.notice{font-size:12px;max-width:420px;white-space:normal}
        @media(prefers-color-scheme:dark){.card{background:#20252c;color:#f5f6f8;border-color:#667180}.word{color:#fff}p,.status{color:#c3cbd6}button{background:#343d49;color:#f5f6f8}}
        @media print{:host{display:none!important}}
      `;
      this.ui.append(style);
      // Reader window focus/keyboard handlers see a Shadow DOM host rather
      // than its inputs and cancel native range/keyboard actions. A separate
      // about:blank document isolates control events before those handlers.
      // No reader handlers are patched or disabled.
      this.panelFrame = doc.createElement("iframe");
      this.panelFrame.className = "panel-frame";
      this.panelFrame.title = "Word Focus settings";
      this.panelFrame.hidden = true;
      const frameReady = new Promise(resolve => this.panelFrame.addEventListener("load", resolve, { once: true }));
      this.panelFrame.src = "about:blank";
      this.ui.append(this.panelFrame);
      doc.documentElement.append(this.uiHost);
      await frameReady;
      if (this.disposed) return;
      doc = this.panelFrame.contentDocument;
      this.panelDocument = doc;
      doc.documentElement.style.cssText = "height:100%;color-scheme:light dark";
      doc.body.style.cssText = "margin:0;height:100%;font:13px/1.5 system-ui,sans-serif;color:#17202a;background:transparent";
      doc.head.append(style.cloneNode(true));
      const el = (name, text, className) => {
        const node = doc.createElement(name);
        if (text) node.textContent = text;
        if (className) node.className = className;
        return node;
      };
      this.panel = el("section", "", "panel card");
      this.panel.setAttribute("role", "dialog");
      this.panel.setAttribute("aria-label", "Word Focus settings");
      const heading = el("div", "", "line");
      const close = el("button", "Close");
      close.addEventListener("click", () => this.closePanel());
      heading.append(el("h2", "Word Focus"), close);
      this.panel.append(heading);
      this.controls = new Map();
      const register = (property, input, number, unit = "") => {
        input.dataset.setting = property;
        this.controls.set(property, { input, number, unit });
        return input;
      };
      const checkbox = (text, property, parent = this.panel) => {
        const label = el("label");
        const input = el("input"); input.type = "checkbox";
        input.addEventListener("change", () => this.updateSettings({ [property]: input.checked }));
        label.append(input, el("span", text)); parent.append(label);
        return register(property, input);
      };
      const colour = (parent, property, labelText = "Colour") => {
        const label = el("label"); label.append(el("span", labelText, "setting-name"));
        const input = el("input"); input.type = "color";
        input.addEventListener("input", () => this.updateSettings({ [property]: input.value }));
        label.append(input); parent.append(label); register(property, input);
      };
      const slider = (parent, groupTitle, labelText, property, max, unit) => {
        const row = el("div", "", "numeric-row");
        const label = el("label", labelText);
        const input = el("input"); input.type = "range"; input.min = 0; input.max = max; input.step = 1;
        input.id = "word-focus-" + property;
        label.htmlFor = input.id;
        input.setAttribute("aria-label", `${groupTitle} ${labelText.toLowerCase()}`);
        const number = el("input"); number.type = "number"; number.min = 0; number.max = max; number.step = 1;
        number.inputMode = "numeric"; number.dataset.numberSetting = property;
        number.setAttribute("aria-label", `${groupTitle} ${labelText.toLowerCase()} value`);
        const updateRange = () => this.updateSettings({ [property]: +input.value });
        input.addEventListener("input", updateRange);
        input.addEventListener("change", updateRange);
        number.addEventListener("input", () => {
          if (number.value !== "" && number.validity.valid) this.updateSettings({ [property]: number.valueAsNumber });
        });
        const commit = () => {
          const value = number.valueAsNumber;
          this.updateSettings({ [property]: Number.isFinite(value) ? Math.round(Math.max(0, Math.min(max, value))) : this.config[property] });
          number.value = this.config[property];
        };
        number.addEventListener("change", commit);
        number.addEventListener("blur", commit);
        number.addEventListener("keydown", event => {
          if (event.key === "Enter") { event.preventDefault(); commit(); }
        });
        const suffix = el("span", unit); suffix.setAttribute("aria-hidden", "true");
        row.append(label, input, number, suffix); parent.append(row); register(property, input, number, unit);
      };
      this.enableControl = checkbox("Enable Word Focus", "enabled");
      checkbox("Point to read", "pointRead");
      this.pointStatus = el("p"); this.panel.append(this.pointStatus);
      const annotationGroup = el("fieldset"); annotationGroup.append(el("legend", "Sentence annotations"));
      colour(annotationGroup, "annotationColour", "Default highlight colour");
      annotationGroup.append(el("p", "Use Add annotation beside Wf in the toolbar to save the sentence being read. This colour applies to new permanent highlights in Zotero’s Annotations."));
      this.panel.append(annotationGroup);
      for (const [title, toggle, colourKey, opacityKey, outlineKey] of [
        ["Spoken word", "wordEnabled", "colour", "opacity", "outline"],
        ["Current sentence", "sentenceEnabled", "sentenceColour", "sentenceOpacity", "sentenceOutline"]
      ]) {
        const group = el("fieldset"); group.append(el("legend", title));
        checkbox("Show highlight", toggle, group);
        colour(group, colourKey);
        slider(group, title, "Opacity", opacityKey, 65, "%");
        slider(group, title, "Outline", outlineKey, 4, "px");
        this.panel.append(group);
      }
      const preview = el("div", "", "preview"); preview.setAttribute("aria-label", "Highlight preview");
      this.sentencePreview = el("span"); this.wordPreview = el("span", "spoken");
      this.sentencePreview.append(doc.createTextNode("Follow each "), this.wordPreview, doc.createTextNode(" word."));
      preview.append(this.sentencePreview); this.panel.append(preview);
      this.panel.append(el("p", "Drag a slider or type a value. Use the arrow keys for small adjustments. Press Enter to confirm a typed value."));
      checkbox("Show the enlarged current word", "showWord");
      this.panel.append(el("p", "Start Read Aloud with the headphones button. Changes apply immediately and are saved across documents."));
      this.panel.append(el("p", "The word highlight needs a voice with word timing. The sentence can remain highlighted while the word moves."));
      this.readout = el("div", "", "readout card");
      this.readout.setAttribute("aria-live", "off");
      this.wordNode = el("div", "", "word");
      this.statusNode = el("div", "", "status");
      this.readout.append(this.wordNode, this.statusNode);
      doc.body.append(this.panel);
      this.ui.append(this.readout);
      this.keyHandler = event => {
        if (event.key === "Escape" && this.panelOpen) { event.stopPropagation(); this.closePanel(); }
      };
      doc.addEventListener("keydown", this.keyHandler);
      this.syncControls(); this.updateUI();
    }

    closePanel() {
      this.panelDocument?.activeElement?.blur();
      this.panelOpen = false;
      this.updateUI();
      this.lastButton?.focus();
    }

    syncControls() {
      if (!this.enableControl) return;
      for (const [property, { input, number, unit }] of this.controls) {
        if (input.type === "checkbox") input.checked = this.config[property];
        else if (input.value !== String(this.config[property])) input.value = this.config[property];
        if (number) {
          // Do not replace an in-progress edit or reset a native slider drag
          // when settings are echoed back from the other reader sessions.
          if (this.panelDocument.activeElement !== number && number.value !== String(this.config[property])) number.value = this.config[property];
          input.setAttribute("aria-valuetext", this.config[property] + (unit === "%" ? " percent" : " pixels"));
        }
      }
      const c = this.config;
      this.sentencePreview.style.cssText = c.enabled && c.sentenceEnabled
        ? `background:${rgba(c.sentenceColour, c.sentenceOpacity)};outline:${c.sentenceOutline}px solid ${c.sentenceColour}` : "";
      this.wordPreview.style.cssText = c.enabled && c.wordEnabled
        ? `background:${rgba(c.colour, c.opacity)};outline:${c.outline}px solid #161616` : "";
    }

    updateUI() {
      if (!this.panel) return;
      this.panel.hidden = !this.panelOpen;
      this.panelFrame.hidden = !this.panelOpen;
      if (this.pointStatus) this.pointStatus.textContent = this.pointReader?.status || "";
      for (const { button } of this.buttons) {
        button.setAttribute("aria-expanded", String(this.panelOpen));
        button.style.borderBottomColor = this.config.enabled ? this.config.colour : "transparent";
      }
      const s = this.snapshot;
      const active = this.config.enabled && s?.popupOpen && s.active;
      // Unsupported voices must remain visible even when the user hides the
      // optional enlarged-word display, so fallback is never silent.
      const unsupported = active && (this.config.wordEnabled || this.config.showWord) && s.activeSegment && this.timing === "waiting" && !s.paused;
      this.readout.hidden = this.panelOpen || !active || (!this.config.showWord && !unsupported);
      this.wordNode.hidden = this.statusNode.hidden = !this.config.showWord && !unsupported;
      this.wordNode.className = unsupported ? "notice" : "word";
      this.wordNode.textContent = this.currentWord || (unsupported ? "No word timing yet. Try another Read Aloud voice." : "Word Focus");
      this.statusNode.textContent = s?.paused ? "Paused" :
        this.timing === "boundaries" ? "Following spoken-word events" :
        this.timing === "timestamps" ? "Following voice word timestamps" :
        this.timing === "unmapped" ? "Word detected, but its page position is unavailable" :
        this.timing === "buffering" ? "Waiting for audio" :
        unsupported ? (this.sentencePosition ? "The sentence highlight is still available." : "This voice may only support paragraph highlighting.") : "Waiting for playback";
      const reason = this.annotationUnavailableReason();
      const key = this.sentenceKey();
      const notice = reason || (this.annotationNotice?.key === key ? this.annotationNotice.message : "");
      for (const { annotationButton, message } of this.buttons) {
        annotationButton.disabled = !!reason;
        annotationButton.title = reason || [notice, "Save the sentence being read to Annotations", this.currentSentence.text].filter(Boolean).join("\n");
        if (message.textContent !== notice) message.textContent = notice;
      }
    }

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.pointReader?.dispose();
      this.detachUtterance();
      if (this.frame !== null) this.win.cancelAnimationFrame(this.frame);
      this.frame = null;
      // Do not overwrite a method subsequently wrapped by another plugin.
      // Our wrapper becomes a pass-through if another plugin retains it.
      if (this.core._composeReadAloudStateSnapshot === this.wrapper) {
        if (this.originalDescriptor) Object.defineProperty(this.core, "_composeReadAloudStateSnapshot", this.originalDescriptor);
        else delete this.core._composeReadAloudStateSnapshot;
      }
      for (const overlay of this.overlays.values()) overlay.dispose();
      this.overlays.clear();
      for (const [target, hooks] of this.nativeHooks) this.restoreHooks(target, hooks);
      this.nativeHooks.clear();
      for (const entry of this.buttons) this.removeButton(entry);
      this.buttons.clear();
      this.panelDocument?.removeEventListener("keydown", this.keyHandler);
      this.uiHost?.remove();
      if (this.win.WordFocusCore?.Session === Session) delete this.win.WordFocusCore;
      Promise.all((this.core._views || []).map(view => view.initializedPromise)).then(() => {
        if (!this.win.closed) this.core._pushReadAloudToViews();
      }).catch(() => { /* Reader may already be closed. */ });
    }
  }

  const api = { DEFAULTS, settings, words, wordAt, sentenceRanges, sentenceAt, pdfRects, viewRects, playbackFromWord, PointReader, Overlay, Session };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WordFocusCore = api;
})(globalThis);

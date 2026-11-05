/* Word Focus for Zotero. Original code, MIT licence. */
(function (root) {
  "use strict";

  const DEFAULTS = Object.freeze({
    settingsVersion: 4, enabled: true, wordEnabled: true, sentenceEnabled: true, pointRead: true,
    colour: "#ffe600", opacity: 32, outline: 0, showWord: false,
    sentenceColour: "#66b7ff", sentenceOpacity: 20, sentenceOutline: 0,
    annotationColour: "#ffd400", annotationShortcut: null,
    underlineEnabled: false, underlineColour: "#2563eb", underlineOpacity: 90,
    underlineThickness: 3, underlineOffset: 1, underlineMode: "fade"
  });
  const WORD_RE = /[\p{L}\p{N}\p{M}]+(?:['’\-][\p{L}\p{N}\p{M}]+)*/gu;

  function settings(input = {}) {
    const colour = (key) => /^#[\da-f]{6}$/i.test(input[key]) ? input[key] : DEFAULTS[key];
    const number = (key, max) => input[key] !== null && input[key] !== "" && Number.isFinite(+input[key])
      ? Math.max(0, Math.min(max, +input[key])) : DEFAULTS[key];
    return {
      settingsVersion: 4,
      enabled: input.enabled !== false,
      wordEnabled: input.wordEnabled !== false,
      sentenceEnabled: input.sentenceEnabled !== false,
      pointRead: input.pointRead !== false,
      colour: colour("colour"), opacity: number("opacity", 65),
      outline: !(+input.settingsVersion >= 3) && +input.outline === 2 ? 0 : number("outline", 4),
      // Adopt the new hidden default once on upgrade. A later explicit choice
      // is retained across documents, plugin reloads and application restarts.
      showWord: +input.settingsVersion >= 4 && input.showWord === true,
      sentenceColour: colour("sentenceColour"),
      sentenceOpacity: number("sentenceOpacity", 65), sentenceOutline: number("sentenceOutline", 4),
      annotationColour: colour("annotationColour"),
      annotationShortcut: normaliseShortcut(input.annotationShortcut),
      underlineEnabled: input.underlineEnabled === true,
      underlineColour: colour("underlineColour"), underlineOpacity: number("underlineOpacity", 100),
      underlineThickness: number("underlineThickness", 8), underlineOffset: number("underlineOffset", 8),
      underlineMode: input.underlineMode === "solid" ? "solid" : "fade"
    };
  }

  function normaliseShortcut(input) {
    if (!input || !/^(Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-2]))$/.test(input.code)) return null;
    const shortcut = { code: input.code, ctrl: input.ctrl === true, alt: input.alt === true,
      shift: input.shift === true, meta: input.meta === true };
    return shortcut.ctrl || shortcut.alt || shortcut.meta ? shortcut : null;
  }

  function shortcutLabel(shortcut) {
    if (!shortcut) return "Not set";
    return [shortcut.ctrl && "Ctrl", shortcut.alt && "Alt", shortcut.shift && "Shift",
      shortcut.meta && "Command", shortcut.code.replace(/^(Key|Digit)/, "")].filter(Boolean).join(" + ");
  }

  function shortcutMatches(event, shortcut) {
    // Gecko also reports ordinary Ctrl+Alt on Windows and Option on macOS as
    // AltGraph. Match explicit modifiers; the caller excludes editable fields.
    return !!shortcut && !event.repeat && !event.isComposing && !event.defaultPrevented &&
      event.code === shortcut.code &&
      !!event.ctrlKey === shortcut.ctrl && !!event.altKey === shortcut.alt &&
      !!event.shiftKey === shortcut.shift && !!event.metaKey === shortcut.meta;
  }

  function editingTarget(event) {
    return (event.composedPath?.() || [event.target]).some(node =>
      node?.isContentEditable || node?.matches?.("input,textarea,select,[role=textbox]"));
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

  function pdfRects(view, position, clipToViewport = true) {
    const win = view._iframeWindow;
    const viewer = win?.PDFViewerApplication?.pdfViewer;
    if (!viewer || !Number.isInteger(position?.pageIndex)) return [];
    const groups = [{ pageIndex: position.pageIndex, rects: position.rects }];
    if (position.nextPageRects) groups.push({ pageIndex: position.pageIndex + 1, rects: position.nextPageRects });
    const results = [];
    const clip = clipToViewport ? win.document.getElementById("viewerContainer")?.getBoundingClientRect() : null;
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

  function viewRects(view, position, clipToViewport = true) {
    if (!position) return [];
    if (typeof view.toDisplayedRange === "function") {
      const range = view.toDisplayedRange(position);
      if (!range) return [];
      return [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
    }
    return pdfRects(view, position, clipToViewport);
  }

  // Fold overlapping inline fragments into one box per visual line. Keep
  // source order, which is also needed for a continuous fade over wrapped text.
  function textLineRects(rects) {
    const lines = [];
    for (const r of rects) {
      if (![r.left, r.top, r.width, r.height].every(Number.isFinite) || r.width <= 0 || r.height <= 0) continue;
      const line = lines.find(l => {
        const dy = Math.abs(l.top + l.height / 2 - r.top - r.height / 2);
        const gap = Math.max(r.left - l.left - l.width, l.left - r.left - r.width, 0);
        return dy <= Math.max(1, Math.max(l.height, r.height) * .35) && gap <= Math.max(24, 2 * Math.max(l.height, r.height));
      });
      if (!line) { lines.push({ left: r.left, top: r.top, width: r.width, height: r.height }); continue; }
      const right = Math.max(line.left + line.width, r.left + r.width);
      const bottom = Math.max(line.top + line.height, r.top + r.height);
      line.left = Math.min(line.left, r.left); line.top = Math.min(line.top, r.top);
      line.width = right - line.left; line.height = bottom - line.top;
    }
    return lines;
  }

  function highlightRects(rects, bounds = []) {
    const lines = textLineRects(rects);
    const ordered = [...lines].sort((a, b) => a.top + a.height / 2 - b.top - b.height / 2);
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const a = ordered[i], b = ordered[j];
        const bottom = a.top + a.height;
        if (b.top >= bottom || b.top <= a.top || b.left >= a.left + a.width || a.left >= b.left + b.width) continue;
        const edge = (bottom + b.top) / 2;
        const gap = Math.min(1, a.height / 4, b.height / 4);
        const end = b.top + b.height;
        a.height = Math.max(0, edge - gap / 2 - a.top);
        b.top = edge + gap / 2; b.height = Math.max(0, end - b.top);
      }
    }
    return lines.map(r => {
      let match = null, area = 0;
      for (const b of bounds) {
        const x = Math.max(0, Math.min(r.left + r.width, b.left + b.width) - Math.max(r.left, b.left));
        const y = Math.max(0, Math.min(r.top + r.height, b.top + b.height) - Math.max(r.top, b.top));
        if (x * y > area) { area = x * y; match = b; }
      }
      if (!match) return r;
      const left = Math.max(r.left, match.left), top = Math.max(r.top, match.top);
      return { left, top, width: Math.min(r.left + r.width, match.left + match.width) - left,
        height: Math.min(r.top + r.height, match.top + match.height) - top };
    }).filter(r => r.height > 0 && r.width > 0);
  }

  function textDirection(text) {
    const firstLetter = text?.match(/\p{L}/u)?.[0] || "";
    return /[\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Syriac}]/u.test(firstLetter) ? "rtl" : "ltr";
  }

  // Measure the fade along the whole sentence, not separately on each row.
  // The central 70% of the actual word is fully opaque, with both sentence
  // ends reaching zero. Uniform colour is an honest fallback without timing.
  function underlineLines(sentenceRects, wordRects, config, direction = "ltr") {
    if (!config.underlineEnabled || config.underlineOpacity <= 0 || config.underlineThickness <= 0) return [];
    const lines = textLineRects(sentenceRects);
    const total = lines.reduce((sum, r) => sum + r.width, 0);
    if (!total) return [];
    const wordSpans = [];
    let position = 0;
    for (const line of lines) {
      for (const word of wordRects) {
        const overlapY = Math.min(line.top + line.height, word.top + word.height) - Math.max(line.top, word.top);
        if (overlapY < Math.min(line.height, word.height) * .5) continue;
        const start = Math.max(line.left, word.left), end = Math.min(line.left + line.width, word.left + word.width);
        if (end <= start) continue;
        wordSpans.push(direction === "rtl"
          ? [position + line.left + line.width - end, position + line.left + line.width - start]
          : [position + start - line.left, position + end - line.left]);
      }
      position += line.width;
    }
    let peakStart, peakEnd;
    if (config.underlineMode === "fade" && wordSpans.length) {
      const start = Math.min(...wordSpans.map(s => s[0])), end = Math.max(...wordSpans.map(s => s[1]));
      peakStart = start + (end - start) * .15;
      peakEnd = end - (end - start) * .15;
    }
    const alpha = x => peakStart === undefined ? 1 :
      x <= 0 || x >= total ? 0 :
      x < peakStart ? x / peakStart : x <= peakEnd ? 1 : (total - x) / (total - peakEnd);
    position = 0;
    return lines.map(r => {
      const points = [0, r.width];
      for (const peak of [peakStart, peakEnd]) {
        if (peak > position && peak < position + r.width) points.push(peak - position);
      }
      points.sort((a, b) => a - b);
      const stops = points.map(x => ({ offset: x / r.width, opacity: config.underlineOpacity * alpha(position + x) }));
      position += r.width;
      return { left: r.left, top: r.top + r.height + config.underlineOffset,
        width: r.width, height: config.underlineThickness, direction, stops };
    });
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
      this.style.textContent = ":host{pointer-events:none!important} .word,.sentence,.underline{position:absolute;box-sizing:border-box;border-radius:2px;pointer-events:none}.underline{border-radius:999px} @media print{:host{display:none!important}}";
      this.content = this.doc.createElement("div");
      this.shadow.append(this.style, this.content);
      this.doc.documentElement.append(this.host);
      this.render = requestRender;
      win.addEventListener("scroll", this.render, true);
      win.addEventListener("resize", this.render);
      this.signature = "";
    }

    draw(wordRects, sentenceRects, config, underlineSentence = [], spokenWord = [], direction = "ltr") {
      const w = this.win.innerWidth, h = this.win.innerHeight;
      const visible = rects => rects.filter(r => r.left < w && r.top < h && r.left + r.width > 0 && r.top + r.height > 0);
      const context = highlightRects(sentenceRects);
      const word = visible(highlightRects(wordRects, context)), sentence = visible(context);
      const underline = visible(underlineLines(underlineSentence, spokenWord, config, direction));
      const coords = rects => rects.map(r => [r.left, r.top, r.width, r.height]);
      const signature = JSON.stringify([config, coords(word), coords(sentence), underline]);
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
        node.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;` +
          `background:${rgba(colour, opacity)};border:${outline}px solid ${isWord ? "#161616" : colour};` +
          (isWord && outline > 0 ? `box-shadow:0 0 0 2px ${colour},0 0 0 3px #fff;` : "");
        return node;
      };
      // Paint sentence context first so the current word remains on top.
      const underlineNodes = underline.map(r => {
        const node = this.doc.createElement("div"); node.className = "underline";
        const colours = r.stops.map(s => `${rgba(config.underlineColour, s.opacity)} ${s.offset * 100}%`);
        const background = config.underlineMode === "solid" ? rgba(config.underlineColour, config.underlineOpacity)
          : `linear-gradient(to ${r.direction === "rtl" ? "left" : "right"},${colours.join(",")})`;
        node.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;background:${background};`;
        return node;
      });
      const nodes = [...sentence.map(r => makeNode(r, "sentence")), ...word.map(r => makeNode(r, "word")), ...underlineNodes];
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
      this.shortcutWindows = new Map();
      this.shortcutHandler = event => this.handleAnnotationShortcut(event);
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
        this.createSidebarAction();
        this.syncShortcutListeners();
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
      this.ensureSidebarAction();
      this.syncShortcutListeners();
      this.updateUI();
      if (this.snapshot?.popupOpen || this.panelOpen) this.schedule();
    }

    paint() {
      this.pointReader?.refresh();
      const snapshot = this.snapshot;
      const show = this.config.enabled && snapshot?.popupOpen && snapshot.active;
      const hover = this.config.enabled && this.config.pointRead ? this.pointReader?.hover : null;
      const position = this.config.wordEnabled ? hover?.position || (show ? snapshot.activeWordSourcePosition : null) : null;
      const sentencePosition = this.config.sentenceEnabled ? hover?.segment.sourcePosition || (show ? this.sentencePosition : null) : null;
      // The underline always tracks speech, including during a hover preview.
      const underlinePosition = show && this.config.underlineEnabled ? this.sentencePosition : null;
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
        if (!overlay && !position && !sentencePosition && !underlinePosition) continue;
        if (!overlay) {
          overlay = new Overlay(win, () => this.schedule());
          this.overlays.set(view, overlay);
        }
        overlay.host.dataset.mode = hover ? "hover" : "speech";
        try { overlay.draw(position ? viewRects(view, position) : [], sentencePosition ? viewRects(view, sentencePosition) : [], this.config,
          underlinePosition ? viewRects(view, underlinePosition, false) : [],
          underlinePosition && snapshot.activeWordSourcePosition ? viewRects(view, snapshot.activeWordSourcePosition, false) : [],
          textDirection(snapshot?.activeSegment?.text)); }
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
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "toolbar-button word-focus-button";
      button.textContent = "Wf";
      button.title = "Word Focus settings";
      button.setAttribute("aria-label", "Word Focus settings");
      button.setAttribute("aria-haspopup", "dialog");
      button.style.cssText = "font-weight:800;font-size:13px;min-width:28px;border-bottom:3px solid #ffe600;";
      const click = () => {
        this.lastButton = button;
        if (this.panelOpen) { this.closePanel(); return; }
        this.panelOpen = true;
        this.updateUI();
        if (this.panelOpen) this.enableControl?.focus();
      };
      button.addEventListener("click", click);
      this.buttons.add({ button, click });
      this.updateUI();
      return button;
    }

    removeButton(entry) {
      entry.button.removeEventListener("click", entry.click);
      entry.button.remove();
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

    createSidebarAction() {
      const doc = this.win.document;
      this.sidebarStyle = doc.createElement("style");
      this.sidebarStyle.textContent = `
        .word-focus-sidebar-action{--wf-button-bg:#f0f3f8;--wf-button-fg:#17202a;--wf-button-border:#aeb9c8;--wf-button-muted:#526071;display:flex;flex-direction:column;align-items:stretch;gap:4px;margin-inline-start:auto;padding:2px;width:144px;max-width:100%;font:12px/1.4 system-ui,sans-serif;flex-shrink:0}
        .word-focus-sidebar-action[data-word-focus-theme=dark]{--wf-button-bg:#343d49;--wf-button-fg:#f1f5fa;--wf-button-border:#6b7889;--wf-button-muted:#c3cbd6}
        .word-focus-sidebar-action[hidden]{display:none!important}
        .word-focus-sidebar-action.at-footer{padding:8px;margin:0;width:auto;border-top:1px solid var(--wf-button-border);align-items:flex-end}
        .word-focus-sidebar-action .word-focus-add-annotation{all:unset;box-sizing:border-box;appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:28px;padding:3px 9px;font:600 12px/1.4 system-ui,sans-serif;color:var(--wf-button-fg);background:var(--wf-button-bg);border:1px solid var(--wf-button-border);border-radius:5px;cursor:pointer;white-space:nowrap;opacity:1}
        .word-focus-sidebar-action .word-focus-add-annotation:hover{filter:brightness(1.08)}
        .word-focus-sidebar-action .word-focus-add-annotation:focus-visible{outline:2px solid #3578d8;outline-offset:2px}
        .word-focus-sidebar-action .word-focus-add-annotation:disabled{color:var(--wf-button-muted);cursor:default;filter:none}
        .word-focus-annotation-message{font:11px/1.4 system-ui,sans-serif;color:var(--wf-button-fg);max-width:100%;white-space:normal}
        .word-focus-annotation-message:empty{display:none}
      `;
      doc.documentElement.append(this.sidebarStyle);
      this.sidebarAction = doc.createElement("div");
      this.sidebarAction.className = "word-focus-sidebar-action";
      this.annotationButton = doc.createElement("button");
      this.annotationButton.type = "button";
      this.annotationButton.className = "word-focus-add-annotation";
      this.annotationButton.disabled = true;
      this.annotationButton.dataset.tabstop = "1";
      this.annotationButton.tabIndex = -1;
      this.annotationButton.setAttribute("aria-label", "Add annotation");
      const icon = doc.createElement("span"); icon.textContent = "+"; icon.setAttribute("aria-hidden", "true");
      const label = doc.createElement("span"); label.textContent = "Add annotation";
      this.annotationButton.append(icon, label);
      this.annotationMessage = doc.createElement("span");
      this.annotationMessage.className = "word-focus-annotation-message";
      this.annotationMessage.setAttribute("role", "status");
      this.annotationMessage.setAttribute("aria-live", "polite");
      this.annotationClick = event => { event.stopPropagation(); this.addSentenceAnnotation(); };
      // This is an ordinary button in the reader document, so Zotero can see
      // its real target. Preserve native focusing while isolating sidebar clicks.
      this.annotationPointer = event => event.stopPropagation();
      this.annotationButton.addEventListener("pointerdown", this.annotationPointer);
      this.annotationButton.addEventListener("click", this.annotationClick);
      this.sidebarAction.append(this.annotationButton, this.annotationMessage);
      this.ensureSidebarAction();
    }

    ensureSidebarAction() {
      if (!this.sidebarAction) return;
      const sidebar = this.win.document.querySelector("#annotationsView");
      if (!sidebar) { this.sidebarAction.remove(); return; }
      const selector = sidebar.querySelector("#selector");
      const target = selector?.querySelector(".colors") || selector || sidebar;
      this.sidebarAction.classList.toggle("at-footer", !selector);
      this.sidebarAction.hidden = !this.config.enabled;
      if (this.sidebarAction.parentElement !== target) target.append(this.sidebarAction);
    }

    syncShortcutListeners() {
      const windows = new Set([this.win, ...(this.core._views || []).map(view => view._iframeWindow || view.iframeWindow)].filter(Boolean));
      for (const [win, doc] of this.shortcutWindows) {
        if (!windows.has(win) || win.closed || win.document !== doc) {
          try { win.removeEventListener("keydown", this.shortcutHandler, true); } catch (_) {}
          this.shortcutWindows.delete(win);
        }
      }
      for (const win of windows) {
        if (!win.document || this.shortcutWindows.has(win)) continue;
        win.addEventListener("keydown", this.shortcutHandler, true);
        this.shortcutWindows.set(win, win.document);
      }
    }

    handleAnnotationShortcut(event) {
      if (this.disposed || !this.config.enabled || this.recordingShortcut || editingTarget(event) ||
          !shortcutMatches(event, this.config.annotationShortcut)) return false;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.addSentenceAnnotation();
      return true;
    }

    syncTheme() {
      // Zotero can override the system theme. The settings document and
      // ordinary sidebar control both follow the reader's chosen scheme.
      const requested = this.win.document.documentElement.dataset.colorScheme || this.core._state?.colorScheme;
      const theme = ["light", "dark"].includes(requested) ? requested
        : this.win.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      for (const node of [this.uiHost, this.panelFrame, this.sidebarAction,
        this.panelDocument?.documentElement]) {
        if (!node || node.dataset.wordFocusTheme === theme) continue;
        node.dataset.wordFocusTheme = theme;
        node.style.colorScheme = theme;
      }
    }

    async createUI() {
      let doc = this.win.document;
      this.uiHost = doc.createElement("div");
      this.uiHost.className = "word-focus-ui";
      this.uiHost.style.cssText = "position:fixed;inset:0;z-index:2147483001;pointer-events:none;";
      this.ui = this.uiHost.attachShadow({ mode: "open" });
      const style = doc.createElement("style");
      style.textContent = `
        :host,:root{--wf-text:#17202a;--wf-muted:#505f70;--wf-card:#fff;--wf-border:#bbc4d0;--wf-control:#f0f3f8;--wf-selected:#e6efff;--wf-glass:rgba(247,250,255,.5);--wf-glass-hover:rgba(247,250,255,.72);--wf-glass-border:rgba(105,126,155,.32);--wf-message:rgba(247,250,255,.9)}
        :host([data-word-focus-theme=dark]),:root[data-word-focus-theme=dark]{--wf-text:#f1f5fa;--wf-muted:#c3cbd6;--wf-card:#20252c;--wf-border:#667180;--wf-control:#343d49;--wf-selected:#28466b;--wf-glass:rgba(24,32,44,.5);--wf-glass-hover:rgba(24,32,44,.72);--wf-glass-border:rgba(213,226,245,.28);--wf-message:rgba(24,32,44,.9)}
        :host{font:13px/1.5 system-ui,sans-serif;color:var(--wf-text);pointer-events:none!important}
        *{box-sizing:border-box} [hidden]{display:none!important}
        .card{background:var(--wf-card);color:var(--wf-text);border:1px solid var(--wf-border);border-radius:12px;box-shadow:0 6px 24px #0003}
        .panel-frame{position:absolute;right:12px;top:50px;width:360px;max-width:calc(100vw - 24px);height:min(720px,calc(100vh - 112px));border:0;border-radius:12px;box-shadow:0 6px 24px #0003;pointer-events:auto;z-index:2}
        .panel{position:relative;width:100%;height:100%;overflow:auto;padding:16px;pointer-events:auto;scrollbar-width:thin;scrollbar-color:var(--wf-border) var(--wf-card)}
        h2{margin:0 0 10px;font-size:17px} p{margin:8px 0;color:var(--wf-muted);font-size:12px}
        label{display:flex;gap:8px;align-items:center;margin:9px 0}
        fieldset{min-width:0;border:1px solid var(--wf-border);border-radius:8px;padding:3px 12px 6px;margin:12px 0}
        legend{font-weight:700;padding:0 5px} .setting-name{flex:1}
        .numeric-row{display:grid;grid-template-columns:minmax(48px,1fr) 92px 56px 18px;gap:6px;align-items:center;margin:9px 0}
        .numeric-row label{margin:0}.numeric-row input{min-width:0}
        input[type=range]{width:100%;margin:0} input[type=number]{width:56px;padding:3px;border:1px solid var(--wf-border);border-radius:4px;font:inherit;font-variant-numeric:tabular-nums;color:var(--wf-text);background:var(--wf-card)}
        input[type=color]{width:40px;height:28px;border:0;padding:0}
        .preview{padding:12px 8px;text-align:center;line-height:2}.preview span{border-radius:3px;padding:1px 2px}
        input{accent-color:#3578d8} button{font:inherit;color:var(--wf-text);background:var(--wf-control);border:1px solid var(--wf-border);border-radius:6px;padding:5px 10px;cursor:pointer}
        button:focus-visible,input:focus-visible{outline:3px solid #2471d6;outline-offset:2px}
        button:disabled{opacity:.55;cursor:default}
        .line{display:flex;justify-content:space-between;align-items:center;gap:12px}
        .readout{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:7px;min-width:156px;max-width:min(560px,90vw);text-align:center;z-index:1}
        .word-panel{padding:8px 18px;max-width:100%}
        .style-options{display:flex;gap:8px;margin:6px 0 10px;flex-wrap:wrap}
        .style-choice{appearance:none;flex:1;min-width:110px;margin:0;padding:7px 8px;border:1px solid var(--wf-border);border-radius:6px;cursor:pointer;color:var(--wf-text);background:var(--wf-card);text-align:center}
        .style-choice[aria-pressed=true]{background:var(--wf-selected);border:2px solid #3578d8;padding:6px 7px;font-weight:700}
        .shortcut-row{display:flex;gap:8px;align-items:center;margin:8px 0}.shortcut-record{flex:1;min-height:30px}.shortcut-help{min-height:18px}
        .word{font-size:28px;font-weight:750;line-height:1.3;overflow-wrap:anywhere;color:var(--wf-text)}
        .status{font-size:11px;color:var(--wf-muted)}.notice{font-size:12px;max-width:420px;white-space:normal}
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
      // Initialise while laid out but invisible, so opening Wf is never needed
      // to finish loading a control document on a particular platform.
      this.panelFrame.style.visibility = "hidden";
      const frameReady = new Promise(resolve => this.panelFrame.addEventListener("load", resolve, { once: true }));
      this.panelFrame.src = "about:blank";
      this.ui.append(this.panelFrame);
      doc.documentElement.append(this.uiHost);
      await frameReady;
      if (this.disposed) return;
      doc = this.panelFrame.contentDocument;
      this.panelDocument = doc;
      doc.documentElement.style.cssText = "height:100%;overflow:hidden;background:transparent";
      doc.body.style.cssText = "margin:0;height:100%;overflow:hidden;font:13px/1.5 system-ui,sans-serif;color:var(--wf-text);background:transparent";
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
      annotationGroup.append(el("p", "Use Add annotation below the annotation list, beside the sidebar colour filters, to save the sentence being read. This colour applies to new permanent highlights."));
      const shortcutHeading = el("div", "Keyboard shortcut");
      const shortcutRow = el("div", "", "shortcut-row");
      this.shortcutRecord = el("button", "Set shortcut", "shortcut-record"); this.shortcutRecord.type = "button";
      this.shortcutRecord.setAttribute("aria-label", "Set Add annotation shortcut");
      this.shortcutClear = el("button", "Clear", "shortcut-clear"); this.shortcutClear.type = "button";
      this.shortcutHelp = el("p", "", "shortcut-help"); this.shortcutHelp.setAttribute("role", "status");
      this.shortcutRecord.addEventListener("click", () => {
        this.recordingShortcut = !this.recordingShortcut;
        this.shortcutHelp.textContent = this.recordingShortcut ? "Press a shortcut now. Escape cancels." : "Shortcut unchanged.";
        this.syncControls();
      });
      this.shortcutClear.addEventListener("click", () => {
        this.recordingShortcut = false; this.updateSettings({ annotationShortcut: null });
        this.shortcutHelp.textContent = "Shortcut cleared.";
      });
      this.shortcutRecorder = event => {
        if (!this.recordingShortcut) return;
        if (event.key === "Tab") { this.recordingShortcut = false; this.syncControls(); return; }
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.key === "Escape") { this.recordingShortcut = false; this.shortcutHelp.textContent = "Shortcut unchanged."; this.syncControls(); return; }
        if (event.repeat || event.isComposing || ["Control", "Alt", "AltGraph", "Shift", "Meta"].includes(event.key)) return;
        const shortcut = normaliseShortcut({ code: event.code, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey });
        if (!shortcut) { this.shortcutHelp.textContent = "Use Ctrl, Alt or Command with a letter, number or F1–F12."; return; }
        this.recordingShortcut = false; this.updateSettings({ annotationShortcut: shortcut });
        this.shortcutHelp.textContent = "Saved. Works in the reader while listening or paused.";
      };
      doc.addEventListener("keydown", this.shortcutRecorder, true);
      shortcutRow.append(this.shortcutRecord, this.shortcutClear);
      annotationGroup.append(shortcutHeading, shortcutRow, this.shortcutHelp,
        el("p", "Click Set shortcut, then press your preferred keys. Use Ctrl, Alt or Command with a letter, number or function key. Choose a combination unused by Zotero or your system. Shortcuts do not run while you type in a field or annotation comment."));
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
      const underlineGroup = el("fieldset"); underlineGroup.append(el("legend", "Spoken sentence underline"));
      checkbox("Show underline", "underlineEnabled", underlineGroup);
      colour(underlineGroup, "underlineColour");
      const modeLabel = el("div", "Style"); modeLabel.id = "word-focus-underline-style";
      const modes = el("div", "", "style-options");
      modes.setAttribute("role", "group"); modes.setAttribute("aria-labelledby", modeLabel.id);
      const modeInputs = [];
      for (const [value, title] of [["fade", "Faded edges"], ["solid", "Solid"]]) {
        const input = el("button", title, "style-choice"); input.type = "button"; input.value = value;
        input.dataset.setting = "underlineMode";
        input.addEventListener("click", () => this.updateSettings({ underlineMode: value }));
        input.addEventListener("keydown", event => {
          if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault();
          const next = modeInputs.find(button => button !== input); next.focus(); next.click();
        });
        modes.append(input); modeInputs.push(input);
      }
      underlineGroup.append(modeLabel, modes);
      this.controls.set("underlineMode", { input: modeInputs[0], options: modeInputs });
      slider(underlineGroup, "Underline", "Opacity", "underlineOpacity", 100, "%");
      slider(underlineGroup, "Underline", "Thickness", "underlineThickness", 8, "px");
      slider(underlineGroup, "Underline", "Gap", "underlineOffset", 8, "px");
      underlineGroup.append(el("p", "Faded edges is strongest under the spoken word and fades to both ends of the sentence. Solid keeps the same colour along the line. Lower opacity makes either style transparent; 0% hides it."));
      underlineGroup.append(el("p", "Across wrapped lines, the fade continues through the sentence. Without word timing, the line stays uniform until a word is known."));
      this.panel.append(underlineGroup);
      const preview = el("div", "", "preview"); preview.setAttribute("aria-label", "Highlight preview");
      this.sentencePreview = el("span"); this.wordPreview = el("span", "spoken");
      this.sentencePreview.append(doc.createTextNode("Follow each "), this.wordPreview, doc.createTextNode(" word."));
      preview.append(this.sentencePreview); this.panel.append(preview);
      this.panel.append(el("p", "Drag a slider or type a value. Use the arrow keys for small adjustments. Press Enter to confirm a typed value."));
      checkbox("Show the enlarged current word", "showWord");
      this.panel.append(el("p", "The enlarged word display starts hidden. Enable it here to show it at the bottom of the reader."));
      this.timingStatus = el("p"); this.panel.append(this.timingStatus);
      this.panel.append(el("p", "Start Read Aloud with the headphones button. Changes apply immediately and are saved across documents."));
      this.panel.append(el("p", "The word highlight needs a voice with word timing. The sentence can remain highlighted while the word moves."));
      this.readout = el("div", "", "readout");
      this.readout.style.visibility = "hidden";
      this.readout.setAttribute("aria-live", "off");
      this.wordPanel = el("div", "", "word-panel card");
      this.wordPanel.hidden = true;
      this.wordNode = el("div", "", "word");
      this.statusNode = el("div", "", "status");
      this.wordPanel.append(this.wordNode, this.statusNode);
      this.readout.append(this.wordPanel);
      doc.body.append(this.panel);
      this.ui.append(this.readout);
      this.keyHandler = event => {
        if (event.key === "Escape" && this.panelOpen) { event.stopPropagation(); this.closePanel(); }
      };
      doc.addEventListener("keydown", this.keyHandler);
      this.syncControls(); this.updateUI();
      this.panelFrame.style.visibility = "";
      this.readout.style.visibility = "";
    }

    closePanel() {
      this.recordingShortcut = false;
      this.syncControls();
      this.panelDocument?.activeElement?.blur();
      this.panelOpen = false;
      this.updateUI();
      this.lastButton?.focus();
    }

    syncControls() {
      if (!this.enableControl) return;
      for (const [property, { input, number, unit, options }] of this.controls) {
        if (options) { for (const option of options) option.setAttribute("aria-pressed", String(option.value === this.config[property])); }
        else if (input.type === "checkbox") input.checked = this.config[property];
        else if (input.value !== String(this.config[property])) input.value = this.config[property];
        if (number) {
          // Do not replace an in-progress edit or reset a native slider drag
          // when settings are echoed back from the other reader sessions.
          if (this.panelDocument.activeElement !== number && number.value !== String(this.config[property])) number.value = this.config[property];
          input.setAttribute("aria-valuetext", this.config[property] + (unit === "%" ? " percent" : " pixels"));
        }
      }
      this.shortcutRecord.textContent = this.recordingShortcut ? "Press shortcut…" : this.config.annotationShortcut ? shortcutLabel(this.config.annotationShortcut) : "Set shortcut";
      this.shortcutClear.disabled = !this.config.annotationShortcut && !this.recordingShortcut;
      const c = this.config;
      this.sentencePreview.style.cssText = c.enabled && c.sentenceEnabled
        ? `background:${rgba(c.sentenceColour, c.sentenceOpacity)};outline:${c.sentenceOutline}px solid ${c.sentenceColour}` : "";
      this.wordPreview.style.cssText = c.enabled && c.wordEnabled
        ? `background:${rgba(c.colour, c.opacity)};outline:${c.outline}px solid #161616` : "";
      if (c.enabled && c.underlineEnabled) {
        const fill = rgba(c.underlineColour, c.underlineOpacity);
        this.sentencePreview.style.backgroundImage = c.underlineMode === "solid" ? `linear-gradient(${fill},${fill})`
          : `linear-gradient(to right,${rgba(c.underlineColour, 0)},${fill} 42%,${fill} 65%,${rgba(c.underlineColour, 0)})`;
        this.sentencePreview.style.backgroundSize = `100% ${c.underlineThickness}px`;
        this.sentencePreview.style.backgroundPosition = "left bottom";
        this.sentencePreview.style.backgroundRepeat = "no-repeat";
        this.sentencePreview.style.paddingBottom = `${c.underlineThickness + c.underlineOffset + 2}px`;
      }
    }

    updateUI() {
      this.syncTheme();
      if (!this.panel || !this.annotationButton) return;
      this.panel.hidden = !this.panelOpen;
      this.panelFrame.hidden = !this.panelOpen;
      if (this.pointStatus) this.pointStatus.textContent = this.pointReader?.status || "";
      for (const { button } of this.buttons) {
        button.setAttribute("aria-expanded", String(this.panelOpen));
        button.style.borderBottomColor = this.config.enabled ? this.config.colour : "transparent";
      }
      const s = this.snapshot;
      const active = this.config.enabled && s?.popupOpen && s.active;
      const unsupported = active && (this.config.wordEnabled || this.config.showWord) && s.activeSegment && this.timing === "waiting" && !s.paused;
      this.readout.hidden = this.panelOpen || !active || !this.config.showWord;
      this.wordPanel.hidden = this.panelOpen || !active || !this.config.showWord;
      this.wordNode.className = unsupported ? "notice" : "word";
      this.wordNode.textContent = this.currentWord || (unsupported ? "No word timing yet. Try another Read Aloud voice." : "Word Focus");
      this.statusNode.textContent = s?.paused ? "Paused" :
        this.timing === "boundaries" ? "Following spoken-word events" :
        this.timing === "timestamps" ? "Following voice word timestamps" :
        this.timing === "unmapped" ? "Word detected, but its page position is unavailable" :
        this.timing === "buffering" ? "Waiting for audio" :
        unsupported ? (this.sentencePosition ? "The sentence highlight is still available." : "This voice may only support paragraph highlighting.") : "Waiting for playback";
      this.timingStatus.textContent = unsupported ? "No word timing yet. Try another Read Aloud voice. " + this.statusNode.textContent : this.statusNode.textContent;
      const reason = this.annotationUnavailableReason();
      const key = this.sentenceKey();
      const notice = (s?.active ? reason : "") || (this.annotationNotice?.key === key ? this.annotationNotice.message : "");
      this.annotationButton.disabled = !!reason;
      this.sidebarAction.hidden = !this.config.enabled;
      this.annotationButton.title = reason || [notice, "Save the sentence being read to Annotations", this.config.annotationShortcut && shortcutLabel(this.config.annotationShortcut), this.currentSentence?.text].filter(Boolean).join("\n");
      const shortcut = this.config.annotationShortcut;
      if (shortcut) this.annotationButton.setAttribute("aria-keyshortcuts", [shortcut.ctrl && "Control", shortcut.alt && "Alt", shortcut.shift && "Shift", shortcut.meta && "Meta", shortcut.code.replace(/^(Key|Digit)/, "")].filter(Boolean).join("+"));
      else this.annotationButton.removeAttribute("aria-keyshortcuts");
      if (this.annotationMessage.textContent !== notice) this.annotationMessage.textContent = notice;
      this.annotationMessage.hidden = !notice;
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
      this.panelDocument?.removeEventListener("keydown", this.shortcutRecorder, true);
      for (const win of this.shortcutWindows.keys()) {
        try { win.removeEventListener("keydown", this.shortcutHandler, true); } catch (_) {}
      }
      this.shortcutWindows.clear();
      this.annotationButton?.removeEventListener("click", this.annotationClick);
      this.annotationButton?.removeEventListener("pointerdown", this.annotationPointer);
      this.sidebarAction?.remove();
      this.sidebarStyle?.remove();
      this.uiHost?.remove();
      if (this.win.WordFocusCore?.Session === Session) delete this.win.WordFocusCore;
      Promise.all((this.core._views || []).map(view => view.initializedPromise)).then(() => {
        if (!this.win.closed) this.core._pushReadAloudToViews();
      }).catch(() => { /* Reader may already be closed. */ });
    }
  }

  const api = { DEFAULTS, settings, normaliseShortcut, shortcutLabel, shortcutMatches, editingTarget, words, wordAt, sentenceRanges, sentenceAt, pdfRects, viewRects, textLineRects, highlightRects, textDirection, underlineLines, playbackFromWord, PointReader, Overlay, Session };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.WordFocusCore = api;
})(globalThis);

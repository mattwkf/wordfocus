/* Word Focus for Zotero. MIT licence. */
var WordFocusCore;
var WordFocusPlugin = null;

async function install({ id }, reason) {
  // This is a manually distributed build. Zotero 10 requires an HTTPS
  // update_url even when there is no hosted update service.
  if (reason !== ADDON_INSTALL) return;
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const addon = await AddonManager.getAddonByID(id);
  if (addon) addon.applyBackgroundUpdates = AddonManager.AUTOUPDATE_DISABLE;
}
function uninstall() {}

async function startup({ id, rootURI }) {
  await Zotero.initializationPromise;
  const { setInterval, clearInterval } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
  const Cu = Components.utils;
  Services.scriptloader.loadSubScript(rootURI + "content/word-focus.js", globalThis);
  const sessions = new Map();
  const pref = "extensions.wordfocus.settings";
  let config;
  try { config = WordFocusCore.settings(JSON.parse(Services.prefs.getStringPref(pref, "{}"))); }
  catch (_) { config = WordFocusCore.settings(); }
  let stopping = false;
  let lastError = "";
  const logError = error => {
    const message = String(error?.stack || error);
    if (message !== lastError) { lastError = message; Zotero.logError(error); }
  };
  const save = next => {
    config = next;
    Services.prefs.setStringPref(pref, JSON.stringify(next));
    for (const session of sessions.values()) {
      if (Cu.isDeadWrapper(session)) continue;
      session.setSettings(Cu.cloneInto(next, session.win));
    }
  };
  const attach = reader => {
    if (stopping || sessions.has(reader)) return sessions.get(reader);
    if (!reader?._internalReader || !reader?._iframeWindow || reader._isUninitialized) return null;
    try {
      const core = Cu.waiveXrays(reader._internalReader);
      const win = Cu.waiveXrays(reader._iframeWindow);
      // Run DOM code in the reader's own realm. Gecko hides properties of
      // privileged objects from content WebIDL dictionaries (e.g. ShadowRootInit).
      Services.scriptloader.loadSubScript(rootURI + "content/word-focus.js", win);
      const options = Cu.cloneInto({ settings: config }, win);
      options.onSettings = Cu.exportFunction(next => save(WordFocusCore.settings(Cu.waiveXrays(next))), win);
      options.onError = Cu.exportFunction(logError, win);
      const session = new win.WordFocusCore.Session(core, win, options);
      sessions.set(reader, session);
      session.ensureButton();
      return session;
    } catch (error) { logError(error); return null; }
  };
  const toolbar = event => {
    const session = attach(event.reader);
    if (session && ![...session.buttons].some(x => x.button.isConnected)) {
      event.append(session.createButton(Cu.waiveXrays(event.doc)));
    }
  };
  Zotero.Reader.registerEventListener("renderToolbar", toolbar, id);
  const scan = () => {
    if (stopping) return;
    const readers = new Set(Zotero.Reader._readers || []);
    for (const [reader, session] of sessions) {
      // A closed reader destroys its content realm before the next scan.
      // Calling even a property getter on its dead wrapper throws in Gecko.
      if (Cu.isDeadWrapper(session)) { sessions.delete(reader); continue; }
      if (!readers.has(reader) || reader._isUninitialized || Cu.isDeadWrapper(session.win) || session.win.closed) {
        sessions.delete(reader);
        try { session.dispose(); } catch (error) { logError(error); }
      }
    }
    for (const reader of readers) {
      const session = attach(reader);
      try { session?.tick(); } catch (error) { logError(error); }
    }
  };
  const timer = setInterval(scan, 250);
  WordFocusPlugin = {
    sessions,
    stop() {
      stopping = true;
      clearInterval(timer);
      Zotero.Reader.unregisterEventListener("renderToolbar", toolbar);
      for (const session of sessions.values()) {
        if (Cu.isDeadWrapper(session)) continue;
        try { session.dispose(); } catch (error) { logError(error); }
      }
      sessions.clear();
    }
  };
  scan();
}

function shutdown() {
  WordFocusPlugin?.stop();
  WordFocusPlugin = null;
  WordFocusCore = null;
}

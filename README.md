# Word Focus for Zotero

A plugin that follows Zotero’s built-in Read Aloud with two independently adjustable highlights. A soft blue highlight marks the current sentence, and a border-free yellow highlight follows the spoken word on top. Move the pointer over text to preview a word and its sentence, then click the word to start reading there. Save a sentence as a permanent Zotero highlight with **Add annotation**. An optional enlarged display shows the current word at the bottom of the reader.

This build targets Zotero **10.0.6 and later 10.0.x releases**. It is a desktop plugin, not a browser extension or a mobile add-on.

<img width="834" height="901" alt="Screenshot 2026-10-26 201329" src="https://github.com/user-attachments/assets/7f809e23-e496-4f94-8b61-b07c9e3e2ba2" />

## Install and use

1. Download `word-focus-0.4.1.xpi`. Keep the `.xpi` extension and do not unzip it.
2. In Zotero, open **Tools → Plugins**.
3. Use the gear menu and choose **Install Plugin From File…**, then select the `.xpi`. You can also drag the file into the Plugins window.
4. Open a document. Hover over readable text with the normal pointer tool, then click a word to begin **Read Aloud** there. You can also start Read Aloud with the headphones button. Choose a voice if Zotero prompts you.
5. Open **Wf** in the reader toolbar. Under **Spoken word** and **Current sentence**, separately adjust the colour, opacity and outline width, or turn either highlight off. Drag the sliders, use the arrow keys, or type exact numbers. Press Enter or leave the number box to confirm. Changes apply immediately.
6. While listening, click **Add annotation** immediately to the right of **Wf** in the reader toolbar. Change **Wf → Sentence annotations → Default highlight colour** to choose the colour for new saved annotations.

To update from an earlier version, install this file over the existing plugin. It uses the same plugin ID and retains your colours, opacity and enlarged-word setting. The old default 2 px word outline changes to 0 px; other saved outline widths are retained. You can choose a border again in Wf. Point to read starts enabled.

Both highlights are enabled by default. Word Focus supplies the adjustable display while enabled and preserves Zotero’s scrolling and playback controls. Turning off **Enable Word Focus**, or disabling the plugin, restores Zotero’s normal highlighting. You do not need to change the global highlighting preference.

<img width="829" height="818" alt="Screenshot 2026-10-26 201626" src="https://github.com/user-attachments/assets/f4c2156a-71d3-4948-a2f5-eec1eabf6556" />

## Save the spoken sentence

- **Add annotation**, beside **Wf** in the toolbar, creates a native Zotero highlight across the current spoken sentence and adds its text to the Annotations sidebar. The sidebar opens with the new annotation selected. Playback continues.
- The button follows the sentence being read, even when the temporary pointer preview is over different text. If you clicked a word partway through a sentence to start playback, the saved highlight includes the full sentence.
- **Wf → Sentence annotations → Default highlight colour** is separate from the temporary word and sentence colours. It starts yellow (`#ffd400`), is saved across documents and affects new annotations. Change an existing annotation’s colour using Zotero’s normal annotation controls.
- The button works while paused, and remains available when the enlarged word display is switched off. It is unavailable if the document is read-only or the voice has not identified a mapped sentence.
- Repeated clicks on the same sentence in the current reader session reuse its saved annotation. Zotero’s normal undo and delete actions work; you can add the sentence again after removing its highlight.
- Saved highlights remain in Zotero after playback stops or Word Focus is disabled or removed. Temporary speech and hover highlights disappear normally. Hovering alone never saves an annotation.

For paragraph-based voices, a word or sentence timing event is needed to identify the sentence within the paragraph. Zotero can divide unusually long sentences into separate audio chunks; the button follows the sentence context available to the reader.

## Point to read

- Hovering temporarily highlights the word and its sentence and changes the cursor to a pointing hand. It does not start or interrupt speech.
- Clicking begins with the selected word, then continues through the rest of that sentence and subsequent sentences using Zotero’s selected voice.
- Moving off the text clears the preview and restores the current playback highlight, if audio is playing.
- The preview uses the same word and sentence appearance controls as playback. Turn off **Point to read** in Wf when you want ordinary click behaviour.
- The first preview may take a moment while Zotero extracts the document’s text. Scans need usable OCR text.
- Dragging to select text, modified clicks, links, existing annotations and annotation tools retain their normal actions. A short click delay lets a double-click cancel speech and select text normally.

Click-to-read supplies a shortened first speech segment beginning at the word you chose. A remote voice may therefore request fresh audio for that segment under Zotero’s usual service and credit rules. A local voice uses local speech synthesis. Hovering makes no audio request.

## Voice support matters

The plugin follows timing supplied by the voice. It does not guess word positions from elapsed time.

| Voice behaviour | Word Focus behaviour |
| --- | --- |
| Zotero exposes word timestamps | Follows those timestamps and draws a stronger highlight over the word |
| A Local voice emits spoken-word boundary events | Connects those events to Zotero’s document position map and highlights each word |
| A sentence-based voice provides no word timing | Keeps the adjustable sentence highlight and shows a word-timing notice |
| A paragraph-based voice supplies word or sentence boundary events | Uses the reported offsets to identify the sentence within the paragraph |
| A multi-sentence paragraph has no usable timing | Shows a notice; cannot identify the current word or sentence |
| A spoken word has no usable document position | The enlarged display can show the word, with a notice that its position is unavailable |

If you see **No word timing yet**, let the voice start speaking. If the notice remains, choose another voice in Read Aloud. A **Local** voice is worth trying, but boundary support depends on the voice and operating system. No particular Windows, macOS or Linux voice is guaranteed by this build.

Some words can remain highlighted during a pause. Local speech may restart its sentence when resumed because that is Zotero’s own playback behaviour. Word Focus waits for the new utterance’s real word events.

Scanned PDFs still need usable text/OCR and a working Zotero document position map. The plugin cannot recover words that Zotero cannot extract.

## Controls and removal

- **Enable Word Focus** switches the enhancement on or off.
- **Point to read** enables the temporary hover preview, pointing-hand cursor and click-to-read behaviour.
- **Sentence annotations** sets the default colour for permanent highlights. The **Add annotation** button is immediately to the right of **Wf** in the toolbar.
- **Spoken word** and **Current sentence** each have **Show highlight**, **Colour**, **Opacity** (0–65%) and **Outline** (0–4 px). A zero outline removes the border. Word outlines default to zero. Each numeric setting has both a slider and an editable number box.
- The sentence is drawn first and the word on top, so they remain visible together. The sentence stays fixed until playback reaches the next sentence.
- A preview reflects the settings before starting audio.
- **Show the enlarged current word** controls the optional word display. A missing-timing notice remains visible when word highlighting is requested.
- **Close** or **Escape** closes the settings panel.
- To remove the plugin, use **Tools → Plugins → Word Focus for Zotero → Remove**. Disabling it also removes its interface and temporary highlights.

Settings apply across open reader tabs. They are saved in Zotero’s profile under `extensions.wordfocus.settings`.

## Privacy and updates

Word Focus does not add a speech provider, record audio or independently upload document text. Permanent highlights are created only when you press **Add annotation**. They are ordinary Zotero annotations and follow your existing Zotero sync settings. Zotero’s existing voice provider continues to handle audio under its normal terms and account requirements.

This build is distributed manually. Zotero 10 requires an HTTPS update URL, so the manifest uses the reserved, non-resolving `word-focus.invalid` hostname. There is no hosted update service. Automatic updates for this add-on are disabled on first installation. Install a newer `.xpi` manually when one is provided.

## Development

No npm packages or build downloads are required.

```sh
node --test tests/core.test.cjs
python3 scripts/build.py
```

The build script produces the installable `.xpi` and a source archive in `dist/`.

`content/word-focus.js` contains the boundary handling, text-position mapping, overlays and controls. `bootstrap.js` manages Zotero lifecycle hooks and settings. See `VALIDATION.md` for the checks actually performed and remaining limitations.

## Compatibility and implementation notes

The adapter was written against the reader submodule pinned by Zotero 10.0.6, commit `5802d14a76552e10000124d2431e352e92054f01`.

- It wraps `_composeReadAloudStateSnapshot` and listens to the current local `SpeechSynthesisUtterance`.
- Local offsets are mapped with Zotero’s existing `getWordTextSpans` and `textNodeSpansToSourcePosition` methods. This keeps Zotero’s normalised speech text aligned with the original document.
- It draws two temporary, non-interactive overlay layers, with the word above the sentence. PDF coordinates pass through PDF.js’s page viewport; DOM-based views use mapped range rectangles.
- Sentence-based voices use Zotero’s supplied sentence source positions. For paragraph-based voices, reported character offsets and `Intl.Segmenter` identify the current sentence and map it through the same document position mapper. No sentence is guessed when a multi-sentence paragraph has no timing. Zotero may split unusually long sentences into audio chunks.
- Native visual-highlight resolvers are temporarily wrapped to avoid extra unadjustable fills beneath the custom layers. Navigation and playback remain native. The wrappers delegate normally while Word Focus is switched off and are restored on removal.
- Controls live in a separate embedded document so Zotero’s reader focus handlers cannot cancel slider clicks or input keystrokes.
- Hover preparation reuses Zotero’s sentence extraction with an isolated manager facade, without activating speech. Candidate words are indexed by page or text block, then tested against their actual rendered rectangles.
- Clicking substitutes a shortened first segment in Zotero’s speech queue. Offset adapters preserve word timing and source-position mapping, including after plugin removal. The sentence context remains the full original sentence.
- Saving a sentence uses the current speech snapshot, its full mapped sentence position and text, and Zotero’s native annotation manager. It preserves Zotero’s persistence and undo handling without using the native read-aloud shortcut’s previous-segment heuristic. Annotation coordinates are copied before Zotero rounds them.
- Late events from old utterances, replaced controllers, paused playback and buffering are ignored.
- The wrapper and listeners are removed on disable. If another plugin has subsequently wrapped the same method, the retained Word Focus wrapper becomes a pass-through instead of overwriting that plugin’s method.
- These are internal reader interfaces. A Zotero update or another plugin that changes Read Aloud internals may require an adapter update. Compatibility is deliberately limited to Zotero 10.0.x.

Primary references consulted

- [Zotero version history](https://www.zotero.org/support/changelog)
- [Zotero 10 announcement and Read Aloud limitations](https://www.zotero.org/blog/zotero-10/)
- [Plugin installation](https://www.zotero.org/support/plugins)
- [Plugin lifecycle and manifest documentation](https://www.zotero.org/support/dev/zotero_7_for_developers)
- [Zotero 10 developer notes](https://www.zotero.org/support/dev/zotero_10_for_developers)
- [Pinned reader source](https://github.com/zotero/reader/tree/5802d14a76552e10000124d2431e352e92054f01)

The plugin is original code under the MIT licence. It is an independent prototype and is not an official Zotero release.

# Zotero integration harness

`zotero-harness.js` is the bootstrap script used for the 0.4.1 upgrade, controls, pointer and permanent-annotation checks. Put it in a separate test-only bootstrap extension, not the installed Word Focus extension. It requires an isolated Zotero 10.0.6 profile and quits that instance when finished.

Set `extensions.wordfocus.testRoot` to an absolute test directory ending in `/`. Copy `fake-point-voice.js` there. Also put `word-focus-upgrade-test.xpi`, built from the new release, in that directory.

Create `word-focus-fixture.pdf` as an A4 page with these two lines of selectable Helvetica 16 text at (72, 750) and (72, 715)

- Clear word highlights follow the spoken text.
- The second sentence checks repeated words and pauses.

Install Word Focus 0.4.0 first and set `extensions.wordfocus.settings` to the JSON string `{"enabled":true,"colour":"#ab1299","opacity":48,"outline":3,"showWord":true}` before starting the harness. In the recorded run, a startup hook in a downloaded runtime installed the extensions through `AddonManager.getInstallForFile`. The reader implementation itself was unchanged.

Do not run the harness in a normal working profile. It imports the generated fixture, changes settings and controls in that test profile, and writes assertion results and UI captures to the test directory. Screenshots remain local test evidence.

The test uses genuine Gecko mouse and keyboard input. Speech events and the voice controller are deterministic simulations. It makes no live voice-provider request. The stopped-playback test replaces voice enumeration with the test voice, then uses the native activation and segment-request path.

Annotation checks create real highlights in the imported fixture, exercise native Undo, inspect saved annotation items and reopen the document. Colour input values are supplied programmatically; the native colour-picker dialog is not automated. Mouse clicks and Enter activation exercise the native toolbar button immediately to the right of Wf. The floating action is no longer present.

The result recorder snapshots data immediately, so closing a reader cannot leave dead content objects inside the result array. All files and annotations belong to the isolated test profile.

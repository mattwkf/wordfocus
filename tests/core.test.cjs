const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, words, wordAt, sentenceRanges, sentenceAt, settings, pdfRects, playbackFromWord, PointReader, Session } = require('../content/word-focus.js');

test('word boundaries retain punctuation and UTF-16 offsets', () => {
  const text = '😀  Clear words, don’t drift. Café!';
  const tokens = words(text, 'en');
  assert.equal(wordAt(tokens, 4).text, 'Clear');
  assert.equal(wordAt(tokens, text.indexOf('don’t')).text, 'don’t');
  assert.equal(wordAt(tokens, text.indexOf('Café')).text, 'Café');
  assert.equal(wordAt(tokens, 2), null);
  assert.equal(wordAt(tokens, -1), null);
  assert.equal(wordAt(tokens, text.length), null);
});

test('leading punctuation and CJK work without splitting by spaces', () => {
  assert.equal(wordAt(words('“Hello world”'), 0, 6).text, 'Hello');
  const tokens = words('你好世界', 'zh');
  assert.ok(tokens.length >= 2);
  assert.equal(tokens.map(t => t.text).join(''), '你好世界');
});

test('settings reject invalid colours and clamp dimensions', () => {
  assert.deepEqual(settings({ colour: 'url(https://invalid)', opacity: 99, outline: -1 }),
    {...DEFAULTS,opacity:65,outline:0});
});

test('old word settings are retained while the new sentence layer starts enabled', () => {
  const config = settings({enabled:true, colour:'#ab1299',opacity:48,outline:3,showWord:false});
  assert.equal(config.colour, '#ab1299');
  assert.equal(config.opacity, 48);
  assert.equal(config.outline, 3);
  assert.equal(config.showWord, false);
  assert.equal(config.wordEnabled, true);
  assert.equal(config.sentenceEnabled, true);
  assert.equal(config.sentenceColour, DEFAULTS.sentenceColour);
});

test('sentence controls are validated independently and support invisible fill and outline', () => {
  const c = settings({sentenceColour:'<red>',sentenceOpacity:100,sentenceOutline:-4,opacity:0,outline:0,sentenceEnabled:false});
  assert.equal(c.sentenceColour, DEFAULTS.sentenceColour);
  assert.equal(c.sentenceOpacity, 65);
  assert.equal(c.sentenceOutline, 0);
  assert.equal(c.opacity, 0);
  assert.equal(c.outline, 0);
  assert.equal(c.sentenceEnabled, false);
  assert.equal(c.wordEnabled, true);
});

test('word borders default off and the old default migrates without erasing a new choice', () => {
  assert.equal(settings().outline,0);
  assert.equal(settings({outline:2}).outline,0);
  assert.equal(settings({outline:3}).outline,3);
  assert.equal(settings({settingsVersion:3,outline:2}).outline,2);
  assert.equal(settings().pointRead,true);
  assert.equal(settings({pointRead:false}).pointRead,false);
});

function speechSource() {
  const segment={text:'Clear word highlights follow.',granularity:'sentence',position:{start:[0,0,0],end:[0,0,29]},sourcePosition:{pageIndex:0,rects:[[0,0,290,10]]}};
  const next={text:'Continue here.',position:{start:[1,0,0],end:[1,0,14]}};
  const source={segments:[segment,next],
    getWordPosition:(s,a,b)=>({start:[s===segment?0:1,0,a],end:[s===segment?0:1,0,b]}),
    getWordTextSpans:(s,a,b)=>[{segment:s,start:a,end:b}],
    getSegmentTextSpans(s){return this.getWordTextSpans(s,0,s.text.length);},
    getParagraphTextSpans(s){return [{paragraph:s}];},
    getSegmentsTextSpans(list){return list.flatMap(s=>this.getSegmentTextSpans(s));}
  };
  const mapper={textNodeSpansToSourcePosition:spans=>({pageIndex:0,rects:spans.map(s=>[s.start,0,s.end,10])})};
  return {source,segment,next,mapper};
}

test('click-to-read starts at the exact word and retains later sentences', () => {
  const {source,segment,next,mapper}=speechSource();
  const r=playbackFromWord(source,segment,6,mapper);
  assert.equal(r.segments[0].text,'word highlights follow.');
  assert.equal(r.segments[1],next);
  assert.equal(r.index,0);
  assert.equal(segment.text,'Clear word highlights follow.');
  assert.equal(source.segments[0],segment);
  assert.equal(r.segments[0].wordFocusSentencePosition,segment.sourcePosition);
  assert.equal(r.segments[0].wordFocusSentenceText,segment.text);
  assert.deepEqual(r.builder.getWordTextSpans(r.segments[0],0,4),[{segment,start:6,end:10}]);
  assert.deepEqual(r.builder.getWordPosition(r.segments[0],0,4),{start:[0,0,6],end:[0,0,10]});
  assert.equal(r.builder.getSegmentsTextSpans(r.segments)[0].start,6);
  assert.equal(r.builder.getParagraphTextSpans(r.segments[0])[0].paragraph,segment);
});

test('permanent annotation colour is validated separately from playback colours', () => {
  assert.equal(settings().annotationColour, '#ffd400');
  const config=settings({colour:'#123456',sentenceColour:'#abcdef',annotationColour:'#aa33ff'});
  assert.equal(config.annotationColour,'#aa33ff');
  assert.equal(config.sentenceColour,'#abcdef');
  assert.equal(config.colour,'#123456');
  assert.equal(settings({...config,annotationColour:'red;url(x)'}).annotationColour,'#ffd400');
});

function annotationSession() {
  const r=makeSession(), {session}=r, annotations=new Map();
  Object.assign(session.core,{
    _state:{readOnly:false},
    _annotationManager:{
      _getAnnotationByID:id=>annotations.get(id),
      addAnnotation(data){const annotation={...data,id:String(++this.count)};annotations.set(annotation.id,annotation);return annotation;},count:0
    },
    _getSourceAnnotationMeta:()=>({sortIndex:'00000|00001|00000',pageLabel:'1'}),
    _composeReadAloudStateSnapshot:()=>session.snapshot,
    setSidebarView(view){this.sidebarView=view;},
    toggleSidebar(open){this.sidebarOpen=open;},
    setSelectedAnnotations(ids){this.selected=ids;}
  });
  session.updateUI=()=>{};
  session.report=e=>{session.error=e;};
  return {...r,annotations};
}

test('annotation saves the actual spoken sentence and ignores hover context', () => {
  const {session,boundary,annotations}=annotationSession();boundary(13);
  session.pointReader={hover:{segment:{text:'A different hovered sentence.'}}};
  session.config.annotationColour='#aa33ff';
  const annotation=session.addSentenceAnnotation();
  assert.equal(annotation.text,'Next words.');
  assert.deepEqual(annotation.position.rects,[[13,0,24,10]]);
  assert.equal(annotation.type,'highlight');assert.equal(annotation.color,'#aa33ff');
  assert.equal(annotation.pageLabel,'1');assert.equal(annotations.size,1);
  assert.equal(session.core.sidebarView,'annotations');assert.equal(session.core.sidebarOpen,true);
  assert.deepEqual(session.core.selected,[annotation.id]);
});

test('click-to-read annotation includes the full sentence before the clicked word', () => {
  const {source,segment,mapper}=speechSource();
  const clipped=playbackFromWord(source,segment,6,mapper).segments[0];
  const {session}=annotationSession();
  session.snapshot={active:true,popupOpen:true,activeSegment:clipped,segmentGranularity:'sentence'};
  const annotation=session.addSentenceAnnotation();
  assert.equal(annotation.text,segment.text);
  assert.deepEqual(annotation.position,segment.sourcePosition);
  assert.notEqual(annotation.position,segment.sourcePosition);
  annotation.position.rects[0][0]=999;
  assert.equal(segment.sourcePosition.rects[0][0],0);
});

test('repeat clicks reuse the annotation, distinct sentences save separately, undo allows re-adding', () => {
  const {session,boundary,annotations}=annotationSession();boundary(0);
  const first=session.addSentenceAnnotation();
  assert.equal(session.addSentenceAnnotation(),first);assert.equal(annotations.size,1);
  boundary(13);const second=session.addSentenceAnnotation();assert.notEqual(first.id,second.id);
  assert.equal(annotations.size,2);
  annotations.delete(second.id);
  assert.notEqual(session.addSentenceAnnotation().id,second.id);assert.equal(annotations.size,2);
});

test('annotation uses a fresh playback snapshot at the instant of activation', () => {
  const {session,boundary}=annotationSession();boundary(0);
  session.core._composeReadAloudStateSnapshot=()=>({active:true,popupOpen:true,
    activeSegment:{text:'Now reading this.',granularity:'sentence',sourcePosition:{pageIndex:3,rects:[[1,2,3,4]]}}});
  const annotation=session.addSentenceAnnotation();
  assert.equal(annotation.text,'Now reading this.');assert.equal(annotation.position.pageIndex,3);
});

test('read-only, stopped, disabled and unmapped playback never create an annotation', () => {
  for(const change of [
    s=>{s.core._state.readOnly=true;},
    s=>{s.core._annotationManager._readOnly=true;},
    s=>{s.snapshot.active=false;},
    s=>{s.snapshot.popupOpen=false;},
    s=>{s.config.enabled=false;},
    s=>{s.core._sdt.mapper.textNodeSpansToSourcePosition=()=>null;}
  ]) {
    const {session,boundary,annotations}=annotationSession();boundary(0);change(session);
    assert.equal(session.addSentenceAnnotation(),null);assert.equal(annotations.size,0);
    assert.ok(session.annotationNotice.message);
  }
  const {session,annotations}=annotationSession();
  assert.equal(session.addSentenceAnnotation(),null);assert.equal(annotations.size,0);
});

test('paused sentence can be saved and missing annotation metadata reports failure without writing', () => {
  const {session,manager,boundary,annotations}=annotationSession();boundary(0);manager.paused=true;
  session.snapshot.paused=true;
  assert.equal(session.addSentenceAnnotation().text,'Clear words.');
  annotations.clear();session.core._getSourceAnnotationMeta=()=>null;
  assert.equal(session.addSentenceAnnotation(),null);assert.equal(annotations.size,0);
  assert.match(session.annotationNotice.message,/Could not add/);assert.ok(session.error);
});

test('clicking the first word keeps the full sentence and invalid offsets are rejected', () => {
  const {source,segment,mapper}=speechSource();
  assert.equal(playbackFromWord(source,segment,0,mapper).builder,source);
  for(const start of [-1,0.5,segment.text.length]) assert.throws(()=>playbackFromWord(source,segment,start,mapper));
});

test('hover preparation builds native sentences without activating the real speech manager', async () => {
  const {source,mapper}=speechSource();
  const manager={active:false,lang:'en',setSegments(){throw new Error('Real playback must not start');}};
  const core={_readAloudManager:manager,_sdt:{mapper},async _loadSDT(){return this._sdt;},async _requestReadAloudSegments(){
    assert.notEqual(this,core); assert.notEqual(this._readAloudManager,manager);
    this._readAloudSegments=source;this._readAloudManager.setSegments(source.segments,0,null);
  }};
  const session={core,config:settings(),schedule(){},report(e){throw e;},win:{}};
  const point=new PointReader(session);await point.load();
  assert.equal(point.preview.builder,source);
  assert.equal(manager.active,false);
  assert.equal(core._readAloudSegments,undefined);
  point.dispose();
});

test('pending click rewrites native playback once and remains mappable after plugin removal', () => {
  const {source,segment,mapper}=speechSource();let received;
  const manager={_activeSegment:segment,_paused:true,setSegments(...args){received=args;}};
  const original=manager.setSegments;
  const session={core:{_readAloudManager:manager,_sdt:{mapper}},config:settings(),schedule(){},report(e){throw e;},win:{}};
  const point=new PointReader(session);
  point.pending={builder:source,segment,word:{start:6}};
  manager.setSegments(source.segments,0,null);
  assert.equal(received[0][0].text,'word highlights follow.');
  assert.equal(manager._paused,false);
  assert.equal(point.pending,null);
  point.dispose();
  assert.equal(manager.setSegments,original);
  assert.equal(session.core._readAloudSegments.getWordTextSpans(received[0][0],0,4)[0].start,6);
});

test('sentence ranges preserve UTF-16 offsets, punctuation and surrounding whitespace', () => {
  const text='  😀 Clear words.  Next words!  ';
  const ranges=sentenceRanges(text,'en');
  assert.equal(text.slice(ranges[0].start,ranges[0].end),'😀 Clear words.');
  assert.equal(text.slice(ranges[1].start,ranges[1].end),'Next words!');
  assert.equal(sentenceAt(ranges,text.indexOf('Next')), ranges[1]);
  assert.equal(sentenceAt(ranges,null),null);
  assert.equal(sentenceAt(ranges,-1),null);
});

test('PDF positions account for page borders, CSS zoom, rotations and next pages', () => {
  const makePage = top => ({
    div: { isConnected:true, clientWidth:400,clientHeight:600,clientLeft:2,clientTop:2,
      getBoundingClientRect:()=>({left:100,top}) },
    viewport:{width:200,height:300,convertToViewportRectangle:([a,b,c,d])=>[200-c,b,200-a,d]}
  });
  const view = {_iframeWindow:{PDFViewerApplication:{pdfViewer:{getPageView:i=>makePage(i*604)}},
    document:{getElementById:()=>null}}};
  assert.deepEqual(pdfRects(view,{pageIndex:0,rects:[[10,20,40,30]],nextPageRects:[[10,0,40,10]]}),[
    {left:422,top:42,width:60,height:20},{left:422,top:606,width:60,height:20}
  ]);
});

// Exercise timing logic without a DOM. The actual Gecko reader is covered by
// the separate Zotero integration harness used to validate the release.
function makeSession() {
  const utterance = Object.assign(new EventTarget(), {text:'Clear words. Next words.'});
  const segment = {text:utterance.text};
  const controller = {_currentUtterance:utterance,_currentSegment:segment};
  const manager = {_controller:controller,activeSegment:segment,paused:false,buffering:false,lang:'en',activeTimestamp:null};
  const session = Object.create(Session.prototype);
  Object.assign(session, {config:settings(),disposed:false,local:null,schedule(){},report(e){throw e;},
    core:{_readAloudManager:manager,
      _readAloudSegments:{getWordTextSpans:(seg,start,end)=>[{start,end}]},
      _sdt:{mapper:{textNodeSpansToSourcePosition:spans=>({pageIndex:0,rects:[[spans[0].start,0,spans[0].end,10]]})}}},
    push(){this.compose({popupOpen:true,active:true,activeSegment:manager.activeSegment,highlightGranularity:'paragraph',activeWordSourcePosition:null})}
  });
  const boundary = (index,name='word',length=5) => {
    const event=new Event('boundary'); Object.assign(event,{name,charIndex:index,charLength:length});utterance.dispatchEvent(event);
  };
  session.push();
  return {session,manager,controller,utterance,segment,boundary};
}

test('local boundary events highlight their exact word and ignore sentence events', () => {
  const {session,boundary}=makeSession();
  boundary(0);
  assert.equal(session.currentWord,'Clear');
  assert.deepEqual(session.snapshot.activeWordSourcePosition.rects,[[0,0,5,10]]);
  boundary(6,'sentence');
  assert.equal(session.currentWord,'Clear');
  boundary(6);
  assert.equal(session.currentWord,'words');
});

test('pause, buffering and replaced controllers reject late boundaries', () => {
  const {session,manager,boundary}=makeSession();
  boundary(0); manager.paused=true;boundary(6);
  assert.equal(session.currentWord,'Clear');
  manager.paused=false;manager.buffering=true;boundary(6);
  assert.equal(session.currentWord,'Clear');
  manager.buffering=false;manager._controller={};boundary(6);
  assert.equal(session.currentWord,'Clear');
});

test('new utterance after speed change clears stale positions and resumes at reported word', () => {
  const {session,manager,controller,boundary,segment}=makeSession();
  boundary(6);
  const newUtterance=Object.assign(new EventTarget(),{text:segment.text});
  controller._currentUtterance=newUtterance;
  session.push();
  assert.equal(session.currentWord,'');
  boundary(0);
  assert.equal(session.currentWord,'');
  const e=Object.assign(new Event('boundary'),{name:'word',charIndex:0,charLength:5});
  newUtterance.dispatchEvent(e);
  assert.equal(session.currentWord,'Clear');
});

test('no word timings are fabricated for unsupported voices', () => {
  const {session}=makeSession();
  assert.equal(session.timing,'waiting');
  assert.equal(session.snapshot.activeWordSourcePosition,null);
});

test('native timestamps take priority and preserve original source position', () => {
  const {session,manager,segment}=makeSession();
  manager.activeTimestamp={charStart:6,charEnd:11};
  const position={pageIndex:2,rects:[[30,40,60,50]]};
  const snapshot={popupOpen:true,active:true,activeSegment:segment,activeWordSourcePosition:position};
  session.compose(snapshot);
  assert.equal(session.currentWord,'words');
  assert.equal(session.timing,'timestamps');
  assert.equal(snapshot.activeWordSourcePosition,position);
});

test('sentence context remains fixed across words and advances at the next sentence', () => {
  const {session,boundary}=makeSession();
  boundary(0);
  const first=JSON.stringify(session.sentencePosition);
  assert.deepEqual(session.sentencePosition.rects,[[0,0,12,10]]);
  boundary(6);
  assert.equal(JSON.stringify(session.sentencePosition),first);
  assert.deepEqual(session.snapshot.activeWordSourcePosition.rects,[[6,0,11,10]]);
  boundary(13);
  assert.deepEqual(session.sentencePosition.rects,[[13,0,24,10]]);
});

test('sentence timing can move context without fabricating a word', () => {
  const {session,boundary}=makeSession();
  boundary(13,'sentence');
  assert.equal(session.currentWord,'');
  assert.deepEqual(session.sentencePosition.rects,[[13,0,24,10]]);
  assert.equal(session.snapshot.activeWordSourcePosition,null);
});

test('native sentence segments supply context before any word boundary', () => {
  const {session,segment}=makeSession();
  segment.granularity='sentence';
  segment.sourcePosition={pageIndex:3,rects:[[2,10,200,20]]};
  session.push();
  assert.equal(session.sentencePosition,segment.sourcePosition);
  assert.equal(session.currentWord,'');
});

test('multi-sentence paragraphs with no timing do not guess an active sentence', () => {
  const {session}=makeSession();
  assert.equal(session.sentencePosition,null);
});

test('native visual layers are suppressed only while enabled and restored on detach', () => {
  const {session}=makeSession();
  const pdf={_resolveReadAloudPrimaryPosition(){return 'pdf';},_resolveReadAloudSkipHighlightPosition(){return 'skip';}};
  const dom={_resolvePrimarySelector(){return 'dom';},_resolveSkipSpotlightSelector(){return 'skip';}};
  const original=pdf._resolveReadAloudPrimaryPosition;
  session.core._views=[pdf,{_readAloud:dom}];
  session.syncNativeHighlights();
  assert.equal(pdf._resolveReadAloudPrimaryPosition(),null);
  assert.equal(dom._resolvePrimarySelector(),null);
  session.config.enabled=false;
  assert.equal(pdf._resolveReadAloudPrimaryPosition(),'pdf');
  assert.equal(dom._resolveSkipSpotlightSelector(),'skip');
  session.core._views=[];session.syncNativeHighlights();
  assert.equal(pdf._resolveReadAloudPrimaryPosition,original);
});

test('later plugin wrappers are preserved and Word Focus becomes a pass-through after disposal', () => {
  const {session}=makeSession();
  const pdf={_resolveReadAloudPrimaryPosition(){return 'native';}};
  session.core._views=[pdf];session.syncNativeHighlights();
  const wrapped=pdf._resolveReadAloudPrimaryPosition;
  const other=function(){return wrapped.call(this)+' plus other';};
  pdf._resolveReadAloudPrimaryPosition=other;
  session.disposed=true;
  session.restoreHooks(pdf,session.nativeHooks.get(pdf));
  assert.equal(pdf._resolveReadAloudPrimaryPosition,other);
  assert.equal(pdf._resolveReadAloudPrimaryPosition(),'native plus other');
});

test('disable leaves native granularity unchanged and detaches listeners', () => {
  const {session,segment,boundary}=makeSession();
  session.config.enabled=false;
  const snapshot={popupOpen:true,active:true,activeSegment:segment,highlightGranularity:'paragraph'};
  session.compose(snapshot);boundary(0);
  assert.equal(snapshot.highlightGranularity,'paragraph');
  session.detachUtterance();
  assert.equal(session.local,null);
});

test('display updates wait for the reader to finish initialising', async () => {
  let ready;
  const initialised = new Promise(resolve => { ready = resolve; });
  let calls = 0;
  const session = {disposed:false,core:{_views:[{initializedPromise:initialised}],_pushReadAloudToViews(){calls++;}},report(e){throw e;}};
  const pending = Session.prototype.push.call(session);
  assert.equal(calls, 0);
  ready(); await pending;
  assert.equal(calls, 1);
});

test('disabling during reader loading prevents late display changes', async () => {
  let ready;
  const initialised = new Promise(resolve => { ready = resolve; });
  let calls = 0;
  const session = {disposed:false,core:{_views:[{initializedPromise:initialised}],_pushReadAloudToViews(){calls++;}},report(e){throw e;}};
  const pending = Session.prototype.push.call(session);
  session.disposed = true;
  ready(); await pending;
  assert.equal(calls, 0);
});

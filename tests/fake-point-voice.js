// Test-only voice. Exercises Zotero's real manager without external audio.
window.wordFocusSpoken=[];
window.wordFocusTestVoice={
 id:'word-focus-test',language:'en',tier:'local',segmentGranularity:'sentence',sentenceDelay:0,
 getController(segments,index){
  const c=new EventTarget();c._segments=segments;c._position=index||0;c._paused=true;c.speed=1;c.buffering=false;
  Object.defineProperty(c,'_currentSegment',{get(){return this._segments[this._position];}});
  Object.defineProperty(c,'paused',{get(){return this._paused;},set(value){
   this._paused=value;if(value)return;
   const segment=this._currentSegment;
   this._currentUtterance=new SpeechSynthesisUtterance(segment.text);
   wordFocusSpoken.push(segment.text);
   setTimeout(()=>{if(this.dead)return;const event=new Event('ActiveSegmentChange');event.segment=segment;this.dispatchEvent(event);},0);
  }});
  c.destroy=function(){this.dead=true;};c.syncActiveWordToPlayback=function(){};
  return c;
 }
};

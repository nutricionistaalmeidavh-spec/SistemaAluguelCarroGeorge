import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {attachPageTelemetry,assertNoPageErrors} from '../qa/artisys-qa/src/telemetry.js';
test('uncaught page exceptions fail the QA gate even if UI steps succeed',()=>{
 const page=new EventEmitter(),events=[];attachPageTelemetry(page,events);
 assert.doesNotThrow(()=>assertNoPageErrors(events));
 page.emit('pageerror',new Error('render crashed'));
 assert.throws(()=>assertNoPageErrors(events),/render crashed/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {searchOnline} from '../src/lib/geocoding.js';
test('online search validates positions, caches queries, spaces requests and retries failures',async()=>{
 const originalFetch=globalThis.fetch,originalLocation=globalThis.location;globalThis.location={href:'http://localhost/'};
 let calls=[],fail=false;globalThis.fetch=async()=>{calls.push(Date.now());return new Response(fail?'unavailable':JSON.stringify([{name:'Test',lat:'10',lon:'20'},{name:'Invalid',lat:'100',lon:'20'}]),{status:fail?503:200});};
 try{assert.equal(calls.length,0);const first=await searchOnline('Test');assert.equal(first.length,1);assert.equal(await searchOnline(' test '),first);assert.equal(calls.length,1);fail=true;await assert.rejects(searchOnline('Other'),/unavailable/);fail=false;assert.equal((await searchOnline('Other')).length,1);assert.equal(calls.length,3);for(let i=1;i<calls.length;i++)assert.ok(calls[i]-calls[i-1]>=990);const controller=new AbortController();controller.abort();await assert.rejects(searchOnline('Cancelled',{signal:controller.signal}),{name:'AbortError'});assert.equal(calls.length,3);}
 finally{globalThis.fetch=originalFetch;globalThis.location=originalLocation;}
});

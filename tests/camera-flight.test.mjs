import assert from 'node:assert/strict';
import {createFlightLock} from '../src/lib/cameraFlight.js';
let time=0,sequence=0;const timers=new Map(),events=[];
const lock=createFlightLock(value=>events.push(value),{now:()=>time,schedule:(fn,delay)=>{const id=++sequence;timers.set(id,{fn,at:time+delay});return id;},cancel:id=>timers.delete(id)});
function advance(ms){const end=time+ms;while(true){const item=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!item||item[1].at>end)break;time=item[1].at;timers.delete(item[0]);item[1].fn();}time=end;}
lock.hold(3100);lock.hold(1150);assert.equal(lock.isLocked(),true);advance(1250);assert.equal(lock.isLocked(),true);lock.hold(1850);advance(1849);assert.equal(lock.isLocked(),true);advance(1);assert.equal(lock.isLocked(),false);assert.deepEqual(events,[true,false]);
lock.hold(1400);advance(200);lock.hold(1800);advance(1399);assert.equal(lock.isLocked(),true);advance(401);assert.equal(lock.isLocked(),false);
lock.hold(1000);lock.dispose();assert.equal(lock.isLocked(),false);assert.equal(timers.size,0);
console.log('PASS: single/extended flights, complete Mirror sequence and disposal');

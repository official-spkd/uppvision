import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateAccountPlan } from '../src/instagram-duplicates.mjs';
import { InstagramManager } from '../server/instagram.mjs';
const phone = (number, count, names = ['shared']) => ({ serial: `p${number}`, name: `Samsung ${String(number).padStart(2, '0')}`, online: true, complete: true, accounts: [...names.map(username => ({ username })), ...Array.from({ length: count - names.length }, (_, i) => ({ username: `unique${number}_${i}` }))] });
test('duplicate cleanup prioritizes fullest HP and retains the smaller HP number on tied counts', () => {
 const devices=[phone(1,13),phone(2,5),phone(3,5)];
 const p=duplicateAccountPlan(devices);
 assert.deepEqual(p.candidates.map(a=>[a.serial,a.keepSerial]),[['p1','p2'],['p3','p2']]);
 devices[0].accounts=devices[0].accounts.filter(a=>a.username!=='shared');
 assert.deepEqual(duplicateAccountPlan(devices).candidates.map(a=>a.serial),['p3']);
});
test('recomputed counts change the next keeper without deleting unique accounts', () => {
 const devices=[phone(1,3,['a','b']),phone(2,2,['a','b'])];
 const p=duplicateAccountPlan(devices); assert.equal(p.candidates[0].serial,'p1');
 devices[0].accounts=devices[0].accounts.filter(a=>a.username!=='a');
 const next=duplicateAccountPlan(devices); assert.equal(next.candidates[0].username,'b'); assert.equal(next.candidates[0].serial,'p2'); assert.equal(next.candidates[0].keepSerial,'p1');
});
test('offline or incomplete copies are held; disabled copies are reported and never selected for normal logout',()=>{
 for(const change of [{online:false},{complete:false},{error:'unreadable'}]) {
  const p=duplicateAccountPlan([phone(1,3),{...phone(2,2),...change}]); assert.equal(p.candidates.length,0);assert.equal(p.blocked.length,1);
 }
 const disabled=phone(2,2);disabled.accounts[0].disabled=true;
 const p=duplicateAccountPlan([phone(1,3),disabled]);assert.equal(p.candidates.length,0);assert.equal(p.blocked.length,1);assert.equal(p.retained[0].serial,'p1');
});
function fixture(){
 const manager=new InstagramManager({statePath:'/unused',devices:()=>manager.state.devices.map(d=>({...d,status:'device'}))});
 manager.state.devices=[phone(1,4),phone(2,2),phone(3,2)];
 manager.save=async()=>{};manager.stayAwake=()=>()=>{};manager.openLog=async()=>{};manager.log=(job,message)=>job.logs.push({message});manager.scanAccounts=async()=>manager.snapshot();
 manager.accountSheet=async (serial,desired)=>desired?{current:desired}:structuredClone(manager.state.devices.find(d=>d.serial===serial));
 const removed=[];
 manager.logout.start=({serial,username})=>{
  const d=manager.state.devices.find(d=>d.serial===serial);const before=d.accounts.map(a=>a.username);
  d.accounts=d.accounts.filter(a=>a.username!==username);removed.push([serial,username]);
  manager.logout.job={status:'success',verification:{before,after:d.accounts.map(a=>a.username)}};manager.logout.task=Promise.resolve();
 };
 return {manager,removed};
}
test('batch verifies retained copy, recomputes priority, and ends with exactly one copy',async()=>{
 const {manager,removed}=fixture();manager.duplicates.start();await manager.duplicates.task;
 assert.deepEqual(removed,[['p1','shared'],['p3','shared']]);assert.equal(manager.duplicates.job.status,'completed');
 assert.equal(manager.state.devices.filter(d=>d.accounts.some(a=>a.username==='shared')).length,1);
 assert.equal(manager.state.lastDuplicates.removed.length,2);
});
test('batch holds logout when retained copy cannot be proven and does not remove the final copy',async()=>{
 const {manager,removed}=fixture();manager.accountSheet=async()=>({accounts:[],complete:true});
 manager.duplicates.start();await manager.duplicates.task;assert.equal(manager.duplicates.job.status,'failed');assert.deepEqual(removed,[]);
});
test('unverified logout stops the batch without counting removal or advancing to another account',async()=>{
 const {manager}=fixture();let attempts=0,released=0;
 manager.stayAwake=()=>()=>{released++;};
 manager.logout.start=()=>{attempts++;manager.logout.job={status:'failed',note:'Log out belum terverifikasi.'};manager.logout.task=Promise.resolve();};
 manager.duplicates.start();await manager.duplicates.task;
 assert.equal(attempts,1);assert.equal(manager.duplicates.job.status,'failed');
 assert.deepEqual(manager.duplicates.job.removed,[]);assert.equal(manager.state.lastDuplicates.note,'Log out belum terverifikasi.');
 assert.equal(manager.state.devices.filter(d=>d.accounts.some(a=>a.username==='shared')).length,3);
 assert.equal(released,1);assert.equal(manager.duplicates.busy,false);
});
test('a listed keeper must also open as the exact account before any logout',async()=>{
 const {manager,removed}=fixture();const original=manager.accountSheet;let selections=0;
 manager.accountSheet=async(serial,desired)=>{if(desired){selections++;return {current:'wrong.account'};}return original(serial);};
 manager.duplicates.start();await manager.duplicates.task;
 assert.equal(selections,1);assert.deepEqual(removed,[]);assert.equal(manager.duplicates.job.status,'failed');
 assert.match(manager.duplicates.job.note,/Sesi @shared/);
});
test('profile-dependent keeper inventories stop cleanup before logout',async()=>{
 const {manager,removed}=fixture();const original=manager.accountSheet;let selected=false;
 manager.accountSheet=async(serial,desired)=>{if(desired){selected=true;return {current:desired};}const result=await original(serial);if(selected)result.accounts.push({username:'linked.extra'});return result;};
 manager.duplicates.start();await manager.duplicates.task;
 assert.deepEqual(removed,[]);assert.equal(manager.duplicates.job.status,'failed');assert.match(manager.duplicates.job.note,/profil aktif diganti/);
});
test('stop finishes current verification and prevents the next logout; concurrent starts are rejected',async()=>{
 const {manager,removed}=fixture();const original=manager.logout.start;
 manager.logout.start=body=>{original(body);manager.duplicates.stop();};
 manager.duplicates.start();assert.throws(()=>manager.duplicates.start(),/Tunggu/);
 await assert.rejects(manager.preview({accounts:[{serial:'p1',username:'shared',target:'target',posts:1,comments:1,tone:'positif'}]}),/berjalan/);
 await manager.duplicates.task;assert.equal(removed.length,1);assert.equal(manager.duplicates.job.status,'stopped');
});

test('selection blocks follow the final recomputed allocation without mutating inventory', async () => {
 const { duplicateSelectionBlocks } = await import('../src/instagram-duplicates.mjs');
 const devices=[phone(1,3,['a','b']),phone(2,2,['a','b'])];
 const before=structuredClone(devices), blocks=duplicateSelectionBlocks(devices);
 assert.equal(blocks.get('p1:a').keepSerial,'p2');
 assert.equal(blocks.get('p2:b').keepSerial,'p1');
 assert.equal(blocks.has('p2:a'),false);assert.equal(blocks.has('p1:b'),false);
 assert.deepEqual(devices,before);
});
test('selection restriction survives incomplete/offline inventory, normalizes usernames, and excludes unique accounts', async () => {
 const { duplicateSelectionBlocks } = await import('../src/instagram-duplicates.mjs');
 const devices=[{...phone(1,3,['@Shared']),complete:false,error:'challenge'}, {...phone(2,2,['shared']),online:false}];
 const blocks=duplicateSelectionBlocks(devices);
 assert.equal(blocks.size,1);assert.equal(blocks.get('p1:shared').keepSerial,'p2');
 assert.match(blocks.get('p1:shared').reason,/Sudah ada di device lain.*Samsung 02/);
 assert.equal(duplicateAccountPlan(devices).candidates.length,0);
 assert.equal(duplicateSelectionBlocks([phone(1,2)]).size,0);
});
test('selection allocation retains the lower phone number for ties and an enabled copy', async () => {
 const { duplicateSelectionBlocks } = await import('../src/instagram-duplicates.mjs');
 const devices=[phone(3,5),phone(2,5),phone(1,13)];
 const blocks=duplicateSelectionBlocks(devices);
 assert.equal(blocks.get('p1:shared').keepSerial,'p2');assert.equal(blocks.get('p3:shared').keepSerial,'p2');
 devices[1].accounts[0].disabled=true;
 assert.equal(duplicateSelectionBlocks(devices).get('p1:shared').keepSerial,'p3');
});

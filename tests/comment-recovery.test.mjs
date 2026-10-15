import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InstagramManager, NetworkError } from '../server/instagram.mjs';
const ref={kind:'post',url:'https://www.instagram.com/p/Example123/',shortcode:'Example123',owner:'target.one'};
const account={serial:'phone',username:'account.one',target:ref.url,posts:1,comments:3,tone:'positif'};
function fixture() {
  const m=new InstagramManager({statePath:'/unused',devices:()=>[{serial:'phone',status:'device'}]});
  m.save=async()=>{};m.logs.write=()=>{};m.prepareDevice=async()=>{};m.accountSheet=async()=>{};
  m.state.devices=[{serial:'phone',accounts:[{username:'account.one'}]}];
  const key=m.commentKey({commentRunId:'original'},account.username,ref.shortcode);
  m.setCount(key,1,{postKey:'account.one:Example123',legacyKey:'account.one:fingerprint'});
  m.state.history=[{id:'record-1',key,postKey:'account.one:Example123',serial:'phone',username:'account.one',target:'target.one',targetInput:ref.url,postRef:ref,fingerprint:'fingerprint',text:'New comment',status:'uncertain',commentRunId:'original'}];
  const entry={...account,status:'done',note:'1 komentar menunggu pemeriksaan hasil',sent:0,progress:{0:{index:0,key,requested:3}},lockedPosts:[ref]};
  m.state.resumableJob={id:'saved-job',commentMode:'new-per-job',commentRunId:'original',accounts:[structuredClone(entry)]};
  m.job={id:'saved-job',status:'stopped',commentRunId:'original',commentMode:'new-per-job',accounts:[entry],logs:[],sent:0};
  m.recovery.hydrateSaved();
  m.openPost=async()=>({fingerprint:'fingerprint',owner:'target.one',nodes:[],caption:'Caption'});
  m.openThread=async()=>({caption:'Caption'});m.closeSheets=async()=>{};
  m.likePost=m.sendComment=m.typeComment=async()=>assert.fail('review cannot like, type or send');
  return {m,key};
}
test('review confirms a saved send without publishing; resume uses only server-owned plan and quota',async()=>{
  const {m,key}=fixture();m.checkDelivery=async()=> 'sent';
  assert.equal(m.recovery.summary().resume.blocked,true);
  const response=await m.recovery.review({recordId:'record-1',status:'failed',target:'injected'});
  assert.equal(response.checking,false);assert.equal(m.state.history[0].status,'sent');assert.equal(m.countFor(key),1);
  assert.equal(response.recovery.pending.length,0);assert.equal(response.recovery.resume.remaining,2);
  assert.equal(response.recovery.resume.blocked,false);assert.equal(m.job.accounts[0].confirmed,1);
  assert.equal(m.job.accounts[0].status,'partial');assert.match(m.job.accounts[0].note,/0 menunggu pemeriksaan/);
  let resumed;m.run=async job=>{resumed=job;};
  m.recovery.resume({resumeJobId:'saved-job',accounts:[{...account,comments:99}]});
  assert.equal(resumed.commentRunId,'original');assert.equal(resumed.accounts[0].comments,3);assert.deepEqual(resumed.accounts[0].lockedPosts,[ref]);
});
test('an explicit scoped failure releases a reservation exactly once',async()=>{
  const {m,key}=fixture();m.checkDelivery=async()=> 'failed';
  await m.recovery.review({recordId:'record-1'});
  assert.equal(m.countFor(key),0);assert.equal(m.recovery.summary().resume.remaining,3);
  await assert.rejects(m.recovery.review({recordId:'record-1'}),/sudah diperiksa/);
  assert.equal(m.countFor(key),0);
});
test('absent, posting or blocked evidence never releases quota and cannot resume',async()=>{
  for (const status of ['uncertain','posting','blocked']) {
    const {m,key}=fixture();m.checkDelivery=async()=>status;
    await m.recovery.review({recordId:'record-1'});
    assert.equal(m.state.history[0].status,'uncertain');assert.equal(m.countFor(key),1);
    assert.throws(()=>m.recovery.resume({resumeJobId:'saved-job'}),/belum pasti/);
  }
});
test('review refuses busy execution, forged records and a changed target before reading results',async()=>{
  const {m}=fixture();m.checkDelivery=async()=>assert.fail('wrong target must stop first');
  await assert.rejects(m.recovery.review({recordId:'forged'}),/tidak tersedia/);
  m.locks.add('phone');await assert.rejects(m.recovery.review({recordId:'record-1'}),/Tunggu/);m.locks.clear();
  m.openPost=async()=>({fingerprint:'other-post',owner:'target.one'});
  await assert.rejects(m.recovery.review({recordId:'record-1'}),/Identitas/);
  assert.equal(m.state.history[0].status,'uncertain');assert.equal(m.previewPending,false);assert.equal(m.locks.size,0);
});
test('failure to persist a review leaves the reservation held',async()=>{
  const {m,key}=fixture();m.checkDelivery=async()=> 'failed';m.save=async()=>{throw Error('disk unavailable');};
  await assert.rejects(m.recovery.review({recordId:'record-1'}),/disk unavailable/);
  assert.equal(m.state.history[0].status,'uncertain');assert.equal(m.countFor(key),1);
});
test('restart retains unresolved send and recovery metadata even before send confirmation',async t=>{
  const {m}=fixture(),dir=await mkdtemp(join(tmpdir(),'phonefarm-recovery-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  m.statePath=join(dir,'state.json');m.save=InstagramManager.prototype.save;
  m.job.status='running';m.state.history[0].status='sending';m.state.history[0].phase='send_requested';
  await m.checkpointJob(m.job);
  const fresh=new InstagramManager({statePath:m.statePath,devices:()=>[{serial:'phone',status:'device'}]});
  await fresh.load();
  assert.equal(fresh.job.status,'stopped');assert.equal(fresh.job.accounts[0].pending,1);
  assert.equal(fresh.recovery.summary().resume.blocked,true);assert.equal(fresh.recovery.summary().pending[0].reviewable,true);
});
test('legacy jobs without per-post progress reconstruct their remaining quota without reading device comments',async()=>{
  const {m,key}=fixture();delete m.state.resumableJob.accounts[0].progress;delete m.state.lastCommentJob;
  m.state.history[0].status='sent';m.setCount(key,2);
  m.recovery.migrate();
  assert.equal(m.recovery.summary().resume.remaining,1);
});
test('legacy unresolved records lacking target proof stay visible and cannot be auto-cleared',async()=>{
  const {m}=fixture();m.state.history=[{key:'legacy-key',username:'account.one',status:'uncertain',text:'Old'}];m.recovery.migrate();
  const pending=m.recovery.summary().pending[0];assert.ok(pending.id);assert.equal(pending.reviewable,false);
  await assert.rejects(m.recovery.review({recordId:pending.id}),/referensi target/);
});

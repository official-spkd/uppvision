import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryEvidence, verifyDelivery } from '../server/comment-delivery.mjs';
import { InstagramManager, NetworkError } from '../server/instagram.mjs';
import { parseUi } from '../server/instagram-core.mjs';
const pause = async () => {};
const id = n => `com.instagram.android:id/${n}`;
const composer = { 'resource-id': id('layout_comment_thread_edittext_multiline'), text: 'Comment as account.one…' };
const own = { 'content-desc': 'account.one mengatakan New comment' };
function manager() {
  const m = new InstagramManager({ statePath: '/unused', devices: () => [] });
  m.deliveryPause = pause; m.inputPause = pause; m.imeShown = async () => false; m.net.phoneOnline = async () => true; m.logs.write = () => {}; m.save = pause;
  return m;
}
const entry = { serial: 'phone', username: 'account.one', target: 'target.one' };

test('failed, posting, offline and wrong-account evidence override visible text', () => {
  for (const [patch, expected] of [[{failed:true},'failed'],[{posting:true},'posting'],[{offline:true},'uncertain'],[{accountMatches:false},'uncertain'],[{blocked:true},'blocked']]) {
    assert.equal(deliveryEvidence({ visible:true, ...patch }), expected);
  }
  assert.equal(deliveryEvidence({ failed:true, visible:true }, { recovery:true }), 'uncertain');
  assert.equal(deliveryEvidence({ failed:true, scopedFailure:true }, { recovery:true }), 'failed');
});
test('two separated online matching observations are required, with no indicators in between', async () => {
  const observations = [{visible:true}, {posting:true,visible:true}, {visible:true}, {visible:true}];
  let reads=0, pauses=0;
  const result=await verifyDelivery({observe:async()=>{reads++;return observations.shift();},online:async()=>true,pause:async()=>pauses++});
  assert.equal(result,'sent'); assert.equal(reads,4); assert.equal(pauses,3);
});
test('late failure after first visible text never becomes success', async () => {
  const observations=[{visible:true},{visible:true,failed:true}];
  assert.equal(await verifyDelivery({observe:async()=>observations.shift(),online:async()=>true,pause}), 'failed');
});
test('loading, absence, flaky connectivity and unreadable screens remain uncertain with bounded attempts', async () => {
  let reads=0;
  assert.equal(await verifyDelivery({observe:async()=>{reads++;return {};},online:async()=>true,pause,attempts:4}), 'uncertain');
  assert.equal(reads,4);
  assert.equal(await verifyDelivery({observe:async()=>({visible:true}),online:async()=>false,pause,attempts:3}), 'uncertain');
  assert.equal(await verifyDelivery({observe:async()=>{throw new Error('ADB disconnected');},online:async()=>true,pause}), 'uncertain');
  assert.equal(await verifyDelivery({observe:async()=>({posting:true,visible:true}),online:async()=>true,pause,attempts:3}), 'posting');
});
test('Instagram requires author and text, not arbitrary matching screen text or a different account', async () => {
  const m=manager();
  for (const nodes of [[composer,{text:'New comment'}],[composer,{'content-desc':'other.one mengatakan New comment'}],[{...composer,text:'Comment as wrong.one…'},own]]) {
    m.ui=async()=>nodes;
    assert.equal(await m.checkDelivery(entry,'New comment',{attempts:2}),'uncertain');
  }
  m.ui=async()=>[composer,own];
  assert.equal(await m.checkDelivery(entry,'New comment'),'sent');
});
test('recovery rejects global failure banner but accepts failure attached to the matching comment row', async () => {
  const m=manager();
  m.ui=async()=>[composer,own,{text:'Gagal memposting'}];
  assert.equal(await m.checkDelivery(entry,'New comment',{recovery:true,attempts:2}),'uncertain');
  m.ui=async()=>parseUi(`<hierarchy><node resource-id="${id('layout_comment_thread_edittext_multiline')}" text="Comment as account.one…"/><node resource-id="${id('comment_row_container')}"><node content-desc="account.one mengatakan New comment"/><node text="Gagal memposting"/></node></hierarchy>`);
  assert.equal(await m.checkDelivery(entry,'New comment',{recovery:true}),'failed');
});
test('send journals an ambiguous tap interruption and never releases its reservation or claims success', async () => {
  const m=manager(); let typed='', clicks=0;
  m.ui=async()=>[{...composer,focused:'true',text:typed||composer.text},{'resource-id':id('layout_comment_thread_post_button_icon'),enabled:'true'}];
  m.typeComment=async(s,text)=>{typed=text;};
  m.tap=async(s,node)=>{if(node['resource-id']===id('layout_comment_thread_post_button_icon')){clicks++;throw new Error('tap timeout');}};
  m.logScreen=pause;
  const job={logs:[],sent:0}, a={...entry,comments:3,sent:0};
  assert.equal(await m.sendComment(job,a,'quota','New comment'),'uncertain');
  assert.equal(clicks,1); assert.equal(job.sent,0); assert.equal(m.countFor('quota'),1);
  assert.equal(m.state.history[0].phase,'checked'); assert.equal(a.pending,1);
});
test('stale posting/failure banners block a new send before any tap or reservation', async () => {
  for (const text of ['Memposting…','Gagal memposting']) {
    const m=manager();m.ui=async()=>[composer,{text}];m.tap=async()=>assert.fail('must not tap');
    await assert.rejects(m.sendComment({logs:[]}, {...entry,comments:1}, 'key','New comment'),NetworkError);
    assert.equal(m.state.history.length,0);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { InstagramManager } from '../server/instagram.mjs';
import { logoutConfirmation } from '../server/instagram-logout.mjs';

test('logout confirmation requires the exact account and rejects all-account or selection dialogs', () => {
  const button = {text:'Log out'};
  assert.equal(logoutConfirmation([{text:'Log out of example.one?'},button],'example.one'),button);
  assert.equal(logoutConfirmation([{text:'Log out of example.one.extra?'},button],'example.one'),null);
  assert.equal(logoutConfirmation([{text:'Log out?'},button],'example.one'),null);
  assert.equal(logoutConfirmation([{text:'Log out all accounts example.one'},button],'example.one'),null);
  assert.equal(logoutConfirmation([{text:'example.one',checkable:'true',checked:'true'},button],'example.one'),null);
});

test('generic native logout requires a verified matching profile and the complete known dialog', () => {
  const headline = {text:'Log out of your account?', 'resource-id':'com.instagram.android:id/igds_headline_headline'};
  const confirm = {text:'Log out', 'resource-id':'com.instagram.android:id/primary_button'};
  const cancel = {text:'Cancel', 'resource-id':'com.instagram.android:id/negative_button'};
  const nodes = [headline, confirm, cancel];
  assert.equal(logoutConfirmation(nodes,'example.one'),null);
  assert.equal(logoutConfirmation(nodes,'example.one','example.two'),null);
  assert.equal(logoutConfirmation(nodes,'example.one','example.one'),confirm);
  assert.equal(logoutConfirmation([headline,confirm],'example.one','example.one'),null);
  assert.equal(logoutConfirmation([...nodes,{text:'Log out all accounts'}],'example.one','example.one'),null);
  assert.equal(logoutConfirmation([...nodes,{checkable:'true'}],'example.one','example.one'),null);
});
function fixture() {
  const m = new InstagramManager({statePath:'/unused',devices:()=>[{serial:'phone',status:'device'},{serial:'other',status:'device'}]});
  m.state.devices = [{serial:'phone',name:'Samsung test',current:'example.one',complete:true,accounts:[{username:'example.one'},{username:'example.two'}]}, {serial:'other',name:'Other',accounts:[{username:'example.one'}]}];
  m.state.plans = {'phone:example.one':{target:'target'},'other:example.one':{target:'other'}};
  m.save=async()=>{};m.stayAwake=()=>()=>{};
  m.logout.navigate=async()=>{};
  return m;
}
test('logout only removes the selected phone entry after a complete scan confirms absence', async () => {
  const m=fixture();let scanned=0;
  m.accountSheet=async(serial,desired)=>{assert.equal(serial,'phone');if(desired){assert.equal(desired,'example.one');return;}return ++scanned===1?{complete:true,current:'example.one',accounts:[{username:'example.one'},{username:'example.two'}]}:{complete:true,current:'example.two',accounts:[{username:'example.two'}]};};
  m.logout.start({serial:'phone',username:'example.one'});await m.logout.task;
  assert.equal(m.logout.job.status,'success');assert.deepEqual(m.state.devices[0].accounts,[{username:'example.two'}]);
  assert.deepEqual(m.state.devices[1].accounts,[{username:'example.one'}]);assert.equal(m.state.plans['phone:example.one'],undefined);assert.ok(m.state.plans['other:example.one']);assert.equal(m.locks.size,0);
});
test('wrong identity, incomplete inventory and unchanged sessions never report successful logout', async () => {
  for(const scenario of ['wrong','incomplete','unchanged','other-missing']){
    const m=fixture();let scanned=0,navigated=0;m.logout.navigate=async()=>{navigated++;};
    m.accountSheet=async(_,desired)=>{if(desired){if(scenario==='wrong')throw Error('Wrong active account');return;}scanned++;return {complete:scenario!=='incomplete',current:'example.one',accounts:scenario==='other-missing'&&scanned>1?[]:[{username:'example.one'},{username:'example.two'}]};};
    m.logout.start({serial:'phone',username:'example.one'});await m.logout.task;
    assert.equal(m.logout.job.status,'failed',scenario);assert.equal(m.locks.size,0);
    if(['wrong','incomplete'].includes(scenario))assert.equal(navigated,0);
    assert.ok(m.state.plans['phone:example.one']);
  }
});

test('logout compares the original profile inventory when linked profile lists differ', async () => {
  const m=fixture();let active='example.two';let removed=false;const calls=[];
  m.accountSheet=async(_,desired)=>{
    calls.push(desired || `scan:${active}`);
    if(desired){active=desired;return {current:active};}
    return {complete:true,current:active,accounts:(active==='example.one'?['example.one','linked.only']:removed?['example.two']:['example.two','example.one']).map(username=>({username}))};
  };
  m.logout.navigate=async()=>{assert.equal(active,'example.one');removed=true;active='linked.only';};
  m.logout.start({serial:'phone',username:'example.one'});await m.logout.task;
  assert.equal(m.logout.job.status,'success');
  assert.deepEqual(calls,['scan:example.two','example.one','scan:linked.only','example.two','scan:example.two']);
  assert.deepEqual(m.logout.job.verification.before,['example.two','example.one']);
  assert.deepEqual(m.logout.job.verification.after,['example.two']);
});
test('busy, offline, unknown and pending verification phones are rejected before navigating', () => {
  for(const setup of [m=>m.locks.add('phone'),m=>m.devices=()=>[],m=>m.state.devices=[],m=>m.state.loginAttention={phone:{username:'pending'}}]){
    const m=fixture();setup(m);assert.throws(()=>m.logout.start({serial:'phone',username:'example.one'}));assert.equal(m.logout.job,null);
  }
});
test('transport failures retain account inventory and release the device lock', async()=>{
  const m=fixture();m.accountSheet=async()=>{throw Error('HP terputus');};m.logout.start({serial:'phone',username:'example.one'});await m.logout.task;
  assert.equal(m.logout.job.status,'failed');assert.equal(m.state.devices[0].accounts.length,2);assert.equal(m.state.devices[0].complete,false);assert.equal(m.locks.size,0);
});
test('duplicate cleanup holds logout if selecting the target changes the visible account inventory',async()=>{
 const m=fixture();let selected=false,navigated=false;
 m.accountSheet=async(_,desired)=>{if(desired){selected=true;return {current:desired};}return {complete:true,current:'example.one',accounts:[{username:'example.one'},{username:'example.two'},...(selected?[{username:'linked.extra'}]:[])]};};
 m.logout.navigate=async()=>{navigated=true;};
 m.logout.start({serial:'phone',username:'example.one'},{forDuplicates:true});await m.logout.task;
 assert.equal(navigated,false);assert.equal(m.logout.job.status,'failed');assert.match(m.logout.job.note,/profil aktif diganti/);
});

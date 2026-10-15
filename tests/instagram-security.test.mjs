import test from 'node:test';
import assert from 'node:assert/strict';
import { instagramChallengeActive, instagramChallengeError } from '../server/instagram-security.mjs';
import { InstagramManager } from '../server/instagram.mjs';
test('security challenge detection uses foreground activity, not historical stack entries',()=>{
 const component='com.instagram.android/com.instagram.challenge.activity.ChallengeActivity';
 for(const prefix of ['topResumedActivity','mResumedActivity','mFocusedApp'])assert.equal(instagramChallengeActive(`  ${prefix}=ActivityRecord{a u0 ${component} t177}`),true);
 assert.equal(instagramChallengeActive(`Hist #1: ActivityRecord{a u0 ${component} t177}\ntopResumedActivity=ActivityRecord{b u0 com.instagram.android/.MainActivity t177}`),false);
});
test('blank challenge is held before any Back or profile tap',async()=>{
 const m=new InstagramManager({statePath:'/unused',devices:()=>[]});m.ui=async()=>[];m.assertNoChallenge=async()=>{throw instagramChallengeError();};m.back=m.tap=async()=>assert.fail('Security challenge must remain untouched');
 await assert.rejects(m.waitForOwnProfile('phone'),{code:'IG_AUTH_CHALLENGE'});
});
test('logout security challenge records needs_action and prevents automatic repeat',async()=>{
 const m=new InstagramManager({statePath:'/unused',devices:()=>[{serial:'phone',status:'device'}]});m.state.devices=[{serial:'phone',name:'HP',accounts:[{username:'target'}]}];m.save=async()=>{};m.stayAwake=()=>()=>{};
 m.accountSheet=async()=>{throw instagramChallengeError();};m.logout.start({serial:'phone',username:'target'});await m.logout.task;
 assert.equal(m.logout.job.status,'needs_action');assert.equal(m.state.loginAttention.phone.username,'target');assert.equal(m.locks.size,0);
 assert.throws(()=>m.logout.start({serial:'phone',username:'target'}),/tertunda/);
});

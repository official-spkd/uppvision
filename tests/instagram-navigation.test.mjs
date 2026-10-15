import test from 'node:test';
import assert from 'node:assert/strict';
import { InstagramManager } from '../server/instagram.mjs';
const profile = { 'resource-id': 'com.instagram.android:id/profile_tab', package: 'com.instagram.android' };
const title = { 'resource-id': 'com.instagram.android:id/action_bar_title', text: 'expected.account', package: 'com.instagram.android' };
test('account switching waits through blank activity without dismissing Instagram', async () => {
 const m=new InstagramManager({statePath:'/unused',devices:()=>[]});m.assertNoChallenge=async()=>{};let back=0,taps=0,waits=0;
 const screens=[[],[{package:'com.instagram.android',class:'android.widget.ProgressBar'}],[profile],[profile,title]];
 m.ui=async()=>screens.shift();m.back=async()=>{back++;};m.tap=async()=>{taps++;};m.wait=async()=>{waits++;};
 const p=await m.waitForOwnProfile('phone');assert.equal(p.current,'expected.account');assert.equal(back,0);assert.equal(taps,1);assert.equal(waits,2);
});
test('blank activity times out without sending repeated Back to the phone',async()=>{
 const m=new InstagramManager({statePath:'/unused',devices:()=>[]});m.assertNoChallenge=async()=>{};m.ui=async()=>[];m.back=async()=>assert.fail('No Back while blank');m.wait=async()=>{};
 await assert.rejects(m.waitForOwnProfile('phone'),/Profil Instagram belum/);
});

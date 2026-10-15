import test from 'node:test';
import assert from 'node:assert/strict';
import {instagramTargets,effectivePostCount,validCommentSettings,targetLabel} from '../src/instagram-target.mjs';
import {validatePlan} from '../server/instagram-core.mjs';
import {InstagramManager} from '../server/instagram.mjs';
const a='https://www.instagram.com/p/Post_A1/';const b='https://www.instagram.com/reel/Post_B2/';
const account={serial:'phone1',username:'account.one',target:`${a}\n${b}`,posts:2,comments:3,tone:'positif'};
test('multiline input ignores blank lines, deduplicates shortcode across routes, and preserves first occurrence order',()=>{
 const p=instagramTargets(`\n${a}?tracking=x\r\n\n${b}\nhttps://instagram.com/reel/Post_A1/`);
 assert.deepEqual(p.targets.map(p=>p.target),[a,b]);assert.equal(p.target,`${a}\n${b}`);
 assert.equal(effectivePostCount({...account,posts:40}),2);assert.equal(targetLabel(account.target),'2 link postingan');
 assert.equal(validatePlan({accounts:[{...account,posts:40}]},[{serial:'phone1',accounts:[{username:'account.one'}]}]).accounts[0].posts,2);
});
test('20 distinct links are accepted; 21, mixed usernames and invalid lines are rejected with useful errors',()=>{
 const links=Array.from({length:21},(_,i)=>`https://www.instagram.com/p/Code_${i}/`);
 assert.equal(instagramTargets(links.slice(0,20).join('\n')).targets.length,20);
 assert.throws(()=>instagramTargets(links.join('\n')),/20 link/);
 assert.throws(()=>instagramTargets(`${a}\n\nhttps://evil.test/p/Other1/`),/Baris 3/);
 assert.throws(()=>instagramTargets(`${a}\nusername`),/Baris 2/);
 assert.equal(validCommentSettings(account),true);assert.equal(validCommentSettings(account,'tt'),false);
});
test('all links are locked before activity and resume retains their exact order',async()=>{
 const m=new InstagramManager({statePath:'/unused',devices:()=>[]});m.log=()=>{};
 const {posts}=await m.lockPosts({logs:[]},account,{});
 assert.deepEqual(posts.map(p=>p.url),[a,b]);assert.ok(Object.isFrozen(posts));assert.ok(posts.every(Object.isFrozen));
 m.save=async()=>{};await m.rememberLockedJob({id:'saved',accounts:[{...account,lockedPosts:posts}]});
 assert.deepEqual(m.resumeFor({resumeJobId:'saved'},{accounts:[account]}).accounts[0].lockedPosts,posts);
});
test('preview reads every link in order, selects account once, and never likes or sends',async()=>{
 const m=new InstagramManager({statePath:'/unused',devices:()=>[]});let selections=0;const opened=[];
 m.prepareDevice=async()=>{};m.accountSheet=async()=>{selections++;};m.log=()=>{};m.readScreen=async()=>'';m.back=async()=>{};
 m.openPost=async(serial,user,target,ref)=>{opened.push(ref.url);return {owner:'target.one',nodes:[],caption:'Caption',fingerprint:ref.shortcode};};
 m.openThread=async()=>({loaded:true,complete:true,mine:[],others:[],caption:'Caption'});
 m.generate=async()=>({comments:['Draft'],suasana:'berita',tone:'positif'});
 m.likePost=m.sendComment=async()=>assert.fail('read-only preview');
 const result=await m.inspect({logs:[]},account);assert.equal(result.ok,true);assert.equal(result.posts.length,2);assert.deepEqual(opened,[a,b]);assert.equal(selections,1);
});

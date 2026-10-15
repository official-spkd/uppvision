import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLogin, loginCandidates, loginFields, loginProblem, loggedOutScreen, loggedOutDialog, loginNavigation, savedPasswordPrompt, saveLoginDismiss } from '../server/instagram-login-core.mjs';
import { InstagramLogin, credentialCommands } from '../server/instagram-login.mjs';
import { InstagramManager } from '../server/instagram.mjs';
import { switcherAccounts } from '../server/instagram-core.mjs';

const phone = (serial, count, extra = {}) => ({ serial, name: serial, complete: true, error: null, accounts: Array.from({ length: count }, (_, i) => ({ username: `${serial}_${i}` })), ...extra });
test('allocation prioritizes empty and least occupied verified online physical phones', () => {
  const inventory = [phone('full', 8), phone('small', 2), phone('empty', 0), phone('unknown', 0, { error: 'failed' }), phone('partial', 0, { complete: false }), phone('offline', 0), phone('emulator-1', 0)];
  const live = inventory.filter(d => d.serial !== 'offline').map(d => ({ ...d, status: 'device' }));
  assert.deepEqual(loginCandidates(inventory, live).map(d => d.serial), ['empty', 'small', 'full']);
  assert.deepEqual(loginCandidates(inventory, live, new Set(['empty'])).map(d => d.serial), ['small', 'full']);
});
test('validation rejects malformed credentials, duplicates and unsupported input without revealing values', () => {
  assert.deepEqual(validateLogin({ accounts: [{ username: '@Name.one', password: 'demo$%s! \'"' }] })[0].username, 'name.one');
  for (const accounts of [[], [null], [{ username: 'good', password: '' }], [{ username: 'good', password: '秘密' }], [{ username: 'a', password: 'x' }, { username: '@A', password: 'x' }]]) assert.throws(() => validateLogin({ accounts }));
  assert.equal(credentialCommands('a%sb$`c'), "input text 'a'\ninput text '%'\ninput text 'sb$`c'\n");
});
test('login screen recognizes native and accessible fields but not an add-account sheet as logged out', () => {
  const nodes = [{ class: 'android.widget.EditText', 'content-desc': 'Username, email or mobile number' }, { class: 'android.widget.EditText', password: 'true' }];
  assert.equal(loginFields(nodes).user, nodes[0]); assert.equal(loginFields(nodes).password, nodes[1]);
  assert.equal(loggedOutScreen(nodes), true);
  assert.equal(loggedOutScreen([{ 'content-desc': 'Dismiss' }, { text: 'Log in' }]), false);
  assert.equal(loggedOutScreen([{ 'resource-id': 'com.instagram.android:id/profile_tab' }, { text: 'Log in' }]), false);
});
test('challenge and bad password outcomes do not contain raw screen data', () => {
  assert.equal(loginProblem([{ text: 'Enter your security code' }]).status, 'needs_action');
  assert.match(loginProblem([{ text: 'Enter the characters you see' }]).note, /CAPTCHA/);
  assert.match(loginProblem([{ text: 'Recover your account' }]).note, /pemulihan/);
  assert.equal(loginProblem([{ text: 'Recover your account' }]).recoverable, true);
  assert.equal(loginProblem([{ text: 'Check your notifications on another device' }]).recoverable, undefined);
  assert.equal(loginProblem([{ text: 'Choose a way to confirm your account' }]).status, 'needs_action');
  assert.equal(loginProblem([{ text: 'We couldn’t find an account that matches what you entered, but found one that closely matches.' }]).status, 'failed');
  assert.equal(loginProblem([{ text: "Can't find account" }]).status, 'failed');
  assert.equal(loginProblem([{ text: 'Reactivate example? This account is scheduled to be deleted.' }]).status, 'needs_action');
  const result = loginProblem([{ text: 'Incorrect password: SECRET' }]);
  assert.equal(result.status, 'failed'); assert.ok(!JSON.stringify(result).includes('SECRET'));
});
test('Meta saved-profile chooser opens another profile and never creates a new account', () => {
  const create = { 'content-desc': 'Create new account' }, another = { 'content-desc': 'Use another profile', class: 'android.widget.Button' };
  assert.equal(loginNavigation([create, { text: 'saved.profile' }, another]), another);
  assert.equal(loginNavigation([create]), undefined);
  assert.equal(loginNavigation([{ 'content-desc': 'Add Instagram' }])['content-desc'], 'Add Instagram');
});
test('Google saved-password overlay is dismissed without choosing another account', () => {
  assert.equal(savedPasswordPrompt([{text:'Sign in to Instagram with your saved password?'},{text:'Cancel'},{text:'Sign in'}]), true);
  assert.equal(savedPasswordPrompt([{text:'Enter your security code'},{text:'Cancel'}]), false);
});
test('OCR fallback only declines a confident save-login dialog for the expected account', () => {
  const nodes=[{text:'Save your login info?',bounds:'[40,300][1040,370]',confidence:1},{text:'Save login info for example.account to your device',bounds:'[40,430][1040,590]',confidence:1},{text:'Save',bounds:'[430,1430][650,1500]',confidence:1},{text:'Not now',bounds:'[390,1590][690,1660]',confidence:1}];
  const frame={width:1080,height:1920,nodes};
  assert.equal(saveLoginDismiss(frame,'example.account'),nodes[3]);
  assert.equal(saveLoginDismiss(frame,'example'),null);
  assert.equal(saveLoginDismiss({...frame,nodes:nodes.slice(1)},'example.account'),null);
  assert.equal(saveLoginDismiss({...frame,nodes:nodes.map(n=>({...n,confidence:.5}))},'example.account'),null);
  assert.equal(saveLoginDismiss({...frame,nodes:[...nodes,{text:'Enter your security code',confidence:1}]},'example.account'),null);
});

function mockManager(inventory) {
  const m = { state: { devices: inventory }, locks: new Set(), devices: () => inventory.map(d => ({ ...d, status: 'device' })),
    scanAccounts: async () => {}, snapshot: () => ({ loginJob: m.login.snapshot() }), stayAwake: () => () => {}, save: async () => {}, ensurePhoneInternet: async () => true,
    locked: async (serial, operation) => { assert.ok(!m.locks.has(serial)); m.locks.add(serial); try { return await operation(); } finally { m.locks.delete(serial); } },
    accountSheet: async serial => ({ ...inventory.find(d => d.serial === serial), complete: true }),
  };
  m.login = new InstagramLogin(m); return m;
}
test('batch rebalances after each login, skips existing accounts and never exposes passwords', async () => {
  const m = mockManager([phone('a', 0), phone('b', 1)]), selected = [];
  m.login.loginOne = async (serial, credential) => { selected.push(serial); return { status: 'success', note: 'Verified' }; };
  const result = m.login.start({ accounts: ['first', 'second', 'third', 'first_again'].map(username => ({ username, password: 'TOP_SECRET' })) });
  assert.ok(!JSON.stringify(result).includes('TOP_SECRET'));
  await m.login.task;
  assert.deepEqual(selected, ['a', 'a', 'b', 'a']);
  assert.equal(m.login.job.status, 'completed'); assert.equal(m.locks.size, 0);
  m.login.start({ accounts: [{ username: 'first', password: 'ANOTHER_SECRET' }] }); await m.login.task;
  assert.equal(m.login.job.accounts[0].status, 'already'); assert.equal(selected.length, 4);
  assert.ok(!JSON.stringify(m.login.snapshot()).includes('password'));
});
test('failed device is excluded, errors are sanitized, and stop clears queued credentials', async () => {
  const m = mockManager([phone('a', 0), phone('b', 0)]), selected = [];
  m.login.loginOne = async (serial, credential) => { selected.push(serial); throw new Error(credential.password); };
  m.login.start({ accounts: ['first', 'second'].map(username => ({ username, password: 'SECRET_FAILURE' })) }); await m.login.task;
  assert.deepEqual(selected, ['a', 'b']); assert.equal(m.login.job.status, 'partial');
  assert.ok(!JSON.stringify(m.login.snapshot()).includes('SECRET_FAILURE'));
  let finishScan; m.scanAccounts = () => new Promise(resolve => { finishScan = resolve; });
  m.login.start({ accounts: [{ username: 'third', password: 'SECRET' }] }); m.login.stop(); finishScan(); await m.login.task;
  assert.equal(m.login.job.status, 'stopped'); assert.equal(m.login.job.accounts[0].status, 'stopped'); assert.equal(m.abortRequested, false);
});
test('login blocks comment/preview/scan until it finishes', async () => {
  const m = new InstagramManager({ statePath: '/unused', devices: () => [] }); m.login = { busy: true };
  assert.throws(() => m.start({}), /proses Instagram/);
  await assert.rejects(m.scanAccounts(), /Auto login/);
});
test('an existing switcher entry is not reported as usable when profile verification fails', async () => {
  const m = mockManager([phone('a', 1)]);
  m.accountSheet = async () => { throw new Error('session expired'); };
  m.login.loginOne = async () => { assert.fail('existing account must not be logged into another HP'); };
  m.login.start({ accounts: [{ username: 'a_0', password: 'SECRET' }] }); await m.login.task;
  assert.equal(m.login.job.accounts[0].status, 'needs_action');
  assert.equal(m.login.job.status, 'partial'); assert.equal(m.state.lastLogin.accounts[0].username, 'a_0');
  assert.ok(!JSON.stringify(m.state).includes('SECRET'));
});
test('existing accounts on an excluded phone are never duplicated on another phone', async () => {
  const m = mockManager([phone('a', 2), phone('b', 0)]);
  m.accountSheet = async () => { throw new Error('verification required'); };
  m.login.loginOne = async () => assert.fail('existing account must not be added elsewhere');
  m.login.start({ accounts: ['a_0', 'a_1'].map(username => ({ username, password: 'example' })) });
  await m.login.task;
  assert.deepEqual(m.login.job.accounts.map(a => a.status), ['needs_action', 'needs_action']);
  assert.deepEqual(m.login.job.accounts.map(a => a.serial), ['a', 'a']);
});
test('verifying an existing profile refreshes its count before allocating a new account', async () => {
  const inventory=[phone('a',3),phone('b',4)],m=mockManager(inventory),selected=[];
  m.accountSheet=async(serial,desired)=>serial==='a'&&!desired?phone('a',6):{...inventory.find(d=>d.serial===serial),complete:true};
  m.login.loginOne=async serial=>{selected.push(serial);return {status:'success',note:'Verified'};};
  m.login.start({accounts:['a_0','new_account'].map(username=>({username,password:'example'}))});await m.login.task;
  assert.deepEqual(selected,['b']);
  assert.equal(m.state.devices[0].accounts.length,6);
  assert.equal(m.login.job.accounts[0].status,'already');
});
test('a rejected password does not consume a healthy phone for the whole batch', async () => {
  const m = mockManager([phone('a', 0)]); let calls = 0;
  m.login.loginOne = async () => ++calls === 1 ? { status: 'failed', note: 'Password ditolak.' } : { status: 'success', note: 'Verified' };
  m.login.start({ accounts: ['first', 'second'].map(username => ({ username, password: 'example' })) }); await m.login.task;
  assert.deepEqual(m.login.job.accounts.map(a => a.status), ['failed', 'success']);
  assert.equal(calls, 2);
});
test('an account recovery notice is recorded while the old phone sessions remain reusable', async () => {
  const m=mockManager([phone('a',0)]);let calls=0;
  m.login.loginOne=async()=>++calls===1?loginProblem([{text:'Recover your account'}]):{status:'success',note:'Verified'};
  m.login.start({accounts:['first','second'].map(username=>({username,password:'example'}))});await m.login.task;
  assert.deepEqual(m.login.job.accounts.map(a=>a.status),['needs_action','success']);
  assert.equal(m.state.loginAttention,undefined);
});
test('a complete approved batch fits the maximum while excessive batches are rejected', () => {
  const accounts = Array.from({length: 100}, (_, i) => ({username: `example_${i}`,password:'example'}));
  assert.equal(validateLogin({accounts}).length, 100);
  assert.throws(() => validateLogin({accounts:[...accounts,{username:'extra',password:'example'}]}));
});
test('a repeated half-open account sheet is not mistaken for the end of the list', async () => {
  const row = name => ({ 'content-desc': name, clickable: 'true', bounds: '[48,700][1032,900]', children: [{text:name,children:[]}] });
  const first = [row('first')], last = [row('second'),{text:'Add Instagram'}];
  let page = 0;
  const m = new InstagramManager({statePath:'/unused',devices:()=>[]});
  m.ownProfile = async () => ({current:'first',title:{}});
  m.tap = m.back = async () => {};
  m.settledSheet = async () => first;
  m.ui = async () => page < 3 ? first : last;
  m.swipe = async () => { page++; };
  const result = await m.accountSheet('example');
  assert.deepEqual(result.accounts.map(a=>a.username), ['first','second']);
  assert.equal(result.complete,true);
  assert.equal(page,3);
});
test('Meta services beneath Instagram do not inflate the phone account count', () => {
  const row = (name,service='') => ({'content-desc':`${name}${service ? `, ${service} account` : ''}`,clickable:'true',children:[{text:name,children:[]}]});
  assert.deepEqual(switcherAccounts([row('ig_account'),row('threads_only','THREADS'),row('facebook_only','FACEBOOK')]).map(a=>a.username),['ig_account']);
});
test('Accounts Center footer completes the inventory only after scrolling stops there', async () => {
  const row = name => ({ 'content-desc': name, clickable: 'true', bounds: '[48,700][1032,900]', children: [{text:name,children:[]}] });
  const footer = {text:'Go to Accounts Center',bounds:'[289,1525][790,1582]'};
  let page = 0;
  const m = new InstagramManager({statePath:'/unused',devices:()=>[]});
  m.ownProfile = async () => ({current:'first',title:{}});
  m.tap = m.back = async () => {};
  m.settledSheet = async () => [row('first'),footer];
  m.ui = async () => [row(page < 2 ? 'middle' : 'last'),footer];
  m.swipe = async () => { page++; };
  const result = await m.accountSheet('example');
  assert.deepEqual(result.accounts.map(a=>a.username), ['first','middle','last']);
  assert.equal(result.complete,true);
  assert.equal(page,4);
});
test('subsequent login batches preserve devices waiting for verification', async () => {
  const inventory = [phone('blocked',0),phone('ready',1)],m=mockManager(inventory);
  m.state.loginAttention = {blocked:{username:'pending',note:'Verification required'}};
  const selected=[];
  m.login.loginOne = async serial => {selected.push(serial);return {status:'success',note:'Verified'};};
  m.login.start({accounts:[{username:'next',password:'example'}]});await m.login.task;
  assert.deepEqual(selected,['ready']);
  const scanner = new InstagramManager({statePath:'/unused',devices:()=>[{serial:'blocked',name:'blocked',status:'device'}]});
  scanner.state.devices=inventory; scanner.state.loginAttention=m.state.loginAttention;
  scanner.openLog=scanner.save=async()=>{};scanner.log=()=>{};
  scanner.prepareDevice=async()=>assert.fail('pending verification must remain untouched');
  await scanner.scanAccounts({forLogin:true});
  assert.equal(scanner.state.devices.find(d=>d.serial==='blocked'),inventory[0]);
});
const id = suffix => `com.instagram.android:id/${suffix}`;
// Dialog "Error: You've been logged out of <akun>", disalin dari dump asli Samsung 04.
const loggedOutNodes = (name = 'tv.nalarberita') => [
  { 'resource-id': id('dialog_container'), bounds: '[150,591][930,1270]' },
  { 'resource-id': id('igds_headline_headline'), text: 'Error', bounds: '[246,687][834,766]' },
  { 'resource-id': id('igds_headline_body'), text: `You've been logged out of ${name}. The account owner may have changed the password.`, bounds: '[246,790][834,981]' },
  { 'resource-id': id('primary_button_row'), clickable: 'true', bounds: '[150,1126][930,1270]' },
  { 'resource-id': id('primary_button'), text: 'OK', clickable: 'true', bounds: '[210,1126][870,1270]' },
];
test('the logged-out dialog is recognised with the account it names, and other dialogs are not', () => {
  const notice = loggedOutDialog(loggedOutNodes());
  assert.equal(notice.username, 'tv.nalarberita');
  assert.equal(notice.dismiss.text, 'OK');
  assert.equal(loggedOutDialog(loggedOutNodes('akun.contoh94')).username, 'akun.contoh94');
  // Dialog lain dengan bentuk serupa tidak boleh dianggap pemberitahuan keluar.
  assert.equal(loggedOutDialog([{ 'resource-id': id('igds_headline_body'), text: 'Your followers might see this' }]), null);
  assert.equal(loggedOutDialog([]), null);
});
test('one logged-out account does not stop the other accounts on the same phone', async () => {
  const manager = new InstagramManager({ statePath: '/unused', devices: () => [{ serial: 'phone1', status: 'device' }] });
  const taps = [];
  const profileScreen = [
    { 'resource-id': id('profile_tab'), 'content-desc': 'Profile', bounds: '[972,1704][1080,1776]' },
    { 'resource-id': id('action_bar_title'), text: 'account.one', bounds: '[0,0][200,80]' },
  ];
  const screens = [loggedOutNodes('account.one'), profileScreen, profileScreen];
  manager.actionPause = async () => {};
  manager.assertNoChallenge = async () => {};
  manager.tap = async (serial, node) => { taps.push(node); };
  manager.back = async () => {};
  manager.ui = async () => screens.length > 1 ? screens.shift() : screens[0];
  const profile = await manager.waitForOwnProfile('phone1');
  assert.equal(profile.current, 'account.one', 'HP tetap bisa dibaca setelah dialog ditutup');
  assert.equal(taps[0].text, 'OK', 'hanya tombol OK pada dialog yang diketuk');
  // Dialog yang muncul terus bukan alasan mengulang tanpa henti.
  const stuck = new InstagramManager({ statePath: '/unused', devices: () => [{ serial: 'phone1', status: 'device' }] });
  stuck.actionPause = async () => {};
  stuck.assertNoChallenge = async () => {};
  stuck.tap = async () => {};
  stuck.back = async () => {};
  stuck.ui = async () => loggedOutNodes('account.one');
  await assert.rejects(stuck.waitForOwnProfile('phone1'), /berulang kali/);
});

'use strict';
/** Chats: direct messages between members, live updates, privacy between participants, and the help chat with staff. */
process.env.NODE_ENV = 'test';
process.env.PHOTOS_ENABLED = 'false';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-campusfind';
process.env.FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT;
process.env.FIREBASE_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || `${process.env.GCLOUD_PROJECT}.appspot.com`;
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.ADMIN_EMAIL = 'chat-root@campus.test';
process.env.ADMIN_PASSWORD = 'Quartz-Lantern-Meadow-71';
process.env.GLOBAL_LIMIT_PER_MIN = '100000';
process.env.REGISTER_LIMIT_PER_HOUR = '500';
process.env.LOGIN_LIMIT_PER_15_MIN = '500';
process.env.MESSAGES_PER_MIN = process.env.MESSAGES_PER_MIN || '200';

const test = require('node:test');
const assert = require('node:assert/strict');
const { init } = require('../src/bootstrap');
const { createApp } = require('../src/app');
const users = require('../src/repo/users');
const { col } = require('../src/store');

let server; let base;
const RUN = Date.now().toString(36);
const PW = 'Meadow-Lantern-Quartz-7';

class Client {
  constructor() { this.jar = new Map(); }
  async req(method, url, { form } = {}) {
    const h = {};
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let body;
    if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    const res = await fetch(base + url, { method, headers: h, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    res.text = await res.text();
    return res;
  }
  get(u) { return this.req('GET', u); }
  async json(u) { const r = await this.get(u); return { status: r.status, data: r.status === 200 ? JSON.parse(r.text) : null }; }
  async token(u) { return /name="_csrf" value="([^"]+)"/.exec((await this.get(u)).text)[1]; }
  async post(u, form, from = '/pricing') { return this.req('POST', u, { form: { _csrf: await this.token(from), ...form } }); }
}

async function member(name, tag) {
  const c = new Client();
  const email = `${tag}.${RUN}@campus.test`;
  const r = await c.post('/register', { name, email, password: PW, agree: '1', dob: '1998-05-14' }, '/register');
  assert.equal(r.status, 302, `register ${email}`);
  return { c, user: await users.getByEmail(email) };
}
const STAFF = { email: `helpdesk.${RUN}@campus.test`, password: 'Quartz-Lantern-Meadow-63' };
let staffReady = false;
async function staff() {
  if (!staffReady) {
    await require('../src/services/auth').createAccount({ name: 'Akua Helpdesk', email: STAFF.email, password: STAFF.password, role: 'moderator' });
    staffReady = true;
  }
  const c = new Client();
  const r = await c.post('/admin/login', { email: STAFF.email, password: STAFF.password, next: '/admin' }, '/admin/login');
  assert.equal(r.status, 302, 'staff login');
  return { c, user: await users.getByEmail(STAFF.email) };
}

test.before(async () => {
  await init();
  await new Promise((resolve) => { server = createApp().listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); setTimeout(() => process.exit(0), 200).unref(); });

test('direct chat: message a member from their profile, reply, and see it in both inboxes', async () => {
  const a = await member('Abena Owusu', 'dm-a');
  const b = await member('Kojo Asante', 'dm-b');
  const profile = await a.c.get(`/users/${b.user.user_id}`);
  assert.match(profile.text, /Message Kojo/);

  const sent = await a.c.post(`/users/${b.user.user_id}/message`, { body: 'Hi Kojo, are you selling the desk?' }, `/users/${b.user.user_id}`);
  assert.equal(sent.status, 302);
  const cid = /\/messages\/(dm-\d+-\d+)/.exec(sent.headers.get('location'))[1];
  const [lo, hi] = [a.user.user_id, b.user.user_id].sort((x, y) => x - y);
  assert.equal(cid, `dm-${lo}-${hi}`, 'one shared thread per pair of members');

  const inboxB = await b.c.get('/messages');
  assert.ok(inboxB.text.includes(`/messages/${cid}`), 'the recipient sees the chat');
  assert.match(inboxB.text, /Direct message/);
  const notes = (await col('notifications').where('user_id', '==', b.user.user_id).get()).docs.map((d) => d.data());
  assert.ok(notes.some((n) => n.link === `/messages/${cid}` && /New message from Abena/.test(n.title)));

  const reply = await b.c.post(`/messages/${cid}`, { body: 'Yes, still available.' }, `/messages/${cid}`);
  assert.equal(reply.status, 302);
  const thread = await a.c.get(`/messages/${cid}`);
  assert.match(thread.text, /Yes, still available\./);
  assert.match(thread.text, /data-chat-poll="\/messages\/dm-\d+-\d+\/updates"/);

  // writing again from the profile continues the same thread instead of opening a new one
  const again = await b.c.post(`/users/${a.user.user_id}/message`, { body: 'Come by Hall 3 at 4pm.' }, `/users/${a.user.user_id}`);
  assert.ok(again.headers.get('location').includes(cid));
});

test('live updates return only new messages, only to participants', async () => {
  const a = await member('Esi Mensah', 'live-a');
  const b = await member('Yaw Darko', 'live-b');
  const intruder = await member('Nosy Neighbour', 'live-c');
  const r = await a.c.post(`/users/${b.user.user_id}/message`, { body: 'First message' }, `/users/${b.user.user_id}`);
  const cid = /\/messages\/(dm-\d+-\d+)/.exec(r.headers.get('location'))[1];

  const first = await b.c.json(`/messages/${cid}/updates?since=0`);
  assert.equal(first.status, 200);
  assert.equal(first.data.messages.length, 1);
  assert.equal(first.data.messages[0].mine, false);
  const since = first.data.messages[0].at;

  await new Promise((res) => setTimeout(res, 5));
  await a.c.post(`/messages/${cid}`, { body: 'Second message' }, `/messages/${cid}`);
  const next = await b.c.json(`/messages/${cid}/updates?since=${since}`);
  assert.deepEqual(next.data.messages.map((m) => m.body), ['Second message']);
  const mine = await a.c.json(`/messages/${cid}/updates?since=${since}`);
  assert.equal(mine.data.messages[0].mine, true);

  // a third member can neither read nor poll the conversation, and is not told it exists
  assert.equal((await intruder.c.get(`/messages/${cid}`)).status, 404);
  assert.equal((await intruder.c.json(`/messages/${cid}/updates?since=0`)).status, 404);
  const post = await intruder.c.post(`/messages/${cid}`, { body: 'let me in' }, '/messages');
  assert.equal(post.status, 404);
  // signed-out visitors are sent to sign in
  assert.equal((await new Client().get(`/messages/${cid}/updates`)).status, 302);
});

test('chat safety: no self-messages, text is escaped, and empty messages are refused', async () => {
  const a = await member('Ama Boateng', 'safe-a');
  const b = await member('Kwesi Appiah', 'safe-b');
  const self = await a.c.post(`/users/${a.user.user_id}/message`, { body: 'hello me' }, `/users/${a.user.user_id}`);
  assert.ok(!/\/messages\/dm-/.test(self.headers.get('location') || ''));
  const r = await a.c.post(`/users/${b.user.user_id}/message`, { body: '<img src=x onerror=alert(1)> hi' }, `/users/${b.user.user_id}`);
  const cid = /\/messages\/(dm-\d+-\d+)/.exec(r.headers.get('location'))[1];
  const page = await b.c.get(`/messages/${cid}`);
  assert.ok(!page.text.includes('<img src=x'), 'message text is never rendered as HTML');
  assert.match(page.text, /&lt;img src=x/);
  const empty = await a.c.post(`/messages/${cid}`, { body: ' ' }, `/messages/${cid}`);
  assert.equal(empty.status, 302);
  const n = (await col('conversations').doc(cid).collection('messages').get()).size;
  assert.equal(n, 1, 'the empty message was not stored');
});

test('help chat: a member writes, gets an automatic reply, staff answer, the member is notified', async () => {
  const s = await staff(); // the team must exist before the member writes, so it can be notified
  const m = await member('Adwoa Nyarko', 'help-m');
  const helpPage = await m.c.get('/help?chat=1');
  assert.equal(helpPage.status, 200);
  assert.match(helpPage.text, /Chat with CampusFind Help/);
  assert.match(helpPage.text, /Common questions/);

  const sent = await m.c.post('/help', { body: 'I cannot upload a photo to my listing.' }, '/help');
  assert.equal(sent.status, 302);
  const after = await m.c.get('/help?chat=1');
  assert.match(after.text, /I cannot upload a photo to my listing\./);
  assert.match(after.text, /usually within one working day/, 'automatic first reply');

  const queue = await s.c.get('/admin/help');
  assert.equal(queue.status, 200);
  assert.ok(queue.text.includes(`/admin/help/${m.user.user_id}`));
  assert.match(queue.text, /Waiting for a reply/);
  const staffNotes = (await col('notifications').where('user_id', '==', s.user.user_id).get()).docs.map((d) => d.data());
  assert.ok(staffNotes.some((n) => n.link === `/admin/help/${m.user.user_id}`), 'the team is told a chat is waiting');

  const open = await s.c.get(`/admin/help/${m.user.user_id}`);
  assert.match(open.text, /I cannot upload a photo/);
  const ans = await s.c.post(`/admin/help/${m.user.user_id}`, { body: 'Photos must be JPG, PNG or WebP under 5 MB. Try again?' }, `/admin/help/${m.user.user_id}`);
  assert.equal(ans.status, 302);

  const upd = await m.c.json('/help/updates?since=0');
  const staffMsg = upd.data.messages.find((x) => /JPG, PNG or WebP/.test(x.body));
  assert.ok(staffMsg && !staffMsg.mine);
  assert.match(staffMsg.who, /Akua · CampusFind team/);
  const notes = (await col('notifications').where('user_id', '==', m.user.user_id).get()).docs.map((d) => d.data());
  assert.ok(notes.some((n) => n.link === '/help' && /replied/.test(n.title)));
  const audits = (await col('activity_logs').where('action', '==', 'support.reply').get()).docs.map((d) => d.data());
  assert.ok(audits.some((x) => Number(x.entity_id) === m.user.user_id), 'staff replies are audited');

  const queue2 = await s.c.get('/admin/help');
  const row = queue2.text.split('<li>').find((x) => x.includes(`/admin/help/${m.user.user_id}"`));
  assert.match(row, /Answered/, 'the chat leaves the waiting list once answered');
  assert.ok(!row.includes('thread--unread'));
});

test('help chat privacy: members cannot open staff pages or other people’s help chats', async () => {
  const m = await member('Fiifi Quaye', 'help-p');
  const other = await member('Efua Sarpong', 'help-q');
  await m.c.post('/help', { body: 'Private question about my account.' }, '/help');

  const denied = await other.c.get('/admin/help');
  assert.notEqual(denied.status, 200);
  assert.notEqual((await other.c.get(`/admin/help/${m.user.user_id}`)).status, 200);
  assert.notEqual((await other.c.json(`/admin/help/${m.user.user_id}/updates`)).status, 200);
  // the support thread id is not reachable through the member chat routes either
  const sid = `help-${m.user.user_id}`;
  assert.equal((await other.c.get(`/messages/${sid}`)).status, 404);
  const own = await m.c.get(`/messages/${sid}`);
  assert.equal(own.status, 302);
  assert.equal(own.headers.get('location'), '/help');
  // someone else's help page shows only their own (empty) chat
  const theirs = await other.c.get('/help?chat=1');
  assert.ok(!theirs.text.includes('Private question about my account.'));
  // signed-out visitors can read the help centre but not chat
  const anon = await new Client().get('/help?chat=1');
  assert.equal(anon.status, 200);
  assert.match(anon.text, /Sign in to chat with our team/);
});

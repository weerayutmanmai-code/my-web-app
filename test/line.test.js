import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifySignature, createLineClient } from '../src/line.js';
import { silentLogger } from './helpers.js';

test('verifySignature', () => {
  const body = Buffer.from('{"events":[]}');
  const sig = crypto.createHmac('sha256', 'secret').update(body).digest('base64');
  assert.equal(verifySignature('secret', body, sig), true);
  assert.equal(verifySignature('other', body, sig), false);
  assert.equal(verifySignature('secret', Buffer.from('{"events":[1]}'), sig), false);
  assert.equal(verifySignature('secret', body, undefined), false);
  assert.equal(verifySignature('secret', body, 'not-base64!!'), false);
});

function fakeFetch(response = { status: 200, body: '{}' }) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return new Response(response.body, { status: response.status, headers: response.headers });
  };
  fn.calls = calls;
  return fn;
}

test('reply/push เรียก API ถูก URL และใส่ token', async () => {
  const fetchImpl = fakeFetch();
  const line = createLineClient({ channelAccessToken: 'TOKEN', fetchImpl, logger: silentLogger });

  await line.reply('rt', { type: 'text', text: 'hi' });
  await line.push('U1', [{ type: 'text', text: 'a' }]);

  const [r, p] = fetchImpl.calls;
  assert.equal(r.url, 'https://api.line.me/v2/bot/message/reply');
  assert.equal(r.init.headers.Authorization, 'Bearer TOKEN');
  assert.deepEqual(JSON.parse(r.init.body), { replyToken: 'rt', messages: [{ type: 'text', text: 'hi' }] });
  assert.equal(p.url, 'https://api.line.me/v2/bot/message/push');
  assert.equal(JSON.parse(p.init.body).to, 'U1');
});

test('ส่งได้สูงสุด 5 ข้อความต่อครั้ง', async () => {
  const fetchImpl = fakeFetch();
  const line = createLineClient({ channelAccessToken: 'TOKEN', fetchImpl });
  await line.push('U1', Array.from({ length: 8 }, (_, i) => ({ type: 'text', text: String(i) })));
  assert.equal(JSON.parse(fetchImpl.calls[0].init.body).messages.length, 5);
});

test('LINE ตอบ error: โยน LineApiError พร้อมรายละเอียด', async () => {
  const fetchImpl = fakeFetch({
    status: 400,
    body: JSON.stringify({ message: 'The request body has 1 error(s)', details: [{ property: 'messages[0].text', message: 'may not be empty' }] }),
  });
  const line = createLineClient({ channelAccessToken: 'TOKEN', fetchImpl });
  await assert.rejects(line.push('U1', { type: 'text', text: '' }), (err) => {
    assert.equal(err.status, 400);
    assert.match(err.message, /may not be empty/);
    return true;
  });
});

test('ดาวน์โหลดรูปจาก api-data.line.me', async () => {
  const fetchImpl = fakeFetch({ status: 200, body: 'jpegbytes', headers: { 'content-type': 'image/jpeg' } });
  const line = createLineClient({ channelAccessToken: 'TOKEN', fetchImpl });
  const { buffer, contentType } = await line.getContent('123');
  assert.equal(fetchImpl.calls[0].url, 'https://api-data.line.me/v2/bot/message/123/content');
  assert.equal(buffer.toString(), 'jpegbytes');
  assert.equal(contentType, 'image/jpeg');
});

test('ไม่มี token = โหมดทดลอง ไม่ยิง API', async () => {
  const fetchImpl = fakeFetch();
  const line = createLineClient({ channelAccessToken: '', fetchImpl, logger: silentLogger });
  assert.equal(line.dryRun, true);
  await line.push('U1', { type: 'text', text: 'x' });
  assert.equal(await line.getProfile('U1'), null);
  assert.equal(fetchImpl.calls.length, 0);
});

import crypto from 'node:crypto';

const API = 'https://api.line.me/v2/bot';
const DATA_API = 'https://api-data.line.me/v2/bot';

/**
 * ตรวจว่า webhook มาจาก LINE จริง
 * x-line-signature = base64(HMAC-SHA256(channelSecret, rawBody))
 */
export function verifySignature(channelSecret, rawBody, signature) {
  if (!channelSecret || !signature || !Buffer.isBuffer(rawBody)) return false;
  const expected = crypto.createHmac('sha256', channelSecret).update(rawBody).digest();
  const given = Buffer.from(String(signature), 'base64');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

export class LineApiError extends Error {
  constructor(status, body) {
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      detail = [parsed.message, ...(parsed.details ?? []).map((d) => `${d.property}: ${d.message}`)]
        .filter(Boolean)
        .join('; ');
    } catch {
      // body ไม่ใช่ JSON ใช้ข้อความดิบ
    }
    super(`LINE API ${status}${detail ? `: ${detail}` : ''}`);
    this.status = status;
  }
}

const summarize = (messages) =>
  messages.map((m) => (m.type === 'text' ? m.text : `[${m.type}] ${m.altText ?? ''}`)).join(' | ');

/**
 * ตัวเรียก LINE Messaging API แบบบางที่สุด (ใช้ fetch ของ Node)
 * ถ้าไม่มี channel access token จะเข้าโหมดทดลอง (dry-run): ไม่ยิง API จริง แค่ log
 */
export function createLineClient({ channelAccessToken, fetchImpl = globalThis.fetch, logger = console } = {}) {
  const dryRun = !channelAccessToken;

  async function request(url, { method = 'GET', body } = {}) {
    const headers = { Authorization: `Bearer ${channelAccessToken}` };
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetchImpl(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) throw new LineApiError(res.status, await res.text().catch(() => ''));
    return res;
  }

  const toArray = (messages) => (Array.isArray(messages) ? messages : [messages]).slice(0, 5);

  return {
    dryRun,

    /** ตอบกลับด้วย reply token (ฟรี ไม่นับโควตา) */
    async reply(replyToken, messages) {
      const list = toArray(messages);
      if (dryRun) {
        logger.info(`[line:dry-run] reply → ${summarize(list)}`);
        return;
      }
      await request(`${API}/message/reply`, { method: 'POST', body: { replyToken, messages: list } });
    },

    /** ส่งข้อความหาผู้ใช้เอง (นับโควตาข้อความรายเดือนของ LINE OA) */
    async push(to, messages) {
      const list = toArray(messages);
      if (dryRun) {
        logger.info(`[line:dry-run] push ${to} → ${summarize(list)}`);
        return;
      }
      await request(`${API}/message/push`, { method: 'POST', body: { to, messages: list } });
    },

    async getProfile(userId) {
      if (dryRun) return null;
      const res = await request(`${API}/profile/${encodeURIComponent(userId)}`);
      return res.json();
    },

    /** ดาวน์โหลดไฟล์ (รูป) ที่ผู้ใช้ส่งมา */
    async getContent(messageId) {
      if (dryRun) throw new Error('โหมดทดลอง: ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN จึงดาวน์โหลดรูปไม่ได้');
      const res = await request(`${DATA_API}/message/${encodeURIComponent(messageId)}/content`);
      return {
        buffer: Buffer.from(await res.arrayBuffer()),
        contentType: res.headers.get('content-type') || 'application/octet-stream',
      };
    },
  };
}

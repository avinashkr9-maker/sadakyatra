import { createHmac, timingSafeEqual } from 'node:crypto';

// Razorpay REST API (Payment Links + refunds). Test keys work before KYC; live keys after.
const API = process.env.RAZORPAY_API_BASE || 'https://api.razorpay.com/v1';

export const razorpayEnabled = () => Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET);

async function call(method, path, body) {
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.description || `Razorpay error ${response.status}`);
    error.status = 502;
    throw error;
  }
  return data;
}

// A hosted payment page for the advance; amount in rupees. Expires after 24 hours.
export function createPaymentLink({ amount, bookingRef, bookingId, customerName, customerPhone }) {
  return call('POST', '/payment_links', {
    amount: Math.round(amount * 100),
    currency: 'INR',
    accept_partial: false,
    reference_id: `${bookingRef}-${Date.now().toString(36)}`,
    description: `SadakYatra advance for ${bookingRef}`,
    customer: { name: customerName || 'SadakYatra customer', contact: `+91${customerPhone}` },
    notify: { sms: false, email: false },
    reminder_enable: false,
    expire_by: Math.floor(Date.now() / 1000) + 24 * 3600,
    notes: { booking_id: String(bookingId), booking_ref: bookingRef }
  });
}

export const fetchPaymentLink = (linkId) => call('GET', `/payment_links/${linkId}`);

export const refundPayment = (paymentId, amount) => call('POST', `/payments/${paymentId}/refund`, { amount: Math.round(amount * 100) });

// Razorpay signs webhook bodies with the webhook secret set in its dashboard.
export function validWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !rawBody || typeof signature !== 'string') return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
  const supplied = Buffer.from(signature);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

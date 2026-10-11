import { query } from './db.js';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const BATCH_SIZE = 100; // Expo's limit per request

// Android channels created by the app: offers and admin alerts ring loudly, trip updates are normal.
export const CHANNELS = { offers: 'booking-offers', admin: 'admin-alerts', trips: 'trip-updates' };

// Best effort: a failed push is logged and never blocks or fails the booking flow.
export async function notifyUsers(userIds, { title, body, data = {}, channel = CHANNELS.trips, ttl }) {
  try {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) return;
    const tokens = (await query('SELECT token FROM user_push_tokens WHERE user_id = ANY($1)', [ids])).map((row) => row.token);
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      const batch = tokens.slice(i, i + BATCH_SIZE);
      const response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(batch.map((to) => ({
          to, title, body, data, sound: 'default', priority: 'high', channelId: channel, ...(ttl ? { ttl } : {})
        })))
      });
      const tickets = (await response.json())?.data || [];
      const dead = batch.filter((_token, index) => tickets[index]?.details?.error === 'DeviceNotRegistered');
      if (dead.length) await query('DELETE FROM user_push_tokens WHERE token = ANY($1)', [dead]);
      tickets.filter((ticket) => ticket.status === 'error' && ticket.details?.error !== 'DeviceNotRegistered')
        .forEach((ticket) => console.error('Push rejected', ticket.message));
    }
  } catch (error) {
    console.error('Push failed', error.message);
  }
}

// Owner plus admins who hold the given permission.
export async function staffUserIds(permission) {
  const rows = await query(`
    SELECT DISTINCT user_id FROM user_roles
    WHERE role = 'owner' OR (role = 'admin' AND $1 = ANY(permissions))
  `, [permission]);
  return rows.map((row) => row.user_id);
}

export async function notifyStaff(permission, message) {
  return notifyUsers(await staffUserIds(permission), { channel: CHANNELS.admin, ...message });
}

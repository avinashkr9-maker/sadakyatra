import { Platform, Vibration } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { apiRequest } from './api/client';

// Must match the backend's channel ids (backend/src/notify.js).
export const CHANNELS = { offers: 'booking-offers', admin: 'admin-alerts', trips: 'trip-updates' };

// Show notifications as a banner with sound even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
});

let channelsReady = null;
function ensureChannels() {
  if (Platform.OS !== 'android') return Promise.resolve();
  // Android plays sound only on high-importance channels.
  channelsReady ??= Promise.all([
    Notifications.setNotificationChannelAsync(CHANNELS.offers, {
      name: 'Booking offers', importance: Notifications.AndroidImportance.MAX, sound: 'default',
      vibrationPattern: [0, 600, 300, 600], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC
    }),
    Notifications.setNotificationChannelAsync(CHANNELS.admin, {
      name: 'New bookings & admin alerts', importance: Notifications.AndroidImportance.MAX, sound: 'default',
      vibrationPattern: [0, 400, 200, 400], lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC
    }),
    Notifications.setNotificationChannelAsync(CHANNELS.trips, {
      name: 'Trip updates', importance: Notifications.AndroidImportance.HIGH, sound: 'default'
    })
  ]).catch(() => {});
  return channelsReady;
}

async function ensurePermission() {
  await ensureChannels();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

// This phone's Expo push token, or null where remote push is unavailable:
// Expo Go (no remote push on Android since SDK 53), no EAS project id yet, or permission denied.
async function getPushToken() {
  try {
    if (!(await ensurePermission())) return null;
    if (Constants.executionEnvironment === 'storeClient') return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return null;
  }
}

let registeredToken = null;

// After login: let the backend ring this phone. Returns true when real push is active.
export async function registerForPush() {
  const token = await getPushToken();
  if (!token) return false;
  await apiRequest('/me/push-token', 'POST', { token });
  registeredToken = token;
  return true;
}

export const hasRemotePush = () => Boolean(registeredToken);

// Before logout: stop this account's notifications on this phone.
export async function unregisterPush() {
  if (!registeredToken) return;
  await apiRequest('/me/push-token', 'POST', { token: null, previousToken: registeredToken }).catch(() => {});
  registeredToken = null;
}

// In-app alert (sound + vibration) for phones without remote push, e.g. Expo Go.
export async function alertLocal(title, body, channel = CHANNELS.trips) {
  if (channel !== CHANNELS.trips) Vibration.vibrate([0, 600, 300, 600]);
  try {
    if (!(await ensurePermission())) return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: 'default' },
      trigger: Platform.OS === 'android' ? { channelId: channel } : null
    });
  } catch {
    // Vibration already alerted for offers and admin alerts.
  }
}

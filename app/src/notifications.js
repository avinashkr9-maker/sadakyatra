import { Platform, Vibration } from 'react-native';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';

const OFFER_CHANNEL = 'booking-offers';

// Show offers as a banner with sound even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false
  })
});

let channelReady = null;
function ensureOfferChannel() {
  if (Platform.OS !== 'android') return Promise.resolve();
  // Android plays sound only for high-importance channels; the backend sends offers on this one.
  channelReady ??= Notifications.setNotificationChannelAsync(OFFER_CHANNEL, {
    name: 'Booking offers',
    importance: Notifications.AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 600, 300, 600],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC
  }).catch(() => {});
  return channelReady;
}

async function ensurePermission() {
  await ensureOfferChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

// Returns this phone's Expo push token, or null where remote push is unavailable:
// Expo Go (no remote push on Android since SDK 53), no EAS project id yet, or permission denied.
export async function getDriverPushToken() {
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

// In-app alert for a new offer; used when remote push is not set up on this phone.
export async function alertNewOffer(booking) {
  Vibration.vibrate([0, 600, 300, 600]);
  try {
    if (!(await ensurePermission())) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'New booking offer',
        body: `${booking.pickup_text} → ${booking.drop_text}`,
        sound: 'default',
        data: { bookingId: booking.id }
      },
      trigger: Platform.OS === 'android' ? { channelId: OFFER_CHANNEL } : null
    });
  } catch {
    // Vibration already alerted the driver.
  }
}

import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  Alert,
  ImageBackground,
  Image,
  Linking,
  Modal,
  Platform,
  KeyboardAvoidingView,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from 'react-native';
import { Pressable, largerText } from './src/ui';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { AdminDashboard, DriverDashboard, OwnerFleet, setCategoryNames, signOutDriver } from './src/components/PartnerOperations';
import {
  ChangePasswordModal, LoadingScreen, PasswordLoginScreen, PartnerSignupScreen, PartnerStatusScreen, ProfileScreen, RoleShell, VIEW_LABELS, WelcomeScreen
} from './src/components/AuthFlow';
import { CHANNELS, alertLocal, hasRemotePush, registerForPush, unregisterPush } from './src/notifications';
import { LinearGradient } from 'expo-linear-gradient';
import * as SecureStore from 'expo-secure-store';
import {
  getAppConfig,
  getMe,
  logoutSession,
  setAuthToken,
  setSessionExpiredHandler,
  setBaseUrl,
  createBooking,
  getQuotes,
  getWeddingVehicles,
  createWeddingBooking,
  listBookings,
  getBooking,
  getBookingTracking,
  cancelBooking,
  warmUp,
  isBackendOnline
} from './src/api/client';
import {
  ArrowUpDown,
  ArrowUpRight,
  ArrowRight,
  LocateFixed,
  LogOut,
  Calendar,
  Car,
  Check,
  ChevronRight,
  Clock,
  Briefcase,
  Heart,
  Home,
  MapPin,
  Menu,
  MessageCircle,
  Phone,
  Plane,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  User,
  Users
} from 'lucide-react-native';

const BRAND = {
  name: 'SadakYatra',
  tagline: 'Safar Apka, Gadi Hamari',
  city: 'Muzaffarpur',
  phone: '9304057169',
  phoneIntl: '919304057169',
  rating: 4.9,
  reviews: 40
};

// Shown until /app/config answers; real prices always come from the server.
const DEFAULT_PRICING = {
  categories: [
    { key: 'hatchback', name: 'Hatchback', seats: '4 seats', models: 'WagonR · Swift', perKm: 20, minFare: 1300, localFare: 1200 },
    { key: 'sedan', name: 'Sedan', seats: '4 seats', models: 'Dzire · Amaze', perKm: 23, minFare: 1500, localFare: 1500 },
    { key: 'suv', name: 'SUV', seats: '6 seats', models: 'Ertiga · Scorpio', perKm: 27, minFare: 1500, localFare: 2000 },
    { key: 'seven_seater', name: '7-Seater', seats: '7 seats', models: 'Innova Crysta', perKm: 30, minFare: 2000, localFare: 2200 },
    { key: 'traveller', name: 'Tempo Traveller', seats: '12-26 seats', models: 'Force Traveller', perKm: 35, minFare: 3500, localFare: 3500 }
  ],
  gstPercent: 5
};
const PricingContext = createContext(DEFAULT_PRICING);
const usePricing = () => useContext(PricingContext);
const findCategory = (pricing, key) => pricing.categories.find((category) => category.key === key);
const categoryLabel = (pricing, key) => findCategory(pricing, key)?.name || CATEGORY_NAMES[key] || key;
const perKmText = (pricing, key) => (findCategory(pricing, key) ? `₹${findCategory(pricing, key).perKm}/km` : '');
// "Sedan ₹23/km · SUV ₹27/km · Tempo Traveller ₹35/km"
const rateSummary = (pricing) => ['sedan', 'suv', 'traveller'].filter((key) => findCategory(pricing, key))
  .map((key) => `${categoryLabel(pricing, key)} ${perKmText(pricing, key)}`).join(' · ');

// Store numbers as the plain 10-digit form so "+91 93040 57169" and
// "9304057169" are the same customer everywhere.
function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.slice(-10);
}

const CATEGORY_NAMES = { hatchback: 'Hatchback', sedan: 'Sedan', suv: 'SUV', seven_seater: '7-Seater', traveller: 'Tempo Traveller' };
const TRIP_TYPE_LABELS = { ONE_WAY: 'One-way', ROUND_TRIP: 'Round trip', LOCAL: 'Local ride', WEDDING: 'Wedding' };

const DEFAULT_PIN = { label: 'Muzaffarpur', latitude: 26.1209, longitude: 85.391 };

const BOOKING_STATUS = {
  PENDING_APPROVAL: { label: 'Awaiting approval', style: 'statusPending' },
  ON_HOLD: { label: 'Being reviewed', style: 'statusPending' },
  APPROVED: { label: 'Finding driver', style: 'statusPending' },
  DRIVER_NOT_FOUND: { label: 'Finding driver', style: 'statusPending' },
  REJECTED: { label: 'Not accepted', style: 'statusCancelled' },
  CONFIRMED: { label: 'Driver assigned', style: 'statusConfirmed' },
  ONGOING: { label: 'On trip', style: 'statusOngoing' },
  COMPLETED: { label: 'Completed', style: 'statusCompleted' },
  CANCELLED: { label: 'Cancelled', style: 'statusCancelled' }
};
const DRIVER_STAGE_LABELS = { GOING_TO_PICKUP: 'Driver on the way', ARRIVED: 'Driver arrived' };

// Customer-facing status, including whether the driver is on the way.
function bookingStatus(booking) {
  const base = BOOKING_STATUS[booking.status] || { label: booking.status };
  const stage = booking.status === 'CONFIRMED' && DRIVER_STAGE_LABELS[booking.driver_status];
  return stage ? { ...base, label: stage } : base;
}

function defaultTripDate() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() < 30 ? 30 : 60, 0, 0);
  return date;
}

// SQLite timestamps are UTC without a zone marker.
function parseServerTime(value) {
  if (!value) return null;
  const date = new Date(String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatFriendlyDate(date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  const day = sameDay(date, today) ? 'Today' : sameDay(date, tomorrow) ? 'Tomorrow'
    : date.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day}, ${date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
}

function rupees(value) {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

const img = {
  logo: require('./assets/loveable/sadakyatra-logo.png'),
  icon: require('./assets/loveable/icon-192.png'),
  map: require('./assets/loveable/map-bg.jpg'),
  sedan: require('./assets/loveable/car-sedan.jpg'),
  suv: require('./assets/loveable/car-suv.jpg'),
  tempo: require('./assets/loveable/car-tempo.jpg'),
  wedding: require('./assets/loveable/service-wedding.jpg'),
  outstation: require('./assets/loveable/service-outstation.jpg'),
  airport: require('./assets/loveable/service-airport.jpg')
};

const CATEGORY_ART = { hatchback: img.sedan, sedan: img.sedan, suv: img.suv, seven_seater: img.suv, traveller: img.tempo };
const CATEGORY_DETAILS = {
  hatchback: { features: ['Budget-friendly AC cab', 'Best for 1-3 people', 'City & short drop trips'] },
  sedan: { badge: 'MOST POPULAR', features: ['Fully Air Conditioned', 'Professional Chauffeur', 'Best for Airport & Drop Only'] },
  suv: { features: ['Extra Space & Legroom', 'Family Drop-Only Trips', 'Weddings & family events'] },
  seven_seater: { features: ['Captain-seat comfort', 'Big families & luggage', 'Long outstation trips'] },
  traveller: { features: ['Pushback Seating', 'Baraats, Pilgrimages & Trips', 'Dual Drivers Long Routes'] }
};
const fleetCard = (category) => ({
  ...category,
  image: CATEGORY_ART[category.key] || img.sedan,
  badge: CATEGORY_DETAILS[category.key]?.badge,
  features: CATEGORY_DETAILS[category.key]?.features || ['Clean AC cab', 'Professional chauffeur'],
  price: `₹${category.perKm}/km`,
  unit: `₹${Number(category.minFare).toLocaleString('en-IN')} minimum`
});

const SERVICES = [
  {
    id: 'outstation',
    title: 'Outstation Cabs',
    short: 'One-way & round trip across Bihar',
    description: 'Door-to-door AC cab to any city. The final price for your exact pickup and drop is shown before you book.',
    features: ['One-way & round trip', 'Price shown upfront', 'Clean AC cabs'],
    icon: Car,
    cta: 'Book outstation',
    preset: { service: 'Drop Only' }
  },
  {
    id: 'airport',
    title: 'Airport Transfer',
    short: 'Patna & Darbhanga airports · 24x7',
    description: 'On-time pickup and drop for Patna (PAT) and Darbhanga (DBR) airports, including early-morning flights.',
    features: ['On-time pickup', 'Early morning', 'Both airports'],
    icon: Plane,
    cta: 'Book airport ride',
    preset: { service: 'Airport Transfer', route: { from: 'Muzaffarpur', to: 'Patna Airport' } }
  },
  {
    id: 'wedding',
    title: 'Wedding & Baraat Cars',
    short: 'Sedan to Innova · price per car',
    description: 'Book one or more cars for the baraat or bidai. Choose the car, date and venue; SadakYatra confirms each car.',
    features: ['Several cars at once', 'Experienced chauffeurs', 'Package km & hours'],
    icon: Heart,
    cta: 'View wedding cars',
    preset: { service: 'Wedding Car - Baraat / Bidai' }
  },
  {
    id: 'tempo',
    title: 'Tempo Traveller',
    short: '12-26 seats for groups',
    description: 'Family trips, pilgrimages and group outings in a pushback-seat AC tempo traveller.',
    features: ['12-26 seats', 'Pushback seats', 'Long routes'],
    icon: Users,
    cta: 'Book tempo traveller',
    preset: { service: 'Drop Only', category: 'traveller' }
  },
  {
    id: 'local',
    title: 'Local Rides',
    short: 'Within Muzaffarpur city',
    description: 'Quick rides around the city at a fixed local price for each car type.',
    features: ['Fixed local price', 'Quick pickup', 'Any car type'],
    icon: MapPin,
    cta: 'Book local ride',
    preset: { service: 'Local City Ride' }
  }
];

// City-centre pins so popular routes show road distance immediately;
// customers can still move either pin to their exact spot.
const PLACES = {
  Muzaffarpur: { latitude: 26.1209, longitude: 85.391 },
  Patna: { latitude: 25.6036, longitude: 85.1369 },
  Darbhanga: { latitude: 26.1542, longitude: 85.8918 },
  'Patna Airport': { latitude: 25.5913, longitude: 85.088 },
  'Darbhanga Airport': { latitude: 26.1928, longitude: 85.9174 },
  Sitamarhi: { latitude: 26.5952, longitude: 85.4808 },
  Motihari: { latitude: 26.647, longitude: 84.9089 },
  Samastipur: { latitude: 25.856, longitude: 85.7868 },
  Raxaul: { latitude: 26.979, longitude: 84.851 }
};

function placePin(name) {
  return PLACES[name] ? { label: name, ...PLACES[name] } : null;
}

const ROUTES = [
  { from: 'Muzaffarpur', to: 'Patna' },
  { from: 'Muzaffarpur', to: 'Darbhanga' },
  { from: 'Muzaffarpur', to: 'Patna Airport' },
  { from: 'Muzaffarpur', to: 'Darbhanga Airport' },
  { from: 'Muzaffarpur', to: 'Sitamarhi' },
  { from: 'Muzaffarpur', to: 'Motihari' },
  { from: 'Muzaffarpur', to: 'Samastipur' },
  { from: 'Muzaffarpur', to: 'Raxaul' }
];

// Shortcuts from Home/Services: [trip type, service tag].
const PRESET_SERVICES = {
  'Drop Only': ['ONE_WAY', null],
  'Round Trip': ['ROUND_TRIP', null],
  'Wedding Car - Baraat / Bidai': ['ONE_WAY', 'WEDDING'],
  'Airport Transfer': ['ONE_WAY', 'AIRPORT'],
  'Local City Ride': ['LOCAL', null]
};

const REVIEWS = [
  { name: 'Bright Nut', text: 'Car was clean, driver was friendly, and the ride felt very comfortable.', rating: 5 },
  { name: 'Md Shahnawaz', text: 'Driver arrived on time, helped with luggage, and the car was clean.', rating: 5 }
];

const TABS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'services', label: 'Services', icon: Sparkles },
  { id: 'book', label: 'Book', icon: Car, primary: true },
  { id: 'bookings', label: 'My Trips', icon: Clock },
  { id: 'about', label: 'About', icon: User }
];

function wa(message) {
  return `https://wa.me/${BRAND.phoneIntl}?text=${encodeURIComponent(message)}`;
}

function BrandGradient({ style, children }) {
  return (
    <LinearGradient colors={[colors.primary, colors.primaryGlow]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={style}>
      {children}
    </LinearGradient>
  );
}

function CardGradient({ style, children }) {
  return (
    <LinearGradient colors={[colors.surfaceElevated, colors.cardEnd]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={style}>
      {children}
    </LinearGradient>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

const SESSION_KEY = 'sadakyatra.session';
const VIEW_KEY = 'sadakyatra.lastView';

// Dashboards this account may open, most important first.
function viewsFor(account) {
  const views = [];
  const has = (role) => account.roles.includes(role);
  if (has('owner') || has('admin')) views.push('admin');
  if (has('driver')) views.push('driver');
  if (has('vehicle_owner')) views.push('fleet');
  const application = account.partnerApplication;
  if (application && application.status !== 'APPROVED' && !has('driver') && !has('vehicle_owner')) views.push('partnerStatus');
  views.push('customer');
  return views;
}

// Which screen to open: what the person tapped on the welcome screen, else the screen they used last.
function defaultView(account, intent, lastView = null) {
  const has = (role) => account.roles.includes(role);
  if (intent === 'partner') {
    if (has('driver')) return 'driver';
    if (has('vehicle_owner')) return 'fleet';
    return account.partnerApplication?.status === 'PENDING' ? 'partnerStatus' : 'partnerSignup';
  }
  if (intent === 'customer') return 'customer';
  if (lastView && viewsFor(account).includes(lastView)) return lastView;
  return viewsFor(account)[0];
}

function Root() {
  const [pricing, setPricing] = useState(DEFAULT_PRICING);
  useEffect(() => {
    getAppConfig().then((config) => {
      if (!config?.pricing?.categories?.length) return;
      setPricing(config.pricing);
      setCategoryNames(Object.fromEntries(config.pricing.categories.map((category) => [category.key, category.name])));
    }).catch(() => {});
  }, []);
  return (
    <PricingContext.Provider value={pricing}>
      <RootScreens pricing={pricing} />
    </PricingContext.Provider>
  );
}

function RootScreens({ pricing }) {
  const [booting, setBooting] = useState(true);
  const [account, setAccount] = useState(null);
  const [intent, setIntent] = useState(null);
  const [view, setView] = useState(null);
  const tokenRef = useRef(null);
  const lastViewRef = useRef(null);

  // Switching dashboards is remembered, so the next app launch opens the same one.
  function chooseView(nextView) {
    setView(nextView);
    lastViewRef.current = nextView;
    SecureStore.setItemAsync(VIEW_KEY, nextView).catch(() => {});
  }

  function persist(nextAccount) {
    SecureStore.setItemAsync(SESSION_KEY, JSON.stringify({ token: tokenRef.current, account: nextAccount })).catch(() => {});
  }

  function clearSession() {
    tokenRef.current = null;
    setAuthToken(null);
    SecureStore.deleteItemAsync(SESSION_KEY).catch(() => {});
    SecureStore.deleteItemAsync(VIEW_KEY).catch(() => {});
    lastViewRef.current = null;
    setAccount(null);
    setView(null);
    setIntent(null);
  }

  // Fresh account data (e.g. just approved): move off screens that no longer apply.
  function applyAccount(nextAccount) {
    setAccount(nextAccount);
    persist(nextAccount);
    setView((current) => {
      if (!current || current === 'partnerSignup') return current;
      return viewsFor(nextAccount).includes(current) ? current : viewsFor(nextAccount)[0];
    });
  }

  useEffect(() => {
    setSessionExpiredHandler(clearSession);
    Promise.all([SecureStore.getItemAsync(SESSION_KEY), SecureStore.getItemAsync(VIEW_KEY).catch(() => null)])
      .then(([stored, lastView]) => {
        lastViewRef.current = lastView;
        if (!stored) return;
        const saved = JSON.parse(stored);
        tokenRef.current = saved.token;
        setAuthToken(saved.token);
        setAccount(saved.account);
        setView(defaultView(saved.account, null, lastView));
        getMe().then((me) => applyAccount(me.account)).catch(() => {});
        registerForPush().catch(() => {});
      })
      .catch(() => {})
      .finally(() => setBooting(false));
  }, []);

  async function onLoggedIn(token, loginAccount) {
    tokenRef.current = token;
    setAuthToken(token);
    registerForPush().catch(() => {});
    const fullAccount = await getMe().then((me) => me.account).catch(() => loginAccount);
    setAccount(fullAccount);
    persist(fullAccount);
    if (fullAccount.profileComplete) chooseView(defaultView(fullAccount, intent, lastViewRef.current));
    else setView(null);
  }

  async function logout() {
    await unregisterPush();
    if (account?.roles.includes('driver')) await signOutDriver();
    await logoutSession().catch(() => {});
    clearSession();
  }

  if (booting) return <LoadingScreen />;
  if (!account) {
    if (!intent) return <WelcomeScreen onChoose={setIntent} />;
    return <PasswordLoginScreen intent={intent} onBack={() => setIntent(null)} onLoggedIn={onLoggedIn} />;
  }
  if (!account.profileComplete) {
    return <ProfileScreen account={account} onSaved={(saved) => { applyAccount(saved); chooseView(defaultView(saved, intent, lastViewRef.current)); }} />;
  }

  const current = view || defaultView(account, intent);
  const views = viewsFor(account);
  if (current === 'partnerSignup') {
    return (
      <PartnerSignupScreen
        account={account}
        categories={pricing.categories}
        onBack={() => chooseView('customer')}
        onSubmitted={(saved) => { applyAccount(saved); setView('partnerStatus'); }}
      />
    );
  }
  if (current === 'partnerStatus') {
    return (
      <PartnerStatusScreen
        account={account}
        onAccount={applyAccount}
        onBookCab={() => chooseView('customer')}
        onApplyAgain={() => setView('partnerSignup')}
        onLogout={logout}
      />
    );
  }
  if (current === 'customer') {
    return (
      <SadakYatraApp
        account={account}
        views={views}
        onSwitchView={chooseView}
        onLogout={logout}
        onJoinPartner={() => setView(account.partnerApplication?.status === 'PENDING' ? 'partnerStatus' : 'partnerSignup')}
      />
    );
  }
  return (
    <RoleShell view={current} views={views} onSwitch={chooseView} onLogout={logout}>
      {current === 'admin' ? <AdminDashboard account={account} /> : null}
      {current === 'driver' ? <DriverDashboard /> : null}
      {current === 'fleet' ? <OwnerFleet /> : null}
    </RoleShell>
  );
}

function SadakYatraApp({ account, views, onSwitchView, onLogout, onJoinPartner }) {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);
  const [tab, setTab] = useState('home');
  const [menuVisible, setMenuVisible] = useState(false);
  const [from, setFrom] = useState('Muzaffarpur');
  const [to, setTo] = useState('Patna');
  const [pickupLocation, setPickupLocation] = useState(placePin('Muzaffarpur'));
  const [dropLocation, setDropLocation] = useState(placePin('Patna'));
  const [carCategory, setCarCategory] = useState('sedan');
  const [tripType, setTripType] = useState('ONE_WAY');
  const [serviceTag, setServiceTag] = useState(null);
  const [returnDate, setReturnDate] = useState(() => new Date(defaultTripDate().getTime() + 12 * 3600e3));
  const phone = account.phone;
  const [tripDate, setTripDate] = useState(defaultTripDate);
  const [lastTrip, setLastTrip] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [bookingTracking, setBookingTracking] = useState(null);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [bookingEvents, setBookingEvents] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [bookingError, setBookingError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [apiUrl, setApiUrl] = useState('');
  const [authModalVisible, setAuthModalVisible] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const pricing = usePricing();

  useEffect(() => {
    setBaseUrl(apiUrl);
  }, [apiUrl]);

  // App khulte hi background me backend dhoond lo, taaki pehla
  // login/booking turant lage (koi 7s wait nahi).
  useEffect(() => {
    warmUp();
  }, []);

  function goTo(nextTab) {
    setTab(nextTab);
    setMenuVisible(false);
  }

  // Open the booking form already filled in for what the customer tapped.
  function startBooking(preset = {}) {
    if (preset.service === 'Wedding Car - Baraat / Bidai') {
      goTo('wedding');
      return;
    }
    if (preset.service && PRESET_SERVICES[preset.service]) {
      const [nextTripType, tag] = PRESET_SERVICES[preset.service];
      setTripType(nextTripType);
      setServiceTag(tag);
    }
    if (preset.category) setCarCategory(preset.category);
    if (preset.route) {
      setFrom(preset.route.from);
      setTo(preset.route.to);
      setPickupLocation(placePin(preset.route.from));
      setDropLocation(placePin(preset.route.to));
    }
    goTo('book');
  }

  // Airport if either pin is an airport, wedding when started from the wedding shortcut.
  function serviceType() {
    if (tripType === 'LOCAL') return 'LOCAL';
    if (serviceTag) return serviceTag;
    return /airport/i.test(`${from} ${to}`) ? 'AIRPORT' : 'OUTSTATION';
  }

  function bookOnWhatsApp(routeDistanceKm, fare) {
    const msg =
      `Hi ${BRAND.name}! Booking request:\n` +
      `• Trip: ${TRIP_TYPE_LABELS[tripType]}${serviceTag === 'WEDDING' ? ' (wedding)' : ''}\n` +
      `• Vehicle: ${categoryLabel(pricing, carCategory)}\n` +
      `• From: ${from}\n` +
      `• To: ${to}\n` +
      (routeDistanceKm ? `• Road distance: ${routeDistanceKm} km\n` : '') +
      (fare ? `• Final payable (all-inclusive): ${rupees(fare.total)}\n` : '') +
      `• Pickup: ${formatFriendlyDate(tripDate)}\n` +
      (tripType === 'ROUND_TRIP' ? `• Return: ${formatFriendlyDate(returnDate)}\n` : '') +
      (phone ? `• Phone: ${phone}\n` : '') +
      `Please confirm availability.`;
    Linking.openURL(wa(msg));
  }

  async function sendBooking(routeDistanceKm, fare) {
    if (!pickupLocation || !dropLocation) {
      return Alert.alert('Set your pins', 'Tap Pickup and Drop to place both pins on the map.');
    }
    if (tripType !== 'LOCAL' && !(routeDistanceKm > 0)) {
      return Alert.alert('Road distance unavailable', 'We could not calculate the road route yet. Check your internet or move the pins slightly.');
    }
    if (tripDate.getTime() < Date.now() + 15 * 60 * 1000) {
      return Alert.alert('Pick a later time', 'Pickup time must be at least 15 minutes from now.');
    }
    if (tripType === 'ROUND_TRIP' && returnDate <= tripDate) {
      return Alert.alert('Check the return time', 'The return time must be after the pickup time.');
    }

    // Backend offline ho to seedha WhatsApp par booking bhejo.
    if (!(await isBackendOnline())) {
      bookOnWhatsApp(routeDistanceKm, fare);
      return;
    }

    setSubmitting(true);
    try {
      const data = await createBooking({
        serviceType: serviceType(),
        tripType,
        pickup: from,
        drop: to,
        tripDatetime: tripDate.toISOString(),
        returnDatetime: tripType === 'ROUND_TRIP' ? returnDate.toISOString() : undefined,
        carCategory,
        pickupLatitude: pickupLocation?.latitude ?? null,
        pickupLongitude: pickupLocation?.longitude ?? null,
        dropLatitude: dropLocation?.latitude ?? null,
        dropLongitude: dropLocation?.longitude ?? null,
        routeDistanceKm: routeDistanceKm ?? null
      });
      const booking = data.booking;

      setLastTrip({
        from,
        to,
        service: TRIP_TYPE_LABELS[tripType],
        date: formatFriendlyDate(tripDate),
        fare: booking.estimated_fare ? rupees(booking.estimated_fare) : 'Quote pending'
      });

      Alert.alert(
        'Booking requested',
        `${booking.booking_ref}${booking.estimated_fare ? ` · ${rupees(booking.estimated_fare)}` : ''}\nSadakYatra will confirm it shortly. You will be notified when a driver is assigned.`
      );
      goTo('bookings');
      fetchBookings();
      fetchBookingDetails(booking.id);
    } catch (err) {
      if (err.status === 400) {
        Alert.alert('Please check your booking', err.message);
      } else {
        // In-app booking fail — customer ko rokna nahi, WhatsApp par bhejo.
        bookOnWhatsApp(routeDistanceKm, fare);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function fetchBookings() {
    setLoadingBookings(true);
    setBookingError(null);

    return listBookings()
      .then((data) => setBookings(data.bookings || []))
      .catch((err) => setBookingError(err.offline ? 'You are offline. Pull down to try again.' : err.message || 'Could not load bookings.'))
      .finally(() => setLoadingBookings(false));
  }

  function loadBookingDetails(id) {
    return Promise.all([
      getBooking(id).then((data) => {
        setSelectedBooking(data.booking);
        setBookingEvents(data.events || []);
      }),
      getBookingTracking(id).then((data) => setBookingTracking(data.tracking)).catch(() => {})
    ]);
  }

  function fetchBookingDetails(id) {
    setBookingError(null);
    setBookingTracking(null);
    return loadBookingDetails(id)
      .catch((err) => setBookingError(err.message || 'Could not load booking details.'));
  }

  const lastStatuses = useRef(null);
  useEffect(() => {
    const check = () => listBookings().then((data) => {
      const latest = data.bookings || [];
      const statuses = new Map(latest.map((booking) => [booking.id, bookingStatus(booking).label]));
      if (lastStatuses.current && !hasRemotePush()) {
        latest.forEach((booking) => {
          const before = lastStatuses.current.get(booking.id);
          if (before && before !== statuses.get(booking.id)) alertLocal(`${booking.booking_ref}: ${statuses.get(booking.id)}`, `${booking.pickup_text} → ${booking.drop_text}`, CHANNELS.trips);
        });
      }
      lastStatuses.current = statuses;
      setBookings(latest);
    }).catch(() => {});
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  // While a trip is open, keep its status, timeline and cab position fresh.
  useEffect(() => {
    if (!selectedBooking || ['COMPLETED', 'CANCELLED'].includes(selectedBooking.status)) return undefined;
    const interval = setInterval(() => {
      loadBookingDetails(selectedBooking.id).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [selectedBooking?.id, selectedBooking?.status]);

  function confirmCancel(booking) {
    Alert.alert('Cancel this booking?', `${booking.booking_ref} · ${booking.pickup_text} → ${booking.drop_text}`, [
      { text: 'Keep booking', style: 'cancel' },
      {
        text: 'Cancel booking',
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelBooking(booking.id, 'Cancelled by customer in app');
            await fetchBookingDetails(booking.id);
            fetchBookings();
          } catch (err) {
            Alert.alert('Could not cancel', err.message || 'Please call us to cancel this booking.');
          }
        }
      }
    ]);
  }

  useEffect(() => {
    if (tab === 'bookings') fetchBookings();
  }, [tab]);

  const bottomSpace = insets.bottom + 104;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />
      <Header user={account} onLoginPress={() => setAuthModalVisible(true)} onMenuPress={() => setMenuVisible(true)} />
      <ScrollView
        key={tab}
        ref={scrollRef}
        contentContainerStyle={{ paddingBottom: bottomSpace }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
        refreshControl={tab === 'bookings' ? (
          <RefreshControl
            refreshing={loadingBookings}
            tintColor={colors.primary}
            colors={[colors.primary]}
            onRefresh={() => (selectedBooking ? fetchBookingDetails(selectedBooking.id) : fetchBookings())}
          />
        ) : undefined}
      >
        {tab === 'home' && <HomeScreen pickupLabel={from} onStart={startBooking} onTab={goTo} apiUrl={apiUrl} setApiUrl={setApiUrl} />}
        {tab === 'fleet' && <FleetScreen onStart={startBooking} />}
        {tab === 'services' && <ServicesScreen onStart={startBooking} />}
        {tab === 'bookings' && (
          <BookingsScreen
            phone={phone}
            bookings={bookings}
            loading={loadingBookings}
            error={bookingError}
            selectedBooking={selectedBooking}
            tracking={bookingTracking}
            events={bookingEvents}
            onRefresh={() => fetchBookings()}
            onSelectBooking={fetchBookingDetails}
            onCancel={confirmCancel}
            onBook={() => goTo('book')}
            onBack={() => {
              setSelectedBooking(null);
              setBookingEvents([]);
              setBookingTracking(null);
            }}
          />
        )}
        {tab === 'book' && (
          <BookScreen
            from={from}
            to={to}
            pickupLocation={pickupLocation}
            dropLocation={dropLocation}
            tripType={tripType}
            carCategory={carCategory}
            phone={phone}
            tripDate={tripDate}
            returnDate={returnDate}
            onFrom={setFrom}
            onTo={setTo}
            onPickupLocation={(location) => { setPickupLocation(location); setFrom(location?.label || from); }}
            onDropLocation={(location) => { setDropLocation(location); setTo(location?.label || to); }}
            onSwap={() => {
              setFrom(to); setTo(from);
              setPickupLocation(dropLocation); setDropLocation(pickupLocation);
            }}
            onTripType={(nextTripType) => { setTripType(nextTripType); if (nextTripType === 'LOCAL') setServiceTag(null); }}
            onCarCategory={setCarCategory}
            onTripDate={setTripDate}
            onReturnDate={setReturnDate}
            onSend={sendBooking}
            isSubmitting={submitting}
          />
        )}
        {tab === 'about' && <AboutScreen lastTrip={lastTrip} />}
        {tab === 'wedding' && <WeddingScreen onBooked={() => { goTo('bookings'); fetchBookings(); }} />}
      </ScrollView>
      <BottomNav tab={tab} onTab={goTo} bottomInset={insets.bottom} />
      <Modal visible={menuVisible} transparent animationType="fade" onRequestClose={() => setMenuVisible(false)}>
        <View style={styles.drawerOverlay}>
          <Pressable style={styles.drawerBackdrop} onPress={() => setMenuVisible(false)} />
          <View style={[styles.drawerPanel, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.drawerHeader}>
              <BrandLogo />
              <Pressable style={styles.drawerClose} onPress={() => setMenuVisible(false)} accessibilityLabel="Close menu">
                <Text style={styles.drawerCloseText}>×</Text>
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.drawerEyebrow}>YOUR JOURNEY</Text>
              {[
                { id: 'book', label: 'Book a cab', icon: Car },
                { id: 'wedding', label: 'Wedding & baraat cars', icon: Heart },
                { id: 'bookings', label: 'My trips', icon: Clock },
                { id: 'fleet', label: 'Our fleet & rates', icon: Car },
                { id: 'services', label: 'Services', icon: Sparkles },
                { id: 'about', label: 'About & reviews', icon: Star }
              ].map((item) => <DrawerItem key={item.id} item={item} onPress={() => goTo(item.id)} />)}
              <View style={styles.drawerDivider} />
              <Text style={styles.drawerEyebrow}>WORK WITH SADAKYATRA</Text>
              {views.filter((item) => item !== 'customer').map((item) => (
                <DrawerItem key={item} item={{ id: item, label: `Open ${VIEW_LABELS[item]}`, icon: ShieldCheck }} onPress={() => { setMenuVisible(false); onSwitchView(item); }} />
              ))}
              {!views.includes('driver') && !views.includes('fleet') && !views.includes('partnerStatus') ? (
                <DrawerItem item={{ id: 'partner', label: 'Become a cab partner', icon: Users }} onPress={() => { setMenuVisible(false); onJoinPartner(); }} />
              ) : null}
              <DrawerItem item={{ id: 'logout', label: 'Log out', icon: LogOut }} onPress={() => { setMenuVisible(false); onLogout(); }} />
            </ScrollView>
            <Pressable style={styles.drawerCall} onPress={() => { setMenuVisible(false); Linking.openURL(`tel:${BRAND.phone}`); }}>
              <Phone color={colors.primaryForeground} size={17} />
              <Text style={styles.drawerCallText}>Call SadakYatra</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal visible={authModalVisible} animationType="slide" transparent onRequestClose={() => setAuthModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Your account</Text>
            <Text style={styles.modalSubtitle}>{account.fullName ? `${account.fullName} · ` : ''}+91 {account.phone}</Text>
            <Pressable style={styles.modalButtonSecondary} onPress={() => { setAuthModalVisible(false); setChangingPassword(true); }}>
              <Text style={styles.modalButtonTextSecondary}>Change password</Text>
            </Pressable>
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalButtonSecondary} onPress={() => { setAuthModalVisible(false); onLogout(); }}>
                <View style={styles.rowCenter}><LogOut color={colors.text} size={16} /><Text style={styles.modalButtonTextSecondary}>Log out</Text></View>
              </Pressable>
              <Pressable style={styles.modalButton} onPress={() => setAuthModalVisible(false)}>
                <Text style={styles.modalButtonText}>Done</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <ChangePasswordModal visible={changingPassword} onClose={() => setChangingPassword(false)} />
    </View>
  );
}

function PrimaryButton({ label, onPress, icon: Icon, disabled = false }) {
  return (
    <Pressable style={[styles.smallCtaOuter, disabled && styles.disabled]} onPress={onPress} disabled={disabled}>
      <BrandGradient style={styles.smallCta}>
        {Icon ? <Icon color={colors.primaryForeground} size={16} /> : null}
        <Text style={styles.smallCtaText}>{label}</Text>
      </BrandGradient>
    </Pressable>
  );
}

function Header({ user, onLoginPress, onMenuPress }) {
  return (
    <View style={styles.header}>
      <BrandLogo />
      <View style={styles.headerRight}>
        <Pressable style={styles.headerAction} onPress={onLoginPress}>
          <User color={colors.primary} size={18} strokeWidth={2.5} />
          <Text style={styles.headerActionText}>{user ? 'Account' : 'Login'}</Text>
        </Pressable>
        <Pressable style={styles.callButton} onPress={() => Linking.openURL(`tel:${BRAND.phone}`)}>
          <Phone color={colors.primary} size={18} strokeWidth={2.5} />
        </Pressable>
        <Pressable style={styles.menuButton} onPress={onMenuPress} accessibilityLabel="Open menu">
          <Menu color={colors.text} size={21} strokeWidth={2.5} />
        </Pressable>
      </View>
    </View>
  );
}

function DrawerItem({ item, onPress }) {
  const Icon = item.icon;
  return (
    <Pressable style={styles.drawerItem} onPress={onPress}>
      <View style={styles.drawerIcon}><Icon color={colors.primary} size={18} /></View>
      <Text style={styles.drawerItemText}>{item.label}</Text>
      <ChevronRight color={colors.muted} size={17} />
    </Pressable>
  );
}

function BrandLogo() {
  // Official SadakYatra wordmark; its dark lettering needs a light backing on the dark header.
  return (
    <View style={styles.brandLogo}>
      <Image source={img.logo} style={styles.brandLogoImage} resizeMode="contain" accessibilityLabel="SadakYatra" />
    </View>
  );
}

function HomeScreen({ pickupLabel, onStart, onTab, apiUrl, setApiUrl }) {
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [tempApiUrl, setTempApiUrl] = useState(apiUrl);
  return (
    <View>
      <ImageBackground source={img.map} style={styles.mapHero} imageStyle={styles.mapHeroImage}>
        <View style={styles.mapOverlay} />
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>{BRAND.tagline}</Text>
          <Text style={styles.heroTitle}>Kahan jaana hai aaj?</Text>
        </View>
        <View style={styles.pinPulse}>
          <BrandGradient style={styles.pinCore}>
            <View style={styles.pinDot} />
          </BrandGradient>
        </View>
      </ImageBackground>

      <Pressable style={styles.whereCardOuter} onPress={() => onStart()}>
        <CardGradient style={styles.whereCard}>
          <View style={styles.iconBox}><Search color={colors.primary} size={22} /></View>
          <View style={styles.flex}>
            <Text style={styles.whereEyebrow}>Final price before you book</Text>
            <Text style={styles.whereTitle}>Where to?</Text>
          </View>
          <BrandGradient style={styles.yellowCircle}><ArrowRight color={colors.primaryForeground} size={20} strokeWidth={3} /></BrandGradient>
        </CardGradient>
      </Pressable>

      <RoutePreview pickupLabel={pickupLabel} onPress={() => onStart()} />
      <QuickPills onStart={onStart} />
      <SectionTitle eyebrow="Suggested rides" title="Choose your ride" action="See all" onAction={() => onTab('fleet')} />
      <FleetList compact onSelect={(category) => onStart({ category })} />
      <SectionTitle eyebrow="Popular near you" title="Most-booked routes" />
      {ROUTES.slice(0, 5).map((route) => <RouteRow key={route.to} route={route} onPress={() => onStart({ route })} />)}
      <WeddingPromo onPress={() => onStart({ service: 'Wedding Car - Baraat / Bidai' })} />
      <SafetyStrip onReviews={() => onTab('about')} />

      {__DEV__ ? (
        <Pressable style={styles.apiSettingsToggle} onPress={() => setShowApiSettings(!showApiSettings)}>
          <Text style={styles.apiSettingsText}>⚙️ Developer: API settings</Text>
        </Pressable>
      ) : null}

      {__DEV__ && showApiSettings && (
        <View style={styles.apiSettings}>
          <Text style={styles.apiSettingsLabel}>Backend URL (empty = automatic):</Text>
          <TextInput
            style={styles.apiUrlInput}
            value={tempApiUrl}
            onChangeText={setTempApiUrl}
            placeholder="http://192.168.x.x:4000"
            placeholderTextColor={colors.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.apiButtons}>
            <Pressable style={styles.apiButton} onPress={() => { setApiUrl(tempApiUrl); setShowApiSettings(false); }}>
              <Text style={styles.apiButtonText}>Save</Text>
            </Pressable>
            <Pressable style={styles.apiButtonSecondary} onPress={() => setShowApiSettings(false)}>
              <Text style={styles.apiButtonTextSecondary}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

function RoutePreview({ pickupLabel, onPress }) {
  return (
    <Pressable style={styles.routePreview} onPress={onPress}>
      <View style={styles.routeRail}>
        <View style={styles.dotYellow} />
        <View style={styles.railLine} />
        <View style={styles.dotSquare} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.inputTiny}>Pickup</Text>
        <Text style={styles.inputStrong} numberOfLines={1}>{pickupLabel || BRAND.city}</Text>
        <View style={styles.dashedLine} />
        <View style={styles.addDestination}>
          <View>
            <Text style={styles.inputTiny}>Drop</Text>
            <Text style={styles.mutedStrong}>Add destination</Text>
          </View>
          <Text style={styles.plus}>+</Text>
        </View>
      </View>
    </Pressable>
  );
}

function QuickPills({ onStart }) {
  const pricing = usePricing();
  const pills = [
    { icon: Plane, label: 'Patna Airport', sub: 'Airport transfer', preset: { service: 'Airport Transfer', route: { from: 'Muzaffarpur', to: 'Patna Airport' } } },
    { icon: Heart, label: 'Wedding Car', sub: 'Baraat & shaadi', preset: { service: 'Wedding Car - Baraat / Bidai' } },
    { icon: Briefcase, label: 'Drop Only', sub: 'price by distance', preset: { service: 'Drop Only' } },
    { icon: Users, label: 'Tempo Traveller', sub: '12-26 seats', preset: { category: 'traveller' } },
    { icon: MapPin, label: 'Darbhanga', sub: `Sedan ${perKmText(pricing, 'sedan')}`, preset: { service: 'Drop Only', route: { from: 'Muzaffarpur', to: 'Darbhanga' } } }
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
      {pills.map((pill) => {
        const Icon = pill.icon;
        return (
          <Pressable key={pill.label} style={styles.quickPill} onPress={() => onStart(pill.preset)}>
            <View style={styles.smallIcon}><Icon color={colors.primary} size={17} /></View>
            <View>
              <Text style={styles.quickLabel}>{pill.label}</Text>
              <Text style={styles.quickSub}>{pill.sub}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function FleetScreen({ onStart }) {
  const pricing = usePricing();
  return (
    <View>
      <SectionTitle eyebrow="Our Fleet" title="Choose your ride" subtitle="Well-maintained, sanitized vehicles for every trip across Bihar." />
      <View style={styles.fleetArticleList}>
        {pricing.categories.map(fleetCard).map((car) => (
          <CardGradient key={car.key} style={styles.fleetArticle}>
            <View style={styles.fleetImageWrap}>
              <Image source={car.image} style={styles.fleetImage} />
              {car.badge ? <Text style={styles.fleetBadge}>{car.badge}</Text> : null}
              <View style={styles.seatBadge}><Users color={colors.text} size={13} /><Text style={styles.seatBadgeText}>{car.seats}</Text></View>
            </View>
            <View style={styles.fleetBody}>
              <Text style={styles.fleetTitle}>{car.name}</Text>
              <Text style={styles.fleetModels}>{car.models}</Text>
              <View style={styles.featureList}>
                {car.features.map((feature) => (
                  <View key={feature} style={styles.featureRow}>
                    <Check color={colors.primary} size={16} />
                    <Text style={styles.featureText}>{feature}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.fleetFooter}>
                <View>
                  <Text style={styles.startsFrom}>Starts from</Text>
                  <Text style={styles.fleetPrice}>{car.price}</Text>
                  <Text style={styles.priceUnit}>{car.unit}</Text>
                </View>
                <PrimaryButton label="Book Now" icon={ArrowRight} onPress={() => onStart({ category: car.key })} />
              </View>
            </View>
          </CardGradient>
        ))}
      </View>
    </View>
  );
}

function FleetList({ compact = false, onSelect }) {
  const pricing = usePricing();
  return (
    <View style={styles.listGap}>
      {pricing.categories.map(fleetCard).map((car) => (
        <Pressable key={car.key} onPress={() => onSelect?.(car.key)}>
          <CardGradient style={styles.rideRow}>
            <Image source={car.image} style={styles.rideImage} />
            <View style={styles.flex}>
              <View style={styles.rowCenter}>
                <Text style={styles.rideName}>{car.name}</Text>
                {car.badge ? <Text style={styles.badge}>{car.badge}</Text> : null}
              </View>
              <Text style={styles.rideMeta} numberOfLines={1}>{[car.seats, car.models].filter(Boolean).join(' · ')}</Text>
              {!compact ? <Text style={styles.rideFeature}>Clean AC cab · professional chauffeur</Text> : null}
            </View>
            <View style={styles.priceBlock}>
              <Text style={styles.priceText}>{car.price}</Text>
              <Text style={styles.priceUnit}>{car.unit}</Text>
            </View>
          </CardGradient>
        </Pressable>
      ))}
    </View>
  );
}

function ServicesScreen({ onStart }) {
  return (
    <View>
      <SectionTitle eyebrow="Services" title="How can we help you travel?" subtitle="Every price is shown before you book and confirmed by SadakYatra." />
      <View style={styles.serviceList}>
        {SERVICES.map((service) => {
          const Icon = service.icon;
          return (
            <View key={service.id} style={styles.serviceCard}>
              <Pressable style={styles.serviceCardTop} onPress={() => onStart(service.preset)}>
                <View style={styles.serviceIcon}><Icon color={colors.primaryForeground} size={22} strokeWidth={2.4} /></View>
                <View style={styles.flex}>
                  <Text style={styles.serviceCardTitle}>{service.title}</Text>
                  <Text style={styles.serviceCardShort}>{service.short}</Text>
                </View>
                <ChevronRight color={colors.mutedForeground} size={20} />
              </Pressable>
              <Text style={styles.serviceCardText}>{service.description}</Text>
              <View style={styles.serviceChips}>
                {service.features.map((feature) => (
                  <View key={feature} style={styles.serviceChip}>
                    <Check color={colors.primary} size={13} />
                    <Text style={styles.serviceChipText}>{feature}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.serviceActions}>
                <Pressable style={styles.serviceBookButton} onPress={() => onStart(service.preset)}>
                  <Text style={styles.serviceBookText}>{service.cta}</Text>
                  <ArrowRight color={colors.primaryForeground} size={16} />
                </Pressable>
                <Pressable
                  style={styles.serviceAskButton}
                  accessibilityLabel={`Ask about ${service.title} on WhatsApp`}
                  onPress={() => Linking.openURL(wa(`Hi ${BRAND.name}! I'm interested in ${service.title}. Please share details.`))}
                >
                  <MessageCircle color={colors.whatsapp} size={18} />
                  <Text style={styles.serviceAskText}>Ask</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const TRIP_TABS = [
  { id: 'ONE_WAY', label: 'One-Way' },
  { id: 'ROUND_TRIP', label: 'Round-Trip' },
  { id: 'LOCAL', label: 'Local' }
];

function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr${hours > 1 ? 's' : ''}${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}

function tripDaysBetween(start, end) {
  return Math.max(1, Math.ceil((end - start) / 86400000));
}

// Road route between the two pins (OpenStreetMap routing): distance, duration and the line to draw.
function useRoadRoute(pickupLocation, dropLocation) {
  const [route, setRoute] = useState({ loading: false, distanceKm: null, durationSec: null, coordinates: [], error: null });
  useEffect(() => {
    if (!pickupLocation || !dropLocation) {
      setRoute({ loading: false, distanceKm: null, durationSec: null, coordinates: [], error: null });
      return undefined;
    }
    setRoute((current) => ({ ...current, loading: true, error: null }));
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${pickupLocation.longitude},${pickupLocation.latitude};${dropLocation.longitude},${dropLocation.latitude}?overview=simplified&geometries=geojson`;
        const response = await fetch(url, { signal: controller.signal });
        const result = await response.json();
        const best = result.routes?.[0];
        if (!response.ok || result.code !== 'Ok' || !best) throw new Error('No road route found between these pins. Move a pin slightly.');
        setRoute({
          loading: false,
          distanceKm: Math.round((best.distance / 1000) * 10) / 10,
          durationSec: best.duration,
          coordinates: best.geometry.coordinates.map(([longitude, latitude]) => ({ latitude, longitude })),
          error: null
        });
      } catch (error) {
        if (error.name !== 'AbortError') {
          setRoute({ loading: false, distanceKm: null, durationSec: null, coordinates: [], error: error.message || 'Road distance is temporarily unavailable.' });
        }
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [pickupLocation?.latitude, pickupLocation?.longitude, dropLocation?.latitude, dropLocation?.longitude]);
  return route;
}

// Live prices for every vehicle type from the server, refreshed when the trip changes.
function useQuotes({ tripType, distanceKm, tripDate, returnDate, pickupLocation, dropLocation }) {
  const [state, setState] = useState({ loading: false, byKey: {}, days: 1, error: null });
  const ready = tripType === 'LOCAL' || distanceKm > 0;
  useEffect(() => {
    if (!ready) {
      setState({ loading: false, byKey: {}, days: 1, error: null });
      return undefined;
    }
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: null }));
    const timer = setTimeout(() => {
      getQuotes({
        tripType,
        distanceKm,
        tripDatetime: tripDate.toISOString(),
        returnDatetime: tripType === 'ROUND_TRIP' ? returnDate.toISOString() : undefined,
        pickupLatitude: pickupLocation?.latitude,
        pickupLongitude: pickupLocation?.longitude,
        dropLatitude: dropLocation?.latitude,
        dropLongitude: dropLocation?.longitude
      })
        .then((result) => {
          if (cancelled) return;
          setState({ loading: false, byKey: Object.fromEntries(result.quotes.map((item) => [item.key, item.quote])), days: result.days, error: null });
        })
        .catch((error) => {
          if (!cancelled) setState({ loading: false, byKey: {}, days: 1, error: error.offline ? 'Prices need internet. You can still book on WhatsApp.' : error.message });
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ready, tripType, distanceKm, tripDate.getTime(), returnDate.getTime(), pickupLocation?.latitude, dropLocation?.latitude]);
  return state;
}

function RouteMap({ pickupLocation, dropLocation, coordinates }) {
  const mapRef = useRef(null);
  const points = coordinates.length ? coordinates : [pickupLocation, dropLocation].filter(Boolean);
  useEffect(() => {
    if (points.length < 2) return;
    const timer = setTimeout(() => {
      mapRef.current?.fitToCoordinates(points, { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [points.length, pickupLocation?.latitude, dropLocation?.latitude]);
  if (!pickupLocation) return null;
  return (
    <MapView
      ref={mapRef}
      style={styles.routeMap}
      initialRegion={{ latitude: pickupLocation.latitude, longitude: pickupLocation.longitude, latitudeDelta: 0.6, longitudeDelta: 0.6 }}
      scrollEnabled={false}
      zoomEnabled={false}
      pitchEnabled={false}
      rotateEnabled={false}
    >
      {coordinates.length > 1 ? <Polyline coordinates={coordinates} strokeColor={colors.primary} strokeWidth={4} /> : null}
      <Marker coordinate={pickupLocation} title="Pickup" pinColor="green" />
      {dropLocation ? <Marker coordinate={dropLocation} title="Drop" pinColor="red" /> : null}
    </MapView>
  );
}

function VehicleOption({ category, quote, loading, selected, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.vehicleOption, selected && styles.vehicleOptionSelected]}>
      <Image source={CATEGORY_ART[category.key] || img.sedan} style={styles.vehicleOptionImage} />
      <View style={styles.flex}>
        <Text style={styles.vehicleOptionName}>{category.name}</Text>
        <Text style={styles.vehicleOptionMeta} numberOfLines={1}>{[category.seats, category.models].filter(Boolean).join(' · ')}</Text>
        {quote?.fixedRoute ? <Text style={styles.vehicleOptionTag}>Fixed route price</Text> : null}
      </View>
      <View style={styles.vehicleOptionPriceBox}>
        <Text style={[styles.vehicleOptionPrice, selected && styles.vehicleOptionPriceSelected]}>
          {quote ? rupees(quote.total) : loading ? '…' : '—'}
        </Text>
        {quote ? <Text style={styles.vehicleOptionUnit}>all-inclusive</Text> : null}
      </View>
    </Pressable>
  );
}

function BookScreen({ from, to, pickupLocation, dropLocation, tripType, carCategory, tripDate, returnDate, onFrom, onTo, onPickupLocation, onDropLocation, onSwap, onTripType, onCarCategory, onTripDate, onReturnDate, onSend, isSubmitting }) {
  const pricing = usePricing();
  const [pickerTarget, setPickerTarget] = useState(null);
  const route = useRoadRoute(pickupLocation, dropLocation);
  const quotes = useQuotes({ tripType, distanceKm: route.distanceKm, tripDate, returnDate, pickupLocation, dropLocation });
  const selectedCategory = pricing.categories.find((category) => category.key === carCategory) || pricing.categories[0];
  const fare = selectedCategory ? quotes.byKey[selectedCategory.key] : null;
  const days = tripType === 'ROUND_TRIP' ? tripDaysBetween(tripDate, returnDate) : 1;

  // A shortcut may pre-select a type the owner has since hidden: book what is shown.
  useEffect(() => {
    if (selectedCategory && selectedCategory.key !== carCategory) onCarCategory(selectedCategory.key);
  }, [selectedCategory?.key, carCategory]);

  // Keep the return after the pickup when the pickup moves.
  useEffect(() => {
    if (tripType === 'ROUND_TRIP' && returnDate <= tripDate) onReturnDate(new Date(tripDate.getTime() + 12 * 3600e3));
  }, [tripType, tripDate.getTime()]);

  return (
    <View>
      <View style={styles.tripTabs}>
        {TRIP_TABS.map((tab) => (
          <Pressable key={tab.id} onPress={() => onTripType(tab.id)} style={[styles.tripTab, tripType === tab.id && styles.tripTabActive]}>
            <Text style={[styles.tripTabText, tripType === tab.id && styles.tripTabTextActive]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>

      <CardGradient style={styles.bookingPanel}>
        <View>
          <PinField label="Pickup" value={pickupLocation ? from : ''} onPress={() => setPickerTarget('pickup')} />
          <PinField label="Drop" value={dropLocation ? to : ''} onPress={() => setPickerTarget('drop')} />
          <Pressable style={styles.swapButton} onPress={onSwap} accessibilityLabel="Swap pickup and drop">
            <ArrowUpDown color={colors.primaryForeground} size={16} strokeWidth={2.5} />
          </Pressable>
        </View>

        <RouteMap pickupLocation={pickupLocation} dropLocation={dropLocation} coordinates={route.coordinates} />
        <View style={styles.routeSummary}>
          <Text style={styles.routeSummaryText}>
            {route.loading ? 'Finding the road route…'
              : route.distanceKm != null ? `${route.distanceKm} km by road${route.durationSec ? ` · about ${formatDuration(route.durationSec)}` : ''}`
                : 'Set pickup and drop to see the route'}
          </Text>
          {route.error ? <Text style={styles.fareDisclaimer}>{route.error}</Text> : null}
        </View>

        <TripTimePicker value={tripDate} onChange={onTripDate} label="Pickup" />
        {tripType === 'ROUND_TRIP' ? (
          <>
            <TripTimePicker
              value={returnDate}
              onChange={onReturnDate}
              label="Return"
              earliestTime={tripDate.getTime() + 60 * 60 * 1000}
              dayCount={30}
            />
            <Text style={styles.roundTripNote}>{days} day{days > 1 ? 's' : ''} · the cab stays with you until you return</Text>
          </>
        ) : null}
      </CardGradient>

      <SectionTitle eyebrow="Choose vehicle" title={tripType === 'LOCAL' ? 'Local ride prices' : 'Prices for this trip'} />
      {quotes.error ? <Text style={styles.quoteError}>{quotes.error}</Text> : null}
      <View style={styles.vehicleOptions}>
        {pricing.categories.map((category) => (
          <VehicleOption
            key={category.key}
            category={category}
            quote={quotes.byKey[category.key]}
            loading={quotes.loading || route.loading}
            selected={category.key === selectedCategory?.key}
            onPress={() => onCarCategory(category.key)}
          />
        ))}
      </View>

      {fare ? (
        <View style={[styles.fareCard, styles.fareCardSpaced]}>
          <Text style={styles.fareLabel}>{selectedCategory.name} · fare details</Text>
          <View style={styles.fareLines}>
            {fare.fixedRoute ? (
              <FareLine label={`Fixed route price (${fare.fixedRoute})`} value={fare.baseFare} />
            ) : (
              <FareLine
                label={tripType === 'LOCAL' ? 'Local ride fare' : tripType === 'ROUND_TRIP' ? `Round trip · ${fare.billedKm} km` : `Distance fare · ${fare.billedKm} km`}
                value={fare.baseFare}
              />
            )}
            {fare.driverAllowance ? <FareLine label={`Driver allowance${fare.days > 1 ? ` · ${fare.days} days` : ''}`} value={fare.driverAllowance} /> : null}
            {fare.tollAndParking ? <FareLine label="Toll & parking" value={fare.tollAndParking} /> : null}
            <FareLine label={`GST (${pricing.gstPercent}%)`} value={fare.gst} />
          </View>
          <View style={styles.fareTotalRow}>
            <View>
              <Text style={styles.fareTotalLabel}>Final payable</Text>
              <Text style={styles.fareTotalSub}>All-inclusive · paid in cash to the driver</Text>
            </View>
            <Text style={styles.fareTotalValue}>{rupees(fare.total)}</Text>
          </View>
        </View>
      ) : null}

      <Pressable
        style={[styles.whatsappButtonOuter, styles.requestButton]}
        onPress={() => onSend(route.distanceKm, fare)}
        disabled={isSubmitting}
      >
        <BrandGradient style={styles.whatsappButton}>
          <Car color={colors.primaryForeground} size={21} strokeWidth={2.5} />
          <Text style={styles.whatsappText}>
            {isSubmitting ? 'Requesting…' : fare ? `Request ${selectedCategory.name} · ${rupees(fare.total)}` : 'Request booking'}
          </Text>
        </BrandGradient>
      </Pressable>
      <View style={styles.paymentRow}>
        <Text style={styles.paymentLabel}>Payment</Text>
        <Text style={styles.paymentValue}>Cash · pay the driver after your trip</Text>
      </View>
      <Text style={styles.noHidden}>SadakYatra confirms your booking, then a driver is assigned</Text>

      <LocationPicker
        visible={Boolean(pickerTarget)}
        title={pickerTarget === 'pickup' ? 'Set pickup pin' : 'Set drop pin'}
        value={pickerTarget === 'pickup' ? from : to}
        initialLocation={pickerTarget === 'pickup' ? pickupLocation : dropLocation}
        onClose={() => setPickerTarget(null)}
        onSelect={(location) => {
          if (pickerTarget === 'pickup') onPickupLocation(location);
          else onDropLocation(location);
          setPickerTarget(null);
        }}
      />

      <SectionTitle eyebrow="Quick pick" title="Popular routes" />
      {ROUTES.slice(0, 5).map((item) => (
        <Pressable key={item.to} style={styles.routeButton} onPress={() => { onFrom(item.from); onTo(item.to); onPickupLocation(placePin(item.from)); onDropLocation(placePin(item.to)); }}>
          <View>
            <Text style={styles.routeButtonMeta}>{item.from} to {item.to}</Text>
            <Text style={styles.routeButtonFare}>{rateSummary(pricing)}</Text>
          </View>
          <ArrowRight color={colors.mutedForeground} size={18} />
        </Pressable>
      ))}
    </View>
  );
}

function defaultEventDate() {
  const date = new Date(Date.now() + 86400000);
  date.setHours(10, 0, 0, 0);
  return date;
}

// Wedding & baraat cars: browse the catalog, then request one or more cars for the event.
function WeddingScreen({ onBooked }) {
  const [vehicles, setVehicles] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [pickup, setPickup] = useState(null);
  const [venue, setVenue] = useState(null);
  const [pickerTarget, setPickerTarget] = useState(null);
  const [eventDate, setEventDate] = useState(defaultEventDate);
  const [withReturn, setWithReturn] = useState(false);
  const [returnDate, setReturnDate] = useState(() => new Date(defaultEventDate().getTime() + 8 * 3600e3));
  const [count, setCount] = useState(1);
  const [requirements, setRequirements] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    getWeddingVehicles()
      .then((result) => setVehicles(result.vehicles || []))
      .catch((error) => setLoadError(error.offline ? 'Wedding cars need internet. You can also ask us on WhatsApp.' : error.message));
  }, []);

  useEffect(() => {
    if (withReturn && returnDate <= eventDate) setReturnDate(new Date(eventDate.getTime() + (selected?.includedHours || 8) * 3600e3));
  }, [withReturn, eventDate.getTime()]);

  function choose(vehicle) {
    setSelected(vehicle);
    setCount(1);
  }

  async function submit() {
    if (!pickup || !venue) return Alert.alert('Add both places', 'Set where the car should report and the wedding venue.');
    setSubmitting(true);
    try {
      const result = await createWeddingBooking({
        weddingVehicleId: selected.id,
        count,
        pickup: pickup.label,
        destination: venue.label,
        pickupLatitude: pickup.latitude,
        pickupLongitude: pickup.longitude,
        dropLatitude: venue.latitude,
        dropLongitude: venue.longitude,
        eventDatetime: eventDate.toISOString(),
        returnDatetime: withReturn ? returnDate.toISOString() : undefined,
        requirements: requirements.trim() || undefined
      });
      Alert.alert('Wedding booking requested', `${result.groupRef} · ${count} × ${selected.name} · ${rupees(result.total)}\nSadakYatra will confirm and assign the car${count > 1 ? 's' : ''}.`);
      setSelected(null);
      onBooked();
    } catch (error) {
      Alert.alert('Could not book', error.offline ? 'No internet. Please try again or book on WhatsApp.' : error.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!selected) {
    return (
      <View>
        <SectionTitle eyebrow="Wedding & Baraat" title="Cars for your big day" subtitle="Choose a car, then tell us the date and venue. Prices are per car." />
        {loadError ? <Text style={styles.quoteError}>{loadError}</Text> : null}
        {!vehicles && !loadError ? <Text style={styles.emptySub}>Loading wedding cars…</Text> : null}
        {(vehicles || []).map((vehicle) => (
          <Pressable key={vehicle.id} onPress={() => choose(vehicle)}>
            <CardGradient style={styles.weddingCard}>
              <Image source={vehicle.imageUrl ? { uri: vehicle.imageUrl } : img.wedding} style={styles.weddingImage} />
              <View style={styles.weddingBody}>
                <View style={styles.rowCenter}>
                  <Text style={[styles.rideName, styles.flex]}>{vehicle.name}</Text>
                  <Text style={styles.weddingPrice}>{rupees(vehicle.price)}</Text>
                </View>
                <Text style={styles.rideMeta}>{vehicle.includedKm} km · {vehicle.includedHours} hours included · per car</Text>
                <Text style={styles.rideMeta}>{vehicle.fuelPolicy}</Text>
                <Text style={styles.rideMeta}>Extra: ₹{vehicle.extraKmRate}/km · ₹{vehicle.extraHourRate}/hour</Text>
                <View style={styles.weddingChoose}><PrimaryButton label="Choose this car" onPress={() => choose(vehicle)} /></View>
              </View>
            </CardGradient>
          </Pressable>
        ))}
        <WhatsAppButton label="Ask about a custom wedding package" message={`Hi ${BRAND.name}! I need wedding cars. Please share packages.`} />
      </View>
    );
  }

  return (
    <View>
      <Pressable style={styles.backLink} onPress={() => setSelected(null)}><Text style={styles.backLinkText}>← All wedding cars</Text></Pressable>
      <CardGradient style={styles.bookingPanel}>
        <View style={styles.rowCenter}>
          <Image source={selected.imageUrl ? { uri: selected.imageUrl } : img.wedding} style={styles.vehicleOptionImage} />
          <View style={styles.flex}>
            <Text style={styles.rideName}>{selected.name}</Text>
            <Text style={styles.rideMeta}>{rupees(selected.price)} per car · {selected.includedKm} km / {selected.includedHours} hrs</Text>
          </View>
        </View>
        <PinField label="Car reports at" value={pickup?.label || ''} onPress={() => setPickerTarget('pickup')} />
        <PinField label="Wedding venue" value={venue?.label || ''} onPress={() => setPickerTarget('venue')} />
        <TripTimePicker value={eventDate} onChange={setEventDate} label="Reporting time" earliestTime={Date.now() + 60 * 60 * 1000} dayCount={60} />
        <Pressable onPress={() => setWithReturn(!withReturn)} style={styles.weddingToggle}>
          <Text style={styles.selectText}>{withReturn ? '☑' : '□'} Add return date & time (for bidai or multi-day)</Text>
        </Pressable>
        {withReturn ? <TripTimePicker value={returnDate} onChange={setReturnDate} label="Return" earliestTime={eventDate.getTime() + 60 * 60 * 1000} dayCount={30} /> : null}
        <View style={styles.fieldBox}>
          <Text style={styles.fieldLabel}>Number of cars</Text>
          <View style={styles.stepper}>
            <Pressable style={styles.stepperButton} onPress={() => setCount(Math.max(1, count - 1))}><Text style={styles.stepperText}>−</Text></Pressable>
            <Text style={styles.stepperValue}>{count}</Text>
            <Pressable style={styles.stepperButton} onPress={() => setCount(Math.min(10, count + 1))}><Text style={styles.stepperText}>+</Text></Pressable>
          </View>
        </View>
        <View style={styles.fieldBox}>
          <Text style={styles.fieldLabel}>Other requirements (optional)</Text>
          <TextInput value={requirements} onChangeText={setRequirements} placeholder="e.g. white car, driver in uniform" placeholderTextColor={colors.placeholder} style={styles.fieldInput} multiline />
        </View>
        <View style={styles.fareTotalRow}>
          <View>
            <Text style={styles.fareTotalLabel}>{count} × {rupees(selected.price)}</Text>
            <Text style={styles.fareTotalSub}>Extra km/hours charged as listed</Text>
          </View>
          <Text style={styles.fareTotalValue}>{rupees(selected.price * count)}</Text>
        </View>
      </CardGradient>
      <Pressable style={[styles.whatsappButtonOuter, styles.requestButton]} onPress={submit} disabled={submitting}>
        <BrandGradient style={styles.whatsappButton}>
          <Heart color={colors.primaryForeground} size={20} strokeWidth={2.5} />
          <Text style={styles.whatsappText}>{submitting ? 'Requesting…' : `Request ${count} car${count > 1 ? 's' : ''} · ${rupees(selected.price * count)}`}</Text>
        </BrandGradient>
      </Pressable>
      <View style={styles.paymentRow}>
        <Text style={styles.paymentLabel}>Payment</Text>
        <Text style={styles.paymentValue}>Cash · pay the driver</Text>
      </View>
      <Text style={styles.noHidden}>SadakYatra confirms your booking, then assigns the car{count > 1 ? 's' : ''}</Text>
      <LocationPicker
        visible={Boolean(pickerTarget)}
        title={pickerTarget === 'pickup' ? 'Where should the car report?' : 'Wedding venue'}
        value={(pickerTarget === 'pickup' ? pickup : venue)?.label || ''}
        initialLocation={pickerTarget === 'pickup' ? pickup : venue}
        onClose={() => setPickerTarget(null)}
        onSelect={(location) => {
          if (pickerTarget === 'pickup') setPickup(location);
          else setVenue(location);
          setPickerTarget(null);
        }}
      />
    </View>
  );
}

function AboutScreen({ lastTrip }) {
  return (
    <View>
      <SectionTitle eyebrow="About" title="Muzaffarpur's trusted cab team" />
      <View style={styles.aboutPanel}>
        <View style={styles.aboutStats}>
          <Stat value={`${BRAND.rating}`} label="Rating" />
          <Stat value={`${BRAND.reviews}+`} label="Reviews" />
          <Stat value="24x7" label="Support" />
        </View>
        <Text style={styles.aboutText}>SadakYatra offers wedding cars, airport transfers, Drop Only cabs, tempo travellers, and local city rides across Bihar.</Text>
        <Pressable style={styles.callWide} onPress={() => Linking.openURL(`tel:${BRAND.phone}`)}>
          <Phone color={colors.primaryForeground} size={18} />
          <Text style={styles.callWideText}>Call {BRAND.phone}</Text>
        </Pressable>
      </View>
      {lastTrip ? (
        <>
          <SectionTitle eyebrow="Last request" title="Recent booking" />
          <View style={styles.lastTrip}>
            <Text style={styles.rideName}>{lastTrip.from} to {lastTrip.to}</Text>
            <Text style={styles.rideMeta}>{lastTrip.service} · {lastTrip.date}</Text>
            <Text style={styles.priceText}>{lastTrip.fare}</Text>
          </View>
        </>
      ) : null}
      <SectionTitle eyebrow="Reviews" title="What customers say" />
      {REVIEWS.map((review) => <ReviewCard key={review.name} review={review} />)}
    </View>
  );
}

function BookingsScreen({ phone, bookings, loading, error, selectedBooking, tracking, events, onRefresh, onSelectBooking, onCancel, onBook, onBack }) {
  const pricing = usePricing();
  if (selectedBooking) {
    const status = bookingStatus(selectedBooking);
    let fare = null;
    try { fare = selectedBooking.fare_breakdown ? JSON.parse(selectedBooking.fare_breakdown) : null; } catch { fare = null; }
    const canCancel = ['PENDING_APPROVAL', 'ON_HOLD', 'APPROVED', 'DRIVER_NOT_FOUND', 'CONFIRMED'].includes(selectedBooking.status);
    return (
      <View style={styles.statusCardOuter}>
        <Pressable style={styles.backLink} onPress={onBack}>
          <Text style={styles.backLinkText}>← All trips</Text>
        </Pressable>
        <View style={styles.statusCard}>
          <View style={styles.detailHeader}>
            <View style={styles.flex}>
              <Text style={styles.bookingLabel}>{selectedBooking.booking_ref}</Text>
              <Text style={styles.detailRoute}>{selectedBooking.pickup_text} → {selectedBooking.drop_text}</Text>
            </View>
            <View style={[styles.statusPill, styles[status.style]]}><Text style={styles.statusLabel}>{status.label}</Text></View>
          </View>
          <Text style={styles.bookingMeta}>
            {selectedBooking.trip_type === 'WEDDING'
              ? `Wedding · ${selectedBooking.wedding_vehicle_name || 'Wedding car'}${selectedBooking.group_size > 1 ? ` · car ${selectedBooking.group_index} of ${selectedBooking.group_size}` : ''}`
              : TRIP_TYPE_LABELS[selectedBooking.trip_type] || 'Trip'} · {formatFriendlyDate(new Date(selectedBooking.trip_datetime))}{selectedBooking.trip_type === 'WEDDING' ? '' : ` · ${categoryLabel(pricing, selectedBooking.car_category)}`}
            {selectedBooking.route_distance_km ? ` · ${selectedBooking.route_distance_km} km` : ''}
          </Text>
          {selectedBooking.return_datetime && selectedBooking.trip_type !== 'WEDDING' ? (
            <Text style={styles.bookingMeta}>Return: {formatFriendlyDate(new Date(selectedBooking.return_datetime))} · {selectedBooking.trip_days} day{selectedBooking.trip_days > 1 ? 's' : ''}</Text>
          ) : null}
          {selectedBooking.status_reason && ['REJECTED', 'CANCELLED', 'ON_HOLD'].includes(selectedBooking.status) ? (
            <Text style={styles.statusReason}>{selectedBooking.status_reason}</Text>
          ) : null}

          {tracking && selectedBooking.status !== 'CANCELLED' ? <LiveCabCard tracking={tracking} /> : null}
          {['PENDING_APPROVAL', 'ON_HOLD'].includes(selectedBooking.status) ? (
            <Text style={styles.emptySub}>SadakYatra is reviewing your booking. You will be notified once it is confirmed.</Text>
          ) : null}
          {['APPROVED', 'DRIVER_NOT_FOUND'].includes(selectedBooking.status) ? (
            <Text style={styles.emptySub}>Confirmed by SadakYatra. We are assigning a driver; their name, phone and car number appear here.</Text>
          ) : null}

          {fare ? (
            <View style={styles.fareCard}>
              <Text style={styles.fareLabel}>Fare</Text>
              <View style={styles.fareLines}>
                <FareLine label={fare.wedding ? `Wedding package · ${fare.includedKm} km / ${fare.includedHours} hrs` : fare.fixedRoute ? `Fixed route price (${fare.fixedRoute})` : fare.billedKm ? `Distance fare · ${fare.billedKm} km` : 'Base fare'} value={fare.baseFare} />
                {fare.driverAllowance ? <FareLine label="Driver allowance" value={fare.driverAllowance} /> : null}
                {fare.tollAndParking ? <FareLine label="Toll & parking" value={fare.tollAndParking} /> : null}
                <FareLine label="GST" value={fare.gst} />
              </View>
              <View style={styles.fareTotalRow}>
                <Text style={styles.fareTotalLabel}>Final payable</Text>
                <Text style={styles.fareTotalValue}>{rupees(fare.total)}</Text>
              </View>
            </View>
          ) : selectedBooking.estimated_fare ? (
            <Text style={styles.priceText}>Final payable: {rupees(selectedBooking.estimated_fare)}</Text>
          ) : null}

          <Text style={styles.fareLabel}>Updates</Text>
          {events.length === 0 ? (
            <Text style={styles.emptySub}>No updates yet.</Text>
          ) : (
            events.map((event) => (
              <View key={event.id} style={styles.timelineItem}>
                <View style={styles.timelineDot} />
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineTitle}>{BOOKING_STATUS[event.new_status]?.label || event.new_status}</Text>
                  <Text style={styles.timelineText}>{[event.note && event.note !== event.new_status ? event.note.replaceAll('_', ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : null, formatFriendlyDate(parseServerTime(event.changed_at))].filter(Boolean).join(' · ')}</Text>
                </View>
              </View>
            ))
          )}

          <View style={styles.detailActions}>
            <Pressable style={styles.secondaryButton} onPress={() => Linking.openURL(`tel:${BRAND.phone}`)}>
              <Phone color={colors.text} size={16} />
              <Text style={styles.secondaryButtonText}>Call support</Text>
            </Pressable>
            {canCancel ? (
              <Pressable style={[styles.secondaryButton, styles.dangerButton]} onPress={() => onCancel(selectedBooking)}>
                <Text style={styles.dangerButtonText}>Cancel booking</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View>
      <SectionTitle eyebrow="My Trips" title="Your bookings" subtitle={`+91 ${normalizePhone(phone)} · pull down to refresh`} />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {!loading && bookings.length === 0 ? (
        <View style={styles.emptyStatePanel}>
          <Text style={styles.emptyTitle}>No trips yet</Text>
          <Text style={styles.emptySub}>Book your first ride and track it live here.</Text>
          <PrimaryButton label="Book a cab" onPress={onBook} />
        </View>
      ) : null}
      {bookings.map((booking) => {
        const status = bookingStatus(booking);
        return (
          <Pressable key={booking.id} style={styles.bookingRow} onPress={() => onSelectBooking(booking.id)}>
            <View style={styles.bookingSummary}>
              <Text style={styles.bookingLabel} numberOfLines={1}>{booking.pickup_text} → {booking.drop_text}</Text>
              <Text style={styles.bookingMeta}>{formatFriendlyDate(new Date(booking.trip_datetime))} · {categoryLabel(pricing, booking.car_category)}{booking.trip_type === 'ROUND_TRIP' ? ' · Round trip' : ''}{booking.wedding_vehicle_name ? ` · ${booking.wedding_vehicle_name}` : ''}</Text>
              <Text style={styles.bookingDetail}>{booking.booking_ref}{booking.estimated_fare ? ` · ${rupees(booking.estimated_fare)}` : ''}</Text>
            </View>
            <View style={[styles.statusPill, styles[status.style]]}>
              <Text style={styles.statusLabel}>{status.label}</Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const DRIVER_STATUS_LABELS = {
  OFFERED: 'Finding your cab',
  BOOKING_REJECTED: 'Finding another cab',
  BOOKING_ACCEPTED: 'Booking accepted',
  GOING_TO_PICKUP: 'Driver is on the way',
  ARRIVED: 'Driver has arrived',
  TRIP_STARTED: 'Trip started',
  TRIP_COMPLETED: 'Trip completed'
};
const ASSIGNED_STATUSES = ['BOOKING_ACCEPTED', 'GOING_TO_PICKUP', 'ARRIVED', 'TRIP_STARTED', 'TRIP_COMPLETED'];

// Road ETA from the cab's live position to the pickup (or to the drop once the trip has started).
function useCabEta(tracking) {
  const [etaMinutes, setEtaMinutes] = useState(null);
  const headingToDrop = tracking?.driver_status === 'TRIP_STARTED';
  const target = headingToDrop
    ? { latitude: tracking?.drop_latitude, longitude: tracking?.drop_longitude }
    : { latitude: tracking?.pickup_latitude, longitude: tracking?.pickup_longitude };
  const active = ['BOOKING_ACCEPTED', 'GOING_TO_PICKUP', 'TRIP_STARTED'].includes(tracking?.driver_status);

  useEffect(() => {
    if (!active || tracking?.latitude == null || target.latitude == null) {
      setEtaMinutes(null);
      return undefined;
    }
    const controller = new AbortController();
    fetch(`https://router.project-osrm.org/route/v1/driving/${tracking.longitude},${tracking.latitude};${target.longitude},${target.latitude}?overview=false`, { signal: controller.signal })
      .then((response) => response.json())
      .then((result) => {
        const seconds = result.routes?.[0]?.duration;
        setEtaMinutes(Number.isFinite(seconds) ? Math.max(1, Math.round(seconds / 60)) : null);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [active, tracking?.latitude, tracking?.longitude, target.latitude, target.longitude]);

  return { etaMinutes, headingToDrop };
}

function LiveCabCard({ tracking }) {
  const { etaMinutes, headingToDrop } = useCabEta(tracking);
  const assigned = ASSIGNED_STATUSES.includes(tracking.driver_status);
  const hasLocation = tracking.latitude != null && tracking.longitude != null;
  const hasPickup = tracking.pickup_latitude != null && tracking.pickup_longitude != null;
  const statusLabel = DRIVER_STATUS_LABELS[tracking.driver_status] || 'Waiting for cab assignment';

  if (!assigned) {
    return (
      <View style={styles.liveCab}>
        <Text style={styles.liveCabStatus}>{statusLabel}</Text>
        <Text style={styles.emptySub}>Cab and driver details appear here as soon as a driver accepts your booking.</Text>
      </View>
    );
  }

  return (
    <View style={styles.liveCab}>
      {hasLocation ? (
        <MapView
          style={styles.trackingMap}
          region={{ latitude: tracking.latitude, longitude: tracking.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        >
          <Marker coordinate={{ latitude: tracking.latitude, longitude: tracking.longitude }} title={tracking.plate_no || 'Your cab'} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.carMarker}><Car color={colors.primaryForeground} size={18} strokeWidth={2.5} /></View>
          </Marker>
          {hasPickup && !headingToDrop ? (
            <Marker coordinate={{ latitude: tracking.pickup_latitude, longitude: tracking.pickup_longitude }} title="Pickup" pinColor="green" />
          ) : null}
          {headingToDrop && tracking.drop_latitude != null ? (
            <Marker coordinate={{ latitude: tracking.drop_latitude, longitude: tracking.drop_longitude }} title="Drop" />
          ) : null}
        </MapView>
      ) : null}
      <View style={styles.liveCabBody}>
        <View style={styles.liveCabHeader}>
          <Text style={styles.liveCabStatus}>{statusLabel}</Text>
          {etaMinutes != null ? <Text style={styles.liveCabEta}>{headingToDrop ? 'Drop' : 'Arrives'} in ~{etaMinutes} min</Text> : null}
        </View>
        <Text style={styles.liveCabDetail}>{tracking.driver_name || 'Driver'} · {tracking.plate_no || 'Cab number pending'}</Text>
        <Text style={styles.liveCabMeta}>{[tracking.vehicle_model, CATEGORY_NAMES[tracking.car_category] || tracking.car_category].filter(Boolean).join(' · ')}</Text>
        {!hasLocation && tracking.driver_status !== 'TRIP_COMPLETED' ? <Text style={styles.emptySub}>Live location appears when the driver is online.</Text> : null}
        {tracking.driver_phone ? (
          <Pressable style={styles.liveCabCall} onPress={() => Linking.openURL(`tel:${tracking.driver_phone}`)}>
            <Phone color={colors.primaryForeground} size={16} />
            <Text style={styles.liveCabCallText}>Call driver</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function TripTimePicker({ value, onChange, label = 'Pickup', earliestTime, dayCount = 7 }) {
  const earliest = earliestTime ?? Date.now() + 30 * 60 * 1000;
  const days = Array.from({ length: dayCount }, (_, index) => {
    const day = new Date(earliest);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + index);
    return day;
  });
  const selectedDay = new Date(value);
  selectedDay.setHours(0, 0, 0, 0);
  const slots = Array.from({ length: 48 }, (_, index) => {
    const slot = new Date(selectedDay);
    slot.setMinutes(index * 30);
    return slot;
  }).filter((slot) => slot.getTime() >= earliest);

  function pickDay(day) {
    const next = new Date(day);
    next.setHours(value.getHours(), value.getMinutes(), 0, 0);
    if (next.getTime() < earliest) {
      const first = new Date(earliest);
      first.setMinutes(first.getMinutes() <= 30 ? 30 : 60, 0, 0);
      onChange(first);
    } else {
      onChange(next);
    }
  }

  return (
    <View style={styles.fieldBox}>
      <View style={styles.fieldLabelRow}><Calendar color={colors.primary} size={14} /><Text style={styles.fieldLabel}>{label} · {formatFriendlyDate(value)}</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {days.map((day, index) => {
          const active = day.getTime() === selectedDay.getTime();
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const offset = Math.round((day - today) / 86400000);
          const dayLabel = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : day.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
          return (
            <Pressable key={day.toISOString()} style={[styles.selectPill, active && styles.selectPillActive]} onPress={() => pickDay(day)}>
              <Text style={[styles.selectText, active && styles.selectTextActive]}>{dayLabel}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {slots.length === 0 ? <Text style={styles.fareDisclaimer}>No more times on this day — choose the next day.</Text> : null}
        {slots.map((slot) => {
          const active = slot.getTime() === value.getTime();
          return (
            <Pressable key={slot.toISOString()} style={[styles.selectPill, active && styles.selectPillActive]} onPress={() => onChange(slot)}>
              <Text style={[styles.selectText, active && styles.selectTextActive]}>{slot.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function FareLine({ label, value }) {
  return (
    <View style={styles.fareLine}>
      <Text style={styles.fareLineLabel}>{label}</Text>
      <Text style={styles.fareLineValue}>{rupees(value)}</Text>
    </View>
  );
}

function PinField({ label, value, onPress }) {
  return (
    <Pressable style={styles.pinField} onPress={onPress}>
      <View style={styles.fieldLabelRow}>
        <MapPin color={colors.primary} size={14} />
        <Text style={styles.fieldLabel}>{label}</Text>
      </View>
      <View style={styles.pinFieldValueRow}>
        <Text style={styles.pinFieldValue} numberOfLines={2}>{value || 'Choose a location on the map'}</Text>
        <Text style={styles.pinFieldAction}>Set pin</Text>
      </View>
    </Pressable>
  );
}

// Ola/Uber style: the pin stays in the centre and the customer moves the map under it.
function LocationPicker({ visible, title, value, initialLocation, onClose, onSelect }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [locating, setLocating] = useState(false);
  const mapRef = useRef(null);
  const [query, setQuery] = useState(value || '');
  const [selectedLocation, setSelectedLocation] = useState(initialLocation || DEFAULT_PIN);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [resolving, setResolving] = useState(false);
  // A fresh map each time the picker opens, so it always starts at the right place.
  const [openCount, setOpenCount] = useState(0);
  // Where we moved the map ourselves (opening, search result): stopping there keeps that place's name.
  const namedSpotRef = useRef(null);
  const lookupRef = useRef(0);

  useEffect(() => {
    if (!visible) return;
    const point = initialLocation || DEFAULT_PIN;
    namedSpotRef.current = point;
    setQuery(value || point.label || '');
    setSelectedLocation({ label: value || point.label, latitude: point.latitude, longitude: point.longitude });
    setResults([]);
    setSearchError(null);
    setOpenCount((count) => count + 1);
  }, [visible]);

  async function searchPlaces() {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const near = selectedLocation || DEFAULT_PIN;
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(`${query.trim()}, India`)}&lat=${near.latitude}&lon=${near.longitude}&limit=8`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Location search is temporarily unavailable.');
      const data = await response.json();
      setResults(data.features || []);
      if (!data.features?.length) setSearchError('No matching places found. Move the map to place the pin yourself.');
    } catch (error) {
      setSearchError(error.message || 'Location search is temporarily unavailable.');
    } finally {
      setSearching(false);
    }
  }

  function labelForFeature(properties) {
    return [...new Set([properties.name, properties.street, properties.city, properties.district, properties.state].filter(Boolean))].slice(0, 3).join(', ');
  }

  function moveMapTo(latitude, longitude, delta = 0.01) {
    namedSpotRef.current = { latitude, longitude };
    mapRef.current?.animateToRegion({ latitude, longitude, latitudeDelta: delta, longitudeDelta: delta }, 400);
  }

  function chooseFeature(feature) {
    const [longitude, latitude] = feature.geometry.coordinates;
    const label = labelForFeature(feature.properties) || 'Pinned location';
    setSelectedLocation({ label, latitude, longitude });
    setQuery(label);
    setResults([]);
    moveMapTo(latitude, longitude);
  }

  // The map stopped moving: the centre is the new pin; look up its address unless we just chose a named place.
  async function onCentreChanged(region) {
    const point = { latitude: region.latitude, longitude: region.longitude };
    const named = namedSpotRef.current;
    if (named && Math.abs(named.latitude - point.latitude) < 0.0003 && Math.abs(named.longitude - point.longitude) < 0.0003) {
      setSelectedLocation((current) => ({ ...current, ...point }));
      return;
    }
    namedSpotRef.current = null;
    const lookup = ++lookupRef.current;
    setSelectedLocation({ label: 'Finding address…', ...point });
    setResolving(true);
    try {
      const response = await fetch(`https://photon.komoot.io/reverse?lon=${point.longitude}&lat=${point.latitude}`);
      const data = await response.json();
      const properties = data.features?.[0]?.properties;
      const label = (properties && labelForFeature(properties)) || 'Pinned location';
      if (lookup !== lookupRef.current) return; // the map moved again meanwhile
      setSelectedLocation({ label, ...point });
      setQuery(label);
    } catch {
      if (lookup === lookupRef.current) setSelectedLocation({ label: 'Pinned location', ...point });
    } finally {
      if (lookup === lookupRef.current) setResolving(false);
    }
  }

  async function useCurrentLocation() {
    setLocating(true);
    setSearchError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Allow location access, or search / move the map instead.');
      const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      namedSpotRef.current = null;
      mapRef.current?.animateToRegion({ latitude: coords.latitude, longitude: coords.longitude, latitudeDelta: 0.008, longitudeDelta: 0.008 }, 400);
    } catch (error) {
      setSearchError(error.message || 'Could not get your location.');
    } finally {
      setLocating(false);
    }
  }

  const mapHeight = Math.max(280, height * 0.5);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.locationPicker, { paddingTop: insets.top + 8, paddingBottom: insets.bottom }]}>
        <View style={styles.locationPickerHeader}>
          <View style={styles.flex}>
            <Text style={styles.locationPickerTitle}>{title}</Text>
            <Text style={styles.locationPickerSubtitle}>Search, or move the map so the pin sits on the exact spot.</Text>
          </View>
          <Pressable style={styles.pickerClose} onPress={onClose} accessibilityLabel="Close map">
            <Text style={styles.pickerCloseText}>Close</Text>
          </Pressable>
        </View>
        <View style={styles.pickerSearchRow}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={searchPlaces}
            returnKeyType="search"
            placeholder="Search area, station, landmark"
            placeholderTextColor={colors.placeholder}
            style={styles.pickerSearchInput}
          />
          <Pressable style={styles.pickerSearchButton} onPress={searchPlaces} disabled={searching}>
            <Search color={colors.primaryForeground} size={18} />
          </Pressable>
        </View>
        {results.length > 0 ? (
          <ScrollView style={styles.locationResults} keyboardShouldPersistTaps="handled">
            {results.map((feature, index) => (
              <Pressable key={`${feature.geometry.coordinates.join(',')}-${index}`} style={styles.locationResult} onPress={() => chooseFeature(feature)}>
                <MapPin color={colors.primary} size={16} />
                <Text style={styles.locationResultText}>{labelForFeature(feature.properties)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        <Pressable style={styles.currentLocationButton} onPress={useCurrentLocation} disabled={locating}>
          <LocateFixed color={colors.primary} size={16} />
          <Text style={styles.currentLocationText}>{locating ? 'Finding you…' : 'Use my current location'}</Text>
        </Pressable>
        {searchError ? <Text style={styles.searchError}>{searchError}</Text> : null}
        <View style={{ height: mapHeight }}>
          <MapView
            key={openCount}
            ref={mapRef}
            style={styles.locationMapFill}
            initialRegion={{ latitude: selectedLocation.latitude, longitude: selectedLocation.longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 }}
            onRegionChangeComplete={onCentreChanged}
            showsUserLocation
          />
          <View pointerEvents="none" style={styles.centerPinWrap}>
            <View style={styles.centerPinHead}><MapPin color={colors.primaryForeground} size={22} strokeWidth={2.6} /></View>
            <View style={styles.centerPinStem} />
            <View style={styles.centerPinShadow} />
          </View>
        </View>
        <View style={styles.pinConfirmRow}>
          <Text style={styles.pinCoords} numberOfLines={2}>{selectedLocation.label}</Text>
          <Pressable
            style={[styles.pinConfirmButton, resolving && styles.pinConfirmDisabled]}
            onPress={() => onSelect(selectedLocation)}
            disabled={resolving}
          >
            <Text style={styles.pinConfirmText}>{resolving ? 'Wait…' : 'Use this pin'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function SelectField({ icon: Icon, label, value, options, onValue }) {
  return (
    <View style={styles.fieldBox}>
      <View style={styles.fieldLabelRow}><Icon color={colors.primary} size={14} /><Text style={styles.fieldLabel}>{label}</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {options.map((option) => {
          const optionValue = typeof option === 'string' ? option : option.value;
          const optionLabel = typeof option === 'string' ? option : option.label;
          return (
          <Pressable key={optionValue} style={[styles.selectPill, value === optionValue && styles.selectPillActive]} onPress={() => onValue(optionValue)}>
            <Text style={[styles.selectText, value === optionValue && styles.selectTextActive]}>{optionLabel}</Text>
          </Pressable>
        );})}
      </ScrollView>
    </View>
  );
}

function RouteRow({ route, onPress }) {
  const pricing = usePricing();
  return (
    <Pressable style={styles.routeRow} onPress={onPress}>
      <View style={styles.clockIcon}><Clock color={colors.primary} size={18} /></View>
      <View style={styles.flex}>
        <Text style={styles.routeTitle}>{route.from} to {route.to}</Text>
        <Text style={styles.routeMeta}>{rateSummary(pricing)}</Text>
      </View>
      <ChevronRight color={colors.mutedForeground} size={18} />
    </Pressable>
  );
}

function WeddingPromo({ onPress }) {
  return (
    <Pressable style={styles.weddingPromoOuter} onPress={onPress}>
      <CardGradient style={styles.weddingPromo}>
        <View style={styles.weddingGlow} />
        <View style={styles.weddingContent}>
          <View style={styles.weddingBadge}><Sparkles color={colors.primary} size={12} /><Text style={styles.weddingLabel}>Wedding Season</Text></View>
          <Text style={styles.weddingTitle}>Cars for your <Text style={styles.yellowText}>wedding & baraat</Text></Text>
          <Text style={styles.weddingSub}>Sedan to Innova · experienced chauffeur · price per car</Text>
          <View style={styles.viewPackages}><Text style={styles.viewPackagesText}>View cars</Text><ArrowUpRight color={colors.primary} size={16} /></View>
        </View>
      </CardGradient>
    </Pressable>
  );
}

function WhatsAppButton({ label, message }) {
  return (
    <Pressable style={styles.smallCtaOuter} onPress={() => Linking.openURL(wa(message))}>
      <BrandGradient style={styles.smallCta}>
        <MessageCircle color={colors.primaryForeground} size={16} />
        <Text style={styles.smallCtaText}>{label}</Text>
      </BrandGradient>
    </Pressable>
  );
}

function SafetyStrip({ onReviews }) {
  return (
    <View style={styles.safetySection}>
      <View style={styles.safetyCard}>
        <View style={styles.successIcon}><ShieldCheck color={colors.success} size={20} /></View>
        <View style={styles.flex}>
          <Text style={styles.safetyTitle}>Your safety, our priority</Text>
          <Text style={styles.safetySub}>Verified drivers · sanitized cabs · 24x7 support</Text>
        </View>
      </View>
      <Pressable style={styles.ratingCard} onPress={onReviews}>
        <View style={styles.ratingPill}><Star color={colors.primary} fill={colors.primary} size={13} /><Text style={styles.ratingPillText}>{BRAND.rating}</Text></View>
        <Text style={styles.ratingText}>{BRAND.reviews}+ Google reviews</Text>
        <Text style={styles.readText}>Read →</Text>
      </Pressable>
      <View style={styles.quickBookRow}>
        <WhatsAppButton label="Quick book on WhatsApp" message={`Hi ${BRAND.name}! I want to book a cab.`} />
        <Pressable style={styles.callSquare} onPress={() => Linking.openURL(`tel:${BRAND.phone}`)}>
          <Phone color={colors.primary} size={20} />
        </Pressable>
      </View>
    </View>
  );
}

function SectionTitle({ eyebrow, title, action, onAction, subtitle }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.flex}>
        <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {action ? <Pressable onPress={onAction} hitSlop={10}><Text style={styles.sectionAction}>{action}</Text></Pressable> : null}
    </View>
  );
}

function Stat({ value, label }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ReviewCard({ review }) {
  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHeader}>
        <Text style={styles.reviewName}>{review.name}</Text>
        <View style={styles.reviewStars}><Star color={colors.primary} fill={colors.primary} size={14} /><Text style={styles.reviewRating}>{review.rating}</Text></View>
      </View>
      <Text style={styles.reviewText}>{review.text}</Text>
    </View>
  );
}

function BottomNav({ tab, onTab, bottomInset }) {
  return (
    <View style={[styles.bottomNav, { bottom: Math.max(bottomInset, 8) + 4 }]}>
      {TABS.map((item) => {
        const Icon = item.icon;
        const active = tab === item.id;
        if (item.primary) {
          return (
            <Pressable key={item.id} style={styles.primaryNavItem} onPress={() => onTab(item.id)}>
              <BrandGradient style={styles.primaryNavCircle}><Icon color={colors.primaryForeground} size={24} strokeWidth={2.5} /></BrandGradient>
              <Text style={styles.primaryNavText}>{item.label}</Text>
            </Pressable>
          );
        }
        return (
          <Pressable key={item.id} style={styles.navItem} onPress={() => onTab(item.id)}>
            <Icon color={active ? colors.primary : colors.mutedForeground} size={21} strokeWidth={active ? 2.5 : 2} />
            <Text style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>
            {active ? <View style={styles.navDot} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const colors = {
  bg: '#0A0A0A',
  surface: '#141414',
  surfaceElevated: '#1C1C1C',
  card: '#1C1C1C',
  cardEnd: '#141414',
  text: '#FFFFFF',
  muted: '#9A9A9A',
  mutedForeground: '#9A9A9A',
  border: '#2E2E2E',
  borderStrong: '#4A4A4A',
  input: '#1C1C1C',
  primary: '#FFCC00',
  primaryGlow: '#FFD633',
  primaryForeground: '#0A0A0A',
  destructive: '#F94144',
  success: '#4CC157',
  whatsapp: '#2EB45C',
  placeholder: '#9A9A9A',
  yellow: '#FFCC00',
  black: '#0A0A0A'
};

const styles = StyleSheet.create(largerText({
  locationMapFill: { ...StyleSheet.absoluteFillObject },
  centerPinWrap: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingBottom: 44 },
  centerPinHead: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFCC00', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#0A0A0A' },
  centerPinStem: { width: 3, height: 14, backgroundColor: '#0A0A0A' },
  centerPinShadow: { width: 12, height: 5, borderRadius: 6, backgroundColor: 'rgba(0,0,0,0.35)' },
  pinConfirmDisabled: { opacity: 0.5 },
  serviceList: { marginHorizontal: 16, gap: 12 },
  serviceCard: { borderRadius: 18, borderWidth: 1, borderColor: '#2E2E2E', backgroundColor: '#141414', padding: 16 },
  serviceCardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  serviceIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: '#FFCC00', alignItems: 'center', justifyContent: 'center' },
  serviceCardTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  serviceCardShort: { color: '#FFCC00', fontSize: 12, fontWeight: '700', marginTop: 2 },
  serviceCardText: { color: '#B8B8B8', fontSize: 13, lineHeight: 19, marginTop: 12 },
  serviceChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  serviceChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, borderWidth: 1, borderColor: '#2E2E2E', paddingHorizontal: 10, paddingVertical: 5 },
  serviceChipText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  serviceActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  serviceBookButton: { flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: '#FFCC00', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  serviceBookText: { color: '#0A0A0A', fontSize: 14, fontWeight: '900' },
  serviceAskButton: { minHeight: 46, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: '#2E2E2E', flexDirection: 'row', alignItems: 'center', gap: 6 },
  serviceAskText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  paymentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#2E2E2E' },
  paymentLabel: { color: '#9A9A9A', fontSize: 12, fontWeight: '700' },
  paymentValue: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  tripTabs: { flexDirection: 'row', marginHorizontal: 16, marginTop: 16, padding: 4, borderRadius: 16, backgroundColor: '#1C1C1C', borderWidth: 1, borderColor: '#2E2E2E' },
  tripTab: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tripTabActive: { backgroundColor: '#FFCC00' },
  tripTabText: { color: '#B8B8B8', fontSize: 14, fontWeight: '800' },
  tripTabTextActive: { color: '#0A0A0A', fontWeight: '900' },
  routeMap: { height: 190, borderRadius: 14, marginTop: 12, overflow: 'hidden' },
  routeSummary: { marginTop: 10, marginBottom: 4 },
  routeSummaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  roundTripNote: { color: '#FFCC00', fontSize: 12, fontWeight: '700', marginTop: -4, marginBottom: 6 },
  vehicleOptions: { marginHorizontal: 16, gap: 10 },
  vehicleOption: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1.5, borderColor: '#2E2E2E', backgroundColor: '#161616' },
  vehicleOptionSelected: { borderColor: '#FFCC00', backgroundColor: 'rgba(255,204,0,0.08)' },
  vehicleOptionImage: { width: 64, height: 44, borderRadius: 8 },
  vehicleOptionName: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  vehicleOptionMeta: { color: '#9A9A9A', fontSize: 12, marginTop: 2 },
  vehicleOptionTag: { color: '#FFCC00', fontSize: 11, fontWeight: '800', marginTop: 3 },
  vehicleOptionPriceBox: { alignItems: 'flex-end' },
  vehicleOptionPrice: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  vehicleOptionPriceSelected: { color: '#FFCC00' },
  vehicleOptionUnit: { color: '#9A9A9A', fontSize: 10, marginTop: 2 },
  fareCardSpaced: { marginHorizontal: 16, marginTop: 14 },
  requestButton: { marginHorizontal: 16, marginTop: 16 },
  quoteError: { color: '#F08080', fontSize: 13, marginHorizontal: 16, marginBottom: 8 },
  weddingCard: { marginHorizontal: 16, marginBottom: 14, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: '#2E2E2E' },
  weddingImage: { width: '100%', height: 170 },
  weddingBody: { padding: 14 },
  weddingPrice: { color: '#FFCC00', fontSize: 20, fontWeight: '900' },
  weddingDecor: { color: '#FFFFFF', fontSize: 12, marginTop: 6 },
  weddingChoose: { marginTop: 12, alignSelf: 'flex-start' },
  weddingToggle: { paddingVertical: 10 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 6 },
  stepperButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFCC00', alignItems: 'center', justifyContent: 'center' },
  stepperText: { color: '#0A0A0A', fontSize: 24, fontWeight: '900' },
  stepperValue: { color: '#FFFFFF', fontSize: 22, fontWeight: '900', minWidth: 28, textAlign: 'center' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  statusReason: { color: '#F5A623', fontSize: 13, marginTop: 6 },
  screen: { flex: 1, backgroundColor: colors.bg },
  disabled: { opacity: 0.5 },
  rowCenterGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  header: {
    paddingTop: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: 'rgba(14,13,11,0.96)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  logoWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.36,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8
  },
  logoMark: { width: 38, height: 38, borderRadius: 11 },
  brandLogo: { backgroundColor: '#FFFFFF', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 },
  brandLogoImage: { width: 124, height: 38 },
  logoInitial: { color: colors.primaryForeground, fontSize: 20, fontWeight: '900' },
  headerText: { flex: 1 },
  logoTitle: { color: colors.text, fontSize: 16, fontWeight: '900', letterSpacing: -0.4 },
  logoAccent: { color: colors.primary },
  logoSub: { color: colors.muted, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAction: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 10 },
  headerActionText: { color: colors.primary, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  callButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  menuButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  drawerOverlay: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(0,0,0,0.62)' },
  drawerBackdrop: { ...StyleSheet.absoluteFillObject },
  drawerPanel: { width: '84%', maxWidth: 360, height: '100%', backgroundColor: colors.bg, paddingHorizontal: 16, borderRightWidth: 1, borderRightColor: colors.border },
  drawerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 22, borderBottomWidth: 1, borderBottomColor: colors.border },
  drawerClose: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  drawerCloseText: { color: colors.text, fontSize: 25, lineHeight: 28 },
  drawerEyebrow: { color: colors.muted, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginTop: 22, marginBottom: 8 },
  drawerItem: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 11, borderBottomWidth: 1, borderBottomColor: 'rgba(75,71,66,0.45)' },
  drawerIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(255,204,0,0.12)', alignItems: 'center', justifyContent: 'center' },
  drawerItemText: { color: colors.text, flex: 1, fontSize: 14, fontWeight: '700' },
  drawerDivider: { height: 1, backgroundColor: colors.border, marginTop: 20 },
  drawerCall: { minHeight: 48, marginTop: 12, borderRadius: 14, backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  drawerCallText: { color: colors.primaryForeground, fontSize: 13, fontWeight: '900' },
  mapHero: { height: 340, justifyContent: 'space-between' },
  mapHeroImage: { opacity: 0.72 },
  mapOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(14,13,11,0.34)' },
  heroCopy: { padding: 20 },
  eyebrow: { color: colors.muted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 2.2 },
  heroTitle: { color: colors.text, fontSize: 29, fontWeight: '900', marginTop: 4 },
  pinPulse: { position: 'absolute', alignSelf: 'center', top: 162, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,204,0,0.24)', alignItems: 'center', justifyContent: 'center' },
  pinCore: { width: 20, height: 20, borderRadius: 10, borderWidth: 4, borderColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  pinDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primaryForeground },
  whereCardOuter: {
    marginHorizontal: 16,
    marginTop: -64,
    borderRadius: 24,
    shadowColor: '#000000',
    shadowOpacity: 0.7,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 20 },
    elevation: 16
  },
  whereCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(75,71,66,0.70)',
    padding: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  iconBox: { width: 46, height: 46, borderRadius: 16, backgroundColor: 'rgba(255,204,0,0.15)', alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  whereEyebrow: { color: colors.primary, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.1 },
  whereTitle: { color: colors.text, fontSize: 19, fontWeight: '900', marginTop: 1 },
  yellowCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  routePreview: { margin: 16, borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 15, flexDirection: 'row', gap: 12 },
  routeRail: { alignItems: 'center', paddingTop: 4 },
  dotYellow: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.yellow },
  railLine: { height: 34, width: 1, backgroundColor: colors.border, marginVertical: 4 },
  dotSquare: { width: 10, height: 10, borderRadius: 2, backgroundColor: colors.text },
  inputTiny: { color: colors.muted, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.1 },
  inputStrong: { color: colors.text, fontSize: 14, fontWeight: '800', marginTop: 2 },
  mutedStrong: { color: colors.muted, fontSize: 14, fontWeight: '800', marginTop: 2 },
  dashedLine: { height: 1, borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.border, marginVertical: 11 },
  addDestination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  plus: { color: colors.yellow, fontSize: 24, fontWeight: '700' },
  pillRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 2 },
  quickPill: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 10 },
  smallIcon: { width: 32, height: 32, borderRadius: 12, backgroundColor: 'rgba(255,204,0,0.15)', alignItems: 'center', justifyContent: 'center' },
  quickLabel: { color: colors.text, fontSize: 12, fontWeight: '800' },
  quickSub: { color: colors.muted, fontSize: 10, marginTop: 1 },
  sectionHeader: { paddingHorizontal: 16, marginTop: 28, marginBottom: 11, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  sectionEyebrow: { color: colors.yellow, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 2 },
  sectionTitle: { color: colors.text, fontSize: 21, fontWeight: '900', marginTop: 3 },
  sectionSubtitle: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 6, maxWidth: 320 },
  sectionAction: { color: colors.yellow, fontSize: 12, fontWeight: '800' },
  listGap: { paddingHorizontal: 16, gap: 9 },
  rideRow: {
    flexDirection: 'row',
    gap: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 11,
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.42,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 7
  },
  rideImage: { width: 88, height: 62, borderRadius: 15 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  rideName: { color: colors.text, fontSize: 14, fontWeight: '900' },
  rideMeta: { color: colors.muted, fontSize: 11, marginTop: 3 },
  rideFeature: { color: colors.muted, fontSize: 11, marginTop: 8 },
  badge: { color: colors.primary, backgroundColor: 'rgba(255,204,0,0.20)', borderRadius: 999, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 2, fontSize: 9, fontWeight: '900' },
  priceBlock: { alignItems: 'flex-end' },
  priceText: { color: colors.text, fontSize: 15, fontWeight: '900' },
  priceUnit: { color: colors.muted, fontSize: 10, marginTop: 2 },
  fleetArticleList: { paddingHorizontal: 16, gap: 16 },
  partnerSection: { marginTop: 10, paddingHorizontal: 16, paddingBottom: 20 },
  partnerPanel: { borderRadius: 18, borderWidth: 1, borderColor: colors.border, padding: 12 },
  partnerDisclosure: { color: colors.muted, fontSize: 11, lineHeight: 17, marginBottom: 12 },
  partnerMessage: { color: colors.primary, fontSize: 12, lineHeight: 18, marginBottom: 10 },
  fleetArticle: {
    overflow: 'hidden',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8
  },
  fleetImageWrap: { height: 192, backgroundColor: colors.surface, position: 'relative' },
  fleetImage: { width: '100%', height: '100%' },
  fleetBadge: {
    position: 'absolute',
    left: 12,
    top: 12,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: colors.primary,
    color: colors.primaryForeground,
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontSize: 10,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1
  },
  seatBadge: {
    position: 'absolute',
    right: 12,
    top: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(14,13,11,0.70)',
    paddingHorizontal: 10,
    paddingVertical: 5
  },
  seatBadgeText: { color: colors.text, fontSize: 10, fontWeight: '800' },
  fleetBody: { padding: 20 },
  fleetTitle: { color: colors.text, fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
  fleetModels: { color: colors.muted, fontSize: 14, marginTop: 3 },
  featureList: { marginTop: 16, gap: 9 },
  featureRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  featureText: { color: colors.text, fontSize: 14, flex: 1 },
  fleetFooter: { marginTop: 20, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  startsFrom: { color: colors.muted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.1 },
  fleetPrice: { color: colors.primary, fontSize: 24, fontWeight: '900', marginTop: 2 },
  routeRow: { marginHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  clockIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  routeTitle: { color: colors.text, fontSize: 14, fontWeight: '800' },
  routeMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
  weddingPromoOuter: { marginHorizontal: 16, marginTop: 20, borderRadius: 24 },
  weddingPromo: {
    minHeight: 176,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,204,0,0.30)',
    padding: 20,
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8
  },
  weddingGlow: { position: 'absolute', right: -24, top: -24, width: 128, height: 128, borderRadius: 64, backgroundColor: 'rgba(255,204,0,0.15)' },
  weddingContent: { flex: 1, justifyContent: 'flex-start' },
  weddingBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: 'rgba(255,204,0,0.15)', paddingHorizontal: 8, paddingVertical: 3 },
  weddingLabel: { color: colors.primary, textTransform: 'uppercase', letterSpacing: 1.2, fontSize: 10, fontWeight: '900' },
  weddingTitle: { color: colors.text, fontSize: 21, fontWeight: '900', marginTop: 12, lineHeight: 27 },
  weddingSub: { color: colors.muted, fontSize: 12, marginTop: 5 },
  viewPackages: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
  viewPackagesText: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  safetySection: { marginTop: 24, paddingHorizontal: 16, gap: 12 },
  safetyCard: { borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  successIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(76,193,87,0.20)' },
  safetyTitle: { color: colors.text, fontSize: 14, fontWeight: '900' },
  safetySub: { color: colors.muted, fontSize: 11, marginTop: 3 },
  ratingCard: { borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10 },
  ratingPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: 'rgba(255,204,0,0.15)', paddingHorizontal: 10, paddingVertical: 5 },
  ratingPillText: { color: colors.text, fontSize: 12, fontWeight: '900' },
  ratingText: { color: colors.muted, fontSize: 12, flex: 1 },
  readText: { color: colors.primary, fontSize: 12, fontWeight: '900' },
  quickBookRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  smallCtaOuter: { flex: 1, borderRadius: 17, shadowColor: colors.primary, shadowOpacity: 0.30, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 7 },
  smallCta: { minHeight: 50, borderRadius: 17, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  smallCtaText: { color: colors.primaryForeground, fontSize: 13, fontWeight: '900' },
  emptyStatePanel: { margin: 16, padding: 22, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center', gap: 10 },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  emptySub: { color: colors.muted, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  syncText: { color: colors.muted, fontSize: 12, marginHorizontal: 16, marginBottom: 10 },
  errorText: { color: colors.destructive, fontSize: 12, marginHorizontal: 16, marginBottom: 10 },
  bookingRow: { marginHorizontal: 16, marginBottom: 12, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  bookingSummary: { flex: 1, gap: 4 },
  bookingLabel: { color: colors.text, fontSize: 13, fontWeight: '900' },
  bookingMeta: { color: colors.muted, fontSize: 11, marginTop: 4 },
  bookingDetail: { color: colors.muted, fontSize: 10, marginTop: 6 },
  statusPill: { minWidth: 86, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 10, alignItems: 'center' },
  statusLabel: { color: colors.text, fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  statusLabelLarge: { color: colors.primary, fontSize: 18, fontWeight: '900', marginTop: 14 },
  statusCardOuter: { paddingTop: 12 },
  statusCard: { marginHorizontal: 16, marginBottom: 24, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 16, gap: 12 },
  backLink: { marginHorizontal: 16, marginBottom: 10, paddingVertical: 6 },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  detailRoute: { color: colors.text, fontSize: 16, fontWeight: '900', marginTop: 4 },
  detailActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  secondaryButton: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, borderColor: colors.borderStrong, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  secondaryButtonText: { color: colors.text, fontSize: 13, fontWeight: '800' },
  dangerButton: { borderColor: 'rgba(249,65,68,0.55)' },
  dangerButtonText: { color: colors.destructive, fontSize: 13, fontWeight: '800' },
  inlinePanel: { marginHorizontal: 16, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 12 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  phonePrefix: { color: colors.muted, fontSize: 14, fontWeight: '800', marginTop: 6 },
  swapButton: { position: 'absolute', right: 14, top: 58, width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: colors.bg },
  currentLocationButton: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 12, marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,204,0,0.35)', backgroundColor: 'rgba(255,204,0,0.10)' },
  currentLocationText: { color: colors.primary, fontSize: 12, fontWeight: '800' },
  callSquareSmall: { width: 50, height: 50, borderRadius: 17, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  serviceBook: { width: 96 },
  modalError: { color: colors.destructive, fontSize: 12, marginBottom: 6 },
  backLinkText: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  bookingNote: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 10 },
  trackingMap: { width: '100%', height: 210 },
  liveCab: { marginTop: 12, overflow: 'hidden', borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceElevated },
  liveCabBody: { padding: 12, gap: 4 },
  liveCabHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  liveCabStatus: { color: colors.primary, fontSize: 14, fontWeight: '900', paddingTop: 2 },
  liveCabEta: { color: colors.text, fontSize: 12, fontWeight: '800' },
  liveCabDetail: { color: colors.text, fontSize: 13, fontWeight: '800' },
  liveCabMeta: { color: colors.muted, fontSize: 11 },
  liveCabCall: { marginTop: 8, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.primary, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  liveCabCallText: { color: colors.primaryForeground, fontSize: 12, fontWeight: '900' },
  carMarker: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, borderWidth: 2, borderColor: colors.primaryForeground, alignItems: 'center', justifyContent: 'center' },
  timelineItem: { flexDirection: 'row', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary, marginTop: 6 },
  timelineContent: { flex: 1, gap: 4 },
  timelineTitle: { color: colors.text, fontSize: 12, fontWeight: '900' },
  timelineText: { color: colors.muted, fontSize: 12, lineHeight: 18 },
  statusPending: { backgroundColor: 'rgba(255,204,0,0.16)' },
  statusConfirmed: { backgroundColor: 'rgba(76,193,87,0.16)' },
  statusOngoing: { backgroundColor: 'rgba(38,198,218,0.16)' },
  statusCompleted: { backgroundColor: 'rgba(76,193,87,0.12)' },
  statusCancelled: { backgroundColor: 'rgba(249,65,68,0.16)' },
  callSquare: { width: 54, borderRadius: 17, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  serviceArticle: {
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8
  },
  serviceImageWrap: { height: 176, position: 'relative' },
  serviceImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  serviceShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(26,24,21,0.58)' },
  serviceHeroText: { position: 'absolute', left: 16, right: 16, bottom: 16 },
  serviceShortLabel: { color: colors.primary, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 2 },
  serviceBody: { padding: 20 },
  serviceTitle: { color: colors.text, fontSize: 19, fontWeight: '900', marginTop: 4 },
  serviceDescription: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  serviceFeatureGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  serviceFeature: { width: '47%', flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  serviceFeatureText: { color: colors.text, fontSize: 12, flex: 1 },
  serviceFooter: { marginTop: 20, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  servicePrice: { color: colors.yellow, fontSize: 21, fontWeight: '900' },
  centerIntro: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 20 },
  quoteBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: 'rgba(255,204,0,0.30)', backgroundColor: 'rgba(255,204,0,0.10)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  quoteBadgeText: { color: colors.yellow, fontSize: 11, fontWeight: '800' },
  bookTitle: { color: colors.text, fontSize: 32, fontWeight: '900', marginTop: 12 },
  yellowText: { color: colors.yellow },
  bookSub: { color: colors.muted, marginTop: 5, textAlign: 'center' },
  bookingPanel: {
    margin: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8
  },
  fieldBox: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(33,31,27,0.50)', padding: 12, marginBottom: 10 },
  pinField: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: 'rgba(33,31,27,0.50)', padding: 12, marginBottom: 10 },
  pinFieldValueRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 7, paddingRight: 40 },
  pinFieldValue: { color: colors.text, flex: 1, fontSize: 14, fontWeight: '700' },
  pinFieldAction: { color: colors.primary, fontSize: 11, fontWeight: '900', textTransform: 'uppercase' },
  fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  fieldLabel: { color: colors.yellow, fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.2, fontWeight: '900' },
  fieldInput: { color: colors.text, padding: 0, marginTop: 6, fontSize: 14, fontWeight: '700' },
  fieldValue: { color: colors.text, marginTop: 6, fontSize: 14, fontWeight: '700' },
  selectPill: { borderRadius: 999, backgroundColor: colors.surfaceElevated, paddingHorizontal: 10, paddingVertical: 7, marginRight: 8, marginTop: 8 },
  selectPillActive: { backgroundColor: colors.primary },
  selectText: { color: colors.muted, fontSize: 11, fontWeight: '800' },
  selectTextActive: { color: colors.black },
  twoCol: { flexDirection: 'row', gap: 10 },
  fareCard: { borderRadius: 18, borderWidth: 1, borderColor: 'rgba(255,204,0,0.30)', backgroundColor: 'rgba(255,204,0,0.10)', padding: 12, marginBottom: 10 },
  fareLabel: { color: colors.yellow, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2 },
  distanceValue: { color: colors.text, fontSize: 16, fontWeight: '900', marginTop: 8 },
  farePrice: { color: colors.yellow, fontSize: 14, fontWeight: '900', marginTop: 8 },
  fareDisclaimer: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 6 },
  fareLines: { marginTop: 10, gap: 6 },
  fareLine: { flexDirection: 'row', justifyContent: 'space-between' },
  fareLineLabel: { color: colors.muted, fontSize: 12 },
  fareLineValue: { color: colors.text, fontSize: 12, fontWeight: '700' },
  fareTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,204,0,0.30)' },
  fareTotalLabel: { color: colors.text, fontSize: 14, fontWeight: '900' },
  fareTotalSub: { color: colors.muted, fontSize: 10, fontWeight: '600', marginTop: 2 },
  fareTotalValue: { color: colors.yellow, fontSize: 24, fontWeight: '900' },
  fareGrid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 },
  fareItem: { alignItems: 'center', flex: 1 },
  fareItemLabel: { color: colors.muted, fontSize: 10 },
  fareItemValue: { color: colors.yellow, fontWeight: '900', marginTop: 2 },
  locationPicker: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 14, paddingTop: 8 },
  locationPickerHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  locationPickerTitle: { color: colors.text, fontSize: 19, fontWeight: '900' },
  locationPickerSubtitle: { color: colors.muted, fontSize: 11, marginTop: 3 },
  pickerClose: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 10 },
  pickerCloseText: { color: colors.primary, fontWeight: '800' },
  pickerSearchRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  pickerSearchInput: { minHeight: 46, flex: 1, borderRadius: 13, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, paddingHorizontal: 12, fontSize: 13 },
  pickerSearchButton: { width: 46, height: 46, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  locationResults: { maxHeight: 128, marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  locationResult: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  locationResultText: { color: colors.text, flex: 1, fontSize: 12 },
  searchError: { color: colors.muted, fontSize: 11, marginBottom: 8 },
  locationMap: { width: '100%', borderRadius: 14, overflow: 'hidden' },
  pinConfirmRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 10 },
  pinCoords: { color: colors.text, flex: 1, fontSize: 12, fontWeight: '700' },
  pinConfirmButton: { minHeight: 44, borderRadius: 13, backgroundColor: colors.primary, paddingHorizontal: 16, justifyContent: 'center' },
  pinConfirmText: { color: colors.primaryForeground, fontWeight: '900', fontSize: 13 },
  whatsappButtonOuter: {
    marginTop: 2,
    borderRadius: 17,
    shadowColor: colors.primary,
    shadowOpacity: 0.38,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 10
  },
  whatsappButton: { height: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 },
  whatsappText: { color: colors.black, fontSize: 16, fontWeight: '900' },
  noHidden: { color: colors.muted, textAlign: 'center', marginTop: 10, fontSize: 11 },
  routeButton: { marginHorizontal: 16, marginBottom: 9, borderRadius: 17, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 13, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  routeButtonMeta: { color: colors.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 },
  routeButtonFare: { color: colors.text, fontSize: 14, marginTop: 3 },
  aboutPanel: { marginHorizontal: 16, borderRadius: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 14 },
  aboutStats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, borderRadius: 16, backgroundColor: colors.surfaceElevated, padding: 12, alignItems: 'center' },
  statValue: { color: colors.text, fontSize: 20, fontWeight: '900' },
  statLabel: { color: colors.muted, fontSize: 10, marginTop: 2 },
  aboutText: { color: colors.muted, marginTop: 14, lineHeight: 20 },
  callWide: { marginTop: 14, height: 48, borderRadius: 16, backgroundColor: colors.yellow, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  callWideText: { color: colors.black, fontWeight: '900' },
  lastTrip: { marginHorizontal: 16, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 13 },
  reviewCard: { marginHorizontal: 16, marginBottom: 10, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 13 },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reviewName: { color: colors.text, fontWeight: '900' },
  reviewStars: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  reviewRating: { color: colors.text, fontWeight: '900' },
  reviewText: { color: colors.muted, marginTop: 8, lineHeight: 19 },
  bottomNav: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    height: 78,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'rgba(33,31,27,0.94)',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingBottom: 8,
    shadowColor: '#000000',
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 14 },
    elevation: 14
  },
  navItem: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 6 },
  navLabel: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  navLabelActive: { color: colors.yellow },
  navDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.yellow, position: 'absolute', top: 0 },
  primaryNavItem: { width: 72, alignItems: 'center', marginTop: -25 },
  primaryNavCircle: { width: 58, height: 58, borderRadius: 20, backgroundColor: colors.yellow, alignItems: 'center', justifyContent: 'center', borderWidth: 5, borderColor: colors.bg },
  primaryNavText: { color: colors.yellow, fontSize: 10, fontWeight: '900', marginTop: 2, textTransform: 'uppercase' },
  apiSettingsToggle: { padding: 16, alignItems: 'center' },
  apiSettingsText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  apiSettings: { marginHorizontal: 16, marginBottom: 16, padding: 16, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 20 },
  modalContent: { borderRadius: 24, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 20 },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '900', marginBottom: 8 },
  modalSubtitle: { color: colors.muted, fontSize: 12, marginBottom: 16 },
  modalButtons: { flexDirection: 'row', gap: 12, marginTop: 14 },
  modalButton: { flex: 1, backgroundColor: colors.yellow, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  modalButtonSecondary: { flex: 1, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceElevated, paddingVertical: 14, borderRadius: 14, alignItems: 'center' },
  modalButtonText: { color: colors.primaryForeground, fontSize: 14, fontWeight: '900' },
  modalButtonTextSecondary: { color: colors.text, fontSize: 14, fontWeight: '900' },
  apiSettingsLabel: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 8 },
  apiUrlInput: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, fontSize: 14, color: colors.text, backgroundColor: colors.bg, marginBottom: 12 },
  apiButtons: { flexDirection: 'row', gap: 12 },
  apiButton: { flex: 1, backgroundColor: colors.yellow, padding: 12, borderRadius: 8, alignItems: 'center' },
  apiButtonSecondary: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 12, borderRadius: 8, alignItems: 'center' },
  apiButtonText: { color: colors.primaryForeground, fontSize: 14, fontWeight: '600' },
  apiButtonTextSecondary: { color: colors.text, fontSize: 14, fontWeight: '600' }
}));

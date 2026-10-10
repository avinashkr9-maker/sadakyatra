import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  ImageBackground,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
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
import MapView, { Marker } from 'react-native-maps';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import PartnerOperations from './src/components/PartnerOperations';
import { LinearGradient } from 'expo-linear-gradient';
import * as SecureStore from 'expo-secure-store';
import {
  getAppConfig,
  login,
  setAuthToken,
  setBaseUrl,
  createBooking,
  submitPartnerApplication,
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

// Offline copy of the backend fareConfig (/app/config replaces it when reachable).
const DEFAULT_FARE_CONFIG = {
  categories: {
    sedan: { perKm: 23, minimumFare: 1500, localFare: 1500 },
    suv: { perKm: 27, minimumFare: 1500, localFare: 2000 },
    traveller: { perKm: 35, minimumFare: 3500, localFare: 3500 }
  },
  roundTripMultiplier: 1.75,
  driverAllowance: 300,
  tollPerKm: 1.5,
  gstPercent: 5
};

const TRACKING_TOKENS_KEY = 'sadakyatra.trackingTokens';
const CUSTOMER_KEY = 'sadakyatra.customer';

// Store numbers as the plain 10-digit form so "+91 93040 57169" and
// "9304057169" are the same customer everywhere.
function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits.slice(-10);
}

function isValidPhone(value) {
  return /^[6-9]\d{9}$/.test(value);
}

const CATEGORY_NAMES = { sedan: 'Sedan', suv: 'SUV', traveller: 'Tempo Traveller' };

const BOOKING_STATUS = {
  PENDING: { label: 'Finding cab', style: 'statusPending' },
  CONFIRMED: { label: 'Confirmed', style: 'statusConfirmed' },
  ONGOING: { label: 'On trip', style: 'statusOngoing' },
  COMPLETED: { label: 'Completed', style: 'statusCompleted' },
  CANCELLED: { label: 'Cancelled', style: 'statusCancelled' }
};

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

// Mirrors calculateFareBreakdown in backend/src/server.js.
function calculateFareBreakdown(category, distanceKm, service, config = DEFAULT_FARE_CONFIG) {
  const rate = config.categories[category];
  if (!rate) return null;
  const isLocal = service === 'Local City Ride';
  const roundTrip = service === 'Round Trip';
  if (!isLocal && !(distanceKm > 0)) return null;

  const baseFare = isLocal
    ? rate.localFare
    : Math.round(Math.max(distanceKm * rate.perKm, rate.minimumFare) * (roundTrip ? config.roundTripMultiplier : 1));
  const driverAllowance = isLocal ? 0 : config.driverAllowance;
  const tollAndParking = isLocal ? 0 : Math.round(distanceKm * config.tollPerKm * (roundTrip ? 2 : 1));
  const subtotal = baseFare + driverAllowance + tollAndParking;
  const gst = Math.round((subtotal * config.gstPercent) / 100);
  return { baseFare, driverAllowance, tollAndParking, gst, total: subtotal + gst };
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

const FLEET = [
  {
    id: 'sedan',
    name: 'Premium Sedan',
    models: 'Honda Amaze · Swift Dzire',
    seats: '4 Seats',
    price: '₹23/km',
    unit: '₹1,500 minimum',
    image: img.sedan,
    badge: 'MOST POPULAR',
    features: ['Fully Air Conditioned', 'Professional Chauffeur', 'Best for Airport & Drop Only']
  },
  {
    id: 'suv',
    name: 'Luxury SUV',
    models: 'Toyota Innova · Ertiga · Scorpio',
    seats: '6-7 Seats',
    price: '₹27/km',
    unit: '₹1,500 minimum',
    image: img.suv,
    features: ['Extra Space & Legroom', 'Family Drop-Only Trips', 'Wedding Decoration Available']
  },
  {
    id: 'tempo',
    name: 'Tempo Traveller',
    models: 'Force Traveller · Minibus',
    seats: '12-26 Seats',
    price: '₹35/km',
    unit: '₹3,500 minimum',
    image: img.tempo,
    features: ['Pushback Seating', 'Baraats, Pilgrimages & Trips', 'Dual Drivers Long Routes']
  }
];

const FLEET_CATEGORY = { sedan: 'sedan', suv: 'suv', tempo: 'traveller' };

const SERVICES = [
  {
    id: 'wedding',
    title: 'Wedding & Baraat Cars',
    short: 'Decorated luxury cars for your big day',
    description: "Fully decorated luxury sedans and SUVs with fresh floral arrangements and uniformed chauffeur. Muzaffarpur ka #1 wedding car service.",
    price: '₹4,500',
    priceNote: 'Sedan · 8 hrs / 150km · all inclusive',
    features: ['Fresh Floral Decor', 'Uniformed Chauffeur', 'Sedan to Fortuner', '8 hrs / 150 km'],
    image: img.wedding,
    icon: Heart,
    preset: { service: 'Wedding Car - Baraat / Bidai' }
  },
  {
    id: 'outstation',
    title: 'Drop Only Cabs',
    short: 'Drop Only · Sedan ₹23/km',
    description: "Door-to-door AC cab service across Bihar with Sedan and SUV rates calculated from the selected road distance.",
    price: '₹23/km',
    priceNote: 'Minimum fare ₹1,500 · round trip ×1.75',
    features: ['Door-to-Door', 'Rate Shared Before Confirmation', 'Clean AC Cab', 'One Way & Round Trip'],
    image: img.outstation,
    icon: Car,
    preset: { service: 'Drop Only' }
  },
  {
    id: 'airport',
    title: 'Airport Transfer',
    short: 'Patna & Darbhanga airports · 24x7',
    description: 'Muzaffarpur se Patna Airport (PAT) aur Darbhanga Airport (DBR) - flight tracking, on-time pickup, zero waiting. Early morning special available.',
    price: '₹23/km',
    priceNote: 'Sedan · minimum fare ₹1,500',
    features: ['Flight Tracking', 'On-Time Guarantee', 'Early Morning Pickup', 'Both Airports'],
    image: img.airport,
    icon: Plane,
    preset: { service: 'Airport Transfer', route: { from: 'Muzaffarpur', to: 'Patna Airport' } }
  },
  {
    id: 'tempo',
    title: 'Tempo Traveller Hire',
    short: '12-26 seater for groups & pilgrimage',
    description: 'Family trips, pilgrimage to Vaishali-Gaya-Bodh Gaya, baraat groups, corporate outings - 12 to 26 seater AC tempo with pushback seats.',
    price: '₹35/km',
    priceNote: 'Minimum fare ₹3,500 · all-inclusive price shown before booking',
    features: ['12-26 Seater', 'Pushback Seats', 'All Bihar Routes', 'Dual Drivers'],
    image: img.tempo,
    icon: Sparkles,
    preset: { service: 'Drop Only', category: 'traveller' }
  },
  {
    id: 'local',
    title: 'Local & Drop Only',
    short: 'All routes across Bihar',
    description: 'Muzaffarpur to Darbhanga, Sitamarhi, Motihari, Samastipur, Patna - sab routes cover. Local city rides bhi available. Instant taxi booking on WhatsApp.',
    price: '₹23/km',
    priceNote: 'Sedan · minimum fare ₹1,500',
    features: ['All Bihar Routes', 'Local City Rides', 'Instant Booking', 'Same Driver Both Ways'],
    image: img.outstation,
    icon: MapPin,
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

const serviceTypeMap = {
  'Drop Only': 'OUTSTATION',
  'Round Trip': 'OUTSTATION',
  'Wedding Car - Baraat / Bidai': 'WEDDING',
  'Airport Transfer': 'AIRPORT',
  'Local City Ride': 'LOCAL'
};

const REVIEWS = [
  { name: 'Bright Nut', text: 'Car was clean, driver was friendly, and the ride felt very comfortable.', rating: 5 },
  { name: 'Md Shahnawaz', text: 'Driver arrived on time, helped with luggage, and the car was clean.', rating: 5 },
  { name: 'Anjali Singh', text: 'Booked a wedding car for baraat. Decoration was beautiful and professional.', rating: 5 }
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
      <SadakYatraApp />
    </SafeAreaProvider>
  );
}

function SadakYatraApp() {
  const insets = useSafeAreaInsets();
  const scrollRef = useRef(null);
  const [tab, setTab] = useState('home');
  const [menuVisible, setMenuVisible] = useState(false);
  const [from, setFrom] = useState('Muzaffarpur');
  const [to, setTo] = useState('Patna');
  const [pickupLocation, setPickupLocation] = useState(placePin('Muzaffarpur'));
  const [dropLocation, setDropLocation] = useState(placePin('Patna'));
  const [carCategory, setCarCategory] = useState('sedan');
  const [service, setService] = useState('Drop Only');
  const [phone, setPhone] = useState('');
  const [tripDate, setTripDate] = useState(defaultTripDate);
  const [lastTrip, setLastTrip] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [trackingTokens, setTrackingTokens] = useState({});
  const [bookingTracking, setBookingTracking] = useState(null);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [bookingEvents, setBookingEvents] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [bookingError, setBookingError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [apiUrl, setApiUrl] = useState('');
  const [user, setUser] = useState(null);
  const [authModalVisible, setAuthModalVisible] = useState(false);
  const [authName, setAuthName] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [fareConfig, setFareConfig] = useState(DEFAULT_FARE_CONFIG);

  useEffect(() => {
    setBaseUrl(apiUrl);
  }, [apiUrl]);

  // App khulte hi background me backend dhoond lo, taaki pehla
  // login/booking turant lage (koi 7s wait nahi).
  useEffect(() => {
    warmUp();
    getAppConfig()
      .then((config) => { if (config?.fareConfig?.categories) setFareConfig(config.fareConfig); })
      .catch(() => {});
    SecureStore.getItemAsync(TRACKING_TOKENS_KEY)
      .then((stored) => { if (stored) setTrackingTokens((current) => ({ ...JSON.parse(stored), ...current })); })
      .catch(() => {});
    // Returning customers stay logged in.
    SecureStore.getItemAsync(CUSTOMER_KEY)
      .then((stored) => {
        if (!stored) return;
        const saved = JSON.parse(stored);
        if (saved.phone) setPhone(saved.phone);
        if (saved.user) setUser(saved.user);
        if (saved.token) setAuthToken(saved.token);
      })
      .catch(() => {});
  }, []);

  function rememberTrackingToken(bookingId, token) {
    setTrackingTokens((current) => {
      const next = { ...current, [bookingId]: token };
      SecureStore.setItemAsync(TRACKING_TOKENS_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  function goTo(nextTab) {
    setTab(nextTab);
    setMenuVisible(false);
  }

  // Open the booking form already filled in for what the customer tapped.
  function startBooking(preset = {}) {
    if (preset.service) setService(preset.service);
    if (preset.category) setCarCategory(preset.category);
    if (preset.route) {
      setFrom(preset.route.from);
      setTo(preset.route.to);
      setPickupLocation(placePin(preset.route.from));
      setDropLocation(placePin(preset.route.to));
    }
    goTo('book');
  }

  async function handleLogin(phoneInput = phone) {
    const cleanPhone = normalizePhone(phoneInput);
    if (!isValidPhone(cleanPhone)) {
      setAuthError('Enter a valid 10-digit mobile number.');
      return false;
    }
    setPhone(cleanPhone);
    setAuthError(null);
    setAuthLoading(true);
    try {
      const data = await login(cleanPhone, authName.trim() || null);
      setUser(data.user);
      setAuthToken(data.token);
      setAuthModalVisible(false);
      setAuthName('');
      SecureStore.setItemAsync(CUSTOMER_KEY, JSON.stringify({ phone: cleanPhone, user: data.user, token: data.token })).catch(() => {});
      return true;
    } catch (err) {
      // Backend offline hai — customer ko login pe atkaao mat.
      // WhatsApp booking waise bhi kaam karta hai.
      if (err.offline) {
        setAuthModalVisible(false);
        return false;
      }
      setAuthError(err.message || 'Unable to log in. Please try again.');
      return false;
    } finally {
      setAuthLoading(false);
    }
  }

  function logout() {
    setUser(null);
    setAuthToken(null);
    setPhone('');
    setBookings([]);
    setSelectedBooking(null);
    setAuthModalVisible(false);
    SecureStore.deleteItemAsync(CUSTOMER_KEY).catch(() => {});
  }

  async function ensureLoggedIn(cleanPhone) {
    if (user && normalizePhone(user.phone) === cleanPhone) return true;
    // Agar backend offline hai to login skip karke WhatsApp par bhejo.
    if (!(await isBackendOnline())) return false;
    return handleLogin(cleanPhone);
  }

  function bookOnWhatsApp(routeDistanceKm) {
    const fare = calculateFareBreakdown(carCategory, routeDistanceKm, service, fareConfig)?.total ?? null;
    const msg =
      `Hi ${BRAND.name}! Booking request:\n` +
      `• Service: ${service}\n` +
      `• Vehicle: ${CATEGORY_NAMES[carCategory] || carCategory}\n` +
      `• From: ${from}\n` +
      `• To: ${to}\n` +
      (routeDistanceKm ? `• Road distance: ${routeDistanceKm} km\n` : '') +
      (fare !== null ? `• Final payable (all-inclusive): ${rupees(fare)}\n` : '') +
      `• Pickup: ${formatFriendlyDate(tripDate)}\n` +
      (phone ? `• Phone: ${phone}\n` : '') +
      `Please confirm availability.`;
    Linking.openURL(wa(msg));
  }

  async function sendBooking(routeDistanceKm) {
    const cleanPhone = normalizePhone(phone);
    if (!isValidPhone(cleanPhone)) {
      return Alert.alert('Mobile number needed', 'Enter your 10-digit mobile number so the driver and our team can reach you.');
    }
    if (!pickupLocation || !dropLocation) {
      return Alert.alert('Set your pins', 'Tap Pickup and Drop to place both pins on the map.');
    }
    if (service !== 'Local City Ride' && !(routeDistanceKm > 0)) {
      return Alert.alert('Road distance unavailable', 'We could not calculate the road route yet. Check your internet or move the pins slightly.');
    }
    if (tripDate.getTime() < Date.now() + 15 * 60 * 1000) {
      return Alert.alert('Pick a later time', 'Pickup time must be at least 15 minutes from now.');
    }

    // Backend offline ho to seedha WhatsApp par booking bhejo.
    if (!(await isBackendOnline()) || !(await ensureLoggedIn(cleanPhone))) {
      bookOnWhatsApp(routeDistanceKm);
      return;
    }

    setSubmitting(true);
    try {
      const data = await createBooking({
        phone: cleanPhone,
        fullName: user?.fullName || null,
        serviceType: serviceTypeMap[service] || 'OUTSTATION',
        pickup: from,
        drop: to,
        tripDatetime: tripDate.toISOString(),
        carCategory,
        pickupLatitude: pickupLocation?.latitude ?? null,
        pickupLongitude: pickupLocation?.longitude ?? null,
        dropLatitude: dropLocation?.latitude ?? null,
        dropLongitude: dropLocation?.longitude ?? null,
        routeDistanceKm: routeDistanceKm ?? null,
        roundTrip: service === 'Round Trip',
        customerNote: service
      });
      const booking = data.booking;
      if (data.trackingToken) rememberTrackingToken(booking.id, data.trackingToken);

      setLastTrip({
        from,
        to,
        service,
        date: formatFriendlyDate(tripDate),
        fare: booking.estimated_fare ? rupees(booking.estimated_fare) : 'Quote pending'
      });

      Alert.alert(
        'Booking requested',
        `${booking.booking_ref}${booking.estimated_fare ? ` · ${rupees(booking.estimated_fare)}` : ''}\nWe are sending it to the nearest cab. Track it live here.`
      );
      goTo('bookings');
      fetchBookings(cleanPhone);
      fetchBookingDetails(booking.id);
    } catch (err) {
      // In-app booking fail — customer ko rokna nahi, WhatsApp par bhejo.
      bookOnWhatsApp(routeDistanceKm);
    } finally {
      setSubmitting(false);
    }
  }

  function fetchBookings(phoneInput = phone) {
    const cleanPhone = normalizePhone(phoneInput);
    if (!isValidPhone(cleanPhone)) return undefined;
    setLoadingBookings(true);
    setBookingError(null);

    return listBookings(cleanPhone)
      .then((data) => setBookings(data.bookings || []))
      .catch((err) => setBookingError(err.offline ? 'You are offline. Pull down to try again.' : err.message || 'Could not load bookings.'))
      .finally(() => setLoadingBookings(false));
  }

  function loadBookingDetails(id, token) {
    return Promise.all([
      getBooking(id).then((data) => {
        setSelectedBooking(data.booking);
        setBookingEvents(data.events || []);
      }),
      token ? getBookingTracking(id, token).then((data) => setBookingTracking(data.tracking)).catch(() => {}) : null
    ]);
  }

  function fetchBookingDetails(id) {
    setBookingError(null);
    setBookingTracking(null);
    return loadBookingDetails(id, trackingTokens[id])
      .catch((err) => setBookingError(err.message || 'Could not load booking details.'));
  }

  // While a trip is open, keep its status, timeline and cab position fresh.
  useEffect(() => {
    if (!selectedBooking || ['COMPLETED', 'CANCELLED'].includes(selectedBooking.status)) return undefined;
    const interval = setInterval(() => {
      loadBookingDetails(selectedBooking.id, trackingTokens[selectedBooking.id]).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [selectedBooking?.id, selectedBooking?.status, trackingTokens]);

  function confirmCancel(booking) {
    Alert.alert('Cancel this booking?', `${booking.booking_ref} · ${booking.pickup_text} → ${booking.drop_text}`, [
      { text: 'Keep booking', style: 'cancel' },
      {
        text: 'Cancel booking',
        style: 'destructive',
        onPress: async () => {
          try {
            await cancelBooking(booking.id, normalizePhone(phone), 'Cancelled by customer in app');
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
    if (tab === 'bookings' && isValidPhone(normalizePhone(phone))) {
      fetchBookings();
    }
  }, [tab, phone]);

  const bottomSpace = insets.bottom + 104;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <StatusBar barStyle="light-content" />
      <Header user={user} onLoginPress={() => { setAuthError(null); setAuthModalVisible(true); }} onMenuPress={() => setMenuVisible(true)} />
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
        {tab === 'partner' && <PartnerScreen />}
        {tab === 'admin' && <PartnerOperations />}
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
            onPhoneSubmit={(value) => { const clean = normalizePhone(value); setPhone(clean); fetchBookings(clean); }}
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
            service={service}
            carCategory={carCategory}
            phone={phone}
            tripDate={tripDate}
            onFrom={setFrom}
            onTo={setTo}
            onPickupLocation={(location) => { setPickupLocation(location); setFrom(location?.label || from); }}
            onDropLocation={(location) => { setDropLocation(location); setTo(location?.label || to); }}
            onSwap={() => {
              setFrom(to); setTo(from);
              setPickupLocation(dropLocation); setDropLocation(pickupLocation);
            }}
            onService={setService}
            onCarCategory={setCarCategory}
            onPhone={setPhone}
            onTripDate={setTripDate}
            onSend={(distance) => sendBooking(distance)}
            isSubmitting={submitting}
            fareConfig={fareConfig}
          />
        )}
        {tab === 'about' && <AboutScreen lastTrip={lastTrip} />}
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
                { id: 'bookings', label: 'My trips', icon: Clock },
                { id: 'fleet', label: 'Our fleet & rates', icon: Car },
                { id: 'services', label: 'Services', icon: Sparkles },
                { id: 'about', label: 'About & reviews', icon: Star }
              ].map((item) => <DrawerItem key={item.id} item={item} onPress={() => goTo(item.id)} />)}
              <View style={styles.drawerDivider} />
              <Text style={styles.drawerEyebrow}>WORK WITH SADAKYATRA</Text>
              <DrawerItem item={{ id: 'partner', label: 'Become a cab partner', icon: Users }} onPress={() => goTo('partner')} />
              <DrawerItem item={{ id: 'admin', label: 'Driver / Admin login', icon: ShieldCheck }} onPress={() => goTo('admin')} />
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
            {user ? (
              <>
                <Text style={styles.modalTitle}>Your account</Text>
                <Text style={styles.modalSubtitle}>{user.fullName ? `${user.fullName} · ` : ''}+91 {normalizePhone(user.phone)}</Text>
                <View style={styles.modalButtons}>
                  <Pressable style={styles.modalButtonSecondary} onPress={logout}>
                    <View style={styles.rowCenter}><LogOut color={colors.text} size={16} /><Text style={styles.modalButtonTextSecondary}>Log out</Text></View>
                  </Pressable>
                  <Pressable style={styles.modalButton} onPress={() => setAuthModalVisible(false)}>
                    <Text style={styles.modalButtonText}>Done</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.modalTitle}>Login to SadakYatra</Text>
                <Text style={styles.modalSubtitle}>Use your mobile number to book and track your trips.</Text>
                <PhoneInput value={phone} onChangeText={setPhone} />
                <View style={styles.fieldBox}>
                  <Text style={styles.fieldLabel}>Name (optional)</Text>
                  <TextInput
                    value={authName}
                    onChangeText={setAuthName}
                    placeholder="Your name"
                    placeholderTextColor={colors.placeholder}
                    style={styles.fieldInput}
                  />
                </View>
                {authError ? <Text style={styles.modalError}>{authError}</Text> : null}
                <View style={styles.modalButtons}>
                  <Pressable style={styles.modalButtonSecondary} onPress={() => setAuthModalVisible(false)}>
                    <Text style={styles.modalButtonTextSecondary}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.modalButton} onPress={() => handleLogin()} disabled={authLoading}>
                    <Text style={styles.modalButtonText}>{authLoading ? 'Logging in…' : 'Login'}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function PhoneInput({ value, onChangeText }) {
  return (
    <View style={styles.fieldBox}>
      <View style={styles.fieldLabelRow}><Phone color={colors.primary} size={14} /><Text style={styles.fieldLabel}>Mobile number</Text></View>
      <View style={styles.phoneRow}>
        <Text style={styles.phonePrefix}>+91</Text>
        <TextInput
          value={value}
          onChangeText={(text) => onChangeText(text.replace(/[^\d]/g, '').slice(-10))}
          keyboardType="phone-pad"
          maxLength={10}
          placeholder="10-digit mobile"
          placeholderTextColor={colors.placeholder}
          style={[styles.fieldInput, styles.flex]}
        />
      </View>
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
  const pills = [
    { icon: Plane, label: 'Patna Airport', sub: 'Airport transfer', preset: { service: 'Airport Transfer', route: { from: 'Muzaffarpur', to: 'Patna Airport' } } },
    { icon: Heart, label: 'Wedding Car', sub: 'from ₹4,500', preset: { service: 'Wedding Car - Baraat / Bidai' } },
    { icon: Briefcase, label: 'Drop Only', sub: 'price by distance', preset: { service: 'Drop Only' } },
    { icon: Users, label: 'Tempo Traveller', sub: '12-26 seats', preset: { category: 'traveller' } },
    { icon: MapPin, label: 'Darbhanga', sub: 'Sedan ₹23/km', preset: { service: 'Drop Only', route: { from: 'Muzaffarpur', to: 'Darbhanga' } } }
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
  return (
    <View>
      <SectionTitle eyebrow="Our Fleet" title="Choose your ride" subtitle="Well-maintained, sanitized vehicles for every trip across Bihar." />
      <View style={styles.fleetArticleList}>
        {FLEET.map((car) => (
          <CardGradient key={car.id} style={styles.fleetArticle}>
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
                <PrimaryButton label="Book Now" icon={ArrowRight} onPress={() => onStart({ category: FLEET_CATEGORY[car.id] })} />
              </View>
            </View>
          </CardGradient>
        ))}
      </View>
    </View>
  );
}

function PartnerScreen() {
  return (
    <View>
      <SectionTitle eyebrow="Partner with SadakYatra" title="Grow your cab business" subtitle="Submit your cab details. Our team reviews every application before it joins the fleet." />
      <PartnerApplicationForm />
    </View>
  );
}

function PartnerApplicationForm() {
  const [application, setApplication] = useState({
    fullName: '',
    phone: '',
    vehicleNumber: '',
    vehicleCategory: 'sedan',
    vehicleModel: '',
    seats: '',
    driverName: '',
    driverPhone: '',
    city: '',
    operatingArea: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  function updateApplication(field, value) {
    setApplication((current) => ({ ...current, [field]: value }));
  }

  async function submitApplication() {
    const missing = fields.find((field) => field.key !== 'seats' && application[field.key].trim().length < 2);
    if (missing) return setMessage(`Please fill: ${missing.label}`);
    if (!isValidPhone(normalizePhone(application.phone))) return setMessage('Owner mobile must be a valid 10-digit number.');
    if (!isValidPhone(normalizePhone(application.driverPhone))) return setMessage('Driver mobile must be a valid 10-digit number.');
    setSubmitting(true);
    setMessage('');
    try {
      const data = await submitPartnerApplication({
        ...application,
        phone: normalizePhone(application.phone),
        driverPhone: normalizePhone(application.driverPhone),
        seats: application.seats ? Number(application.seats) : null
      });
      setMessage(`${data.application.applicationRef} received. Our team will call to verify your details and documents.`);
      setApplication({ ...application, fullName: '', phone: '', vehicleNumber: '', vehicleModel: '', seats: '', driverName: '', driverPhone: '', city: '', operatingArea: '' });
    } catch (error) {
      setMessage(error.message || 'Could not submit application. Check the connection and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const fields = [
    { key: 'fullName', label: 'Owner name' },
    { key: 'phone', label: 'Owner mobile', keyboardType: 'phone-pad' },
    { key: 'vehicleNumber', label: 'Vehicle registration', autoCapitalize: 'characters' },
    { key: 'vehicleModel', label: 'Vehicle model' },
    { key: 'driverName', label: 'Driver name' },
    { key: 'driverPhone', label: 'Driver mobile', keyboardType: 'phone-pad' },
    { key: 'city', label: 'City' },
    { key: 'operatingArea', label: 'Operating area' },
    { key: 'seats', label: 'Seats', keyboardType: 'number-pad' }
  ];

  return (
    <View style={styles.partnerSection}>
      <SectionTitle eyebrow="Partner with us" title="Become a Cab Partner" subtitle="Register your cab for review by the SadakYatra team." />
      <CardGradient style={styles.partnerPanel}>
        <SelectField icon={Car} label="Vehicle type" value={application.vehicleCategory} options={[
          { value: 'sedan', label: 'Sedan' },
          { value: 'suv', label: 'SUV' },
          { value: 'traveller', label: 'Tempo Traveller' }
        ]} onValue={(value) => updateApplication('vehicleCategory', value)} />
        {fields.map((field) => (
          <View key={field.key} style={styles.fieldBox}>
            <Text style={styles.fieldLabel}>{field.label}</Text>
            <TextInput
              value={application[field.key]}
              onChangeText={(value) => updateApplication(field.key, value)}
              keyboardType={field.keyboardType || 'default'}
              autoCapitalize={field.autoCapitalize || 'words'}
              placeholder={field.label}
              placeholderTextColor={colors.placeholder}
              style={styles.fieldInput}
            />
          </View>
        ))}
        <Text style={styles.partnerDisclosure}>Applications stay pending until our team verifies your mobile and RC, DL, and insurance. Do not send document scans here; secure upload is not enabled yet.</Text>
        {message ? <Text style={styles.partnerMessage}>{message}</Text> : null}
        <Pressable style={styles.smallCtaOuter} onPress={submitApplication} disabled={submitting}>
          <BrandGradient style={styles.smallCta}>
            <Text style={styles.smallCtaText}>{submitting ? 'Submitting…' : 'Submit partner application'}</Text>
          </BrandGradient>
        </Pressable>
      </CardGradient>
    </View>
  );
}

function FleetList({ compact = false, onSelect }) {
  return (
    <View style={styles.listGap}>
      {FLEET.map((car) => (
        <Pressable key={car.id} onPress={() => onSelect?.(FLEET_CATEGORY[car.id])}>
          <CardGradient style={styles.rideRow}>
            <Image source={car.image} style={styles.rideImage} />
            <View style={styles.flex}>
              <View style={styles.rowCenter}>
                <Text style={styles.rideName}>{car.name}</Text>
                {car.badge ? <Text style={styles.badge}>{car.badge}</Text> : null}
              </View>
              <Text style={styles.rideMeta}>{car.seats} · {car.models}</Text>
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
      <SectionTitle eyebrow="Every Need Covered" title="Services for every occasion" subtitle="From baraat entries to airport drops - across Muzaffarpur & Bihar." />
      {SERVICES.map((service) => (
        <Pressable key={service.id} onPress={() => onStart(service.preset)}>
          <CardGradient style={styles.serviceArticle}>
            <View style={styles.serviceImageWrap}>
              <Image source={service.image} style={styles.serviceImage} />
              <View style={styles.serviceShade} />
              <View style={styles.serviceHeroText}>
                <Text style={styles.serviceShortLabel}>{service.short}</Text>
                <Text style={styles.serviceTitle}>{service.title}</Text>
              </View>
            </View>
            <View style={styles.serviceBody}>
              <Text style={styles.serviceDescription}>{service.description}</Text>
              <View style={styles.serviceFeatureGrid}>
                {service.features.map((feature) => (
                  <View key={feature} style={styles.serviceFeature}>
                    <Check color={colors.primary} size={14} />
                    <Text style={styles.serviceFeatureText}>{feature}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.serviceFooter}>
                <View style={styles.flex}>
                  <Text style={styles.servicePrice}>{service.price}</Text>
                  <Text style={styles.priceUnit}>{service.priceNote}</Text>
                </View>
                <Pressable style={styles.callSquareSmall} accessibilityLabel={`Ask about ${service.title} on WhatsApp`}
                  onPress={() => Linking.openURL(wa(`Hi ${BRAND.name}! I'm interested in ${service.title}. Please share details.`))}>
                  <MessageCircle color={colors.whatsapp} size={20} />
                </Pressable>
                <View style={styles.serviceBook}>
                  <PrimaryButton label="Book" onPress={() => onStart(service.preset)} />
                </View>
              </View>
            </View>
          </CardGradient>
        </Pressable>
      ))}
    </View>
  );
}

function BookScreen({ from, to, pickupLocation, dropLocation, service, carCategory, phone, tripDate, onFrom, onTo, onPickupLocation, onDropLocation, onSwap, onService, onCarCategory, onPhone, onTripDate, onSend, isSubmitting, fareConfig }) {
  const [pickerTarget, setPickerTarget] = useState(null);
  const [routeDistanceKm, setRouteDistanceKm] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState(null);

  useEffect(() => {
    if (!pickupLocation || !dropLocation) {
      setRouteDistanceKm(null);
      setRouteLoading(false);
      setRouteError(null);
      return undefined;
    }

    setRouteDistanceKm(null);
    setRouteLoading(true);
    setRouteError(null);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${pickupLocation.longitude},${pickupLocation.latitude};${dropLocation.longitude},${dropLocation.latitude}?overview=false`;
        const response = await fetch(url, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok || result.code !== 'Ok' || !result.routes?.[0]) {
          throw new Error('A road route could not be found for these pins.');
        }
        setRouteDistanceKm(Math.round((result.routes[0].distance / 1000) * 10) / 10);
      } catch (error) {
        if (error.name !== 'AbortError') {
          setRouteDistanceKm(null);
          setRouteError(error.message || 'Road distance is temporarily unavailable.');
        }
      } finally {
        if (!controller.signal.aborted) setRouteLoading(false);
      }
    }, 350);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [pickupLocation?.latitude, pickupLocation?.longitude, dropLocation?.latitude, dropLocation?.longitude]);

  const fare = calculateFareBreakdown(carCategory, routeDistanceKm, service, fareConfig);

  return (
    <View>
      <View style={styles.centerIntro}>
        <View style={styles.quoteBadge}><Sparkles color={colors.primary} size={14} /><Text style={styles.quoteBadgeText}>All-inclusive price · no hidden charges</Text></View>
        <Text style={styles.bookTitle}>Book in <Text style={styles.yellowText}>60 seconds.</Text></Text>
        <Text style={styles.bookSub}>Set your pins, pick a cab, see the final price.</Text>
      </View>

      <CardGradient style={styles.bookingPanel}>
        <View>
          <PinField label="Pickup" value={pickupLocation ? from : ''} onPress={() => setPickerTarget('pickup')} />
          <PinField label="Drop" value={dropLocation ? to : ''} onPress={() => setPickerTarget('drop')} />
          <Pressable style={styles.swapButton} onPress={onSwap} accessibilityLabel="Swap pickup and drop">
            <ArrowUpDown color={colors.primaryForeground} size={16} strokeWidth={2.5} />
          </Pressable>
        </View>
        <SelectField icon={Car} label="Choose vehicle" value={carCategory} options={[
          { value: 'sedan', label: 'Sedan · 4 seats' },
          { value: 'suv', label: 'SUV · 6-7 seats' },
          { value: 'traveller', label: 'Tempo · 12-26 seats' }
        ]} onValue={onCarCategory} />
        <SelectField icon={Sparkles} label="Trip type" value={service} options={['Drop Only', 'Round Trip', 'Wedding Car - Baraat / Bidai', 'Airport Transfer', 'Local City Ride']} onValue={onService} />
        <TripTimePicker value={tripDate} onChange={onTripDate} />
        <PhoneInput value={phone} onChangeText={onPhone} />
        <View style={styles.fareCard}>
          <Text style={styles.fareLabel}>Route and fare</Text>
          <Text style={styles.distanceValue}>{routeLoading ? 'Calculating road distance…' : routeDistanceKm !== null ? `${routeDistanceKm} km road distance` : service === 'Local City Ride' ? 'Local city ride · fixed price' : 'Set pickup and drop pins to see the distance'}</Text>
          {routeError ? <Text style={styles.fareDisclaimer}>{routeError}</Text> : null}
          {fare ? (
            <>
              <View style={styles.fareLines}>
                <FareLine label={service === 'Local City Ride' ? 'Local ride fare' : `Base fare${service === 'Round Trip' ? ' (round trip)' : ''}`} value={fare.baseFare} />
                {fare.driverAllowance ? <FareLine label="Driver allowance" value={fare.driverAllowance} /> : null}
                {fare.tollAndParking ? <FareLine label="Toll & parking" value={fare.tollAndParking} /> : null}
                <FareLine label={`GST (${fareConfig.gstPercent}%)`} value={fare.gst} />
              </View>
              <View style={styles.fareTotalRow}>
                <View>
                  <Text style={styles.fareTotalLabel}>Final payable</Text>
                  <Text style={styles.fareTotalSub}>All-inclusive · no extra charges</Text>
                </View>
                <Text style={styles.fareTotalValue}>{rupees(fare.total)}</Text>
              </View>
            </>
          ) : (
            <Text style={styles.farePrice}>Final all-inclusive price appears once the road route is calculated.</Text>
          )}
        </View>
        <Pressable style={styles.whatsappButtonOuter} onPress={() => onSend(routeDistanceKm)} disabled={isSubmitting}>
          <BrandGradient style={styles.whatsappButton}>
            <MessageCircle color={colors.primaryForeground} size={21} strokeWidth={2.5} />
            <Text style={styles.whatsappText}>{isSubmitting ? 'Requesting...' : fare ? `Request booking · ${rupees(fare.total)}` : 'Request booking'}</Text>
          </BrandGradient>
        </Pressable>
        <Text style={styles.noHidden}>Price includes driver allowance, toll, parking & GST</Text>
      </CardGradient>

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
      {ROUTES.slice(0, 5).map((route) => (
        <Pressable key={route.to} style={styles.routeButton} onPress={() => { onFrom(route.from); onTo(route.to); onPickupLocation(placePin(route.from)); onDropLocation(placePin(route.to)); }}>
          <View>
            <Text style={styles.routeButtonMeta}>{route.from} to {route.to}</Text>
            <Text style={styles.routeButtonFare}>Sedan ₹23/km · SUV ₹27/km · Tempo ₹35/km</Text>
          </View>
          <ArrowRight color={colors.mutedForeground} size={18} />
        </Pressable>
      ))}
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

function BookingsScreen({ phone, bookings, loading, error, selectedBooking, tracking, events, onRefresh, onPhoneSubmit, onSelectBooking, onCancel, onBook, onBack }) {
  const [phoneDraft, setPhoneDraft] = useState(phone || '');

  if (!isValidPhone(normalizePhone(phone))) {
    return (
      <View>
        <SectionTitle eyebrow="My Trips" title="Track your bookings" />
        <View style={styles.inlinePanel}>
          <Text style={styles.emptySub}>Enter the mobile number you booked with.</Text>
          <PhoneInput value={phoneDraft} onChangeText={setPhoneDraft} />
          <PrimaryButton label="Show my trips" onPress={() => onPhoneSubmit(phoneDraft)} disabled={!isValidPhone(normalizePhone(phoneDraft))} />
        </View>
      </View>
    );
  }

  if (selectedBooking) {
    const status = BOOKING_STATUS[selectedBooking.status] || { label: selectedBooking.status };
    let fare = null;
    try { fare = selectedBooking.fare_breakdown ? JSON.parse(selectedBooking.fare_breakdown) : null; } catch { fare = null; }
    const canCancel = ['PENDING', 'CONFIRMED'].includes(selectedBooking.status);
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
            {formatFriendlyDate(new Date(selectedBooking.trip_datetime))} · {CATEGORY_NAMES[selectedBooking.car_category] || selectedBooking.car_category}
            {selectedBooking.customer_note ? ` · ${selectedBooking.customer_note}` : ''}
            {selectedBooking.route_distance_km ? ` · ${selectedBooking.route_distance_km} km` : ''}
          </Text>

          {tracking && selectedBooking.status !== 'CANCELLED' ? <LiveCabCard tracking={tracking} /> : null}
          {!tracking && selectedBooking.status === 'PENDING' ? (
            <Text style={styles.emptySub}>We are sending your booking to the nearest available cab. Driver details appear here once accepted.</Text>
          ) : null}

          {fare ? (
            <View style={styles.fareCard}>
              <Text style={styles.fareLabel}>Fare</Text>
              <View style={styles.fareLines}>
                <FareLine label="Base fare" value={fare.baseFare} />
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
        const status = BOOKING_STATUS[booking.status] || { label: booking.status };
        return (
          <Pressable key={booking.id} style={styles.bookingRow} onPress={() => onSelectBooking(booking.id)}>
            <View style={styles.bookingSummary}>
              <Text style={styles.bookingLabel} numberOfLines={1}>{booking.pickup_text} → {booking.drop_text}</Text>
              <Text style={styles.bookingMeta}>{formatFriendlyDate(new Date(booking.trip_datetime))} · {CATEGORY_NAMES[booking.car_category] || booking.car_category}</Text>
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
        <Text style={styles.liveCabMeta}>{[tracking.vehicle_model, tracking.car_category === 'traveller' ? 'Tempo Traveller' : tracking.car_category?.toUpperCase()].filter(Boolean).join(' · ')}</Text>
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

function TripTimePicker({ value, onChange }) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date();
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() + index);
    return day;
  });
  const selectedDay = new Date(value);
  selectedDay.setHours(0, 0, 0, 0);
  const earliest = Date.now() + 30 * 60 * 1000;
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
      <View style={styles.fieldLabelRow}><Calendar color={colors.primary} size={14} /><Text style={styles.fieldLabel}>Pickup time · {formatFriendlyDate(value)}</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {days.map((day, index) => {
          const active = day.getTime() === selectedDay.getTime();
          const label = index === 0 ? 'Today' : index === 1 ? 'Tomorrow' : day.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
          return (
            <Pressable key={day.toISOString()} style={[styles.selectPill, active && styles.selectPillActive]} onPress={() => pickDay(day)}>
              <Text style={[styles.selectText, active && styles.selectTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {slots.length === 0 ? <Text style={styles.fareDisclaimer}>No more slots today — choose Tomorrow.</Text> : null}
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

function LocationPicker({ visible, title, value, initialLocation, onClose, onSelect }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [locating, setLocating] = useState(false);
  const mapRef = useRef(null);
  const [query, setQuery] = useState(value || '');
  const [selectedLocation, setSelectedLocation] = useState(initialLocation || {
    label: 'Muzaffarpur', latitude: 26.1209, longitude: 85.391
  });
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  useEffect(() => {
    if (!visible) return;
    const point = initialLocation || { label: value || 'Muzaffarpur', latitude: 26.1209, longitude: 85.391 };
    setQuery(value || point.label || '');
    setSelectedLocation(point);
    setResults([]);
    setSearchError(null);
    mapRef.current?.animateToRegion({ latitude: point.latitude, longitude: point.longitude, latitudeDelta: 0.07, longitudeDelta: 0.07 });
  }, [visible, initialLocation, value]);

  async function searchPlaces() {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(`${query.trim()}, Bihar, India`)}&lat=26.12&lon=85.39&limit=6`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Location search is temporarily unavailable.');
      const data = await response.json();
      setResults(data.features || []);
      if (!data.features?.length) setSearchError('No matching places found. Move the map and place the pin manually.');
    } catch (error) {
      setSearchError(error.message || 'Location search is temporarily unavailable.');
    } finally {
      setSearching(false);
    }
  }

  function labelForFeature(properties) {
    return [...new Set([properties.name, properties.street, properties.city, properties.district, properties.state].filter(Boolean))].slice(0, 3).join(', ');
  }

  function chooseFeature(feature) {
    const [longitude, latitude] = feature.geometry.coordinates;
    const location = { label: labelForFeature(feature.properties) || 'Pinned location', latitude, longitude };
    setSelectedLocation(location);
    setQuery(location.label);
    setResults([]);
    mapRef.current?.animateToRegion({ latitude, longitude, latitudeDelta: 0.025, longitudeDelta: 0.025 }, 350);
  }

  async function setMapPin(coordinate) {
    const location = { label: 'Pinned location', latitude: coordinate.latitude, longitude: coordinate.longitude };
    setSelectedLocation(location);
    try {
      const response = await fetch(`https://photon.komoot.io/reverse?lon=${coordinate.longitude}&lat=${coordinate.latitude}`);
      const data = await response.json();
      const properties = data.features?.[0]?.properties;
      if (properties) {
        const label = labelForFeature(properties);
        if (label) {
          setSelectedLocation({ ...location, label });
          setQuery(label);
        }
      }
    } catch {
      setQuery('Pinned location');
    }
  }

  async function useCurrentLocation() {
    setLocating(true);
    setSearchError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') throw new Error('Allow location access, or search / move the pin instead.');
      const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      mapRef.current?.animateToRegion({ latitude: coords.latitude, longitude: coords.longitude, latitudeDelta: 0.012, longitudeDelta: 0.012 }, 350);
      await setMapPin(coords);
    } catch (error) {
      setSearchError(error.message || 'Could not get your location.');
    } finally {
      setLocating(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.locationPicker, { paddingTop: insets.top + 8, paddingBottom: insets.bottom }]}>
        <View style={styles.locationPickerHeader}>
          <View style={styles.flex}>
            <Text style={styles.locationPickerTitle}>{title}</Text>
            <Text style={styles.locationPickerSubtitle}>Search, or tap / drag the pin to the exact spot.</Text>
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
        <MapView
          ref={mapRef}
          style={[styles.locationMap, { height: Math.max(260, height * 0.48) }]}
          initialRegion={{ latitude: selectedLocation.latitude, longitude: selectedLocation.longitude, latitudeDelta: 0.07, longitudeDelta: 0.07 }}
          onPress={(event) => setMapPin(event.nativeEvent.coordinate)}
        >
          <Marker
            coordinate={{ latitude: selectedLocation.latitude, longitude: selectedLocation.longitude }}
            draggable
            title={selectedLocation.label}
            onDragEnd={(event) => setMapPin(event.nativeEvent.coordinate)}
          />
        </MapView>
        <View style={styles.pinConfirmRow}>
          <Text style={styles.pinCoords} numberOfLines={2}>{selectedLocation.label}</Text>
          <Pressable style={styles.pinConfirmButton} onPress={() => onSelect(selectedLocation)}>
            <Text style={styles.pinConfirmText}>Use this pin</Text>
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
  return (
    <Pressable style={styles.routeRow} onPress={onPress}>
      <View style={styles.clockIcon}><Clock color={colors.primary} size={18} /></View>
      <View style={styles.flex}>
        <Text style={styles.routeTitle}>{route.from} to {route.to}</Text>
        <Text style={styles.routeMeta}>Sedan ₹23/km · SUV ₹27/km · Tempo ₹35/km</Text>
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
          <Text style={styles.weddingTitle}>Decorated baraat cars from <Text style={styles.yellowText}>₹4,500</Text></Text>
          <Text style={styles.weddingSub}>Fresh florals · uniformed chauffeur · sedan to Fortuner</Text>
          <View style={styles.viewPackages}><Text style={styles.viewPackagesText}>View packages</Text><ArrowUpRight color={colors.primary} size={16} /></View>
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
  bg: '#0E0D0B',
  surface: '#171613',
  surfaceElevated: '#211F1B',
  card: '#1A1815',
  cardEnd: '#13110F',
  text: '#FAF8F5',
  muted: '#9B9891',
  mutedForeground: '#9B9891',
  border: '#2B2825',
  borderStrong: '#4B4742',
  input: '#211F1B',
  primary: '#F6CE00',
  primaryGlow: '#FEE657',
  primaryForeground: '#0E0D0B',
  destructive: '#F94144',
  success: '#4CC157',
  whatsapp: '#2EB45C',
  placeholder: '#9B9891',
  yellow: '#F6CE00',
  black: '#0E0D0B'
};

const styles = StyleSheet.create({
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
  drawerIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: 'rgba(246,206,0,0.12)', alignItems: 'center', justifyContent: 'center' },
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
  pinPulse: { position: 'absolute', alignSelf: 'center', top: 162, width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(246,206,0,0.24)', alignItems: 'center', justifyContent: 'center' },
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
  iconBox: { width: 46, height: 46, borderRadius: 16, backgroundColor: 'rgba(246,206,0,0.15)', alignItems: 'center', justifyContent: 'center' },
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
  smallIcon: { width: 32, height: 32, borderRadius: 12, backgroundColor: 'rgba(246,206,0,0.15)', alignItems: 'center', justifyContent: 'center' },
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
  badge: { color: colors.primary, backgroundColor: 'rgba(246,206,0,0.20)', borderRadius: 999, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 2, fontSize: 9, fontWeight: '900' },
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
    borderColor: 'rgba(246,206,0,0.30)',
    padding: 20,
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8
  },
  weddingGlow: { position: 'absolute', right: -24, top: -24, width: 128, height: 128, borderRadius: 64, backgroundColor: 'rgba(246,206,0,0.15)' },
  weddingContent: { flex: 1, justifyContent: 'flex-start' },
  weddingBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: 'rgba(246,206,0,0.15)', paddingHorizontal: 8, paddingVertical: 3 },
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
  ratingPill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, backgroundColor: 'rgba(246,206,0,0.15)', paddingHorizontal: 10, paddingVertical: 5 },
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
  currentLocationButton: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 12, marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(246,206,0,0.35)', backgroundColor: 'rgba(246,206,0,0.10)' },
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
  statusPending: { backgroundColor: 'rgba(246,206,0,0.16)' },
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
  quoteBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: 'rgba(246,206,0,0.30)', backgroundColor: 'rgba(246,206,0,0.10)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
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
  fareCard: { borderRadius: 18, borderWidth: 1, borderColor: 'rgba(246,206,0,0.30)', backgroundColor: 'rgba(246,206,0,0.10)', padding: 12, marginBottom: 10 },
  fareLabel: { color: colors.yellow, fontSize: 10, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2 },
  distanceValue: { color: colors.text, fontSize: 16, fontWeight: '900', marginTop: 8 },
  farePrice: { color: colors.yellow, fontSize: 14, fontWeight: '900', marginTop: 8 },
  fareDisclaimer: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 6 },
  fareLines: { marginTop: 10, gap: 6 },
  fareLine: { flexDirection: 'row', justifyContent: 'space-between' },
  fareLineLabel: { color: colors.muted, fontSize: 12 },
  fareLineValue: { color: colors.text, fontSize: 12, fontWeight: '700' },
  fareTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(246,206,0,0.30)' },
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
});

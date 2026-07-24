import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  ImageBackground,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { login, setAuthToken, setBaseUrl } from './src/api/client';
import {
  ArrowUpRight,
  ArrowRight,
  Calendar,
  Car,
  Check,
  ChevronRight,
  Clock,
  Briefcase,
  Heart,
  Home,
  MapPin,
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

const img = {
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
    price: '₹1,699',
    unit: 'one way',
    image: img.sedan,
    badge: 'MOST POPULAR',
    features: ['Fully Air Conditioned', 'Professional Chauffeur', 'Best for Airport & Outstation']
  },
  {
    id: 'suv',
    name: 'Luxury SUV',
    models: 'Toyota Innova · Ertiga · Scorpio',
    seats: '6-7 Seats',
    price: '₹1,999',
    unit: 'one way',
    image: img.suv,
    features: ['Extra Space & Legroom', 'Family Outstation', 'Wedding Decoration Available']
  },
  {
    id: 'tempo',
    name: 'Tempo Traveller',
    models: 'Force Traveller · Minibus',
    seats: '12-26 Seats',
    price: '₹25/km',
    unit: 'per km',
    image: img.tempo,
    features: ['Pushback Seating', 'Baraats, Pilgrimages & Trips', 'Dual Drivers Long Routes']
  }
];

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
    icon: Heart
  },
  {
    id: 'outstation',
    title: 'Outstation Cabs',
    short: 'Muzaffarpur ↔ Patna · ₹1,699 one way',
    description: "Bihar's most travelled route - fixed fare, door-to-door pickup, AC cab. NH-27 via Hajipur - fastest route, on-time every time.",
    price: '₹1,699',
    priceNote: 'One way Sedan · RT ₹2,999',
    features: ['Door-to-Door', 'No Hidden Charges', 'Clean AC Cab', 'One Way & Round Trip'],
    image: img.outstation,
    icon: Car
  },
  {
    id: 'airport',
    title: 'Airport Transfer',
    short: 'Patna & Darbhanga airports · 24x7',
    description: 'Muzaffarpur se Patna Airport (PAT) aur Darbhanga Airport (DBR) - flight tracking, on-time pickup, zero waiting. Early morning special available.',
    price: '₹1,699',
    priceNote: 'Patna Airport · Sedan',
    features: ['Flight Tracking', 'On-Time Guarantee', 'Early Morning Pickup', 'Both Airports'],
    image: img.airport,
    icon: Plane
  },
  {
    id: 'tempo',
    title: 'Tempo Traveller Hire',
    short: '12-26 seater for groups & pilgrimage',
    description: 'Family trips, pilgrimage to Vaishali-Gaya-Bodh Gaya, baraat groups, corporate outings - 12 to 26 seater AC tempo with pushback seats.',
    price: '₹25/km',
    priceNote: '12 Seater · Min 100km',
    features: ['12-26 Seater', 'Pushback Seats', 'All Bihar Routes', 'Dual Drivers'],
    image: img.tempo,
    icon: Sparkles
  },
  {
    id: 'local',
    title: 'Local & Outstation',
    short: 'All routes across Bihar',
    description: 'Muzaffarpur to Darbhanga, Sitamarhi, Motihari, Samastipur, Patna - sab routes cover. Local city rides bhi available. Instant taxi booking on WhatsApp.',
    price: '₹1,699',
    priceNote: 'Outstation Sedan · One Way',
    features: ['All Bihar Routes', 'Local City Rides', 'Instant Booking', 'Same Driver Both Ways'],
    image: img.outstation,
    icon: MapPin
  }
];

const ROUTES = [
  { from: 'Muzaffarpur', to: 'Patna', sedan: 1699, suv: 2499, rt: 2999 },
  { from: 'Muzaffarpur', to: 'Darbhanga', sedan: 1699, suv: 2499, rt: 2999 },
  { from: 'Muzaffarpur', to: 'Patna Airport', sedan: 1699, suv: 2499, rt: 2999 },
  { from: 'Muzaffarpur', to: 'Darbhanga Airport', sedan: 1699, suv: 2499, rt: 2999 },
  { from: 'Muzaffarpur', to: 'Sitamarhi', sedan: 1699, suv: 2499, rt: 2999 },
  { from: 'Muzaffarpur', to: 'Motihari', sedan: 1999, suv: 2799, rt: 3499 },
  { from: 'Muzaffarpur', to: 'Samastipur', sedan: 1700, suv: 2500, rt: 3000 },
  { from: 'Muzaffarpur', to: 'Raxual', sedan: 2699, suv: 3499, rt: 4499 }
];

const serviceTypeMap = {
  'Outstation / Intercity': 'OUTSTATION',
  'Wedding Car - Baraat / Bidai': 'WEDDING',
  'Airport Transfer': 'AIRPORT',
  'Local City Ride': 'LOCAL',
  'Tempo Traveller': 'OUTSTATION'
};

const REVIEWS = [
  { name: 'Bright Nut', text: 'Car was clean, driver was friendly, and the ride felt very comfortable.', rating: 5 },
  { name: 'Md Shahnawaz', text: 'Driver arrived on time, helped with luggage, and the car was clean.', rating: 5 },
  { name: 'Anjali Singh', text: 'Booked a wedding car for baraat. Decoration was beautiful and professional.', rating: 5 }
];

const TABS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'fleet', label: 'Fleet', icon: Car },
  { id: 'services', label: 'Services', icon: Sparkles },
  { id: 'bookings', label: 'My Trips', icon: Clock },
  { id: 'book', label: 'Book', icon: MessageCircle, primary: true },
  { id: 'about', label: 'About', icon: User }
];

function wa(message) {
  return `https://wa.me/${BRAND.phoneIntl}?text=${encodeURIComponent(message)}`;
}

function parseTripDate(value) {
  const match = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2})\s*$/.exec(value);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match;
  const parsed = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute)
  );
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
  const [tab, setTab] = useState('home');
  const [from, setFrom] = useState('Muzaffarpur');
  const [to, setTo] = useState('Patna');
  const [service, setService] = useState('Outstation / Intercity');
  const [phone, setPhone] = useState('');
  const [date, setDate] = useState(new Date(Date.now() + 60 * 60 * 1000));
  const [dateText, setDateText] = useState(formatDate(new Date(Date.now() + 60 * 60 * 1000)));
  const [lastTrip, setLastTrip] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [bookingEvents, setBookingEvents] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [bookingError, setBookingError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [apiUrl, setApiUrl] = useState('http://192.168.29.135:4000');
  const [user, setUser] = useState(null);
  const [authModalVisible, setAuthModalVisible] = useState(false);
  const [authName, setAuthName] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState(null);

  const matchedRoute = useMemo(
    () => ROUTES.find((r) => r.from.toLowerCase() === from.toLowerCase() && r.to.toLowerCase() === to.toLowerCase()),
    [from, to]
  );

  useEffect(() => {
    setBaseUrl(apiUrl);
  }, [apiUrl]);

  useEffect(() => {
    if (user?.phone && user.phone !== phone) {
      setPhone(user.phone);
    }
  }, [user]);

  async function handleLogin() {
    if (!phone) {
      Alert.alert('Phone required', 'Enter your phone number to log in.');
      return false;
    }
    setAuthError(null);
    setAuthLoading(true);
    try {
      const data = await login(phone, authName || null);
      setUser(data.user);
      setAuthToken(data.token);
      setAuthModalVisible(false);
      setAuthName('');
      Alert.alert('Logged in', `Welcome ${data.user.fullName || data.user.phone}!`);
      return true;
    } catch (err) {
      const message = err.message || 'Unable to log in. Please try again.';
      setAuthError(message);
      return false;
    } finally {
      setAuthLoading(false);
    }
  }

  async function ensureLoggedIn() {
    if (user) return true;
    return handleLogin();
  }

  async function sendBooking() {
    if (!phone) {
      return Alert.alert('Phone required', 'Enter your phone number so we can confirm your booking.');
    }

    if (!(await ensureLoggedIn())) {
      return;
    }

    const serviceType = serviceTypeMap[service] || 'OUTSTATION';
    const carCategory = service === 'Tempo Traveller' ? 'traveller' : 'sedan';
    const tripDate = parseTripDate(dateText);

    if (!tripDate) {
      Alert.alert('Invalid date', 'Please use DD/MM/YYYY HH:mm format for your travel date.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        phone,
        fullName: null,
        serviceType,
        pickup: from,
        drop: to,
        tripDatetime: tripDate.toISOString(),
        carCategory,
        customerNote: service
      };
      const data = await createBooking(payload);
      const booking = data.booking;

      setLastTrip({
        from,
        to,
        service,
        date: dateText,
        fare: booking.estimated_fare ? `₹${booking.estimated_fare}` : 'Quote pending'
      });

      Alert.alert('Booking requested', 'Your ride request has been created. Track it in My Trips.');
      setTab('bookings');
      await fetchBookings();
    } catch (err) {
      Alert.alert('Booking failed', err.message || 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  function fetchBookings() {
    if (!phone) return;
    setLoadingBookings(true);
    setBookingError(null);

    return listBookings(phone)
      .then((data) => setBookings(data.bookings || []))
      .catch((err) => setBookingError(err.message || 'Could not load bookings.'))
      .finally(() => setLoadingBookings(false));
  }

  function fetchBookingDetails(id) {
    setLoadingBookings(true);
    setBookingError(null);

    return getBooking(id)
      .then((data) => {
        setSelectedBooking(data.booking);
        setBookingEvents(data.events || []);
      })
      .catch((err) => setBookingError(err.message || 'Could not load booking details.'))
      .finally(() => setLoadingBookings(false));
  }

  useEffect(() => {
    if (tab === 'bookings' && phone) {
      fetchBookings();
    }
  }, [tab, phone]);

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="light-content" />
      <Header user={user} onLoginPress={() => setAuthModalVisible(true)} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {tab === 'home' && <HomeScreen onBook={() => setTab('book')} onRoute={(route) => { setFrom(route.from); setTo(route.to); setTab('book'); }} apiUrl={apiUrl} setApiUrl={setApiUrl} />}
        {tab === 'fleet' && <FleetScreen />}
        {tab === 'services' && <ServicesScreen onBook={() => setTab('book')} />}
        {tab === 'bookings' && (
          <BookingsScreen
            phone={phone}
            bookings={bookings}
            loading={loadingBookings}
            error={bookingError}
            selectedBooking={selectedBooking}
            events={bookingEvents}
            onRefresh={fetchBookings}
            onSelectBooking={fetchBookingDetails}
            onBack={() => {
              setSelectedBooking(null);
              setBookingEvents([]);
            }}
          />
        )}
        {tab === 'book' && (
          <BookScreen
            from={from}
            to={to}
            service={service}
            phone={phone}
            date={dateText}
            matchedRoute={matchedRoute}
            onFrom={setFrom}
            onTo={setTo}
            onService={setService}
            onPhone={setPhone}
            onDate={setDateText}
            onSend={sendBooking}
            isSubmitting={submitting}
          />
        )}
        {tab === 'about' && <AboutScreen lastTrip={lastTrip} />}
      </ScrollView>
      <BottomNav tab={tab} onTab={setTab} />
      <Modal visible={authModalVisible} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Login to SadakYatra</Text>
            <Text style={styles.modalSubtitle}>Enter your phone and optional name to continue.</Text>
            <View style={styles.fieldBox}>
              <Text style={styles.fieldLabel}>Phone</Text>
              <TextInput
                value={phone}
                onChangeText={setPhone}
                placeholder="+91 93040..."
                placeholderTextColor={colors.placeholder}
                keyboardType="phone-pad"
                style={styles.fieldInput}
              />
            </View>
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
            {authError ? <Text style={styles.errorText}>{authError}</Text> : null}
            <View style={styles.modalButtons}>
              <Pressable style={styles.modalButton} onPress={handleLogin} disabled={authLoading}>
                <Text style={styles.modalButtonText}>{authLoading ? 'Logging in…' : 'Login'}</Text>
              </Pressable>
              <Pressable style={styles.modalButtonSecondary} onPress={() => setAuthModalVisible(false)}>
                <Text style={styles.modalButtonTextSecondary}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Header({ user, onLoginPress }) {
  return (
    <View style={styles.header}>
      <BrandGradient style={styles.logoWrap}>
        <Text style={styles.logoInitial}>S</Text>
      </BrandGradient>
      <View style={styles.headerText}>
        <Text style={styles.logoTitle}>सड़क<Text style={styles.logoAccent}>Yatra</Text></Text>
        <Text style={styles.logoSub}>{BRAND.tagline}</Text>
      </View>
      <View style={styles.headerRight}>
        <Pressable style={styles.headerAction} onPress={onLoginPress}>
          <User color={colors.primary} size={18} strokeWidth={2.5} />
          <Text style={styles.headerActionText}>{user ? 'Account' : 'Login'}</Text>
        </Pressable>
        <Pressable style={styles.callButton} onPress={() => Linking.openURL(`tel:${BRAND.phone}`)}>
          <Phone color={colors.primary} size={18} strokeWidth={2.5} />
        </Pressable>
      </View>
    </View>
  );
}

function HomeScreen({ onBook, onRoute, apiUrl, setApiUrl }) {
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [tempApiUrl, setTempApiUrl] = useState(apiUrl);
  return (
    <View>
      <ImageBackground source={img.map} style={styles.mapHero} imageStyle={styles.mapHeroImage}>
        <View style={styles.mapOverlay} />
        <View style={styles.heroCopy}>
          <Text style={styles.eyebrow}>Good to see you</Text>
          <Text style={styles.heroTitle}>Kahan jaana hai aaj?</Text>
        </View>
        <View style={styles.pinPulse}>
        <BrandGradient style={styles.pinCore}>
          <View style={styles.pinDot} />
        </BrandGradient>
      </View>
    </ImageBackground>

      <Pressable style={styles.whereCardOuter} onPress={onBook}>
        <CardGradient style={styles.whereCard}>
          <View style={styles.iconBox}><Search color={colors.primary} size={22} /></View>
          <View style={styles.flex}>
            <Text style={styles.whereEyebrow}>Plan your ride</Text>
            <Text style={styles.whereTitle}>Where to?</Text>
          </View>
          <BrandGradient style={styles.yellowCircle}><ArrowRight color={colors.primaryForeground} size={20} strokeWidth={3} /></BrandGradient>
        </CardGradient>
      </Pressable>

      <RoutePreview onBook={onBook} />
      <QuickPills onBook={onBook} />
      <SectionTitle eyebrow="Suggested rides" title="Choose your ride" action="See all" />
      <FleetList compact />
      <SectionTitle eyebrow="Popular near you" title="Most-booked routes" />
      {ROUTES.slice(0, 5).map((route) => <RouteRow key={route.to} route={route} onPress={() => onRoute(route)} />)}
      <WeddingPromo onBook={onBook} />
      <SafetyStrip />

      <Pressable style={styles.apiSettingsToggle} onPress={() => setShowApiSettings(!showApiSettings)}>
        <Text style={styles.apiSettingsText}>⚙️ API Settings</Text>
      </Pressable>

      {showApiSettings && (
        <View style={styles.apiSettings}>
          <Text style={styles.apiSettingsLabel}>Backend URL:</Text>
          <TextInput
            style={styles.apiUrlInput}
            value={tempApiUrl}
            onChangeText={setTempApiUrl}
            placeholder="https://your-app.railway.app"
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

function RoutePreview({ onBook }) {
  return (
    <View style={styles.routePreview}>
      <View style={styles.routeRail}>
        <View style={styles.dotYellow} />
        <View style={styles.railLine} />
        <View style={styles.dotSquare} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.inputTiny}>Pickup</Text>
        <Text style={styles.inputStrong}>{BRAND.city}</Text>
        <View style={styles.dashedLine} />
        <Pressable onPress={onBook} style={styles.addDestination}>
          <View>
            <Text style={styles.inputTiny}>Drop</Text>
            <Text style={styles.mutedStrong}>Add destination</Text>
          </View>
          <Text style={styles.plus}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function QuickPills({ onBook }) {
  const pills = [
    { icon: Plane, label: 'Patna Airport', sub: '₹1,699' },
    { icon: Heart, label: 'Wedding Car', sub: 'from ₹4,500' },
    { icon: Briefcase, label: 'Outstation', sub: 'fixed fare' },
    { icon: MapPin, label: 'Darbhanga', sub: '₹1,699' }
  ];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
      {pills.map((pill) => {
        const Icon = pill.icon;
        return (
          <Pressable key={pill.label} style={styles.quickPill} onPress={onBook}>
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

function FleetScreen() {
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
                <WhatsAppButton label="Book Now" message={`Hi ${BRAND.name}! I want to book a ${car.name}. Please confirm availability.`} />
              </View>
            </View>
          </CardGradient>
        ))}
      </View>
    </View>
  );
}

function FleetList({ compact = false }) {
  return (
    <View style={styles.listGap}>
      {FLEET.map((car) => (
        <CardGradient key={car.id} style={styles.rideRow}>
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
      ))}
    </View>
  );
}

function ServicesScreen({ onBook }) {
  return (
    <View>
      <SectionTitle eyebrow="Every Need Covered" title="Services for every occasion" subtitle="From baraat entries to airport drops - across Muzaffarpur & Bihar." />
      {SERVICES.map((service) => {
        return (
          <Pressable key={service.id} onPress={onBook}>
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
                  <View>
                    <Text style={styles.servicePrice}>{service.price}</Text>
                    <Text style={styles.priceUnit}>{service.priceNote}</Text>
                  </View>
                  <WhatsAppButton label="Enquire" message={`Hi ${BRAND.name}! I'm interested in ${service.title}. Please share details.`} />
                </View>
              </View>
            </CardGradient>
          </Pressable>
        );
      })}
    </View>
  );
}

function BookScreen({ from, to, service, phone, date, matchedRoute, onFrom, onTo, onService, onPhone, onDate, onSend, isSubmitting }) {
  return (
    <View>
      <View style={styles.centerIntro}>
        <View style={styles.quoteBadge}><Sparkles color={colors.primary} size={14} /><Text style={styles.quoteBadgeText}>Instant booking request</Text></View>
        <Text style={styles.bookTitle}>Book in <Text style={styles.yellowText}>60 seconds.</Text></Text>
        <Text style={styles.bookSub}>Fill below, get a confirmed quote in minutes.</Text>
      </View>

      <CardGradient style={styles.bookingPanel}>
        <Field icon={MapPin} label="From" value={from} onChangeText={onFrom} placeholder="Pickup city" />
        <Field icon={ArrowRight} label="To" value={to} onChangeText={onTo} placeholder="Destination" />
        <SelectField icon={Sparkles} label="Service Type" value={service} options={['Outstation / Intercity', 'Wedding Car - Baraat / Bidai', 'Airport Transfer', 'Local City Ride', 'Tempo Traveller']} onValue={onService} />
        <View style={styles.twoCol}>
          <View style={styles.fieldBox}>
            <View style={styles.fieldLabelRow}><Calendar color={colors.primary} size={14} /><Text style={styles.fieldLabel}>Date</Text></View>
            <TextInput value={date} onChangeText={onDate} placeholder="DD/MM/YYYY HH:mm" placeholderTextColor={colors.placeholder} style={styles.fieldInput} />
          </View>
          <View style={styles.fieldBox}>
            <View style={styles.fieldLabelRow}><Phone color={colors.primary} size={14} /><Text style={styles.fieldLabel}>Phone</Text></View>
            <TextInput value={phone} onChangeText={onPhone} keyboardType="phone-pad" placeholder="+91 ..." placeholderTextColor={colors.placeholder} style={styles.fieldInput} />
          </View>
        </View>
        {matchedRoute ? <FareCard route={matchedRoute} /> : null}
        <Pressable style={styles.whatsappButtonOuter} onPress={onSend} disabled={isSubmitting}>
          <BrandGradient style={styles.whatsappButton}>
            <MessageCircle color={colors.primaryForeground} size={21} strokeWidth={2.5} />
            <Text style={styles.whatsappText}>{isSubmitting ? 'Requesting...' : 'Request booking'}</Text>
          </BrandGradient>
        </Pressable>
        <Text style={styles.noHidden}>No hidden charges · Instant confirmation</Text>
      </CardGradient>

      <SectionTitle eyebrow="Quick pick" title="Popular routes" />
      {ROUTES.slice(0, 5).map((route) => (
        <Pressable key={route.to} style={styles.routeButton} onPress={() => { onFrom(route.from); onTo(route.to); }}>
          <View>
            <Text style={styles.routeButtonMeta}>{route.from} to {route.to}</Text>
            <Text style={styles.routeButtonFare}>Sedan <Text style={styles.yellowText}>₹{route.sedan}</Text></Text>
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
        <Text style={styles.aboutText}>SadakYatra offers wedding cars, airport transfers, outstation taxis, tempo travellers, and local city rides across Bihar.</Text>
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

function BookingsScreen({ phone, bookings, loading, error, selectedBooking, events, onRefresh, onSelectBooking, onBack }) {
  if (!phone) {
    return (
      <View style={styles.emptyStatePanel}>
        <SectionTitle eyebrow="My Trips" title="Booking status" />
        <Text style={styles.emptyTitle}>Enter your phone on the Book tab</Text>
        <Text style={styles.emptySub}>Your booking requests and status timeline appear once we know your phone number.</Text>
      </View>
    );
  }

  return (
    <View>
      <SectionTitle eyebrow="My Trips" title="Booking status" />
      {loading && <Text style={styles.syncText}>Loading bookings…</Text>}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {!loading && !selectedBooking && bookings.length === 0 ? (
        <View style={styles.emptyStatePanel}>
          <Text style={styles.emptyTitle}>No bookings found</Text>
          <Text style={styles.emptySub}>Request a ride from the Book tab and track it here.</Text>
          <Pressable style={styles.smallCtaOuter} onPress={onRefresh}>
            <BrandGradient style={styles.smallCta}>
              <Text style={styles.smallCtaText}>Refresh</Text>
            </BrandGradient>
          </Pressable>
        </View>
      ) : null}

      {!loading && !selectedBooking && bookings.map((booking) => (
        <Pressable key={booking.id} style={styles.bookingRow} onPress={() => onSelectBooking(booking.id)}>
          <View style={styles.bookingSummary}>
            <Text style={styles.bookingLabel}>{booking.booking_ref}</Text>
            <Text style={styles.bookingMeta}>{booking.pickup_text} → {booking.drop_text}</Text>
            <Text style={styles.bookingDetail}>{formatDate(new Date(booking.trip_datetime))}</Text>
          </View>
          <View style={[styles.statusPill, booking.status === 'PENDING' && styles.statusPending, booking.status === 'CONFIRMED' && styles.statusConfirmed, booking.status === 'ONGOING' && styles.statusOngoing, booking.status === 'COMPLETED' && styles.statusCompleted, booking.status === 'CANCELLED' && styles.statusCancelled]}>
            <Text style={styles.statusLabel}>{booking.status}</Text>
          </View>
        </Pressable>
      ))}

      {selectedBooking ? (
        <View style={styles.statusCard}>
          <Pressable style={styles.backLink} onPress={onBack}>
            <Text style={styles.backLinkText}>← Back to bookings</Text>
          </Pressable>
          <Text style={styles.bookingLabel}>{selectedBooking.booking_ref}</Text>
          <Text style={styles.bookingMeta}>{selectedBooking.pickup_text} → {selectedBooking.drop_text}</Text>
          <Text style={styles.statusLabelLarge}>{selectedBooking.status}</Text>
          <Text style={styles.bookingDetail}>{formatDate(new Date(selectedBooking.trip_datetime))}</Text>
          <Text style={styles.bookingNote}>{selectedBooking.customer_note || 'No extra note'}</Text>

          <SectionTitle eyebrow="Status timeline" title="Updates" />
          {events.length === 0 ? (
            <Text style={styles.emptySub}>No timeline events are available yet.</Text>
          ) : (
            events.map((event) => (
              <View key={event.id} style={styles.timelineItem}>
                <View style={styles.timelineDot} />
                <View style={styles.timelineContent}>
                  <Text style={styles.timelineTitle}>{event.new_status}</Text>
                  <Text style={styles.timelineText}>{event.note || 'Status updated'}</Text>
                </View>
              </View>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

function Field({ icon: Icon, label, value, onChangeText, placeholder }) {
  return (
    <View style={styles.fieldBox}>
      <View style={styles.fieldLabelRow}><Icon color={colors.primary} size={14} /><Text style={styles.fieldLabel}>{label}</Text></View>
      <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.placeholder} style={styles.fieldInput} />
    </View>
  );
}

function SelectField({ icon: Icon, label, value, options, onValue }) {
  return (
    <View style={styles.fieldBox}>
      <View style={styles.fieldLabelRow}><Icon color={colors.primary} size={14} /><Text style={styles.fieldLabel}>{label}</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {options.map((option) => (
          <Pressable key={option} style={[styles.selectPill, value === option && styles.selectPillActive]} onPress={() => onValue(option)}>
            <Text style={[styles.selectText, value === option && styles.selectTextActive]}>{option}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function FareCard({ route }) {
  return (
    <View style={styles.fareCard}>
      <Text style={styles.fareLabel}>Estimated fare</Text>
      <View style={styles.fareGrid}>
        <FareItem label="Sedan" value={`₹${route.sedan}`} />
        <FareItem label="SUV" value={`₹${route.suv}`} />
        <FareItem label="Round Trip" value={`₹${route.rt}`} />
      </View>
    </View>
  );
}

function FareItem({ label, value }) {
  return (
    <View style={styles.fareItem}>
      <Text style={styles.fareItemLabel}>{label}</Text>
      <Text style={styles.fareItemValue}>{value}</Text>
    </View>
  );
}

function RouteRow({ route, onPress }) {
  return (
    <Pressable style={styles.routeRow} onPress={onPress}>
      <View style={styles.clockIcon}><Clock color={colors.primary} size={18} /></View>
      <View style={styles.flex}>
        <Text style={styles.routeTitle}>{route.from} to {route.to}</Text>
        <Text style={styles.routeMeta}>Sedan from <Text style={styles.yellowText}>₹{route.sedan}</Text> · RT ₹{route.rt}</Text>
      </View>
      <ChevronRight color={colors.mutedForeground} size={18} />
    </Pressable>
  );
}

function WeddingPromo({ onBook }) {
  return (
    <Pressable style={styles.weddingPromoOuter} onPress={onBook}>
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

function SafetyStrip() {
  return (
    <View style={styles.safetySection}>
      <View style={styles.safetyCard}>
        <View style={styles.successIcon}><ShieldCheck color={colors.success} size={20} /></View>
        <View style={styles.flex}>
          <Text style={styles.safetyTitle}>Your safety, our priority</Text>
          <Text style={styles.safetySub}>Verified drivers · sanitized cabs · 24x7 support</Text>
        </View>
      </View>
      <View style={styles.ratingCard}>
        <View style={styles.ratingPill}><Star color={colors.primary} fill={colors.primary} size={13} /><Text style={styles.ratingPillText}>{BRAND.rating}</Text></View>
        <Text style={styles.ratingText}>{BRAND.reviews}+ Google reviews</Text>
        <Text style={styles.readText}>Read →</Text>
      </View>
      <View style={styles.quickBookRow}>
        <WhatsAppButton label="Quick book on WhatsApp" message={`Hi ${BRAND.name}! I want to book a cab.`} />
        <Pressable style={styles.callSquare} onPress={() => Linking.openURL(`tel:${BRAND.phone}`)}>
          <Phone color={colors.primary} size={20} />
        </Pressable>
      </View>
    </View>
  );
}

function SectionTitle({ eyebrow, title, action, subtitle }) {
  return (
    <View style={styles.sectionHeader}>
      <View>
        <Text style={styles.sectionEyebrow}>{eyebrow}</Text>
        <Text style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {action ? <Text style={styles.sectionAction}>{action}</Text> : null}
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

function BottomNav({ tab, onTab }) {
  return (
    <View style={styles.bottomNav}>
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

function formatDate(date) {
  const day = `${date.getDate()}`.padStart(2, '0');
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()} ${hours}:${minutes}`;
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
  content: { paddingBottom: 116 },
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
  logoInitial: { color: colors.primaryForeground, fontSize: 20, fontWeight: '900' },
  headerText: { flex: 1 },
  logoTitle: { color: colors.text, fontSize: 16, fontWeight: '900', letterSpacing: -0.4 },
  logoAccent: { color: colors.primary },
  logoSub: { color: colors.muted, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerAction: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 10 },
  headerActionText: { color: colors.primary, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  callButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
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
  statusCard: { marginHorizontal: 16, marginBottom: 24, borderRadius: 24, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 18, gap: 14 },
  backLink: { marginBottom: 10 },
  backLinkText: { color: colors.primary, fontSize: 13, fontWeight: '900' },
  bookingNote: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 10 },
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
  fareGrid: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 },
  fareItem: { alignItems: 'center', flex: 1 },
  fareItemLabel: { color: colors.muted, fontSize: 10 },
  fareItemValue: { color: colors.yellow, fontWeight: '900', marginTop: 2 },
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

import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import * as SecureStore from 'expo-secure-store';
import MapView, { Marker } from 'react-native-maps';
import { partnerAdminRequest, partnerDriverRequest } from '../api/client';

const CATEGORY_LABELS = { sedan: 'Sedan', suv: 'SUV', traveller: 'Tempo Traveller' };
const DRIVER_TOKEN_KEY = 'sadakyatra.driverToken';
const ADMIN_KEY_KEY = 'sadakyatra.adminKey';

function formatPickupTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const stages = {
  BOOKING_ACCEPTED: 'GOING_TO_PICKUP',
  GOING_TO_PICKUP: 'ARRIVED',
  ARRIVED: 'TRIP_STARTED',
  TRIP_STARTED: 'TRIP_COMPLETED'
};

export default function PartnerOperations() {
  const [mode, setMode] = useState('driver');
  return (
    <View style={styles.section}>
      <Text style={styles.title}>Partner operations</Text>
      <Text style={styles.subtitle}>Driver availability, bookings, and fleet review.</Text>
      <View style={styles.modeRow}>
        <ModeButton label="Driver" active={mode === 'driver'} onPress={() => setMode('driver')} />
        <ModeButton label="Admin" active={mode === 'admin'} onPress={() => setMode('admin')} />
      </View>
      {mode === 'driver' ? <DriverMode /> : <AdminMode />}
    </View>
  );
}

function ModeButton({ label, active, onPress }) {
  return (
    <Pressable onPress={onPress} style={[styles.modeButton, active && styles.modeButtonActive]}>
      <Text style={[styles.modeText, active && styles.modeTextActive]}>{label}</Text>
    </Pressable>
  );
}

function DriverMode() {
  const [token, setToken] = useState('');
  const [activeToken, setActiveToken] = useState('');
  const [driver, setDriver] = useState(null);
  const [online, setOnline] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const locationSubscription = useRef(null);

  useEffect(() => {
    // Log the driver back in with the token saved on this phone.
    SecureStore.getItemAsync(DRIVER_TOKEN_KEY)
      .then((saved) => { if (saved) connect(saved, true); })
      .catch(() => {});
    return () => locationSubscription.current?.remove();
  }, []);

  // New offers arrive without the driver having to tap refresh.
  useEffect(() => {
    if (!activeToken) return undefined;
    const interval = setInterval(() => refresh().catch(() => {}), 10000);
    return () => clearInterval(interval);
  }, [activeToken]);

  async function refresh(auth = activeToken) {
    const result = await partnerDriverRequest('/driver/bookings', 'GET', undefined, auth);
    setBookings(result.bookings || []);
  }

  async function startLocationSharing(auth) {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') throw new Error('Location permission is needed to go online.');
    locationSubscription.current?.remove();
    const send = ({ coords }) => partnerDriverRequest('/driver/location', 'POST', {
      latitude: coords.latitude,
      longitude: coords.longitude
    }, auth).catch(() => {});
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then(send).catch(() => {});
    locationSubscription.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 8000, distanceInterval: 15 },
      send
    );
  }

  async function connect(auth = token.trim(), silent = false) {
    if (!auth) return setMessage('Paste the driver token you received from SadakYatra.');
    setBusy(true);
    if (!silent) setMessage('');
    try {
      const me = await partnerDriverRequest('/driver/me', 'GET', undefined, auth);
      setDriver(me.driver);
      setActiveToken(auth);
      setToken('');
      await SecureStore.setItemAsync(DRIVER_TOKEN_KEY, auth).catch(() => {});
      await refresh(auth);
      if (me.driver.online) {
        await startLocationSharing(auth).catch(() => {});
        setOnline(true);
      }
    } catch (error) {
      if (silent && error.status === 401) await SecureStore.deleteItemAsync(DRIVER_TOKEN_KEY).catch(() => {});
      if (!silent || error.status === 401) setMessage(error.message || 'Could not log in with this token.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    if (online) await toggleOnline();
    await SecureStore.deleteItemAsync(DRIVER_TOKEN_KEY).catch(() => {});
    setActiveToken('');
    setDriver(null);
    setBookings([]);
    setMessage('Logged out.');
  }

  async function toggleOnline() {
    setBusy(true);
    setMessage('');
    try {
      if (online) {
        locationSubscription.current?.remove();
        locationSubscription.current = null;
        await partnerDriverRequest('/driver/presence', 'PATCH', { online: false }, activeToken);
        setOnline(false);
        return;
      }
      await startLocationSharing(activeToken);
      await partnerDriverRequest('/driver/presence', 'PATCH', { online: true }, activeToken);
      setOnline(true);
      await refresh();
    } catch (error) {
      setMessage(error.message || 'Could not update availability.');
    } finally {
      setBusy(false);
    }
  }

  async function respond(bookingId, decision) {
    try {
      await partnerDriverRequest(`/driver/bookings/${bookingId}/response`, 'PATCH', { decision }, activeToken);
      setMessage(decision === 'ACCEPT' ? 'Booking accepted. Tap "Going to pickup" when you leave.' : 'Booking rejected.');
      await refresh();
    } catch (error) {
      setMessage(error.message || 'Could not respond to booking.');
      await refresh().catch(() => {});
    }
  }

  async function advance(bookingId, status) {
    try {
      await partnerDriverRequest(`/driver/bookings/${bookingId}/status`, 'PATCH', { status }, activeToken);
      await refresh();
    } catch (error) {
      setMessage(error.message || 'Could not update trip status.');
    }
  }

  if (!activeToken) {
    return (
      <View>
        <Text style={styles.disclosure}>Paste the driver token you received from SadakYatra. You only need to do this once on this phone.</Text>
        <View style={styles.inlineRow}>
          <TextInput value={token} onChangeText={setToken} placeholder="Driver token" placeholderTextColor={palette.muted} autoCapitalize="none" autoCorrect={false} secureTextEntry style={styles.inlineInput} />
          <ActionButton label={busy ? '…' : 'Login'} onPress={() => connect()} primary disabled={busy} />
        </View>
        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
    );
  }

  return (
    <View>
      <View style={styles.driverHeader}>
        <View style={styles.flex}>
          <Text style={styles.itemTitle}>{driver?.name || 'Driver'}</Text>
          <Text style={styles.itemMeta}>{driver?.cab ? `${driver.cab.cab_ref} · ${driver.cab.plate_no} · ${CATEGORY_LABELS[driver.cab.category] || driver.cab.category}` : ''}</Text>
        </View>
        <ActionButton label="Logout" onPress={logout} />
      </View>
      <Pressable onPress={toggleOnline} disabled={busy} style={[styles.onlineToggle, online ? styles.onlineToggleOn : styles.onlineToggleOff]}>
        <Text style={[styles.onlineToggleTitle, online && styles.onlineToggleTitleOn]}>{online ? 'ONLINE — Booking Available' : 'OFFLINE — Not Available'}</Text>
        <Text style={[styles.onlineToggleSub, online && styles.onlineToggleSubOn]}>{busy ? 'Please wait…' : online ? 'Tap to go offline' : 'Tap to go online and receive bookings'}</Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {bookings.length === 0 ? (
        <Text style={styles.itemMeta}>{online ? 'Waiting for bookings… new requests appear here automatically.' : 'Go online to receive bookings.'}</Text>
      ) : null}
      {bookings.map((booking) => {
        const isOffer = booking.driver_status === 'OFFERED';
        return (
          <View key={booking.id} style={[styles.listItem, isOffer && styles.offerCard]}>
            <Text style={styles.offerLabel}>{isOffer ? 'New Booking' : (booking.driver_status || '').replaceAll('_', ' ')}</Text>
            <Text style={styles.itemText}>Pickup: {booking.pickup_text}</Text>
            <Text style={styles.itemText}>Drop: {booking.drop_text}</Text>
            <Text style={styles.itemText}>Vehicle: {CATEGORY_LABELS[booking.car_category] || booking.car_category}</Text>
            <Text style={styles.itemText}>Pickup Time: {formatPickupTime(booking.trip_datetime)}</Text>
            <Text style={styles.itemMeta}>{booking.booking_ref}{booking.route_distance_km ? ` · ${booking.route_distance_km} km` : ''}{booking.estimated_fare ? ` · Fare ₹${booking.estimated_fare}` : ''}</Text>
            {isOffer ? (
              <>
                <Text style={styles.itemMeta}>Reply within 60 seconds, or the booking goes to the next cab.</Text>
                <View style={[styles.inlineRow, styles.offerActions]}>
                  <ActionButton label="Accept" onPress={() => respond(booking.id, 'ACCEPT')} primary />
                  <ActionButton label="Reject" onPress={() => respond(booking.id, 'REJECT')} />
                </View>
              </>
            ) : stages[booking.driver_status] ? (
              <View style={styles.offerActions}>
                <ActionButton label={stages[booking.driver_status].replaceAll('_', ' ')} onPress={() => advance(booking.id, stages[booking.driver_status])} primary />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function AdminMode() {
  const [apiKey, setApiKey] = useState('');
  const [applications, setApplications] = useState([]);
  const [partners, setPartners] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [docs, setDocs] = useState({});
  const [verifiedPhones, setVerifiedPhones] = useState({});
  const [gpsDevices, setGpsDevices] = useState({});
  const [driverToken, setDriverToken] = useState('');
  const [message, setMessage] = useState('');

  const [activeKey, setActiveKey] = useState('');

  useEffect(() => {
    SecureStore.getItemAsync(ADMIN_KEY_KEY)
      .then((saved) => { if (saved) setActiveKey(saved); })
      .catch(() => {});
  }, []);

  // Keep the dashboard current while it is open.
  useEffect(() => {
    if (!activeKey) return undefined;
    load();
    const interval = setInterval(() => load(true), 15000);
    return () => clearInterval(interval);
  }, [activeKey]);

  async function request(path, method = 'GET', body) {
    return partnerAdminRequest(path, method, body, activeKey);
  }

  async function login() {
    const key = apiKey.trim();
    if (!key) return setMessage('Enter the admin key.');
    try {
      await partnerAdminRequest('/admin/partners', 'GET', undefined, key);
      await SecureStore.setItemAsync(ADMIN_KEY_KEY, key).catch(() => {});
      setApiKey('');
      setMessage('');
      setActiveKey(key);
    } catch (error) {
      setMessage(error.message || 'Wrong admin key.');
    }
  }

  async function logout() {
    await SecureStore.deleteItemAsync(ADMIN_KEY_KEY).catch(() => {});
    setActiveKey('');
    setApplications([]);
    setPartners([]);
    setBookings([]);
  }

  async function load(quiet = false) {
    if (!quiet) setMessage('');
    // Load each section independently so one failing source (e.g. applications
    // when Supabase is down) doesn't hide the fleet and bookings.
    const [applicationResult, partnerResult, bookingResult] = await Promise.allSettled([
      request('/admin/partners/applications'),
      request('/admin/partners'),
      request('/admin/bookings')
    ]);
    if (applicationResult.status === 'fulfilled') setApplications(applicationResult.value.applications || []);
    if (partnerResult.status === 'fulfilled') setPartners(partnerResult.value.partners || []);
    if (bookingResult.status === 'fulfilled') setBookings(bookingResult.value.bookings || []);
    const errors = [applicationResult, partnerResult, bookingResult]
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason?.message || 'Could not load admin data.');
    if (errors.length && !quiet) setMessage([...new Set(errors)].join('\n'));
  }

  function updateDoc(applicationId, field, value) {
    setDocs((current) => ({
      ...current,
      [applicationId]: { rc: '', dl: '', insurance: '', ...current[applicationId], [field]: value }
    }));
  }

  async function approve(application) {
    try {
      const result = await request(`/admin/partners/applications/${application.id}/approve`, 'POST', {
        phoneVerified: verifiedPhones[application.id] === true,
        rcDocumentKey: docs[application.id]?.rc,
        dlDocumentKey: docs[application.id]?.dl,
        insuranceDocumentKey: docs[application.id]?.insurance
      });
      setDriverToken(result.driverAccessToken);
      setMessage(`${application.application_ref} approved. Hand the one-time token to the driver securely.`);
      await load();
    } catch (error) {
      setMessage(error.message || 'Could not approve application.');
    }
  }

  async function reject(applicationId) {
    try {
      await request(`/admin/partners/applications/${applicationId}`, 'PATCH', { status: 'REJECTED' });
      await load();
    } catch (error) {
      setMessage(error.message || 'Could not reject application.');
    }
  }

  async function assign(bookingId, vehicleId) {
    try {
      await request(`/admin/bookings/${bookingId}/assign`, 'POST', { vehicleId });
      setMessage('Booking sent to the driver.');
      await load(true);
    } catch (error) {
      setMessage(error.message || 'Could not offer booking.');
    }
  }

  async function setPartnerActive(partnerId, active) {
    try {
      await request(`/admin/partners/${partnerId}`, 'PATCH', { active });
      await load();
    } catch (error) {
      setMessage(error.message || 'Could not update partner status.');
    }
  }

  async function saveGpsDevice(vehicleId) {
    try {
      const gpsDeviceId = (gpsDevices[vehicleId] || '').trim() || null;
      await request(`/admin/vehicles/${vehicleId}`, 'PATCH', { gpsDeviceId });
      setMessage(gpsDeviceId ? 'GPS tracker linked to this cab.' : 'GPS tracker removed from this cab.');
      await load();
    } catch (error) {
      setMessage(error.message || 'Could not save the GPS device.');
    }
  }

  async function setVehicleActive(vehicleId, active) {
    try {
      await request(`/admin/vehicles/${vehicleId}`, 'PATCH', { active });
      await load();
    } catch (error) {
      setMessage(error.message || 'Could not update cab status.');
    }
  }

  return (
    <View>
      {!activeKey ? (
        <>
          <Text style={styles.disclosure}>Enter the admin key once; it is stored securely on this phone until you log out.</Text>
          <View style={styles.inlineRow}>
            <TextInput value={apiKey} onChangeText={setApiKey} placeholder="Admin key" placeholderTextColor={palette.muted} secureTextEntry autoCapitalize="none" style={styles.inlineInput} />
            <ActionButton label="Login" onPress={login} primary />
          </View>
          {message ? <Text style={styles.message}>{message}</Text> : null}
        </>
      ) : (
        <View style={styles.inlineRow}>
          <Text style={[styles.itemMeta, styles.flex]}>Bookings go automatically to the nearest free online cab. Use the buttons below only to override.</Text>
          <ActionButton label="Refresh" onPress={() => load()} />
          <ActionButton label="Logout" onPress={logout} />
        </View>
      )}
      {activeKey && message ? <Text style={styles.message}>{message}</Text> : null}
      {driverToken ? <View style={styles.listItem}><Text style={styles.itemTitle}>One-time driver token</Text><Text selectable style={styles.itemText}>{driverToken}</Text></View> : null}
      {applications.map((application) => (
        <View key={application.id} style={styles.listItem}>
          <Text style={styles.itemTitle}>{application.application_ref} · {application.full_name}</Text>
          <Text style={styles.itemText}>{application.phone} · {application.vehicle_number} · {application.vehicle_category} {application.vehicle_model}</Text>
          <Text style={styles.itemMeta}>{application.city}: {application.operating_area} · Driver {application.driver_name}</Text>
          {[
            ['rc', 'RC private object key'],
            ['dl', 'DL private object key'],
            ['insurance', 'Insurance private object key']
          ].map(([field, label]) => (
            <TextInput key={field} value={docs[application.id]?.[field] || ''} onChangeText={(value) => updateDoc(application.id, field, value)} placeholder={label} placeholderTextColor={palette.muted} autoCapitalize="none" style={styles.formInput} />
          ))}
          <Pressable onPress={() => setVerifiedPhones((current) => ({ ...current, [application.id]: !current[application.id] }))} style={styles.verifyRow}>
            <Text style={styles.itemText}>{verifiedPhones[application.id] ? '☑' : '□'} Phone verified by admin</Text>
          </Pressable>
          <View style={styles.inlineRow}>
            <ActionButton label="Approve" onPress={() => approve(application)} primary />
            <ActionButton label="Reject" onPress={() => reject(application.id)} />
          </View>
        </View>
      ))}
      {activeKey ? (
        <Text style={styles.groupTitle}>Waiting bookings · {bookings.filter((booking) => booking.status === 'PENDING').length}</Text>
      ) : null}
      {bookings.filter((booking) => booking.status === 'PENDING').map((booking) => {
        const offeredTo = booking.driver_status === 'OFFERED' ? partners.find((partner) => partner.driver_id === booking.driver_id) : null;
        const freeCabs = partners.filter((partner) => partner.is_online && partner.vehicle_active && partner.partner_active
          && partner.category === booking.car_category && !partner.current_booking_ref);
        return (
          <View key={booking.id} style={styles.listItem}>
            <Text style={styles.itemTitle}>{booking.booking_ref} · {booking.pickup_text} → {booking.drop_text}</Text>
            <Text style={styles.itemMeta}>{CATEGORY_LABELS[booking.car_category] || booking.car_category} · {formatPickupTime(booking.trip_datetime)}{booking.estimated_fare ? ` · ₹${booking.estimated_fare}` : ''}</Text>
            <Text style={styles.dispatchStatus}>
              {offeredTo
                ? `Sent to ${offeredTo.cab_ref} (${offeredTo.driver_name}) — waiting for driver`
                : freeCabs.length
                  ? 'Finding nearest cab automatically…'
                  : `No free ${CATEGORY_LABELS[booking.car_category] || booking.car_category} cab online. It will be sent as soon as one goes online.`}
            </Text>
            {freeCabs.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.vehicleChoices}>
                {freeCabs.map((cab) => (
                  <Pressable key={cab.vehicle_id} onPress={() => assign(booking.id, cab.vehicle_id)} style={styles.vehicleChoice}>
                    <Text style={styles.vehicleChoiceText}>Send to {cab.cab_ref} · {cab.driver_name}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
          </View>
        );
      })}
      {partners.length ? (
        <>
          <Text style={styles.groupTitle}>Fleet · {partners.filter((p) => p.is_online).length} online · {partners.filter((p) => p.current_booking_ref).length} on booking</Text>
          <FleetMap partners={partners} />
        </>
      ) : null}
      {partners.map((partner) => {
        const busy = Boolean(partner.current_booking_ref);
        return (
          <View key={`${partner.vehicle_id}-${partner.driver_phone}`} style={styles.listItem}>
            <Text style={styles.itemTitle}>{partner.cab_ref} · {partner.plate_no} · {partner.driver_name}</Text>
            <View style={styles.badgeRow}>
              <Text style={[styles.badge, partner.is_online ? styles.badgeOnline : styles.badgeOffline]}>{partner.is_online ? 'ONLINE' : 'OFFLINE'}</Text>
              <Text style={[styles.badge, busy ? styles.badgeBusy : styles.badgeFree]}>{busy ? 'ON BOOKING' : 'FREE'}</Text>
              {!partner.partner_active || !partner.vehicle_active ? <Text style={[styles.badge, styles.badgeOffline]}>PAUSED</Text> : null}
            </View>
            <Text style={styles.itemMeta}>{CATEGORY_LABELS[partner.category] || partner.category} {partner.model || ''} · {partner.driver_phone}</Text>
            {busy ? <Text style={styles.itemMeta}>{partner.current_booking_ref}: {partner.current_pickup} → {partner.current_drop} · {(partner.current_driver_status || '').replaceAll('_', ' ')}</Text> : null}
            <Text style={styles.itemMeta}>{partner.latitude == null ? 'No live location' : `Location ${partner.latitude.toFixed(4)}, ${partner.longitude?.toFixed(4)} · updated ${partner.location_updated_at} UTC`}</Text>
            <View style={styles.inlineRow}>
              <TextInput
                value={gpsDevices[partner.vehicle_id] ?? partner.gps_device_id ?? ''}
                onChangeText={(value) => setGpsDevices((current) => ({ ...current, [partner.vehicle_id]: value }))}
                placeholder="GPS tracker device ID (optional)"
                placeholderTextColor={palette.muted}
                autoCapitalize="none"
                style={styles.inlineInput}
              />
              <ActionButton label="Save" onPress={() => saveGpsDevice(partner.vehicle_id)} />
            </View>
            <View style={styles.inlineRow}>
              <ActionButton label={partner.partner_active ? 'Pause partner' : 'Resume partner'} onPress={() => setPartnerActive(partner.partner_id, !partner.partner_active)} />
              <ActionButton label={partner.vehicle_active ? 'Pause cab' : 'Resume cab'} onPress={() => setVehicleActive(partner.vehicle_id, !partner.vehicle_active)} />
            </View>
          </View>
        );
      })}
      {bookings.filter((booking) => booking.status !== 'PENDING').slice(0, 15).map((booking) => (
        <View key={booking.id} style={styles.listItem}>
          <Text style={styles.itemTitle}>{booking.booking_ref} · {booking.pickup_text} → {booking.drop_text}</Text>
          <Text style={styles.itemMeta}>{booking.status} · {(booking.driver_status || 'Not assigned').replaceAll('_', ' ')}</Text>
        </View>
      ))}
    </View>
  );
}

function FleetMap({ partners }) {
  const located = partners.filter((partner) => partner.latitude != null && partner.longitude != null);
  if (!located.length) return <Text style={styles.itemMeta}>No cab is sharing a live location right now.</Text>;
  const lats = located.map((partner) => partner.latitude);
  const lngs = located.map((partner) => partner.longitude);
  const region = {
    latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
    longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
    latitudeDelta: Math.max(0.05, (Math.max(...lats) - Math.min(...lats)) * 1.4),
    longitudeDelta: Math.max(0.05, (Math.max(...lngs) - Math.min(...lngs)) * 1.4)
  };
  return (
    <MapView style={styles.fleetMap} region={region}>
      {located.map((partner) => (
        <Marker
          key={partner.vehicle_id}
          coordinate={{ latitude: partner.latitude, longitude: partner.longitude }}
          title={`${partner.cab_ref} · ${partner.plate_no}`}
          description={`${partner.driver_name} · ${partner.current_booking_ref ? `On ${partner.current_booking_ref}` : 'Free'}`}
          pinColor={partner.current_booking_ref ? 'orange' : 'green'}
        />
      ))}
    </MapView>
  );
}

function ActionButton({ label, onPress, primary = false, disabled = false }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.actionButton, primary && styles.actionButtonPrimary, disabled && styles.actionButtonDisabled]}>
      <Text style={[styles.actionText, primary && styles.actionTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

const palette = {
  bg: '#0E0D0B',
  surface: '#171613',
  elevated: '#211F1B',
  border: '#38342F',
  text: '#FAF8F5',
  muted: '#A7A39B',
  primary: '#F6CE00',
  primaryText: '#0E0D0B',
  error: '#F08080'
};

const styles = StyleSheet.create({
  section: { marginTop: 20, marginHorizontal: 16, marginBottom: 24, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface },
  title: { color: palette.text, fontSize: 20, fontWeight: '900' },
  subtitle: { color: palette.muted, fontSize: 12, marginTop: 4, marginBottom: 12 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modeButton: { flex: 1, minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: palette.border, alignItems: 'center', justifyContent: 'center' },
  modeButtonActive: { borderColor: palette.primary, backgroundColor: 'rgba(246,206,0,0.12)' },
  modeText: { color: palette.muted, fontSize: 13, fontWeight: '800' },
  modeTextActive: { color: palette.primary },
  disclosure: { color: palette.muted, fontSize: 11, lineHeight: 16, marginBottom: 10 },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  inlineInput: { minWidth: 0, flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.elevated, color: palette.text, paddingHorizontal: 11, fontSize: 12 },
  formInput: { minHeight: 42, borderRadius: 11, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.elevated, color: palette.text, paddingHorizontal: 10, marginTop: 8, fontSize: 12 },
  actionButton: { minHeight: 40, borderRadius: 11, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  actionButtonPrimary: { borderColor: palette.primary, backgroundColor: palette.primary },
  actionButtonDisabled: { opacity: 0.45 },
  actionText: { color: palette.text, fontSize: 11, fontWeight: '800', textAlign: 'center' },
  actionTextPrimary: { color: palette.primaryText },
  listItem: { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: palette.border },
  itemTitle: { color: palette.text, fontSize: 12, fontWeight: '900' },
  itemText: { color: palette.text, fontSize: 11, lineHeight: 17, marginTop: 4 },
  itemMeta: { color: palette.muted, fontSize: 10, lineHeight: 16, marginTop: 4 },
  verifyRow: { paddingVertical: 8 },
  vehicleChoices: { marginVertical: 8 },
  vehicleChoice: { maxWidth: 220, minHeight: 40, marginRight: 8, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: palette.border },
  vehicleChoiceActive: { borderColor: palette.primary, backgroundColor: 'rgba(246,206,0,0.12)' },
  vehicleChoiceText: { color: palette.text, fontSize: 10, fontWeight: '700' },
  fleetMap: { height: 220, marginTop: 8, marginBottom: 4, borderRadius: 12 },
  groupTitle: { color: palette.text, fontSize: 13, fontWeight: '900', marginTop: 14 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  badge: { fontSize: 9, fontWeight: '900', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  badgeOnline: { color: '#0E0D0B', backgroundColor: '#4CC157' },
  badgeOffline: { color: palette.text, backgroundColor: palette.border },
  badgeBusy: { color: '#0E0D0B', backgroundColor: '#F5A623' },
  badgeFree: { color: '#0E0D0B', backgroundColor: palette.primary },
  offerCard: { borderWidth: 1, borderColor: palette.primary, borderRadius: 12, paddingHorizontal: 10, marginTop: 8, backgroundColor: 'rgba(246,206,0,0.08)' },
  offerLabel: { color: palette.primary, fontSize: 13, fontWeight: '900', marginBottom: 2 },
  offerActions: { marginTop: 8 },
  flex: { flex: 1 },
  driverHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  onlineToggle: { borderRadius: 14, paddingVertical: 16, paddingHorizontal: 14, alignItems: 'center', marginBottom: 10, borderWidth: 1 },
  onlineToggleOn: { backgroundColor: '#4CC157', borderColor: '#4CC157' },
  onlineToggleOff: { backgroundColor: palette.elevated, borderColor: palette.border },
  onlineToggleTitle: { color: palette.text, fontSize: 15, fontWeight: '900' },
  onlineToggleTitleOn: { color: '#0E0D0B' },
  onlineToggleSub: { color: palette.muted, fontSize: 11, marginTop: 4 },
  onlineToggleSubOn: { color: '#0E0D0B' },
  dispatchStatus: { color: palette.primary, fontSize: 11, fontWeight: '700', marginTop: 6 },
  message: { color: palette.primary, fontSize: 11, lineHeight: 16, marginTop: 8 }
});

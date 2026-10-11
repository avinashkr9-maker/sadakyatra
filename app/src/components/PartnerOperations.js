import React, { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Location from 'expo-location';
import MapView, { Marker } from 'react-native-maps';
import { apiRequest } from '../api/client';
import { alertNewOffer, getDriverPushToken } from '../notifications';

const CATEGORY_LABELS = { sedan: 'Sedan', suv: 'SUV', traveller: 'Tempo Traveller' };
const PERMISSION_LABELS = { bookings: 'Bookings', partners: 'Partners & fleet', pricing: 'Pricing' };

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

// Before logging out on this phone: stop offers ringing it and take the driver offline.
export async function signOutDriver() {
  await apiRequest('/driver/push-token', 'POST', { token: null }).catch(() => {});
  await apiRequest('/driver/presence', 'PATCH', { online: false }).catch(() => {});
}

export function DriverDashboard() {
  const [driver, setDriver] = useState(null);
  const [online, setOnline] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const locationSubscription = useRef(null);
  const seenOffers = useRef(new Set());
  // True once the backend can ring this phone with a real push; then skip the in-app alert.
  const hasRemotePush = useRef(false);

  useEffect(() => {
    load();
    return () => locationSubscription.current?.remove();
  }, []);

  // New offers arrive without the driver having to tap refresh.
  useEffect(() => {
    if (!driver) return undefined;
    const interval = setInterval(() => refresh().catch(() => {}), 10000);
    return () => clearInterval(interval);
  }, [driver]);

  async function load() {
    setBusy(true);
    try {
      const me = await apiRequest('/driver/me');
      setDriver(me.driver);
      registerPush().catch(() => {});
      await refresh();
      if (me.driver.online) {
        await startLocationSharing().catch(() => {});
        setOnline(true);
      }
    } catch (error) {
      setMessage(error.message || 'Could not open your driver account.');
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    const result = await apiRequest('/driver/bookings');
    const latest = result.bookings || [];
    for (const booking of latest) {
      if (booking.driver_status !== 'OFFERED' || seenOffers.current.has(booking.id)) continue;
      seenOffers.current.add(booking.id);
      if (!hasRemotePush.current) alertNewOffer(booking);
    }
    setBookings(latest);
  }

  async function registerPush() {
    const pushToken = await getDriverPushToken();
    if (!pushToken) return;
    await apiRequest('/driver/push-token', 'POST', { token: pushToken });
    hasRemotePush.current = true;
  }

  async function startLocationSharing() {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== 'granted') throw new Error('Location permission is needed to go online.');
    locationSubscription.current?.remove();
    const send = ({ coords }) => apiRequest('/driver/location', 'POST', {
      latitude: coords.latitude,
      longitude: coords.longitude
    }).catch(() => {});
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).then(send).catch(() => {});
    locationSubscription.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.Balanced, timeInterval: 8000, distanceInterval: 15 },
      send
    );
  }

  async function toggleOnline() {
    setBusy(true);
    setMessage('');
    try {
      if (online) {
        locationSubscription.current?.remove();
        locationSubscription.current = null;
        await apiRequest('/driver/presence', 'PATCH', { online: false });
        setOnline(false);
        return;
      }
      await startLocationSharing();
      await apiRequest('/driver/presence', 'PATCH', { online: true });
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
      await apiRequest(`/driver/bookings/${bookingId}/response`, 'PATCH', { decision });
      setMessage(decision === 'ACCEPT' ? 'Booking accepted. Tap "Going to pickup" when you leave.' : 'Booking declined.');
      await refresh();
    } catch (error) {
      setMessage(error.message || 'Could not respond to booking.');
      await refresh().catch(() => {});
    }
  }

  async function advance(bookingId, status) {
    try {
      await apiRequest(`/driver/bookings/${bookingId}/status`, 'PATCH', { status });
      await refresh();
    } catch (error) {
      setMessage(error.message || 'Could not update trip status.');
    }
  }

  if (!driver) {
    return (
      <View style={styles.section}>
        <Text style={styles.title}>Cab Partner</Text>
        <Text style={styles.itemMeta}>{busy ? 'Opening your driver account…' : message}</Text>
        {!busy ? <ActionButton label="Try again" onPress={load} primary /> : null}
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <View style={styles.driverHeader}>
        <View style={styles.flex}>
          <Text style={styles.title}>{driver.name || 'Driver'}</Text>
          <Text style={styles.itemMeta}>{driver.cab ? `${driver.cab.cab_ref} · ${driver.cab.plate_no} · ${CATEGORY_LABELS[driver.cab.category] || driver.cab.category}` : ''}</Text>
        </View>
      </View>
      <Pressable onPress={toggleOnline} disabled={busy} style={[styles.onlineToggle, online ? styles.onlineToggleOn : styles.onlineToggleOff]}>
        <Text style={[styles.onlineToggleTitle, online && styles.onlineToggleTitleOn]}>{online ? 'ONLINE — Ready for bookings' : 'OFFLINE — Not available'}</Text>
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
                  <ActionButton label="Decline" onPress={() => respond(booking.id, 'REJECT')} />
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

// A vehicle owner's cabs and drivers.
export function OwnerFleet() {
  const [fleet, setFleet] = useState(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const load = () => apiRequest('/partner/fleet')
      .then((result) => setFleet(result.fleet || []))
      .catch((error) => setMessage(error.message || 'Could not load your cabs.'));
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={styles.section}>
      <Text style={styles.title}>My cabs</Text>
      <Text style={styles.subtitle}>Your vehicles and drivers on SadakYatra.</Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {fleet && !fleet.length ? <Text style={styles.itemMeta}>No approved cabs yet.</Text> : null}
      {(fleet || []).map((cab) => (
        <View key={cab.vehicle_id} style={styles.listItem}>
          <Text style={styles.itemTitle}>{cab.cab_ref} · {cab.plate_no}</Text>
          <View style={styles.badgeRow}>
            <Text style={[styles.badge, cab.is_online ? styles.badgeOnline : styles.badgeOffline]}>{cab.is_online ? 'ONLINE' : 'OFFLINE'}</Text>
            <Text style={[styles.badge, cab.current_booking_ref ? styles.badgeBusy : styles.badgeFree]}>{cab.current_booking_ref ? 'ON TRIP' : 'FREE'}</Text>
            {!cab.partner_active || !cab.vehicle_active ? <Text style={[styles.badge, styles.badgeOffline]}>PAUSED BY SADAKYATRA</Text> : null}
          </View>
          <Text style={styles.itemMeta}>{CATEGORY_LABELS[cab.category] || cab.category} {cab.model || ''} · Driver {cab.driver_name} ({cab.driver_phone})</Text>
          {cab.current_booking_ref ? <Text style={styles.itemMeta}>{cab.current_booking_ref} · {(cab.current_driver_status || '').replaceAll('_', ' ')}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export function AdminDashboard({ account }) {
  const canPartners = account.permissions.includes('partners');
  const canBookings = account.permissions.includes('bookings');
  const canAdmins = account.permissions.includes('admins');
  const [applications, setApplications] = useState([]);
  const [partners, setPartners] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [docs, setDocs] = useState({});
  const [verifiedPhones, setVerifiedPhones] = useState({});
  const [gpsDevices, setGpsDevices] = useState({});
  const [message, setMessage] = useState('');

  // Keep the dashboard current while it is open.
  useEffect(() => {
    load();
    const interval = setInterval(() => load(true), 15000);
    return () => clearInterval(interval);
  }, []);

  async function load(quiet = false) {
    if (!quiet) setMessage('');
    // Load each section independently so one failure doesn't hide the rest.
    const sections = [
      canPartners ? apiRequest('/admin/partners/applications') : null,
      canPartners || canBookings ? apiRequest('/admin/partners').catch((error) => (canPartners ? Promise.reject(error) : { partners: [] })) : null,
      canBookings ? apiRequest('/admin/bookings') : null,
      canAdmins ? apiRequest('/admin/admins') : null
    ];
    const [applicationResult, partnerResult, bookingResult, adminResult] = await Promise.allSettled(sections);
    if (applicationResult.value) setApplications(applicationResult.value.applications || []);
    if (partnerResult.value) setPartners(partnerResult.value.partners || []);
    if (bookingResult.value) setBookings(bookingResult.value.bookings || []);
    if (adminResult.value) setAdmins(adminResult.value.admins || []);
    const errors = [applicationResult, partnerResult, bookingResult, adminResult]
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
      const result = await apiRequest(`/admin/partners/applications/${application.id}/approve`, 'POST', {
        phoneVerified: verifiedPhones[application.id] === true,
        rcDocumentKey: docs[application.id]?.rc,
        dlDocumentKey: docs[application.id]?.dl,
        insuranceDocumentKey: docs[application.id]?.insurance
      });
      setMessage(`${application.application_ref}: ${result.message}`);
      await load(true);
    } catch (error) {
      setMessage(error.message || 'Could not approve application.');
    }
  }

  async function reject(applicationId) {
    try {
      await apiRequest(`/admin/partners/applications/${applicationId}`, 'PATCH', { status: 'REJECTED' });
      await load();
    } catch (error) {
      setMessage(error.message || 'Could not reject application.');
    }
  }

  async function assign(bookingId, vehicleId) {
    try {
      await apiRequest(`/admin/bookings/${bookingId}/assign`, 'POST', { vehicleId });
      setMessage('Booking sent to the driver.');
      await load(true);
    } catch (error) {
      setMessage(error.message || 'Could not offer booking.');
    }
  }

  async function setPartnerActive(partnerId, active) {
    try {
      await apiRequest(`/admin/partners/${partnerId}`, 'PATCH', { active });
      await load();
    } catch (error) {
      setMessage(error.message || 'Could not update partner status.');
    }
  }

  async function saveGpsDevice(vehicleId) {
    try {
      const gpsDeviceId = (gpsDevices[vehicleId] || '').trim() || null;
      await apiRequest(`/admin/vehicles/${vehicleId}`, 'PATCH', { gpsDeviceId });
      setMessage(gpsDeviceId ? 'GPS tracker linked to this cab.' : 'GPS tracker removed from this cab.');
      await load();
    } catch (error) {
      setMessage(error.message || 'Could not save the GPS device.');
    }
  }

  async function setVehicleActive(vehicleId, active) {
    try {
      await apiRequest(`/admin/vehicles/${vehicleId}`, 'PATCH', { active });
      await load();
    } catch (error) {
      setMessage(error.message || 'Could not update cab status.');
    }
  }

  return (
    <View style={styles.section}>
      <View style={styles.inlineRow}>
        <View style={styles.flex}>
          <Text style={styles.title}>Admin</Text>
          <Text style={styles.itemMeta}>{account.roles.includes('owner') ? 'Owner · full access' : `Access: ${account.permissions.map((item) => PERMISSION_LABELS[item] || item).join(', ')}`}</Text>
        </View>
        <ActionButton label="Refresh" onPress={() => load()} />
      </View>
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {canPartners ? <Text style={styles.groupTitle}>Partner registrations · {applications.length}</Text> : null}
      {canPartners && !applications.length ? <Text style={styles.itemMeta}>No new registrations.</Text> : null}
      {applications.map((application) => (
        <View key={application.id} style={styles.listItem}>
          <Text style={styles.itemTitle}>{application.application_ref} · {application.full_name}</Text>
          <Text style={styles.itemText}>{application.partner_type === 'vehicle_owner' ? 'Vehicle owner' : 'Driver'} · +91 {application.phone}{application.phone_verified ? ' ✓ OTP verified' : ''}</Text>
          <Text style={styles.itemText}>{application.vehicle_number} · {CATEGORY_LABELS[application.vehicle_category] || application.vehicle_category} {application.vehicle_model}{application.seats ? ` · ${application.seats} seats` : ''}</Text>
          <Text style={styles.itemMeta}>{application.city}: {application.operating_area} · Driver {application.driver_name} (+91 {application.driver_phone})</Text>
          {[
            ['rc', 'RC document path (optional)'],
            ['dl', 'DL document path (optional)'],
            ['insurance', 'Insurance document path (optional)']
          ].map(([field, label]) => (
            <TextInput key={field} value={docs[application.id]?.[field] || ''} onChangeText={(value) => updateDoc(application.id, field, value)} placeholder={label} placeholderTextColor={palette.muted} autoCapitalize="none" style={styles.formInput} />
          ))}
          {!application.phone_verified ? (
            <Pressable onPress={() => setVerifiedPhones((current) => ({ ...current, [application.id]: !current[application.id] }))} style={styles.verifyRow}>
              <Text style={styles.itemText}>{verifiedPhones[application.id] ? '☑' : '□'} Phone verified by admin</Text>
            </Pressable>
          ) : null}
          <View style={[styles.inlineRow, styles.offerActions]}>
            <ActionButton label="Approve" onPress={() => approve(application)} primary />
            <ActionButton label="Reject" onPress={() => reject(application.id)} />
          </View>
        </View>
      ))}

      {canBookings ? (
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

      {canPartners && partners.length ? (
        <>
          <Text style={styles.groupTitle}>Fleet · {partners.filter((p) => p.is_online).length} online · {partners.filter((p) => p.current_booking_ref).length} on booking</Text>
          <FleetMap partners={partners} />
        </>
      ) : null}
      {canPartners ? partners.map((partner) => {
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
            <Text style={styles.itemMeta}>{partner.latitude == null ? 'No live location' : `Location ${partner.latitude.toFixed(4)}, ${partner.longitude?.toFixed(4)} · updated ${formatPickupTime(partner.location_updated_at)}`}</Text>
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
      }) : null}

      {canBookings ? <Text style={styles.groupTitle}>Recent bookings</Text> : null}
      {bookings.filter((booking) => booking.status !== 'PENDING').slice(0, 15).map((booking) => (
        <View key={booking.id} style={styles.listItem}>
          <Text style={styles.itemTitle}>{booking.booking_ref} · {booking.pickup_text} → {booking.drop_text}</Text>
          <Text style={styles.itemMeta}>{booking.status} · {(booking.driver_status || 'Not assigned').replaceAll('_', ' ')}</Text>
        </View>
      ))}

      {canAdmins ? <AdminAccounts admins={admins} onChanged={() => load(true)} onMessage={setMessage} /> : null}
    </View>
  );
}

// Owner only: give staff access to chosen sections by mobile number.
function AdminAccounts({ admins, onChanged, onMessage }) {
  const [phone, setPhone] = useState('');
  const [fullName, setFullName] = useState('');
  const [permissions, setPermissions] = useState(['bookings']);

  function togglePermission(permission) {
    setPermissions((current) => (current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]));
  }

  async function addAdmin() {
    try {
      await apiRequest('/admin/admins', 'POST', { phone, fullName, permissions });
      onMessage(`Admin added. They can now log in with +91 ${phone.replace(/\D/g, '').slice(-10)}.`);
      setPhone('');
      setFullName('');
      onChanged();
    } catch (error) {
      onMessage(error.message || 'Could not add admin.');
    }
  }

  function removeAdmin(admin) {
    Alert.alert('Remove admin?', `${admin.full_name || ''} +91 ${admin.phone} will lose admin access.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => apiRequest(`/admin/admins/${admin.id}`, 'DELETE').then(onChanged).catch((error) => onMessage(error.message))
      }
    ]);
  }

  return (
    <>
      <Text style={styles.groupTitle}>Admin accounts · {admins.length}</Text>
      {admins.map((admin) => (
        <View key={admin.id} style={styles.listItem}>
          <Text style={styles.itemTitle}>{admin.full_name || 'Admin'} · +91 {admin.phone}</Text>
          <Text style={styles.itemMeta}>{admin.permissions.map((item) => PERMISSION_LABELS[item] || item).join(', ')}</Text>
          <View style={styles.offerActions}><ActionButton label="Remove" onPress={() => removeAdmin(admin)} /></View>
        </View>
      ))}
      <View style={styles.listItem}>
        <Text style={styles.itemTitle}>Add an admin</Text>
        <TextInput value={fullName} onChangeText={setFullName} placeholder="Name" placeholderTextColor={palette.muted} style={styles.formInput} />
        <TextInput value={phone} onChangeText={setPhone} placeholder="Mobile number" keyboardType="phone-pad" placeholderTextColor={palette.muted} style={styles.formInput} />
        <View style={[styles.badgeRow, styles.offerActions]}>
          {Object.entries(PERMISSION_LABELS).map(([permission, label]) => (
            <Pressable key={permission} onPress={() => togglePermission(permission)} style={[styles.vehicleChoice, permissions.includes(permission) && styles.vehicleChoiceActive]}>
              <Text style={styles.vehicleChoiceText}>{permissions.includes(permission) ? '☑' : '□'} {label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.offerActions}><ActionButton label="Add admin" onPress={addAdmin} primary /></View>
      </View>
    </>
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

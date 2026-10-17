import React, { useEffect, useState } from 'react';
import { Alert, Image, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { Pressable, largerText } from '../ui';
import { apiRequest } from '../api/client';
import { pickPhoto } from '../pickPhoto';

// Route ends the owner can pick for fixed prices (same pins the customer app uses).
const PLACES = {
  Muzaffarpur: { lat: 26.1209, lng: 85.391 },
  Patna: { lat: 25.6036, lng: 85.1369 },
  'Patna Airport': { lat: 25.5913, lng: 85.088 },
  Darbhanga: { lat: 26.1542, lng: 85.8918 },
  'Darbhanga Airport': { lat: 26.1928, lng: 85.9174 },
  Sitamarhi: { lat: 26.5952, lng: 85.4808 },
  Motihari: { lat: 26.647, lng: 84.9089 },
  Samastipur: { lat: 25.856, lng: 85.7868 },
  Raxaul: { lat: 26.979, lng: 84.851 },
  Hajipur: { lat: 25.6858, lng: 85.2146 },
  Vaishali: { lat: 25.9903, lng: 85.1287 },
  Gaya: { lat: 24.7955, lng: 85.0002 }
};

const CATEGORY_FIELDS = [
  ['per_km', 'One-way ₹ per km'],
  ['min_fare', 'Minimum fare ₹'],
  ['rt_per_km', 'Round-trip ₹ per km'],
  ['rt_min_km_per_day', 'Round-trip minimum km / day'],
  ['driver_allowance', 'Driver allowance ₹ / day'],
  ['local_fare', 'Local ride fare ₹'],
  ['base_fare', 'Booking fee ₹ (optional)']
];
const SETTING_FIELDS = [
  ['toll_per_km', 'Toll & parking ₹ per km'],
  ['gst_percent', 'GST %'],
  ['commission_percent', 'SadakYatra commission %'],
  ['round_trip_multiplier', 'Round trip = one-way × (0 = use per-km rates)']
];

const asText = (value) => (value == null ? '' : String(value));
// Text boxes hold strings; send numbers back.
const toNumbers = (draft, fields) => Object.fromEntries(fields.map(([field]) => [field, draft[field] === '' ? undefined : Number(draft[field])]));

function NumberField({ label, value, onChange }) {
  return (
    <View style={styles.numberField}>
      <Text style={styles.numberLabel}>{label}</Text>
      <TextInput value={value} onChangeText={(text) => onChange(text.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" style={styles.input} placeholderTextColor={palette.muted} />
    </View>
  );
}

function Button({ label, onPress, primary = false }) {
  return (
    <Pressable onPress={onPress} style={[styles.button, primary && styles.buttonPrimary]}>
      <Text style={[styles.buttonText, primary && styles.buttonTextPrimary]}>{label}</Text>
    </Pressable>
  );
}

function Chips({ options, value, onChange }) {
  return (
    <View style={styles.chips}>
      {options.map(([key, label]) => (
        <Pressable key={key} onPress={() => onChange(key)} style={[styles.chip, value === key && styles.chipActive]}>
          <Text style={[styles.chipText, value === key && styles.chipTextActive]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function CategoryEditor({ category, onSaved, onMessage }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => Object.fromEntries([...CATEGORY_FIELDS.map(([field]) => [field, asText(category[field])]), ['name', category.name], ['seats_label', category.seats_label], ['models', category.models]]));
  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }));

  async function save(extra = {}) {
    try {
      await apiRequest(`/admin/pricing/categories/${category.key}`, 'PUT', {
        ...toNumbers(draft, CATEGORY_FIELDS), name: draft.name, seats_label: draft.seats_label, models: draft.models, ...extra
      });
      onMessage(`${draft.name} saved. New bookings use these prices.`);
      onSaved();
    } catch (error) {
      onMessage(error.message);
    }
  }

  return (
    <View style={[styles.card, !category.active && styles.cardMuted]}>
      <Pressable onPress={() => setOpen(!open)} style={styles.cardHeader}>
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{category.name}{category.active ? '' : ' · hidden'}</Text>
          <Text style={styles.meta}>₹{category.per_km}/km one-way · ₹{category.rt_per_km}/km round trip · min ₹{category.min_fare}</Text>
        </View>
        <Text style={styles.toggleText}>{open ? 'Close' : 'Edit'}</Text>
      </Pressable>
      {open ? (
        <>
          <View style={styles.textRow}>
            <TextInput value={draft.name} onChangeText={(value) => update('name', value)} placeholder="Name" style={[styles.input, styles.flex]} placeholderTextColor={palette.muted} />
            <TextInput value={draft.seats_label} onChangeText={(value) => update('seats_label', value)} placeholder="e.g. 4 seats" style={[styles.input, styles.flex]} placeholderTextColor={palette.muted} />
          </View>
          <TextInput value={draft.models} onChangeText={(value) => update('models', value)} placeholder="Example models" style={styles.input} placeholderTextColor={palette.muted} />
          <View style={styles.grid}>
            {CATEGORY_FIELDS.map(([field, label]) => <NumberField key={field} label={label} value={draft[field]} onChange={(value) => update(field, value)} />)}
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.meta}>Show to customers</Text>
            <Switch value={category.active} onValueChange={(active) => save({ active })} trackColor={{ true: palette.primary }} />
          </View>
          <Button label={`Save ${draft.name}`} onPress={() => save()} primary />
        </>
      ) : null}
    </View>
  );
}

function NewCategory({ onSaved, onMessage }) {
  const [name, setName] = useState('');
  const [seats, setSeats] = useState('');
  const [perKm, setPerKm] = useState('');
  async function add() {
    try {
      await apiRequest('/admin/pricing/categories', 'POST', { name, seats_label: seats, per_km: Number(perKm) });
      onMessage(`${name} added. Open it to set the other prices.`);
      setName('');
      setSeats('');
      setPerKm('');
      onSaved();
    } catch (error) {
      onMessage(error.message);
    }
  }
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Add a vehicle type</Text>
      <View style={styles.textRow}>
        <TextInput value={name} onChangeText={setName} placeholder="Name, e.g. Luxury Sedan" style={[styles.input, styles.flex]} placeholderTextColor={palette.muted} />
        <TextInput value={seats} onChangeText={setSeats} placeholder="Seats, e.g. 4 seats" style={[styles.input, styles.flex]} placeholderTextColor={palette.muted} />
      </View>
      <NumberField label="One-way ₹ per km" value={perKm} onChange={setPerKm} />
      <Button label="Add vehicle type" onPress={add} primary />
    </View>
  );
}

function FixedRoutes({ routes, categories, onSaved, onMessage }) {
  const [form, setForm] = useState({ from: 'Muzaffarpur', to: 'Patna', category: 'sedan', oneWay: '', roundTrip: '', radius: '10' });
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const placeOptions = Object.keys(PLACES).map((name) => [name, name]);
  const categoryName = (key) => categories.find((category) => category.key === key)?.name || key;

  async function add() {
    if (form.from === form.to) return onMessage('Choose two different places.');
    try {
      await apiRequest('/admin/pricing/routes', 'POST', {
        origin_name: form.from, origin_lat: PLACES[form.from].lat, origin_lng: PLACES[form.from].lng,
        dest_name: form.to, dest_lat: PLACES[form.to].lat, dest_lng: PLACES[form.to].lng,
        radius_km: Number(form.radius), category: form.category,
        one_way_fare: Number(form.oneWay), round_trip_fare: form.roundTrip ? Number(form.roundTrip) : undefined
      });
      onMessage(`Fixed price added: ${form.from} – ${form.to}, ${categoryName(form.category)}.`);
      setForm((current) => ({ ...current, oneWay: '', roundTrip: '' }));
      onSaved();
    } catch (error) {
      onMessage(error.message);
    }
  }

  function remove(route) {
    Alert.alert('Delete fixed price?', `${route.origin_name} – ${route.dest_name} · ${categoryName(route.category)}`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => apiRequest(`/admin/pricing/routes/${route.id}`, 'DELETE').then(onSaved).catch((error) => onMessage(error.message)) }
    ]);
  }

  return (
    <>
      {routes.map((route) => (
        <View key={route.id} style={[styles.card, !route.active && styles.cardMuted]}>
          <Text style={styles.cardTitle}>{route.origin_name} ⇄ {route.dest_name} · {categoryName(route.category)}</Text>
          <Text style={styles.meta}>One-way ₹{route.one_way_fare}{route.round_trip_fare ? ` · Round trip ₹${route.round_trip_fare}` : ''} · within {route.radius_km} km of each end</Text>
          <View style={styles.switchRow}>
            <Text style={styles.meta}>{route.active ? 'In use' : 'Paused'}</Text>
            <Switch value={route.active} onValueChange={(active) => apiRequest(`/admin/pricing/routes/${route.id}`, 'PUT', { active }).then(onSaved).catch((error) => onMessage(error.message))} trackColor={{ true: palette.primary }} />
            <Button label="Delete" onPress={() => remove(route)} />
          </View>
        </View>
      ))}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Add a fixed price</Text>
        <Text style={styles.meta}>Customers whose pickup and drop are near these two places (either direction) pay exactly this, all-inclusive.</Text>
        <Text style={styles.numberLabel}>From</Text>
        <Chips options={placeOptions} value={form.from} onChange={(value) => update('from', value)} />
        <Text style={styles.numberLabel}>To</Text>
        <Chips options={placeOptions} value={form.to} onChange={(value) => update('to', value)} />
        <Text style={styles.numberLabel}>Vehicle</Text>
        <Chips options={categories.filter((category) => category.active).map((category) => [category.key, category.name])} value={form.category} onChange={(value) => update('category', value)} />
        <View style={styles.grid}>
          <NumberField label="One-way price ₹" value={form.oneWay} onChange={(value) => update('oneWay', value)} />
          <NumberField label="Round-trip price ₹ (optional)" value={form.roundTrip} onChange={(value) => update('roundTrip', value)} />
          <NumberField label="Match within km" value={form.radius} onChange={(value) => update('radius', value)} />
        </View>
        <Button label="Add fixed price" onPress={add} primary />
      </View>
    </>
  );
}

const WEDDING_FIELDS = [
  ['price', 'Price per car ₹ (all-inclusive)'],
  ['included_km', 'Included km'],
  ['included_hours', 'Included hours'],
  ['extra_km_rate', 'Extra ₹ per km'],
  ['extra_hour_rate', 'Extra ₹ per hour']
];

function WeddingCarEditor({ car, categories, onSaved, onMessage }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => ({
    ...Object.fromEntries(WEDDING_FIELDS.map(([field]) => [field, asText(car[field])])),
    name: car.name, category: car.category, fuel_policy: car.fuel_policy, decoration_options: car.decoration_options
  }));
  const update = (field, value) => setDraft((current) => ({ ...current, [field]: value }));
  const activeTypes = categories.filter((category) => category.active).map((category) => [category.key, category.name]);

  async function save(extra = {}) {
    try {
      await apiRequest(`/admin/wedding/vehicles/${car.id}`, 'PUT', {
        ...toNumbers(draft, WEDDING_FIELDS), name: draft.name, category: draft.category,
        fuel_policy: draft.fuel_policy, decoration_options: draft.decoration_options, ...extra
      });
      onMessage(`${draft.name} saved.`);
      onSaved();
    } catch (error) {
      onMessage(error.message);
    }
  }

  async function changePhoto() {
    const file = await pickPhoto(`Photo of ${car.name}`);
    if (!file) return;
    try {
      onMessage('Uploading photo…');
      await apiRequest(`/admin/wedding/vehicles/${car.id}/image`, 'POST', { data: file.data, contentType: file.contentType });
      onMessage(`Photo updated for ${car.name}.`);
      onSaved();
    } catch (error) {
      onMessage(error.message || 'Could not upload the photo.');
    }
  }

  return (
    <View style={[styles.card, !car.active && styles.cardMuted]}>
      <Pressable onPress={() => setOpen(!open)} style={styles.cardHeader}>
        {car.image_url ? <Image source={{ uri: car.image_url }} style={styles.carThumb} /> : <View style={styles.carThumb} />}
        <View style={styles.flex}>
          <Text style={styles.cardTitle}>{car.name}{car.active ? '' : ' · hidden'}</Text>
          <Text style={styles.meta}>₹{car.price} · {car.included_km} km / {car.included_hours} hrs</Text>
        </View>
        <Text style={styles.toggleText}>{open ? 'Close' : 'Edit'}</Text>
      </Pressable>
      {open ? (
        <>
          <Button label={car.image_url ? 'Change photo' : 'Add photo'} onPress={changePhoto} />
          <TextInput value={draft.name} onChangeText={(value) => update('name', value)} placeholder="Car name" style={styles.input} placeholderTextColor={palette.muted} />
          <Text style={styles.numberLabel}>Drivers with this vehicle type can take it</Text>
          <Chips options={activeTypes} value={draft.category} onChange={(value) => update('category', value)} />
          <View style={styles.grid}>
            {WEDDING_FIELDS.map(([field, label]) => <NumberField key={field} label={label} value={draft[field]} onChange={(value) => update(field, value)} />)}
          </View>
          <Text style={styles.numberLabel}>Fuel policy</Text>
          <TextInput value={draft.fuel_policy} onChangeText={(value) => update('fuel_policy', value)} style={styles.input} placeholderTextColor={palette.muted} />
          <View style={styles.switchRow}>
            <Text style={styles.meta}>Show to customers</Text>
            <Switch value={car.active} onValueChange={(active) => save({ active })} trackColor={{ true: palette.primary }} />
          </View>
          <Button label={`Save ${draft.name}`} onPress={() => save()} primary />
        </>
      ) : null}
    </View>
  );
}

function WeddingCars({ categories, onMessage }) {
  const [cars, setCars] = useState(null);
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState({ name: '', category: 'sedan', price: '' });
  const activeTypes = categories.filter((category) => category.active).map((category) => [category.key, category.name]);

  async function load() {
    try {
      setCars((await apiRequest('/admin/wedding/vehicles')).vehicles);
      setVersion((value) => value + 1);
    } catch (error) {
      onMessage(error.message);
    }
  }
  useEffect(() => { load(); }, []);

  async function add() {
    try {
      await apiRequest('/admin/wedding/vehicles', 'POST', { name: form.name, category: form.category, price: Number(form.price) });
      onMessage(`${form.name} added. Open it to add a photo and package details.`);
      setForm((current) => ({ ...current, name: '', price: '' }));
      load();
    } catch (error) {
      onMessage(error.message);
    }
  }

  if (!cars) return <Text style={styles.meta}>Loading wedding cars…</Text>;
  return (
    <>
      {cars.map((car) => <WeddingCarEditor key={`${car.id}-${version}`} car={car} categories={categories} onSaved={load} onMessage={onMessage} />)}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Add a wedding car</Text>
        <TextInput value={form.name} onChangeText={(value) => setForm((current) => ({ ...current, name: value }))} placeholder="e.g. Toyota Fortuner" style={styles.input} placeholderTextColor={palette.muted} />
        <Chips options={activeTypes} value={form.category} onChange={(value) => setForm((current) => ({ ...current, category: value }))} />
        <NumberField label="Price per car ₹" value={form.price} onChange={(value) => setForm((current) => ({ ...current, price: value }))} />
        <Button label="Add wedding car" onPress={add} primary />
      </View>
    </>
  );
}

export default function AdminPricing() {
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState({});
  const [message, setMessage] = useState('');
  const [version, setVersion] = useState(0);

  async function load() {
    try {
      const result = await apiRequest('/admin/pricing');
      setData(result);
      setSettings(Object.fromEntries(SETTING_FIELDS.map(([field]) => [field, asText(result.settings[field])])));
      setVersion((value) => value + 1);
    } catch (error) {
      setMessage(error.message || 'Could not load prices.');
    }
  }
  useEffect(() => { load(); }, []);

  async function saveSettings() {
    try {
      await apiRequest('/admin/pricing/settings', 'PUT', toNumbers(settings, SETTING_FIELDS));
      setMessage('Settings saved.');
      load();
    } catch (error) {
      setMessage(error.message);
    }
  }

  if (!data) return <Text style={styles.meta}>{message || 'Loading prices…'}</Text>;
  return (
    <View>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      <Text style={styles.heading}>Settings for every trip</Text>
      <View style={styles.card}>
        <View style={styles.grid}>
          {SETTING_FIELDS.map(([field, label]) => (
            <NumberField key={field} label={label} value={settings[field]} onChange={(value) => setSettings((current) => ({ ...current, [field]: value }))} />
          ))}
        </View>
        <Text style={styles.meta}>Driver earns: (fare − GST) − commission. Toll and parking are included in the customer price.</Text>
        <Button label="Save settings" onPress={saveSettings} primary />
      </View>

      <Text style={styles.heading}>Vehicle types & rates</Text>
      <Text style={styles.meta}>Round trips charge the round-trip rate on the km driven there and back, but at least the minimum km for each day away.</Text>
      {data.categories.map((category) => (
        <CategoryEditor key={`${category.key}-${version}`} category={category} onSaved={load} onMessage={setMessage} />
      ))}
      <NewCategory onSaved={load} onMessage={setMessage} />

      <Text style={styles.heading}>Fixed route prices</Text>
      <FixedRoutes routes={data.routes} categories={data.categories} onSaved={load} onMessage={setMessage} />

      <Text style={styles.heading}>Wedding & baraat cars</Text>
      <WeddingCars categories={data.categories} onMessage={setMessage} />
    </View>
  );
}

const palette = { surface: '#141414', elevated: '#1C1C1C', border: '#2E2E2E', text: '#FFFFFF', muted: '#9A9A9A', primary: '#FFCC00', primaryText: '#0A0A0A' };

const styles = StyleSheet.create(largerText({
  flex: { flex: 1 },
  heading: { color: palette.text, fontSize: 15, fontWeight: '900', marginTop: 18, marginBottom: 6 },
  card: { borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.elevated, padding: 12, marginTop: 10 },
  cardMuted: { opacity: 0.6 },
  carThumb: { width: 56, height: 40, borderRadius: 8, backgroundColor: '#2E2E2E', marginRight: 4 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { color: palette.text, fontSize: 14, fontWeight: '900' },
  toggleText: { color: palette.primary, fontSize: 13, fontWeight: '800' },
  meta: { color: palette.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  message: { color: palette.primary, fontSize: 12, fontWeight: '700', marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  numberField: { flexGrow: 1, minWidth: '45%' },
  numberLabel: { color: palette.muted, fontSize: 11, fontWeight: '700', marginTop: 8, marginBottom: 4 },
  input: { minHeight: 42, borderRadius: 10, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surface, color: palette.text, paddingHorizontal: 10, fontSize: 14, marginTop: 6 },
  textRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 },
  button: { minHeight: 42, borderRadius: 11, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  buttonPrimary: { backgroundColor: palette.primary, borderColor: palette.primary },
  buttonText: { color: palette.text, fontSize: 13, fontWeight: '800' },
  buttonTextPrimary: { color: palette.primaryText },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: palette.border },
  chipActive: { backgroundColor: palette.primary, borderColor: palette.primary },
  chipText: { color: palette.text, fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: palette.primaryText }
}));

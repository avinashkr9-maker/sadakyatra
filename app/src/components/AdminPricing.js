import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { apiRequest } from '../api/client';

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
  ['commission_percent', 'SadakYatra commission %']
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
    </View>
  );
}

const palette = { surface: '#171613', elevated: '#211F1B', border: '#38342F', text: '#FAF8F5', muted: '#A7A39B', primary: '#F6CE00', primaryText: '#0E0D0B' };

const styles = StyleSheet.create({
  flex: { flex: 1 },
  heading: { color: palette.text, fontSize: 15, fontWeight: '900', marginTop: 18, marginBottom: 6 },
  card: { borderRadius: 14, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.elevated, padding: 12, marginTop: 10 },
  cardMuted: { opacity: 0.6 },
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
});

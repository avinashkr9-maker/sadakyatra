import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { Pressable, largerText } from '../ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Car, ChevronLeft, ChevronRight, Clock, Phone, ShieldCheck, User, Users } from 'lucide-react-native';
import { changePassword, getMe, loginWithPassword, signup, submitPartnerApplication, updateMe, uploadPartnerDocument } from '../api/client';
import { pickPhoto } from '../pickPhoto';

const logo = require('../../assets/loveable/sadakyatra-logo.png');
const SUPPORT_PHONE = '9304057169';

export const brand = {
  black: '#0A0A0A',
  surface: '#1C1C1C',
  border: '#2E2E2E',
  yellow: '#FFCC00',
  white: '#FFFFFF',
  muted: '#9A9A9A',
  ink: '#111111',
  inkMuted: '#6B6B6B',
  line: '#E6E6E6',
  error: '#D93025'
};

const normalizePhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
};
const isValidPhone = (value) => /^[6-9]\d{9}$/.test(value);

// ---- Shared pieces -------------------------------------------------------
function Screen({ children, onBack }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.screen, { paddingTop: insets.top }]}>
      {onBack ? (
        <Pressable onPress={onBack} style={styles.back} accessibilityLabel="Back" hitSlop={12}>
          <ChevronLeft color={brand.white} size={24} />
        </Pressable>
      ) : null}
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Logo({ small = false }) {
  return (
    <View style={[styles.logoBox, small && styles.logoBoxSmall]}>
      <Image source={logo} style={small ? styles.logoSmall : styles.logo} resizeMode="contain" accessibilityLabel="SadakYatra" />
    </View>
  );
}

function Button({ label, onPress, busy = false, disabled = false, secondary = false }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      style={[styles.button, secondary && styles.buttonSecondary, (busy || disabled) && styles.buttonDisabled]}
    >
      {busy ? <ActivityIndicator color={secondary ? brand.white : brand.black} /> : (
        <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{label}</Text>
      )}
    </Pressable>
  );
}

function Field({ label, ...props }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput placeholderTextColor="#A0A0A0" style={styles.fieldInput} {...props} />
    </View>
  );
}

function ChoiceCard({ icon: Icon, title, subtitle, onPress, highlight = false }) {
  return (
    <Pressable onPress={onPress} style={[styles.choice, highlight && styles.choiceHighlight]}>
      <View style={[styles.choiceIcon, highlight && styles.choiceIconHighlight]}><Icon color={highlight ? brand.black : brand.yellow} size={22} /></View>
      <View style={styles.flex}>
        <Text style={styles.choiceTitle}>{title}</Text>
        <Text style={styles.choiceSubtitle}>{subtitle}</Text>
      </View>
      <ChevronRight color={brand.muted} size={20} />
    </Pressable>
  );
}

function ErrorText({ children }) {
  return children ? <Text style={styles.error}>{children}</Text> : null;
}

// ---- 1. Welcome ----------------------------------------------------------
export function WelcomeScreen({ onChoose }) {
  return (
    <Screen>
      <View style={styles.welcomeTop}>
        <Logo />
        <Text style={styles.tagline}>Safe journey · Reliable rides</Text>
        <Text style={styles.taglineSub}>Bihar's own cab service</Text>
      </View>
      <ChoiceCard icon={User} title="Book a Cab" subtitle="For customers" onPress={() => onChoose('customer')} highlight />
      <ChoiceCard icon={Car} title="Join as Cab Partner" subtitle="For drivers & vehicle owners" onPress={() => onChoose('partner')} />
      <Pressable onPress={() => onChoose('login')} style={styles.loginLink}>
        <Text style={styles.loginLinkText}>Already have an account? <Text style={styles.loginLinkStrong}>Log in</Text></Text>
      </Pressable>
    </Screen>
  );
}

// ---- 2. Mobile number + password -----------------------------------------
const INTENT_TITLES = {
  customer: 'Book a Cab',
  partner: 'Join as Cab Partner',
  login: 'Welcome back'
};

function PasswordField({ label, value, onChangeText, autoFocus = false }) {
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.passwordRow}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={autoFocus}
          placeholder="At least 6 characters"
          placeholderTextColor="#A0A0A0"
          style={styles.passwordInput}
        />
        <Pressable onPress={() => setVisible(!visible)} style={styles.showButton} hitSlop={8}>
          <Text style={styles.showText}>{visible ? 'Hide' : 'Show'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function PhoneField({ value, onChangeText, autoFocus = false }) {
  return (
    <>
      <Text style={styles.fieldLabel}>Mobile number</Text>
      <View style={styles.phoneRow}>
        <Text style={styles.phonePrefix}>+91</Text>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="10-digit mobile number"
          placeholderTextColor="#A0A0A0"
          keyboardType="phone-pad"
          maxLength={14}
          autoFocus={autoFocus}
          style={styles.phoneInput}
        />
      </View>
    </>
  );
}

// Log in, or create an account with your own password. "Book a Cab" and "Join as Cab Partner" start on Create account.
export function PasswordLoginScreen({ intent, onBack, onLoggedIn }) {
  const [mode, setMode] = useState(intent === 'login' ? 'login' : 'signup');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const signingUp = mode === 'signup';

  function switchMode() {
    setMode(signingUp ? 'login' : 'signup');
    setError('');
    setPassword('');
    setConfirm('');
  }

  async function submit() {
    const clean = normalizePhone(phone);
    if (!isValidPhone(clean)) return setError('Enter a valid 10-digit mobile number.');
    if (signingUp && fullName.trim().length < 2) return setError('Enter your full name.');
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    if (signingUp && password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    setError('');
    try {
      const result = signingUp ? await signup(clean, fullName.trim(), password) : await loginWithPassword(clean, password);
      onLoggedIn(result.token, result.account);
    } catch (err) {
      setError(err.offline ? 'No internet connection. Please try again.' : err.message);
      // "Already exists" on signup → offer login with the number kept.
      if (err.status === 409) setMode('login');
      setBusy(false);
    }
  }

  return (
    <Screen onBack={onBack}>
      <Logo small />
      <Text style={styles.title}>{signingUp ? 'Create your account' : INTENT_TITLES[intent] || INTENT_TITLES.login}</Text>
      <Text style={styles.subtitle}>{signingUp ? 'Use your mobile number and choose a password.' : 'Log in with your mobile number and password.'}</Text>
      <View style={styles.card}>
        {signingUp ? <Field label="Full name" value={fullName} onChangeText={setFullName} placeholder="e.g. Rohit Kumar" autoCapitalize="words" autoFocus /> : null}
        <PhoneField value={phone} onChangeText={(value) => { setPhone(value); setError(''); }} autoFocus={!signingUp} />
        <PasswordField label={signingUp ? 'Choose a password' : 'Password'} value={password} onChangeText={(value) => { setPassword(value); setError(''); }} />
        {signingUp ? <PasswordField label="Type the password again" value={confirm} onChangeText={(value) => { setConfirm(value); setError(''); }} /> : null}
        <ErrorText>{error}</ErrorText>
        <Button label={signingUp ? 'Create account' : 'Log in'} onPress={submit} busy={busy} />
        <Pressable onPress={switchMode} style={styles.resend}>
          <Text style={styles.resendText}>{signingUp ? 'Already have an account? Log in' : 'New here? Create an account'}</Text>
        </Pressable>
      </View>
      <Pressable onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)} style={styles.helpRow}>
        <Phone color={brand.muted} size={14} />
        <Text style={styles.helpText}>Forgot password? Call +91 {SUPPORT_PHONE}</Text>
      </Pressable>
    </Screen>
  );
}

// Popup to change your password (other phones are logged out).
export function ChangePasswordModal({ visible, onClose }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function save() {
    if (next.length < 6) return setMessage('New password must be at least 6 characters.');
    setBusy(true);
    setMessage('');
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setBusy(false);
      onClose();
      Alert.alert('Password changed', 'Use your new password next time you log in.');
    } catch (err) {
      setMessage(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
        <View style={styles.card}>
          <Text style={styles.modalTitle}>Change password</Text>
          <PasswordField label="Current password" value={current} onChangeText={setCurrent} autoFocus />
          <PasswordField label="New password" value={next} onChangeText={setNext} />
          <ErrorText>{message}</ErrorText>
          <Button label="Save new password" onPress={save} busy={busy} />
          <Pressable onPress={onClose} style={styles.resend}><Text style={styles.resendText}>Cancel</Text></Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---- 3. Profile ----------------------------------------------------------
export function ProfileScreen({ account, onSaved }) {
  const [fullName, setFullName] = useState(account.fullName || '');
  const [email, setEmail] = useState(account.email || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    setBusy(true);
    setError('');
    try {
      const result = await updateMe({ fullName, email });
      onSaved(result.account);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Logo small />
      <Text style={styles.title}>Your details</Text>
      <Text style={styles.subtitle}>+91 {account.phone} · verified</Text>
      <View style={styles.card}>
        <Field label="Full name" value={fullName} onChangeText={setFullName} placeholder="e.g. Rohit Kumar" autoCapitalize="words" autoFocus />
        <Field label="Email (optional)" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
        <ErrorText>{error}</ErrorText>
        <Button label="Continue" onPress={save} busy={busy} disabled={fullName.trim().length < 2} />
      </View>
    </Screen>
  );
}

// ---- 4. Partner registration ---------------------------------------------
const DOCUMENT_TYPES = [['dl', 'Driving licence'], ['rc', 'Vehicle RC'], ['insurance', 'Vehicle insurance']];

// "7 seats" / "12-26 seats" -> pre-fill the seats box with the first number.
const defaultSeats = (category) => (String(category?.seats || '').match(/\d+/) || [''])[0];

export function PartnerSignupScreen({ account, categories = [], onSubmitted, onBack }) {
  const [partnerType, setPartnerType] = useState(null);
  const [form, setForm] = useState({
    vehicleCategory: 'sedan', vehicleModel: '', vehicleNumber: '', seats: '4', city: 'Muzaffarpur', operatingArea: '',
    driverName: '', driverPhone: '', ownerDrives: true
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [documents, setDocuments] = useState({});
  const update = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  async function addDocument(type, label) {
    const file = await pickPhoto(label);
    if (file) setDocuments((current) => ({ ...current, [type]: file }));
  }

  if (!partnerType) {
    return (
      <Screen onBack={onBack}>
        <Logo small />
        <Text style={styles.title}>Join as Cab Partner</Text>
        <Text style={styles.subtitle}>Partner with us and earn more</Text>
        <ChoiceCard icon={Car} title="I am a Driver" subtitle="I drive my own vehicle" onPress={() => setPartnerType('driver')} highlight />
        <ChoiceCard icon={Users} title="I am a Vehicle Owner" subtitle="I own the vehicle and may have a separate driver" onPress={() => setPartnerType('vehicle_owner')} />
      </Screen>
    );
  }

  async function submit() {
    const ownerDrives = partnerType === 'driver' || form.ownerDrives;
    if (form.vehicleModel.trim().length < 2) return setError('Enter the vehicle model.');
    if (!/^[A-Z0-9 -]{6,20}$/.test(form.vehicleNumber.trim().toUpperCase())) return setError('Enter a valid registration number, e.g. BR06AB1234.');
    if (form.operatingArea.trim().length < 2) return setError('Enter the area you operate in.');
    if (!ownerDrives && (form.driverName.trim().length < 2 || !isValidPhone(normalizePhone(form.driverPhone)))) {
      return setError("Enter the driver's name and 10-digit mobile number.");
    }
    setBusy(true);
    setError('');
    try {
      const { application } = await submitPartnerApplication({
        partnerType,
        fullName: account.fullName,
        vehicleCategory: form.vehicleCategory,
        vehicleModel: form.vehicleModel.trim(),
        vehicleNumber: form.vehicleNumber.trim().toUpperCase(),
        seats: form.seats ? Number(form.seats) : null,
        city: form.city.trim(),
        operatingArea: form.operatingArea.trim(),
        driverName: ownerDrives ? account.fullName : form.driverName.trim(),
        driverPhone: ownerDrives ? account.phone : normalizePhone(form.driverPhone)
      });
      // Documents are optional: a failed upload doesn't undo the registration.
      const failed = [];
      for (const [type, file] of Object.entries(documents)) {
        await uploadPartnerDocument(application.id, type, file).catch(() => failed.push(DOCUMENT_TYPES.find(([key]) => key === type)[1]));
      }
      if (failed.length) Alert.alert('Registration submitted', `Could not upload: ${failed.join(', ')}. Our team will collect it when they call you.`);
      const me = await getMe();
      onSubmitted(me.account);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Screen onBack={() => setPartnerType(null)}>
      <Text style={styles.title}>Vehicle details</Text>
      <Text style={styles.subtitle}>{partnerType === 'driver' ? 'Driver' : 'Vehicle owner'} · {account.fullName} · +91 {account.phone}</Text>
      <View style={styles.card}>
        <Text style={styles.fieldLabel}>Vehicle category</Text>
        <View style={styles.segment}>
          {categories.map((category) => (
            <Pressable
              key={category.key}
              onPress={() => setForm((current) => ({ ...current, vehicleCategory: category.key, seats: defaultSeats(category) }))}
              style={[styles.segmentItem, form.vehicleCategory === category.key && styles.segmentItemActive]}
            >
              <Text style={[styles.segmentText, form.vehicleCategory === category.key && styles.segmentTextActive]}>{category.name}</Text>
            </Pressable>
          ))}
        </View>
        <Field label="Vehicle model" value={form.vehicleModel} onChangeText={(value) => update('vehicleModel', value)} placeholder="e.g. Honda Amaze" autoCapitalize="words" />
        <Field label="Registration number" value={form.vehicleNumber} onChangeText={(value) => update('vehicleNumber', value)} placeholder="e.g. BR06AB1234" autoCapitalize="characters" />
        <Field label="Seats (excluding driver)" value={form.seats} onChangeText={(value) => update('seats', value.replace(/\D/g, ''))} keyboardType="number-pad" />
        <Field label="City" value={form.city} onChangeText={(value) => update('city', value)} autoCapitalize="words" />
        <Field label="Operating area" value={form.operatingArea} onChangeText={(value) => update('operatingArea', value)} placeholder="e.g. Muzaffarpur, Patna" autoCapitalize="words" />
        {partnerType === 'vehicle_owner' ? (
          <>
            <Pressable onPress={() => update('ownerDrives', !form.ownerDrives)} style={styles.checkRow}>
              <View style={[styles.checkbox, form.ownerDrives && styles.checkboxOn]}>{form.ownerDrives ? <Text style={styles.checkMark}>✓</Text> : null}</View>
              <Text style={styles.checkLabel}>I drive this vehicle myself</Text>
            </Pressable>
            {!form.ownerDrives ? (
              <>
                <Field label="Driver name" value={form.driverName} onChangeText={(value) => update('driverName', value)} autoCapitalize="words" />
                <Field label="Driver mobile number" value={form.driverPhone} onChangeText={(value) => update('driverPhone', value)} keyboardType="phone-pad" placeholder="The driver logs in with this number" />
              </>
            ) : null}
          </>
        ) : null}
        <Text style={styles.fieldLabel}>Documents (optional)</Text>
        {DOCUMENT_TYPES.map(([type, label]) => (
          <Pressable key={type} onPress={() => addDocument(type, label)} style={styles.documentRow}>
            {documents[type] ? <Image source={{ uri: documents[type].uri }} style={styles.documentThumb} /> : <View style={styles.documentThumb}><Text style={styles.documentPlus}>+</Text></View>}
            <View style={styles.flex}>
              <Text style={styles.documentLabel}>{label}</Text>
              <Text style={styles.documentHint}>{documents[type] ? 'Added · tap to change' : 'Tap to take a photo'}</Text>
            </View>
          </Pressable>
        ))}
        <Text style={styles.note}>You can register without documents. Our team may call you to verify your details.</Text>
        <ErrorText>{error}</ErrorText>
        <Button label="Submit for verification" onPress={submit} busy={busy} />
      </View>
    </Screen>
  );
}

// ---- 5. Waiting for approval ---------------------------------------------
export function PartnerStatusScreen({ account, onAccount, onBookCab, onApplyAgain, onLogout }) {
  const application = account.partnerApplication;

  // Check every 30 seconds; the app switches to the driver dashboard once approved.
  useEffect(() => {
    const interval = setInterval(() => getMe().then((me) => onAccount(me.account)).catch(() => {}), 30000);
    return () => clearInterval(interval);
  }, []);

  const rejected = application?.status === 'REJECTED';
  return (
    <Screen>
      <Logo small />
      <View style={styles.statusIcon}>{rejected ? <ShieldCheck color={brand.error} size={40} /> : <Clock color={brand.yellow} size={40} />}</View>
      <Text style={[styles.title, styles.center]}>{rejected ? 'Registration not approved' : 'Verification in progress'}</Text>
      <Text style={[styles.subtitle, styles.center]}>
        {rejected
          ? application.review_note || 'SadakYatra could not approve this registration. Call us for details.'
          : 'Your registration has been submitted and is under review. This screen updates automatically once you are approved.'}
      </Text>
      {application ? (
        <View style={styles.card}>
          <Text style={styles.cardRow}>Reference: {application.application_ref}</Text>
          <Text style={styles.cardRow}>{application.partner_type === 'vehicle_owner' ? 'Vehicle owner' : 'Driver'} · {application.vehicle_number}</Text>
          <Text style={styles.cardRow}>{application.vehicle_model} · {application.vehicle_category}</Text>
        </View>
      ) : null}
      {rejected ? <Button label="Register again" onPress={onApplyAgain} /> : null}
      <Button label="Book a cab meanwhile" onPress={onBookCab} secondary />
      <Pressable onPress={() => Linking.openURL(`tel:${SUPPORT_PHONE}`)} style={styles.helpRow}>
        <Phone color={brand.muted} size={14} />
        <Text style={styles.helpText}>Questions? Call +91 {SUPPORT_PHONE}</Text>
      </Pressable>
      <Pressable onPress={onLogout} style={styles.resend}><Text style={styles.resendText}>Log out</Text></Pressable>
    </Screen>
  );
}

// ---- Shell for driver / owner / admin dashboards -------------------------
export const VIEW_LABELS = { customer: 'Book a cab', driver: 'Driver', fleet: 'My cabs', admin: 'Admin', partnerStatus: 'Registration' };

export function RoleShell({ view, views, onSwitch, onLogout, children }) {
  const insets = useSafeAreaInsets();
  const [changingPassword, setChangingPassword] = useState(false);
  return (
    <View style={[styles.shell, { paddingTop: insets.top }]}>
      <View style={styles.shellHeader}>
        <Logo small />
        <View style={styles.shellActions}>
          <Pressable onPress={() => setChangingPassword(true)} style={styles.shellLogout}><Text style={styles.shellLogoutText}>Password</Text></Pressable>
          <Pressable onPress={onLogout} style={styles.shellLogout}><Text style={styles.shellLogoutText}>Log out</Text></Pressable>
        </View>
      </View>
      <ChangePasswordModal visible={changingPassword} onClose={() => setChangingPassword(false)} />
      {views.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.switcher} contentContainerStyle={styles.switcherContent}>
          {views.map((item) => (
            <Pressable key={item} onPress={() => onSwitch(item)} style={[styles.switchChip, item === view && styles.switchChipActive]}>
              <Text style={[styles.switchText, item === view && styles.switchTextActive]}>{VIEW_LABELS[item]}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </View>
  );
}

export function LoadingScreen() {
  return (
    <View style={[styles.screen, styles.loading]}>
      <Logo />
      <ActivityIndicator color={brand.yellow} style={styles.loadingSpinner} />
    </View>
  );
}

const styles = StyleSheet.create(largerText({
  screen: { flex: 1, backgroundColor: brand.black },
  content: { paddingHorizontal: 20, paddingTop: 24 },
  flex: { flex: 1 },
  center: { textAlign: 'center' },
  back: { position: 'absolute', zIndex: 2, left: 12, top: 48, padding: 6 },
  loading: { alignItems: 'center', justifyContent: 'center' },
  loadingSpinner: { marginTop: 24 },
  logoBox: { alignSelf: 'center', backgroundColor: brand.white, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 12 },
  logoBoxSmall: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 20 },
  logo: { width: 220, height: 90 },
  logoSmall: { width: 130, height: 40 },
  welcomeTop: { alignItems: 'center', marginTop: 40, marginBottom: 36 },
  tagline: { color: brand.white, fontSize: 16, fontWeight: '800', marginTop: 20 },
  taglineSub: { color: brand.muted, fontSize: 13, marginTop: 4 },
  title: { color: brand.white, fontSize: 26, fontWeight: '900' },
  subtitle: { color: brand.muted, fontSize: 14, marginTop: 6, marginBottom: 20, lineHeight: 20 },
  card: { backgroundColor: brand.white, borderRadius: 18, padding: 18, marginBottom: 16 },
  cardRow: { color: brand.ink, fontSize: 14, marginVertical: 3 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: brand.surface, borderRadius: 16, borderWidth: 1, borderColor: brand.border, padding: 16, marginBottom: 12 },
  choiceHighlight: { borderColor: brand.yellow },
  choiceIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A2A2A' },
  choiceIconHighlight: { backgroundColor: brand.yellow },
  choiceTitle: { color: brand.white, fontSize: 17, fontWeight: '800' },
  choiceSubtitle: { color: brand.muted, fontSize: 13, marginTop: 2 },
  loginLink: { alignItems: 'center', paddingVertical: 20 },
  loginLinkText: { color: brand.muted, fontSize: 14 },
  loginLinkStrong: { color: brand.yellow, fontWeight: '800' },
  field: { marginBottom: 14 },
  fieldLabel: { color: brand.inkMuted, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  fieldInput: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: brand.line, paddingHorizontal: 14, fontSize: 16, color: brand.ink },
  phoneRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: brand.line, marginBottom: 14 },
  phonePrefix: { color: brand.ink, fontSize: 16, fontWeight: '800', paddingHorizontal: 14, borderRightWidth: 1, borderRightColor: brand.line, paddingVertical: 13 },
  phoneInput: { flex: 1, minHeight: 50, paddingHorizontal: 14, fontSize: 17, color: brand.ink, letterSpacing: 1 },
  otpInput: { minHeight: 60, borderRadius: 12, borderWidth: 1, borderColor: brand.line, textAlign: 'center', fontSize: 28, letterSpacing: 12, color: brand.ink, marginBottom: 14, fontWeight: '800' },
  button: { minHeight: 52, borderRadius: 14, backgroundColor: brand.yellow, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: brand.border, marginTop: 12 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: brand.black, fontSize: 16, fontWeight: '900' },
  buttonTextSecondary: { color: brand.white },
  error: { color: brand.error, fontSize: 13, marginBottom: 10, lineHeight: 18 },
  resend: { alignItems: 'center', paddingVertical: 14 },
  resendText: { color: '#8A6D00', fontSize: 14, fontWeight: '800' },
  resendDisabled: { color: brand.inkMuted },
  helpRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  helpText: { color: brand.muted, fontSize: 13 },
  segment: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  segmentItem: { flexGrow: 1, minWidth: '30%', minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: brand.line, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segmentItemActive: { borderColor: brand.black, backgroundColor: brand.yellow },
  segmentText: { color: brand.ink, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  segmentTextActive: { color: brand.black, fontWeight: '900' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, marginBottom: 8 },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: brand.inkMuted, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: brand.yellow, borderColor: brand.black },
  checkMark: { color: brand.black, fontSize: 14, fontWeight: '900' },
  checkLabel: { color: brand.ink, fontSize: 14 },
  documentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: brand.line },
  documentThumb: { width: 52, height: 40, borderRadius: 8, backgroundColor: '#F2F2F2', alignItems: 'center', justifyContent: 'center' },
  documentPlus: { color: brand.inkMuted, fontSize: 22, fontWeight: '700' },
  documentLabel: { color: brand.ink, fontSize: 14, fontWeight: '700' },
  documentHint: { color: brand.inkMuted, fontSize: 12, marginTop: 2 },
  note: { color: brand.inkMuted, fontSize: 12, lineHeight: 17, marginBottom: 12 },
  statusIcon: { alignSelf: 'center', width: 80, height: 80, borderRadius: 40, backgroundColor: brand.surface, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  shell: { flex: 1, backgroundColor: brand.black },
  shellHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12 },
  shellActions: { flexDirection: 'row', gap: 8 },
  passwordRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: brand.line },
  passwordInput: { flex: 1, minHeight: 48, paddingHorizontal: 14, fontSize: 16, color: brand.ink },
  showButton: { paddingHorizontal: 14, paddingVertical: 12 },
  showText: { color: '#8A6D00', fontSize: 13, fontWeight: '800' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', padding: 16, backgroundColor: 'rgba(0,0,0,0.6)' },
  modalTitle: { color: brand.ink, fontSize: 20, fontWeight: '900', marginBottom: 12 },
  shellLogout: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: brand.border, marginBottom: 20 },
  shellLogoutText: { color: brand.white, fontSize: 13, fontWeight: '700' },
  switcher: { flexGrow: 0 },
  switcherContent: { paddingHorizontal: 16, gap: 8 },
  switchChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: brand.border },
  switchChipActive: { backgroundColor: brand.yellow, borderColor: brand.yellow },
  switchText: { color: brand.white, fontSize: 13, fontWeight: '700' },
  switchTextActive: { color: brand.black, fontWeight: '900' }
}));

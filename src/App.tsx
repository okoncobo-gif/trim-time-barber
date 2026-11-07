/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Clock,
  User,
  Phone,
  Scissors,
  ChevronRight,
  CheckCircle2,
  X,
  Settings,
  Trash2,
  CalendarDays,
  Pencil,
  Save,
  Lock,
  Ticket,
  LogOut,
  KeyRound,
  AlertTriangle,
  MessageSquare,
  UserCheck,
} from 'lucide-react';
import {
  Appointment, AppointmentStatus, Barber, BarberRemovalAction, CustomerBooking, NewAppointment, SessionUser, SmsMessage,
} from './types';
import { appointmentService, ApiError } from './services/appointmentService';

const TIME_SLOTS = ['09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00'];
const slotLabel = (t: string) => {
  const h = Number(t.slice(0, 2));
  return `${String(h % 12 || 12).padStart(2, '0')}:${t.slice(3)} ${h < 12 ? 'AM' : 'PM'}`;
};
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

const fieldBase = 'w-full rounded-xl border border-black/5 bg-black/[0.02] focus:outline-none focus:ring-2 focus:ring-black/5 transition-all';
const inputClass = `${fieldBase} px-4 py-3`;
const labelClass = 'text-xs font-bold uppercase tracking-widest text-black/40';
const primaryButton = 'w-full bg-black text-white py-4 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-black/90 transition-all disabled:opacity-50';

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  pending: 'Awaiting approval',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
};

function StatusBadge({ status }: { status: AppointmentStatus }) {
  const color = status === 'confirmed' ? 'bg-emerald-100 text-emerald-700'
    : status === 'cancelled' ? 'bg-red-100 text-red-700'
    : 'bg-amber-100 text-amber-700';
  return <span className={`inline-block text-xs font-bold uppercase tracking-widest px-2 py-1 rounded-md ${color}`}>{STATUS_LABEL[status]}</span>;
}

function Modal({ title, icon, onClose, children, wide }: {
  title: string; icon?: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <motion.div
        initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }}
        className={`relative w-full ${wide ? 'max-w-md' : 'max-w-sm'} bg-white rounded-3xl shadow-2xl p-8 max-h-[90vh] overflow-y-auto`}
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            {icon}
            <h2 className="text-xl font-serif">{title}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-black/5 rounded-full transition-colors"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}

// ------------------------------------------------------------------ customer: my booking

function MyBooking({ initial, onClose }: { initial: { ref: string; phone: string } | null; onClose: () => void }) {
  const [ref, setRef] = useState(initial?.ref ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [booking, setBooking] = useState<CustomerBooking | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<CustomerBooking>) => {
    setBusy(true);
    setError('');
    try { setBooking(await fn()); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };

  useEffect(() => {
    if (initial) run(() => appointmentService.lookup(initial.ref, initial.phone));
  }, []);

  const cancel = () => {
    if (!confirm('Cancel this booking?')) return;
    run(() => appointmentService.cancelBooking(ref, phone));
  };
  const confirmComing = () => run(() => appointmentService.confirmAttendance(ref, phone));

  return (
    <Modal title="My booking" icon={<Ticket className="w-5 h-5 text-black/40" />} onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); run(() => appointmentService.lookup(ref, phone)); }} className="space-y-4">
        <p className="text-sm text-black/40">Enter the booking code you received and the phone number you booked with.</p>
        <input required placeholder="Booking code (e.g. 7KQ2MX)" value={ref} onChange={e => setRef(e.target.value)} className={`${inputClass} uppercase`} />
        <input required type="tel" placeholder="Phone number" value={phone} onChange={e => setPhone(e.target.value)} className={inputClass} />
        <button type="submit" disabled={busy} className={primaryButton}>{busy ? 'Checking...' : 'Check status'}</button>
      </form>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {booking && (
        <div className="mt-6 p-4 rounded-xl bg-black/[0.02] border border-black/5 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{booking.customer_name}</span>
            <StatusBadge status={booking.status} />
          </div>
          <p className="text-sm flex items-center gap-2"><CalendarDays className="w-4 h-4 text-black/40" /> {booking.date} at {slotLabel(booking.time)}</p>
          <p className="text-sm flex items-center gap-2"><Scissors className="w-4 h-4 text-black/40" /> {booking.barber_name || 'Any available barber'}</p>
          {booking.status === 'pending' && (
            <p className="text-sm text-black/50">Your barber hasn't approved this booking yet. Check back here for confirmation.</p>
          )}
          {booking.status !== 'cancelled' && (booking.customer_confirmed ? (
            <p className="text-sm text-emerald-700 flex items-center gap-2"><UserCheck className="w-4 h-4" /> You've confirmed you're coming. See you soon!</p>
          ) : booking.can_confirm_attendance ? (
            <button onClick={confirmComing} disabled={busy} className={primaryButton}>
              <UserCheck className="w-4 h-4" /> Yes, I'm still coming
            </button>
          ) : (
            <p className="text-xs text-black/40">Within {booking.attendance_window_hours} hours of your appointment we'll text you to confirm you're still coming.</p>
          ))}
          {booking.status !== 'cancelled' && (booking.can_cancel ? (
            <button onClick={cancel} disabled={busy} className="w-full py-3 rounded-xl font-semibold border border-red-200 text-red-600 hover:bg-red-50 transition-all">
              Cancel booking
            </button>
          ) : (
            <p className="text-xs text-black/40">Online cancellation closes {booking.cancel_cutoff_hours} hours before your appointment. Please call the shop to make changes.</p>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ staff: sign in

function StaffLogin({ barbers, onClose, onSignedIn }: {
  barbers: Barber[]; onClose: () => void; onSignedIn: (u: SessionUser) => void;
}) {
  const [who, setWho] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const user = who === 'admin'
        ? await appointmentService.login('admin', password)
        : await appointmentService.login('barber', password, Number(who));
      onSignedIn(user);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Modal title="Staff sign in" icon={<Lock className="w-5 h-5 text-black/40" />} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-2">
          <label className={labelClass}>Sign in as</label>
          <select value={who} onChange={e => setWho(e.target.value)} className={`${inputClass} appearance-none`}>
            <option value="admin">Admin</option>
            {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <input type="password" required autoFocus placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} className={inputClass} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className={primaryButton}>Sign in</button>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ app

export default function App() {
  const [view, setView] = useState<'customer' | 'staff'>('customer');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<Record<string, string>>({ opening_hours: 'Tue — Sat, 9:00 AM - 7:00 PM', approval_mode: 'manual' });

  // customer
  const [bookingStatus, setBookingStatus] = useState<'idle' | 'submitting'>('idle');
  const [bookingError, setBookingError] = useState('');
  const [lastBooking, setLastBooking] = useState<{ booking: CustomerBooking; phone: string } | null>(null);
  const [myBooking, setMyBooking] = useState<{ ref: string; phone: string } | null | false>(false); // false = closed

  // staff
  const [showLogin, setShowLogin] = useState(false);
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [editingBarber, setEditingBarber] = useState<Barber | null>(null);
  const [removingBarber, setRemovingBarber] = useState<Barber | null>(null);
  const [showAddBarber, setShowAddBarber] = useState(false);
  const [isEditingHours, setIsEditingHours] = useState(false);
  const [barberFilter, setBarberFilter] = useState('all');
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [showMessages, setShowMessages] = useState(false);

  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    fetchSettings();
    fetchBarbers();
    // Restore a staff session from this browser tab, if any.
    appointmentService.me().then(setUser).catch(() => appointmentService.logout());
  }, []);

  useEffect(() => {
    if (view === 'staff' && user) {
      fetchAppointments();
      fetchBarbers();
      if (user.role === 'admin') { fetchAdminSettings(); fetchMessages(); }
    }
  }, [view, user]);

  // Keep the staff dashboard fresh (approvals, auto-approvals, new bookings).
  useEffect(() => {
    if (view !== 'staff' || !user) return;
    const timer = setInterval(() => { fetchAppointments(); if (user.role === 'admin') fetchMessages(); }, 60_000);
    return () => clearInterval(timer);
  }, [view, user]);

  const fetchBarbers = async () => {
    try { setBarbers(await appointmentService.getBarbers()); } catch (e) { console.error('Failed to fetch barbers', e); }
  };

  const fetchSettings = async () => {
    try { setSettings(await appointmentService.getSettings()); } catch (e) { console.error('Failed to fetch settings', e); }
  };

  const fetchAdminSettings = async () => {
    try { setSettings(await appointmentService.getAdminSettings()); } catch (e) { console.error('Failed to fetch settings', e); }
  };

  const fetchMessages = async () => {
    try { setMessages(await appointmentService.getMessages()); } catch (e) { console.error('Failed to fetch messages', e); }
  };

  const fetchAppointments = async () => {
    setLoading(true);
    try { setAppointments(await appointmentService.getAll()); } catch (e) { handleStaffError(e); } finally { setLoading(false); }
  };

  // Session expired or barber removed: back to the customer view.
  const handleStaffError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      signOut();
      alert('Your session has ended. Please sign in again.');
    } else {
      alert(errorMessage(e));
    }
  };

  const staffAction = async (fn: () => Promise<unknown>, refresh: Array<() => Promise<void>> = [fetchAppointments]) => {
    try {
      await fn();
      await Promise.all([...refresh, ...(isAdmin ? [fetchMessages] : [])].map(r => r()));
      return true;
    } catch (e) {
      handleStaffError(e);
      return false;
    }
  };

  const signOut = () => {
    appointmentService.logout();
    setUser(null);
    setAppointments([]);
    setView('customer');
    fetchBarbers();
  };

  // ---------------------------------------------------------------- customer actions

  const handleBook = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setBookingStatus('submitting');
    setBookingError('');
    const formData = new FormData(form);
    const barberVal = formData.get('barber_id') as string;
    const newApp: NewAppointment = {
      customer_name: formData.get('name') as string,
      customer_phone: formData.get('phone') as string,
      date: formData.get('date') as string,
      time: formData.get('time') as string,
      barber_id: Number(barberVal),
    };
    try {
      const booking = await appointmentService.create(newApp);
      setLastBooking({ booking, phone: newApp.customer_phone });
      form.reset();
    } catch (error) {
      setBookingError(errorMessage(error));
    } finally {
      setBookingStatus('idle');
    }
  };

  // ---------------------------------------------------------------- staff actions

  const handleUpdateStatus = (id: number, status: AppointmentStatus) =>
    staffAction(() => appointmentService.update(id, { status }));

  const handleReassign = (id: number, barberVal: string) => {
    if (!barberVal) return;
    const name = barbers.find(b => b.id === Number(barberVal))?.name;
    if (!confirm(`Move this booking to ${name}? ${name} will need to approve it, and the customer will get a text.`)) return;
    staffAction(() => appointmentService.update(id, { barber_id: Number(barberVal) }));
  };

  const handleDelete = (id: number) => {
    if (!confirm('Permanently delete this appointment? To keep a record, cancel it instead.')) return;
    staffAction(() => appointmentService.delete(id));
  };

  const handleSaveEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingAppointment) return;
    const formData = new FormData(e.currentTarget);
    const updates: Partial<Appointment> = {
      date: formData.get('date') as string,
      time: formData.get('time') as string,
      barber_id: Number(formData.get('barber_id')),
    };
    if (isAdmin) {
      updates.customer_name = formData.get('name') as string;
      updates.customer_phone = formData.get('phone') as string;
    }
    const ok = await staffAction(() => appointmentService.update(editingAppointment.id, updates));
    if (ok) setEditingAppointment(null);
  };

  const handleUpdateOpeningHours = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = new FormData(e.currentTarget).get('opening_hours') as string;
    if (await staffAction(() => appointmentService.updateSetting('opening_hours', value), [fetchAdminSettings])) setIsEditingHours(false);
  };

  const handleApprovalMode = (mode: 'auto' | 'manual') =>
    staffAction(() => appointmentService.updateSetting('approval_mode', mode), [fetchAdminSettings]);

  const handleAdminPhone = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const value = new FormData(e.currentTarget).get('admin_phone') as string;
    staffAction(() => appointmentService.updateSetting('admin_phone', value), [fetchAdminSettings]);
  };

  const handleAddBarber = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);
    const ok = await staffAction(() => appointmentService.createBarber({
      name: formData.get('name') as string,
      specialty: formData.get('specialty') as string,
      password: (formData.get('password') as string) || undefined,
      phone: (formData.get('phone') as string) || undefined,
    }), [fetchBarbers]);
    if (ok) { setShowAddBarber(false); form.reset(); }
  };

  const handleSaveBarber = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingBarber) return;
    const formData = new FormData(e.currentTarget);
    const ok = await staffAction(() => appointmentService.updateBarber(editingBarber.id, {
      name: formData.get('name') as string,
      specialty: formData.get('specialty') as string,
      password: (formData.get('password') as string) || undefined,
      phone: formData.get('phone') as string,
    }), [fetchBarbers, fetchAppointments]);
    if (ok) setEditingBarber(null);
  };

  const handleRemoveBarber = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!removingBarber) return;
    const formData = new FormData(e.currentTarget);
    const action = formData.get('action') as BarberRemovalAction;
    const target = formData.get('reassign_to') as string;
    const ok = await staffAction(
      () => appointmentService.deleteBarber(removingBarber.id, action, target ? Number(target) : undefined),
      [fetchBarbers, fetchAppointments],
    );
    if (ok) setRemovingBarber(null);
  };

  const toggleView = () => {
    if (view === 'staff') setView('customer');
    else if (user) setView('staff');
    else setShowLogin(true);
  };

  const shownAppointments = barberFilter === 'all' ? appointments
    : barberFilter === 'unassigned' ? appointments.filter(a => a.barber_id === null)
    : appointments.filter(a => a.barber_id === Number(barberFilter));
  const pendingCount = appointments.filter(a => a.status === 'pending').length;
  const urgent = appointments.filter(a => a.needs_approval_soon);
  const upcomingForRemoval = removingBarber
    ? appointments.filter(a => a.barber_id === removingBarber.id && a.status !== 'cancelled' && a.date >= todayLocal()).length
    : 0;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Navigation */}
      <nav className="border-bottom border-black/5 bg-white/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
              <Scissors className="text-white w-5 h-5" />
            </div>
            <span className="font-serif text-xl font-semibold tracking-tight">TrimTime</span>
          </div>

          <div className="flex items-center gap-2">
            {view === 'customer' && (
              <button onClick={() => setMyBooking(null)} className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full hover:bg-black/5 transition-colors">
                <Ticket className="w-4 h-4" /> My Booking
              </button>
            )}
            <button
              onClick={toggleView}
              className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full border border-black/10 hover:bg-black hover:text-white transition-colors"
            >
              {view === 'customer' ? (
                <><Settings className="w-4 h-4" /> {user ? 'Dashboard' : 'Staff Login'}</>
              ) : (
                <><User className="w-4 h-4" /> Customer View</>
              )}
            </button>
            {user && (
              <button onClick={signOut} title={`Sign out ${user.name}`} className="p-2 rounded-full hover:bg-black/5 text-black/50 hover:text-black transition-colors">
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </nav>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-12">
        <AnimatePresence mode="wait">
          {view === 'customer' ? (
            <motion.div
              key="customer"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid lg:grid-cols-2 gap-16 items-start"
            >
              {/* Left Side: Editorial Content */}
              <div className="space-y-8">
                <h1 className="font-serif text-7xl leading-[0.9] tracking-tight">
                  Crafted <br />
                  <span className="italic text-black/40">Excellence.</span>
                </h1>
                <p className="text-lg text-black/60 max-w-md leading-relaxed">
                  Book your next session with master barbers. We specialize in classic cuts, modern fades, and precision beard grooming.
                </p>

                <div className="space-y-4 pt-8">
                  <div className="flex items-center gap-4 group">
                    <div className="w-12 h-12 rounded-full border border-black/10 flex items-center justify-center group-hover:bg-black group-hover:text-white transition-all">
                      <Clock className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-wider text-black/40">Opening Hours</p>
                      <p className="font-medium">{settings.opening_hours}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Side: Booking Form or confirmation */}
              <div className="glass-card rounded-3xl p-8 lg:p-10">
                {lastBooking ? (
                  <div className="space-y-6 text-center">
                    <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-600" />
                    <h2 className="text-2xl font-serif">
                      {lastBooking.booking.status === 'confirmed' ? "You're booked!" : 'Request received'}
                    </h2>
                    <p className="text-black/60">
                      {lastBooking.booking.date} at {slotLabel(lastBooking.booking.time)}
                      {lastBooking.booking.barber_name ? ` with ${lastBooking.booking.barber_name}` : ''}
                    </p>
                    <div className="p-4 rounded-xl bg-black/[0.03] border border-black/5">
                      <p className={labelClass}>Your booking code</p>
                      <p className="font-mono text-3xl tracking-[0.3em] mt-1">{lastBooking.booking.ref}</p>
                    </div>
                    <p className="text-sm text-black/50">
                      {lastBooking.booking.status === 'confirmed'
                        ? 'Your appointment is confirmed.'
                        : 'Your barber will review your request and we’ll text you when it’s confirmed. You can also check under "My Booking" with this code.'}
                      {' '}You can cancel online up to {lastBooking.booking.cancel_cutoff_hours} hours before. Keep this code.
                    </p>
                    <div className="flex gap-3">
                      <button onClick={() => setMyBooking({ ref: lastBooking.booking.ref, phone: lastBooking.phone })} className="flex-1 py-4 rounded-xl font-semibold border border-black/10 hover:bg-black/5 transition-all">
                        View booking
                      </button>
                      <button onClick={() => setLastBooking(null)} className="flex-1 bg-black text-white py-4 rounded-xl font-semibold hover:bg-black/90 transition-all">
                        Book another
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h2 className="text-2xl font-serif mb-8">Reserve your spot</h2>
                    <form onSubmit={handleBook} className="space-y-6">
                      <div className="space-y-2">
                        <label className={labelClass}>Full Name</label>
                        <div className="relative">
                          <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-black/20" />
                          <input name="name" required placeholder="John Doe" className={`${fieldBase} pl-12 pr-4 py-4`} />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className={labelClass}>Phone Number</label>
                        <div className="relative">
                          <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-black/20" />
                          <input name="phone" required type="tel" placeholder="(555) 000-0000" className={`${fieldBase} pl-12 pr-4 py-4`} />
                        </div>
                      </div>

                      {barbers.length > 0 && (
                        <div className="space-y-2">
                          <label className={labelClass}>Select Barber</label>
                          <div className="relative">
                            <Scissors className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-black/20" />
                            <select name="barber_id" required defaultValue="" className={`${fieldBase} pl-12 pr-4 py-4 appearance-none`}>
                              <option value="" disabled>Choose your barber</option>
                              {barbers.map(b => <option key={b.id} value={b.id}>{b.name} — {b.specialty}</option>)}
                            </select>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className={labelClass}>Date</label>
                          <input name="date" required type="date" min={todayLocal()} className={`${fieldBase} px-4 py-4`} />
                        </div>
                        <div className="space-y-2">
                          <label className={labelClass}>Time</label>
                          <select name="time" required className={`${fieldBase} px-4 py-4 appearance-none`}>
                            {TIME_SLOTS.map(t => <option key={t} value={t}>{slotLabel(t)}</option>)}
                          </select>
                        </div>
                      </div>

                      <p className="text-xs text-black/40">
                        Book at least {settings.min_lead_hours || 1} hour ahead. We'll text you when your booking is confirmed,
                        and again before your appointment to check you're still coming.
                      </p>

                      {bookingError && <p className="text-sm text-red-600">{bookingError}</p>}

                      <button disabled={bookingStatus === 'submitting'} className={primaryButton.replace('py-4', 'py-5')}>
                        {bookingStatus === 'submitting' ? 'Processing...' : <>Book Appointment <ChevronRight className="w-4 h-4" /></>}
                      </button>
                    </form>
                  </>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="staff"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="space-y-8"
            >
              <div className="flex items-end justify-between flex-wrap gap-4">
                <div>
                  <h1 className="font-serif text-4xl">{isAdmin ? 'Appointment Manager' : 'Your Bookings'}</h1>
                  <p className="text-black/40">
                    {isAdmin ? 'Manage the shop schedule, barbers and settings' : `Signed in as ${user?.name}. Approve or cancel your bookings.`}
                  </p>
                </div>
                <div className="flex gap-2">
                  {pendingCount > 0 && (
                    <div className="px-4 py-2 bg-amber-100 text-amber-800 rounded-lg text-sm font-medium">{pendingCount} awaiting approval</div>
                  )}
                  <div className="px-4 py-2 bg-black/5 rounded-lg text-sm font-medium">{appointments.length} Total</div>
                </div>
              </div>

              {urgent.length > 0 && (
                <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 flex gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="text-sm text-amber-900">
                    <p className="font-semibold">{urgent.length} booking{urgent.length === 1 ? '' : 's'} still need{urgent.length === 1 ? 's' : ''} approval</p>
                    <p>Unapproved bookings are approved automatically {settings.approval_deadline_hours || 1} hour before the appointment.</p>
                    <ul className="mt-1 list-disc pl-5">
                      {urgent.map(a => (
                        <li key={a.id}>{a.customer_name}, {a.date} at {slotLabel(a.time)}{isAdmin && a.barber_name ? ` (${a.barber_name})` : ''}: auto-approves at {clock(a.auto_approve_at)}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {isAdmin && (
                <>
                  {/* Shop settings */}
                  <div className="glass-card rounded-2xl p-6 space-y-6">
                    <div className="flex items-center gap-2">
                      <Settings className="w-5 h-5 text-black/40" />
                      <h2 className="text-xl font-serif">Shop Settings</h2>
                    </div>

                    <div className="space-y-2">
                      <p className={labelClass}>Booking approval</p>
                      <div className="inline-flex rounded-xl border border-black/10 p-1 bg-black/[0.02]">
                        {(['manual', 'auto'] as const).map(mode => (
                          <button
                            key={mode}
                            onClick={() => handleApprovalMode(mode)}
                            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${settings.approval_mode === mode ? 'bg-black text-white' : 'text-black/50 hover:text-black'}`}
                          >
                            {mode === 'manual' ? 'Manual approval' : 'Auto-approve'}
                          </button>
                        ))}
                      </div>
                      <p className="text-sm text-black/40">
                        {settings.approval_mode === 'auto'
                          ? 'New bookings are confirmed immediately.'
                          : `New bookings wait for the barber (or admin) to approve them. Anything not approved is approved automatically ${settings.approval_deadline_hours || 1} hour before; the barber and admin get a warning ${settings.approval_warning_hours || 3} hours before.`}
                      </p>
                    </div>

                    <form onSubmit={handleAdminPhone} className="space-y-2">
                      <label className={labelClass}>Admin mobile (for SMS warnings)</label>
                      <div className="flex gap-2">
                        <input key={settings.admin_phone} name="admin_phone" type="tel" defaultValue={settings.admin_phone} placeholder="(555) 000-0000" className={`${inputClass} flex-1`} />
                        <button type="submit" className="px-6 py-3 rounded-xl font-semibold border border-black/10 hover:bg-black/5 transition-all">Save</button>
                      </div>
                    </form>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className={labelClass}>Opening hours</p>
                        {!isEditingHours && (
                          <button onClick={() => setIsEditingHours(true)} className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black transition-colors" title="Edit Hours">
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      {isEditingHours ? (
                        <form onSubmit={handleUpdateOpeningHours} className="flex flex-col md:flex-row gap-3 items-end">
                          <input name="opening_hours" required autoFocus defaultValue={settings.opening_hours} className={`${inputClass} flex-1`} />
                          <div className="flex gap-2 w-full md:w-auto">
                            <button type="button" onClick={() => setIsEditingHours(false)} className="flex-1 md:flex-none px-6 py-3 rounded-xl font-semibold border border-black/10 hover:bg-black/5 transition-all">Cancel</button>
                            <button type="submit" className="flex-1 md:flex-none bg-black text-white px-6 py-3 rounded-xl font-semibold hover:bg-black/90 transition-all flex items-center justify-center gap-2">
                              <Save className="w-4 h-4" /> Update
                            </button>
                          </div>
                        </form>
                      ) : (
                        <p className="p-4 rounded-xl bg-black/[0.02] border border-black/5 font-medium">{settings.opening_hours}</p>
                      )}
                    </div>
                  </div>

                  {/* Barber Management */}
                  <div className="glass-card rounded-2xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Scissors className="w-5 h-5 text-black/40" />
                        <h2 className="text-xl font-serif">Manage Barbers</h2>
                      </div>
                      <button onClick={() => setShowAddBarber(v => !v)} className="text-sm font-semibold px-4 py-2 rounded-full border border-black/10 hover:bg-black hover:text-white transition-colors">
                        {showAddBarber ? 'Cancel' : '+ Add Barber'}
                      </button>
                    </div>

                    <AnimatePresence>
                      {showAddBarber && (
                        <motion.form
                          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                          onSubmit={handleAddBarber}
                          className="grid md:grid-cols-5 gap-3 items-end p-4 rounded-xl bg-black/[0.02] border border-black/5"
                        >
                          <div className="space-y-1">
                            <label className={labelClass}>Name</label>
                            <input name="name" required placeholder="Barber name" className={`w-full rounded-xl border border-black/5 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-black/5`} />
                          </div>
                          <div className="space-y-1">
                            <label className={labelClass}>Specialty</label>
                            <input name="specialty" required placeholder="e.g. Fades & Tapers" className={`w-full rounded-xl border border-black/5 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-black/5`} />
                          </div>
                          <div className="space-y-1">
                            <label className={labelClass}>Mobile (SMS)</label>
                            <input name="phone" type="tel" placeholder="Optional" className="w-full rounded-xl border border-black/5 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-black/5" />
                          </div>
                          <div className="space-y-1">
                            <label className={labelClass}>Login password</label>
                            <input name="password" type="password" minLength={4} placeholder="Optional" className={`w-full rounded-xl border border-black/5 bg-white px-4 py-3 focus:outline-none focus:ring-2 focus:ring-black/5`} />
                          </div>
                          <button type="submit" className="bg-black text-white px-6 py-3 rounded-xl font-semibold hover:bg-black/90 transition-all whitespace-nowrap">Add Barber</button>
                        </motion.form>
                      )}
                    </AnimatePresence>

                    <div className="grid gap-3">
                      {barbers.length === 0 ? (
                        <p className="text-sm text-black/30 italic text-center py-4">No barbers yet. Add one above.</p>
                      ) : barbers.map(barber => (
                        <div key={barber.id} className="flex items-center justify-between px-4 py-3 rounded-xl border border-black/5 bg-black/[0.02]">
                          <div>
                            <p className="font-semibold">{barber.name}</p>
                            <p className="text-sm text-black/40">
                              {barber.specialty} · {barber.has_login ? 'Can sign in' : <span className="text-amber-700">No login yet — set a password</span>}
                              {' · '}{barber.phone ? barber.phone : <span className="text-amber-700">No mobile for SMS</span>}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => setEditingBarber(barber)} className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black transition-colors" title="Edit / set password"><Pencil className="w-4 h-4" /></button>
                            <button onClick={() => setRemovingBarber(barber)} className="p-2 rounded-lg hover:bg-red-50 text-black/40 hover:text-red-600 transition-colors" title="Remove"><Trash2 className="w-4 h-4" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className={labelClass}>Show</label>
                    <select value={barberFilter} onChange={e => setBarberFilter(e.target.value)} className="px-4 py-2 rounded-xl border border-black/10 bg-white text-sm">
                      <option value="all">All barbers</option>
                      {appointments.some(a => a.barber_id === null) && <option value="unassigned">Unassigned</option>}
                      {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>

                  {/* SMS log */}
                  <div className="glass-card rounded-2xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="w-5 h-5 text-black/40" />
                        <h2 className="text-xl font-serif">Text Messages</h2>
                      </div>
                      <button onClick={() => setShowMessages(v => !v)} className="text-sm font-semibold px-4 py-2 rounded-full border border-black/10 hover:bg-black hover:text-white transition-colors">
                        {showMessages ? 'Hide' : `Show latest (${messages.length})`}
                      </button>
                    </div>
                    {messages.some(m => m.status === 'not_sent') && (
                      <p className="text-sm text-amber-700">SMS isn't connected yet. Messages are logged here but not delivered.</p>
                    )}
                    {showMessages && (
                      <div className="divide-y divide-black/5 max-h-96 overflow-y-auto">
                        {messages.length === 0 ? <p className="text-sm text-black/30 italic py-2">No messages yet.</p> : messages.map(m => (
                          <div key={m.id} className="py-3 text-sm">
                            <div className="flex justify-between gap-4 text-xs text-black/40">
                              <span>{new Date(m.created_at.replace(' ', 'T') + 'Z').toLocaleString()} · to {m.to_role} {m.to_phone}</span>
                              <span className={m.status === 'sent' ? 'text-emerald-700' : m.status === 'failed' ? 'text-red-600' : 'text-black/40'}>
                                {m.status === 'not_sent' ? 'not sent' : m.status}
                              </span>
                            </div>
                            <p className="mt-1">{m.body}</p>
                            {m.status === 'failed' && m.error && <p className="text-xs text-red-600 mt-1">{m.error}</p>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              <div className="grid gap-4">
                {loading ? (
                  <div className="py-20 text-center text-black/20 font-serif text-2xl">Loading schedule...</div>
                ) : shownAppointments.length === 0 ? (
                  <div className="py-20 text-center text-black/20 font-serif text-2xl">No appointments found</div>
                ) : (
                  shownAppointments.map(app => (
                    <div key={app.id} className="glass-card rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:border-black/20 transition-all">
                      <div className="flex items-center gap-6">
                        <div className="w-14 h-14 rounded-full bg-black/5 flex items-center justify-center text-xl font-serif">
                          {app.customer_name[0]}
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg">{app.customer_name}</h3>
                          <p className="text-sm text-black/40 flex items-center gap-1"><Phone className="w-3 h-3" /> {app.customer_phone}</p>
                          <p className="text-xs text-black/30 font-mono mt-1">#{app.ref}</p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-8">
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-black/30">Barber</p>
                          {isAdmin ? (
                            <select
                              value={app.barber_id ?? ''}
                              onChange={e => handleReassign(app.id, e.target.value)}
                              className="px-2 py-1 rounded-lg border border-black/10 bg-white text-sm font-medium"
                              title="Reassign"
                              disabled={app.status === 'cancelled'}
                            >
                              {app.barber_id === null && <option value="">Unassigned</option>}
                              {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                          ) : (
                            <div className="flex items-center gap-2 font-medium"><Scissors className="w-4 h-4 text-black/40" />{app.barber_name}</div>
                          )}
                        </div>

                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-black/30">Date & Time</p>
                          <div className="flex items-center gap-2 font-medium">
                            <CalendarDays className="w-4 h-4 text-black/40" />
                            {app.date} at {slotLabel(app.time)}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-black/30">Status</p>
                          <StatusBadge status={app.status} />
                          {app.status === 'cancelled' && app.cancelled_by && (
                            <p className="text-[10px] text-black/30">by {app.cancelled_by}</p>
                          )}
                          {app.status === 'pending' && !app.is_past && (
                            <p className={`text-[10px] ${app.needs_approval_soon ? 'text-amber-700 font-semibold' : 'text-black/30'}`}>auto-approves {clock(app.auto_approve_at)}</p>
                          )}
                          {app.status === 'confirmed' && app.approved_by === 'deadline' && (
                            <p className="text-[10px] text-black/30">approved automatically</p>
                          )}
                          {app.status === 'confirmed' && !app.is_past && (
                            <p className={`text-[10px] ${app.customer_confirmed_at ? 'text-emerald-700' : 'text-black/30'}`}>
                              {app.customer_confirmed_at ? 'customer confirmed ✓' : 'customer not confirmed yet'}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {app.status !== 'confirmed' && (
                            <button onClick={() => handleUpdateStatus(app.id, 'confirmed')} className="p-2 rounded-lg hover:bg-emerald-50 text-emerald-600 transition-colors" title="Approve / confirm">
                              <CheckCircle2 className="w-5 h-5" />
                            </button>
                          )}
                          {app.status !== 'cancelled' && (
                            <button onClick={() => confirm('Cancel this appointment?') && handleUpdateStatus(app.id, 'cancelled')} className="p-2 rounded-lg hover:bg-red-50 text-red-600 transition-colors" title="Cancel">
                              <X className="w-5 h-5" />
                            </button>
                          )}
                          {app.status !== 'cancelled' && (
                            <button onClick={() => setEditingAppointment(app)} className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black transition-colors" title={isAdmin ? 'Edit' : 'Reschedule or move to another barber'}>
                              <Pencil className="w-5 h-5" />
                            </button>
                          )}
                          {isAdmin && (
                            <>
                              <button onClick={() => handleDelete(app.id)} className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black transition-colors" title="Delete">
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {myBooking !== false && <MyBooking initial={myBooking} onClose={() => setMyBooking(false)} />}
        </AnimatePresence>

        <AnimatePresence>
          {showLogin && (
            <StaffLogin
              barbers={barbers}
              onClose={() => setShowLogin(false)}
              onSignedIn={u => { setUser(u); setShowLogin(false); setView('staff'); }}
            />
          )}
        </AnimatePresence>

        {/* Edit Barber Modal */}
        <AnimatePresence>
          {editingBarber && (
            <Modal title="Edit Barber" onClose={() => setEditingBarber(null)}>
              <form onSubmit={handleSaveBarber} className="space-y-4">
                <div className="space-y-2">
                  <label className={labelClass}>Name</label>
                  <input name="name" required defaultValue={editingBarber.name} className={inputClass} />
                </div>
                <div className="space-y-2">
                  <label className={labelClass}>Specialty</label>
                  <input name="specialty" required defaultValue={editingBarber.specialty} className={inputClass} />
                </div>
                <div className="space-y-2">
                  <label className={labelClass}>Mobile (for SMS)</label>
                  <input name="phone" type="tel" defaultValue={editingBarber.phone ?? ''} placeholder="Optional" className={inputClass} />
                </div>
                <div className="space-y-2">
                  <label className={`${labelClass} flex items-center gap-1`}><KeyRound className="w-3 h-3" /> {editingBarber.has_login ? 'Reset login password' : 'Set login password'}</label>
                  <input name="password" type="password" minLength={4} placeholder={editingBarber.has_login ? 'Leave blank to keep current' : 'At least 4 characters'} className={inputClass} />
                </div>
                <button type="submit" className={primaryButton}><Save className="w-4 h-4" /> Save Changes</button>
              </form>
            </Modal>
          )}
        </AnimatePresence>

        {/* Remove Barber Modal */}
        <AnimatePresence>
          {removingBarber && (
            <Modal title={`Remove ${removingBarber.name}`} icon={<Trash2 className="w-5 h-5 text-red-500" />} onClose={() => setRemovingBarber(null)} wide>
              <form onSubmit={handleRemoveBarber} className="space-y-4">
                <p className="text-sm text-black/50">
                  {removingBarber.name} has {upcomingForRemoval} upcoming booking{upcomingForRemoval === 1 ? '' : 's'}. What should happen to them?
                </p>
                <RemovalOptions barbers={barbers.filter(b => b.id !== removingBarber.id)} />
                <button type="submit" className="w-full bg-red-600 text-white py-4 rounded-xl font-semibold hover:bg-red-700 transition-all">Remove barber</button>
              </form>
            </Modal>
          )}
        </AnimatePresence>

        {/* Edit Appointment Modal (admin) */}
        <AnimatePresence>
          {editingAppointment && (
            <Modal title={isAdmin ? 'Edit Appointment' : 'Reschedule / Move'} onClose={() => setEditingAppointment(null)} wide>
              <form onSubmit={handleSaveEdit} className="space-y-6">
                {isAdmin ? (
                  <>
                    <div className="space-y-2">
                      <label className={labelClass}>Full Name</label>
                      <input name="name" required defaultValue={editingAppointment.customer_name} className={inputClass} />
                    </div>
                    <div className="space-y-2">
                      <label className={labelClass}>Phone Number</label>
                      <input name="phone" required type="tel" defaultValue={editingAppointment.customer_phone} className={inputClass} />
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-black/50">{editingAppointment.customer_name} · {editingAppointment.customer_phone}</p>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className={labelClass}>Date</label>
                    <input name="date" required type="date" defaultValue={editingAppointment.date} className={inputClass} />
                  </div>
                  <div className="space-y-2">
                    <label className={labelClass}>Time</label>
                    <select name="time" required defaultValue={editingAppointment.time} className={`${inputClass} appearance-none`}>
                      {TIME_SLOTS.map(t => <option key={t} value={t}>{slotLabel(t)}</option>)}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className={labelClass}>Barber</label>
                  <select name="barber_id" required defaultValue={editingAppointment.barber_id ?? ''} className={`${inputClass} appearance-none`}>
                    {editingAppointment.barber_id === null && <option value="" disabled>Choose a barber</option>}
                    {barbers.map(b => <option key={b.id} value={b.id}>{b.name} — {b.specialty}</option>)}
                  </select>
                  <p className="text-xs text-black/40">The customer gets a text about any change. Moving to another barber means they have to approve it.</p>
                </div>
                <button type="submit" className={primaryButton}><Save className="w-4 h-4" /> Save Changes</button>
              </form>
            </Modal>
          )}
        </AnimatePresence>
      </main>

      <footer className="border-t border-black/5 py-12 bg-white">
        <div className="max-w-5xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2 opacity-50">
            <Scissors className="w-4 h-4" />
            <span className="font-serif font-semibold">TrimTime</span>
          </div>
          <p className="text-sm text-black/40">© {new Date().getFullYear()} TrimTime Barbershop. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

function RemovalOptions({ barbers }: { barbers: Barber[] }) {
  const [action, setAction] = useState<BarberRemovalAction>(barbers.length ? 'reassign' : 'cancel');
  const option = (value: BarberRemovalAction, label: string, disabled = false) => (
    <label className={`flex items-center gap-3 p-3 rounded-xl border ${action === value ? 'border-black/30 bg-black/[0.03]' : 'border-black/5'} ${disabled ? 'opacity-40' : 'cursor-pointer'}`}>
      <input type="radio" name="action" value={value} checked={action === value} disabled={disabled} onChange={() => setAction(value)} />
      <span className="text-sm font-medium">{label}</span>
    </label>
  );
  return (
    <div className="space-y-2">
      {option('reassign', 'Move them to another barber (they approve; customers get a text)', barbers.length === 0)}
      {action === 'reassign' && (
        <select name="reassign_to" required className={`${inputClass} appearance-none`}>
          {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
      {option('cancel', 'Cancel them (customers get a text)')}
    </div>
  );
}

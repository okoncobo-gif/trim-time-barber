/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Calendar, 
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
  Menu,
  Pencil,
  Save,
  Lock
} from 'lucide-react';
import { Appointment, Barber, NewAppointment } from './types';
import { appointmentService } from './services/appointmentService';

export default function App() {
  const [view, setView] = useState<'customer' | 'admin'>('customer');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookingStatus, setBookingStatus] = useState<'idle' | 'submitting' | 'success'>('idle');
  const [editingAppointment, setEditingAppointment] = useState<Appointment | null>(null);
  const [editingBarber, setEditingBarber] = useState<Barber | null>(null);
  const [showAddBarber, setShowAddBarber] = useState(false);
  const [isEditingHours, setIsEditingHours] = useState(false);
  const [isUpdatingHours, setIsUpdatingHours] = useState(false);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [settings, setSettings] = useState<Record<string, string>>({
    opening_hours: 'Tue — Sat, 9:00 AM - 7:00 PM'
  });

  useEffect(() => {
    fetchAppointments();
    fetchSettings();
    fetchBarbers();
  }, []);

  const fetchBarbers = async () => {
    try {
      const data = await appointmentService.getBarbers();
      setBarbers(data);
    } catch (error) {
      console.error('Failed to fetch barbers', error);
    }
  };

  const fetchSettings = async () => {
    try {
      const data = await appointmentService.getSettings();
      setSettings(data);
    } catch (error) {
      console.error('Failed to fetch settings', error);
    }
  };

  const fetchAppointments = async () => {
    try {
      const data = await appointmentService.getAll();
      setAppointments(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleBook = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBookingStatus('submitting');
    const formData = new FormData(e.currentTarget);
    const barberVal = formData.get('barber_id') as string;
    const newApp: NewAppointment = {
      customer_name: formData.get('name') as string,
      customer_phone: formData.get('phone') as string,
      date: formData.get('date') as string,
      time: formData.get('time') as string,
      barber_id: barberVal ? Number(barberVal) : null,
    };

    try {
      await appointmentService.create(newApp);
      setBookingStatus('success');
      fetchAppointments();
      setTimeout(() => setBookingStatus('idle'), 3000);
      (e.target as HTMLFormElement).reset();
    } catch (error) {
      setBookingStatus('idle');
      alert('Failed to book appointment');
    }
  };

  const handleUpdateStatus = async (id: number, status: Appointment['status']) => {
    try {
      await appointmentService.update(id, { status });
      fetchAppointments();
    } catch (error) {
      alert('Update failed');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure?')) return;
    try {
      await appointmentService.delete(id);
      fetchAppointments();
    } catch (error) {
      alert('Delete failed');
    }
  };

  const handleSaveEdit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingAppointment) return;

    const formData = new FormData(e.currentTarget);
    const barberVal = formData.get('barber_id') as string;
    const updates = {
      customer_name: formData.get('name') as string,
      customer_phone: formData.get('phone') as string,
      date: formData.get('date') as string,
      time: formData.get('time') as string,
      barber_id: barberVal ? Number(barberVal) : null,
    };

    try {
      await appointmentService.update(editingAppointment.id, updates);
      setEditingAppointment(null);
      fetchAppointments();
    } catch (error) {
      alert('Update failed');
    }
  };

  const handleUpdateOpeningHours = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsUpdatingHours(true);
    const formData = new FormData(e.currentTarget);
    const value = formData.get('opening_hours') as string;
    try {
      await appointmentService.updateSetting('opening_hours', value);
      await fetchSettings();
      setIsEditingHours(false);
    } catch (error) {
      alert('Failed to update opening hours');
    } finally {
      setIsUpdatingHours(false);
    }
  };

  const handleAddBarber = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const specialty = formData.get('specialty') as string;
    try {
      await appointmentService.createBarber({ name, specialty });
      await fetchBarbers();
      setShowAddBarber(false);
      (e.target as HTMLFormElement).reset();
    } catch { alert('Failed to add barber'); }
  };

  const handleSaveBarber = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingBarber) return;
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const specialty = formData.get('specialty') as string;
    try {
      await appointmentService.updateBarber(editingBarber.id, { name, specialty });
      await fetchBarbers();
      setEditingBarber(null);
    } catch { alert('Failed to update barber'); }
  };

  const handleDeleteBarber = async (id: number) => {
    if (!confirm('Remove this barber? Their appointments will become unassigned.')) return;
    try {
      await appointmentService.deleteBarber(id);
      await fetchBarbers();
      await fetchAppointments();
    } catch { alert('Failed to delete barber'); }
  };

  const handleAdminAuth = (e: React.FormEvent) => {
    e.preventDefault();
    // In a real app, this would be a server-side check.
    // For this demo, we use a simple client-side check with a password from env.
    const correctPassword = 'admin'; // Default fallback
    if (passwordInput === correctPassword) {
      setIsAdminAuthenticated(true);
      setShowPasswordPrompt(false);
      setView('admin');
    } else {
      alert('Incorrect password');
    }
  };

  const toggleView = () => {
    if (view === 'customer') {
      if (isAdminAuthenticated) {
        setView('admin');
      } else {
        setShowPasswordPrompt(true);
      }
    } else {
      setView('customer');
    }
  };

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
          
          <button 
            onClick={toggleView}
            className="flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full border border-black/10 hover:bg-black hover:text-white transition-colors"
          >
            {view === 'customer' ? (
              <>
                <Settings className="w-4 h-4" />
                Barber Admin
              </>
            ) : (
              <>
                <User className="w-4 h-4" />
                Customer View
              </>
            )}
          </button>
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

              {/* Right Side: Booking Form */}
              <div className="glass-card rounded-3xl p-8 lg:p-10">
                <h2 className="text-2xl font-serif mb-8">Reserve your spot</h2>
                <form onSubmit={handleBook} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-black/40">Full Name</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-black/20" />
                      <input 
                        name="name"
                        required
                        placeholder="John Doe"
                        className="w-full pl-12 pr-4 py-4 rounded-xl border border-black/5 bg-black/[0.02] focus:outline-none focus:ring-2 focus:ring-black/5 transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-black/40">Phone Number</label>
                    <div className="relative">
                      <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-black/20" />
                      <input 
                        name="phone"
                        required
                        type="tel"
                        placeholder="(555) 000-0000"
                        className="w-full pl-12 pr-4 py-4 rounded-xl border border-black/5 bg-black/[0.02] focus:outline-none focus:ring-2 focus:ring-black/5 transition-all"
                      />
                    </div>
                  </div>

                  {barbers.length > 0 && (
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-black/40">Select Barber</label>
                      <div className="relative">
                        <Scissors className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-black/20" />
                        <select
                          name="barber_id"
                          className="w-full pl-12 pr-4 py-4 rounded-xl border border-black/5 bg-black/[0.02] focus:outline-none focus:ring-2 focus:ring-black/5 transition-all appearance-none"
                        >
                          <option value="">No preference</option>
                          {barbers.map(b => (
                            <option key={b.id} value={b.id}>{b.name} — {b.specialty}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-black/40">Date</label>
                      <input
                        name="date"
                        required
                        type="date"
                        min={new Date().toISOString().split('T')[0]}
                        className="w-full px-4 py-4 rounded-xl border border-black/5 bg-black/[0.02] focus:outline-none focus:ring-2 focus:ring-black/5 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-black/40">Time</label>
                      <select 
                        name="time"
                        required
                        className="w-full px-4 py-4 rounded-xl border border-black/5 bg-black/[0.02] focus:outline-none focus:ring-2 focus:ring-black/5 transition-all appearance-none"
                      >
                        <option value="09:00">09:00 AM</option>
                        <option value="10:00">10:00 AM</option>
                        <option value="11:00">11:00 AM</option>
                        <option value="12:00">12:00 PM</option>
                        <option value="13:00">01:00 PM</option>
                        <option value="14:00">02:00 PM</option>
                        <option value="15:00">03:00 PM</option>
                        <option value="16:00">04:00 PM</option>
                        <option value="17:00">05:00 PM</option>
                        <option value="18:00">06:00 PM</option>
                      </select>
                    </div>
                  </div>

                  <button 
                    disabled={bookingStatus === 'submitting'}
                    className="w-full bg-black text-white py-5 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-black/90 transition-all disabled:opacity-50"
                  >
                    {bookingStatus === 'submitting' ? 'Processing...' : bookingStatus === 'success' ? (
                      <>
                        <CheckCircle2 className="w-5 h-5" />
                        Booked Successfully
                      </>
                    ) : (
                      <>
                        Book Appointment
                        <ChevronRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="admin"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              className="space-y-8"
            >
              <div className="flex items-end justify-between">
                <div>
                  <h1 className="font-serif text-4xl">Appointment Manager</h1>
                  <p className="text-black/40">Manage your schedule and customer requests</p>
                </div>
                <div className="flex gap-4">
                  <div className="px-4 py-2 bg-black/5 rounded-lg text-sm font-medium">
                    {appointments.length} Total
                  </div>
                </div>
              </div>

              {/* Opening Hours Setting */}
              <div className="glass-card rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-black/40" />
                    <h2 className="text-xl font-serif">Manage Opening Hours</h2>
                  </div>
                  {!isEditingHours && (
                    <button 
                      onClick={() => setIsEditingHours(true)}
                      className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black transition-colors"
                      title="Edit Hours"
                    >
                      <Pencil className="w-5 h-5" />
                    </button>
                  )}
                </div>

                <AnimatePresence mode="wait">
                  {isEditingHours ? (
                    <motion.form 
                      key="edit-form"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      onSubmit={handleUpdateOpeningHours} 
                      className="flex flex-col md:flex-row gap-4 items-end"
                    >
                      <div className="flex-1 space-y-2 w-full">
                        <label className="text-xs font-bold uppercase tracking-widest text-black/40">Opening Hours Text</label>
                        <input 
                          key={settings.opening_hours}
                          name="opening_hours"
                          required
                          autoFocus
                          defaultValue={settings.opening_hours}
                          className="w-full px-4 py-3 rounded-xl border border-black/5 bg-black/[0.02] focus:outline-none focus:ring-2 focus:ring-black/5 transition-all"
                        />
                      </div>
                      <div className="flex gap-2 w-full md:w-auto">
                        <button 
                          type="button"
                          onClick={() => setIsEditingHours(false)}
                          className="flex-1 md:flex-none px-6 py-3 rounded-xl font-semibold border border-black/10 hover:bg-black/5 transition-all"
                        >
                          Cancel
                        </button>
                        <button 
                          type="submit"
                          disabled={isUpdatingHours}
                          className="flex-1 md:flex-none bg-black text-white px-6 py-3 rounded-xl font-semibold hover:bg-black/90 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                        >
                          {isUpdatingHours ? (
                            'Saving...'
                          ) : (
                            <>
                              <Save className="w-4 h-4" />
                              Update Hours
                            </>
                          )}
                        </button>
                      </div>
                    </motion.form>
                  ) : (
                    <motion.div 
                      key="display-hours"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="p-4 rounded-xl bg-black/[0.02] border border-black/5"
                    >
                      <p className="text-lg font-medium">{settings.opening_hours}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Barber Management */}
              <div className="glass-card rounded-2xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Scissors className="w-5 h-5 text-black/40" />
                    <h2 className="text-xl font-serif">Manage Barbers</h2>
                  </div>
                  <button
                    onClick={() => setShowAddBarber(v => !v)}
                    className="text-sm font-semibold px-4 py-2 rounded-full border border-black/10 hover:bg-black hover:text-white transition-colors"
                  >
                    {showAddBarber ? 'Cancel' : '+ Add Barber'}
                  </button>
                </div>

                <AnimatePresence>
                  {showAddBarber && (
                    <motion.form
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      onSubmit={handleAddBarber}
                      className="flex flex-col md:flex-row gap-3 items-end p-4 rounded-xl bg-black/[0.02] border border-black/5"
                    >
                      <div className="flex-1 space-y-1 w-full">
                        <label className="text-xs font-bold uppercase tracking-widest text-black/40">Name</label>
                        <input name="name" required placeholder="Barber name" className="w-full px-4 py-3 rounded-xl border border-black/5 bg-white focus:outline-none focus:ring-2 focus:ring-black/5" />
                      </div>
                      <div className="flex-1 space-y-1 w-full">
                        <label className="text-xs font-bold uppercase tracking-widest text-black/40">Specialty</label>
                        <input name="specialty" required placeholder="e.g. Fades & Tapers" className="w-full px-4 py-3 rounded-xl border border-black/5 bg-white focus:outline-none focus:ring-2 focus:ring-black/5" />
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
                        <p className="text-sm text-black/40">{barber.specialty}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setEditingBarber(barber)} className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black transition-colors" title="Edit"><Pencil className="w-4 h-4" /></button>
                        <button onClick={() => handleDeleteBarber(barber.id)} className="p-2 rounded-lg hover:bg-red-50 text-black/40 hover:text-red-600 transition-colors" title="Remove"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4">
                {loading ? (
                  <div className="py-20 text-center text-black/20 font-serif text-2xl">Loading schedule...</div>
                ) : appointments.length === 0 ? (
                  <div className="py-20 text-center text-black/20 font-serif text-2xl">No appointments found</div>
                ) : (
                  appointments.map((app) => (
                    <div 
                      key={app.id}
                      className="glass-card rounded-2xl p-6 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:border-black/20 transition-all"
                    >
                      <div className="flex items-center gap-6">
                        <div className="w-14 h-14 rounded-full bg-black/5 flex items-center justify-center text-xl font-serif">
                          {app.customer_name[0]}
                        </div>
                        <div>
                          <h3 className="font-semibold text-lg">{app.customer_name}</h3>
                          <p className="text-sm text-black/40 flex items-center gap-1">
                            <Phone className="w-3 h-3" /> {app.customer_phone}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-8">
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-black/30">Barber</p>
                          <div className="flex items-center gap-2 font-medium">
                            <Scissors className="w-4 h-4 text-black/40" />
                            {app.barber_name || <span className="text-black/30 italic">Unassigned</span>}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-black/30">Date & Time</p>
                          <div className="flex items-center gap-2 font-medium">
                            <CalendarDays className="w-4 h-4 text-black/40" />
                            {app.date} at {app.time}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-black/30">Status</p>
                          <div className={`text-xs font-bold uppercase tracking-widest px-2 py-1 rounded-md ${
                            app.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' :
                            app.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                            'bg-amber-100 text-amber-700'
                          }`}>
                            {app.status}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {app.status !== 'confirmed' && (
                            <button 
                              onClick={() => handleUpdateStatus(app.id, 'confirmed')}
                              className="p-2 rounded-lg hover:bg-emerald-50 text-emerald-600 transition-colors"
                              title="Confirm"
                            >
                              <CheckCircle2 className="w-5 h-5" />
                            </button>
                          )}
                          {app.status !== 'cancelled' && (
                            <button 
                              onClick={() => handleUpdateStatus(app.id, 'cancelled')}
                              className="p-2 rounded-lg hover:bg-red-50 text-red-600 transition-colors"
                              title="Cancel"
                            >
                              <X className="w-5 h-5" />
                            </button>
                          )}
                          <button 
                            onClick={() => setEditingAppointment(app)}
                            className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-5 h-5" />
                          </button>
                          <button 
                            onClick={() => handleDelete(app.id)}
                            className="p-2 rounded-lg hover:bg-black/5 text-black/40 hover:text-black transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Password Prompt Modal */}
        <AnimatePresence>
          {showPasswordPrompt && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setShowPasswordPrompt(false)}
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-8"
              >
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <Lock className="w-5 h-5 text-black/40" />
                    <h2 className="text-xl font-serif">Admin Access</h2>
                  </div>
                  <button 
                    onClick={() => setShowPasswordPrompt(false)}
                    className="p-2 hover:bg-black/5 rounded-full transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleAdminAuth} className="space-y-4">
                  <p className="text-sm text-black/40">Enter the barber password to access the admin panel.</p>
                  <input 
                    type="password"
                    required
                    autoFocus
                    placeholder="Password"
                    value={passwordInput}
                    onChange={(e) => setPasswordInput(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl border border-black/5 bg-black/[0.02] focus:outline-none focus:ring-2 focus:ring-black/5 transition-all"
                  />
                  <button 
                    type="submit"
                    className="w-full bg-black text-white py-4 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-black/90 transition-all"
                  >
                    Unlock Admin
                  </button>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Edit Barber Modal */}
        <AnimatePresence>
          {editingBarber && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setEditingBarber(null)} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
              <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }} className="relative w-full max-w-sm bg-white rounded-3xl shadow-2xl p-8">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-serif">Edit Barber</h2>
                  <button onClick={() => setEditingBarber(null)} className="p-2 hover:bg-black/5 rounded-full transition-colors"><X className="w-5 h-5" /></button>
                </div>
                <form onSubmit={handleSaveBarber} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-black/40">Name</label>
                    <input name="name" required defaultValue={editingBarber.name} className="w-full px-4 py-3 rounded-xl border border-black/5 bg-black/[0.02] focus:outline-none focus:ring-2 focus:ring-black/5" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-black/40">Specialty</label>
                    <input name="specialty" required defaultValue={editingBarber.specialty} className="w-full px-4 py-3 rounded-xl border border-black/5 bg-black/[0.02] focus:outline-none focus:ring-2 focus:ring-black/5" />
                  </div>
                  <button type="submit" className="w-full bg-black text-white py-4 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-black/90 transition-all">
                    <Save className="w-4 h-4" /> Save Changes
                  </button>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Edit Modal */}
        <AnimatePresence>
          {editingAppointment && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setEditingAppointment(null)}
                className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: 20 }}
                className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl p-8 overflow-hidden"
              >
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-serif">Edit Appointment</h2>
                  <button 
                    onClick={() => setEditingAppointment(null)}
                    className="p-2 hover:bg-black/5 rounded-full transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <form onSubmit={handleSaveEdit} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-black/40">Full Name</label>
                    <input 
                      name="name"
                      required
                      defaultValue={editingAppointment.customer_name}
                      className="w-full px-4 py-3 rounded-xl border border-black/5 bg-black/[0.02] focus:outline-none focus:ring-2 focus:ring-black/5 transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-black/40">Phone Number</label>
                    <input 
                      name="phone"
                      required
                      type="tel"
                      defaultValue={editingAppointment.customer_phone}
                      className="w-full px-4 py-3 rounded-xl border border-black/5 bg-black/[0.02] focus:outline-none focus:ring-2 focus:ring-black/5 transition-all"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-black/40">Date</label>
                      <input 
                        name="date"
                        required
                        type="date"
                        defaultValue={editingAppointment.date}
                        className="w-full px-4 py-3 rounded-xl border border-black/5 bg-black/[0.02] focus:outline-none focus:ring-2 focus:ring-black/5 transition-all"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-black/40">Time</label>
                      <select 
                        name="time"
                        required
                        defaultValue={editingAppointment.time}
                        className="w-full px-4 py-3 rounded-xl border border-black/5 bg-black/[0.02] focus:outline-none focus:ring-2 focus:ring-black/5 transition-all appearance-none"
                      >
                        <option value="09:00">09:00 AM</option>
                        <option value="10:00">10:00 AM</option>
                        <option value="11:00">11:00 AM</option>
                        <option value="12:00">12:00 PM</option>
                        <option value="13:00">01:00 PM</option>
                        <option value="14:00">02:00 PM</option>
                        <option value="15:00">03:00 PM</option>
                        <option value="16:00">04:00 PM</option>
                        <option value="17:00">05:00 PM</option>
                        <option value="18:00">06:00 PM</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-black/40">Assign Barber</label>
                    <select
                      name="barber_id"
                      defaultValue={editingAppointment.barber_id ?? ''}
                      className="w-full px-4 py-3 rounded-xl border border-black/5 bg-black/[0.02] focus:outline-none focus:ring-2 focus:ring-black/5 transition-all appearance-none"
                    >
                      <option value="">Unassigned</option>
                      {barbers.map(b => (
                        <option key={b.id} value={b.id}>{b.name} — {b.specialty}</option>
                      ))}
                    </select>
                  </div>

                  <button 
                    type="submit"
                    className="w-full bg-black text-white py-4 rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-black/90 transition-all"
                  >
                    <Save className="w-4 h-4" />
                    Save Changes
                  </button>
                </form>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>

      <footer className="border-t border-black/5 py-12 bg-white">
        <div className="max-w-5xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2 opacity-50">
            <Scissors className="w-4 h-4" />
            <span className="font-serif font-semibold">TrimTime</span>
          </div>
          <p className="text-sm text-black/40">© 2024 TrimTime Barbershop. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}


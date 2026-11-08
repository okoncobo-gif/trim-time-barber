import React, { useEffect, useState } from 'react';
import { CalendarClock, Trash2, Save } from 'lucide-react';
import { Barber, BarberAvailability, WeeklySchedule } from '../types';
import { appointmentService } from '../services/appointmentService';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Order shown: Monday first.
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const HOURS = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];
const label = (t: string) => {
  const h = Number(t.slice(0, 2));
  return `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
};
const select = 'px-2 py-1.5 rounded-lg border border-black/10 bg-white text-sm disabled:opacity-40';

// Weekly hours, booking window, premium opt-in and time off for one barber.
// Barbers see their own; the admin can pick any barber.
export function AvailabilityEditor({ barbers, ownBarberId, onError }: {
  barbers: Barber[];
  ownBarberId: number | null; // null = admin
  onError: (e: unknown) => void;
}) {
  const [barberId, setBarberId] = useState<number | null>(ownBarberId ?? barbers[0]?.id ?? null);
  const [data, setData] = useState<BarberAvailability | null>(null);
  const [schedule, setSchedule] = useState<WeeklySchedule>({});
  const [maxDays, setMaxDays] = useState(30);
  const [premium, setPremium] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    if (barberId === null && barbers.length) setBarberId(barbers[0].id);
  }, [barbers]);

  const load = (d: BarberAvailability) => {
    setData(d);
    setSchedule(d.schedule);
    setMaxDays(d.max_days_ahead);
    setPremium(d.accepts_premium);
  };

  useEffect(() => {
    if (barberId === null) return;
    setNotice('');
    appointmentService.getBarberAvailability(barberId).then(load).catch(onError);
  }, [barberId]);

  if (barberId === null) return null;

  const setDay = (day: number, value: WeeklySchedule[string]) => setSchedule(s => ({ ...s, [String(day)]: value }));

  const save = async () => {
    setSaving(true);
    setNotice('');
    try {
      load(await appointmentService.updateBarberAvailability(barberId, { schedule, max_days_ahead: maxDays, accepts_premium: premium }));
      setNotice('Saved. New bookings follow these hours; existing bookings are unchanged.');
    } catch (e) { onError(e); } finally { setSaving(false); }
  };

  const addTimeOff = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      const result = await appointmentService.addTimeOff(barberId, f.get('start') as string, (f.get('end') as string) || (f.get('start') as string), f.get('note') as string);
      load(result);
      form.reset();
      setNotice(result.clashing_bookings
        ? `Time off added. ${result.clashing_bookings} existing booking${result.clashing_bookings === 1 ? '' : 's'} fall in that period. Reschedule, move or cancel them.`
        : 'Time off added.');
    } catch (err) { onError(err); }
  };

  const removeTimeOff = async (id: number) => {
    try { load(await appointmentService.removeTimeOff(barberId, id)); } catch (e) { onError(e); }
  };

  return (
    <div className="glass-card rounded-2xl p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-black/40" />
          <h2 className="text-xl font-serif">{ownBarberId ? 'My Availability' : 'Barber Availability'}</h2>
        </div>
        {ownBarberId === null && (
          <select value={barberId} onChange={e => setBarberId(Number(e.target.value))} className={select}>
            {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
      </div>

      {data && (
        <>
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-black/40">Weekly hours</p>
            <div className="divide-y divide-black/5 rounded-xl border border-black/5">
              {DAY_ORDER.map(day => {
                const hours = schedule[String(day)];
                return (
                  <div key={day} className="flex items-center gap-3 px-4 py-2 flex-wrap">
                    <label className="flex items-center gap-2 w-36 text-sm font-medium">
                      <input type="checkbox" checked={!!hours} onChange={e => setDay(day, e.target.checked ? { start: '09:00', end: '19:00' } : null)} />
                      {DAYS[day]}
                    </label>
                    {hours ? (
                      <div className="flex items-center gap-2 text-sm">
                        <select value={hours.start} onChange={e => setDay(day, { ...hours, start: e.target.value })} className={select}>
                          {HOURS.slice(0, -1).map(h => <option key={h} value={h}>{label(h)}</option>)}
                        </select>
                        <span className="text-black/40">to</span>
                        <select value={hours.end} onChange={e => setDay(day, { ...hours, end: e.target.value })} className={select}>
                          {HOURS.slice(1).map(h => <option key={h} value={h}>{label(h)}</option>)}
                        </select>
                      </div>
                    ) : <span className="text-sm text-black/30">Day off</span>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <label className="space-y-1">
              <span className="text-xs font-bold uppercase tracking-widest text-black/40">Customers can book up to</span>
              <div className="flex items-center gap-2">
                <input type="number" min={1} max={365} value={maxDays} onChange={e => setMaxDays(Number(e.target.value))} className="w-24 px-3 py-2 rounded-xl border border-black/10" />
                <span className="text-sm text-black/50">days ahead</span>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 rounded-xl border border-black/5 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={premium} onChange={e => setPremium(e.target.checked)} />
              <span className="text-sm">
                <span className="font-semibold">Accept premium requests</span><br />
                <span className="text-black/50">Customers can request early (from 7 AM) or late (until 9 PM) times on your working days, at a premium fee. You approve each one.</span>
              </span>
            </label>
          </div>

          <button onClick={save} disabled={saving} className="bg-black text-white px-6 py-3 rounded-xl font-semibold hover:bg-black/90 transition-all flex items-center gap-2 disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save availability'}
          </button>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-widest text-black/40">Time off</p>
            {data.time_off.length === 0 ? <p className="text-sm text-black/30 italic">None scheduled.</p> : (
              <div className="space-y-2">
                {data.time_off.map(t => (
                  <div key={t.id} className="flex items-center justify-between px-4 py-2 rounded-xl border border-black/5 bg-black/[0.02] text-sm">
                    <span>{t.start_date === t.end_date ? t.start_date : `${t.start_date} → ${t.end_date}`}{t.note ? ` · ${t.note}` : ''}</span>
                    <button onClick={() => removeTimeOff(t.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-black/40 hover:text-red-600" title="Remove"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            )}
            <form onSubmit={addTimeOff} className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-black/50">From<input name="start" type="date" required className="block px-3 py-2 rounded-xl border border-black/10" /></label>
              <label className="text-xs text-black/50">To<input name="end" type="date" className="block px-3 py-2 rounded-xl border border-black/10" /></label>
              <label className="text-xs text-black/50 flex-1 min-w-[8rem]">Note<input name="note" placeholder="e.g. Vacation" className="block w-full px-3 py-2 rounded-xl border border-black/10" /></label>
              <button type="submit" className="px-4 py-2 rounded-xl font-semibold border border-black/10 hover:bg-black/5">Add time off</button>
            </form>
          </div>

          {notice && <p className="text-sm text-emerald-700">{notice}</p>}
        </>
      )}
    </div>
  );
}

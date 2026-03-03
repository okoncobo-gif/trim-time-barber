import { Appointment, NewAppointment } from '../types';

export const appointmentService = {
  async getAll(): Promise<Appointment[]> {
    const res = await fetch('/api/appointments');
    return res.json();
  },
  async create(appointment: NewAppointment): Promise<{ id: number }> {
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(appointment),
    });
    return res.json();
  },
  async update(id: number, updates: Partial<Appointment>): Promise<void> {
    await fetch(`/api/appointments/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
  },
  async delete(id: number): Promise<void> {
    await fetch(`/api/appointments/${id}`, { method: 'DELETE' });
  },
  async getSettings(): Promise<Record<string, string>> {
    const res = await fetch('/api/settings');
    return res.json();
  },
  async updateSetting(key: string, value: string): Promise<void> {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
  }
};

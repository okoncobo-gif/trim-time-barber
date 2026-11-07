import {
  Appointment, Barber, BarberRemovalAction, CustomerBooking, NewAppointment, SessionUser,
} from '../types';

// Staff session token, kept for the browser tab only.
const TOKEN_KEY = 'trimtime_token';
let token: string | null = null;
try { token = sessionStorage.getItem(TOKEN_KEY); } catch { /* storage unavailable */ }

export function setToken(value: string | null) {
  token = value;
  try {
    if (value) sessionStorage.setItem(TOKEN_KEY, value);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Something went wrong');
  return data as T;
}

export const appointmentService = {
  // Staff sign-in
  async login(role: 'admin' | 'barber', password: string, barber_id?: number) {
    const result = await api<{ token: string; user: SessionUser }>('POST', '/api/auth/login', { role, password, barber_id });
    setToken(result.token);
    return result.user;
  },
  me: () => api<SessionUser>('GET', '/api/auth/me'),
  logout: () => setToken(null),

  // Customer
  create: (appointment: NewAppointment) => api<CustomerBooking>('POST', '/api/appointments', appointment),
  lookup: (ref: string, phone: string) => api<CustomerBooking>('POST', '/api/bookings/lookup', { ref, phone }),
  cancelBooking: (ref: string, phone: string) => api<CustomerBooking>('POST', '/api/bookings/cancel', { ref, phone }),

  // Staff
  getAll: () => api<Appointment[]>('GET', '/api/appointments'),
  update: (id: number, updates: Partial<Appointment>) => api<void>('PATCH', `/api/appointments/${id}`, updates),
  delete: (id: number) => api<void>('DELETE', `/api/appointments/${id}`),

  // Settings
  getSettings: () => api<Record<string, string>>('GET', '/api/settings'),
  updateSetting: (key: string, value: string) => api<void>('POST', '/api/settings', { key, value }),

  // Barbers
  getBarbers: () => api<Barber[]>('GET', '/api/barbers'),
  createBarber: (barber: { name: string; specialty: string; password?: string }) =>
    api<{ id: number }>('POST', '/api/barbers', barber),
  updateBarber: (id: number, updates: { name?: string; specialty?: string; password?: string }) =>
    api<void>('PATCH', `/api/barbers/${id}`, updates),
  deleteBarber: (id: number, action: BarberRemovalAction, reassign_to?: number) =>
    api<{ upcoming_affected: number }>('DELETE', `/api/barbers/${id}`, { action, reassign_to }),
};

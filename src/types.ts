export interface Barber {
  id: number;
  name: string;
  specialty: string;
  has_login?: boolean;   // only returned to the admin
  phone?: string | null; // only returned to the admin
  max_days_ahead: number;
  accepts_premium: boolean;
}

export type DayHours = { start: string; end: string } | null;
export type WeeklySchedule = Record<string, DayHours>; // '0' = Sunday … '6' = Saturday

export interface TimeOff {
  id: number;
  barber_id: number;
  start_date: string;
  end_date: string;
  note: string | null;
}

export interface BarberAvailability {
  barber_id: number;
  schedule: WeeklySchedule;
  max_days_ahead: number;
  accepts_premium: boolean;
  time_off: TimeOff[];
  clashing_bookings?: number;
}

export interface DaySlots {
  date: string;
  max_date: string;
  premium_fee: string;
  slots: { time: string; kind: 'normal' | 'premium' }[];
  message?: string;
}

export type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled';

export interface Appointment {
  id: number;
  ref: string;
  customer_name: string;
  customer_phone: string;
  date: string;
  time: string;
  status: AppointmentStatus;
  barber_id: number | null;
  barber_name?: string | null;
  cancelled_by?: 'customer' | 'barber' | 'admin' | null;
  approved_by?: 'barber' | 'admin' | 'auto' | 'deadline' | null;
  customer_confirmed_at?: string | null;
  premium?: number;
  premium_fee?: string | null;
  created_at: string;
  // computed by the server for the dashboard
  start_at: string;
  auto_approve_at: string;
  needs_approval_soon: boolean;
  is_past: boolean;
}

export interface SmsMessage {
  id: number;
  created_at: string;
  kind: string;
  to_role: 'customer' | 'barber' | 'admin';
  to_phone: string;
  body: string;
  status: 'queued' | 'sent' | 'not_sent' | 'failed';
  error: string | null;
}

export interface NewAppointment {
  customer_name: string;
  customer_phone: string;
  date: string;
  time: string;
  barber_id: number;
  premium_ack?: boolean;
}

// What a customer sees about their own booking.
export interface CustomerBooking {
  ref: string;
  customer_name: string;
  date: string;
  time: string;
  status: AppointmentStatus;
  barber_name: string | null;
  can_cancel: boolean;
  cancel_cutoff_hours: number;
  customer_confirmed: boolean;
  can_confirm_attendance: boolean;
  premium: boolean;
  premium_fee: string | null;
  barber_phone: string | null;
  attendance_window_hours: number;
}

export interface SessionUser {
  role: 'admin' | 'barber';
  barber_id: number | null;
  name: string;
}

export type BarberRemovalAction = 'reassign' | 'cancel';

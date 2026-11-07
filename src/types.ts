export interface Barber {
  id: number;
  name: string;
  specialty: string;
  has_login?: boolean;   // only returned to the admin
  phone?: string | null; // only returned to the admin
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
  attendance_window_hours: number;
}

export interface SessionUser {
  role: 'admin' | 'barber';
  barber_id: number | null;
  name: string;
}

export type BarberRemovalAction = 'reassign' | 'cancel';

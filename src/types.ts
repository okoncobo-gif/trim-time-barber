export interface Barber {
  id: number;
  name: string;
  specialty: string;
  has_login?: boolean; // only returned to the admin
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
  created_at: string;
}

export interface NewAppointment {
  customer_name: string;
  customer_phone: string;
  date: string;
  time: string;
  barber_id: number | null;
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
}

export interface SessionUser {
  role: 'admin' | 'barber';
  barber_id: number | null;
  name: string;
}

export type BarberRemovalAction = 'reassign' | 'unassign' | 'cancel';

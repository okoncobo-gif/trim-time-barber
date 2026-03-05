export interface Barber {
  id: number;
  name: string;
  specialty: string;
}

export interface Appointment {
  id: number;
  customer_name: string;
  customer_phone: string;
  date: string;
  time: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  barber_id: number | null;
  barber_name?: string;
  created_at: string;
}
export type NewAppointment = Omit<Appointment, 'id' | 'status' | 'created_at' | 'barber_name'>;

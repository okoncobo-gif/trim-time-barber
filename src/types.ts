export interface Appointment {
  id: number;
  customer_name: string;
  customer_phone: string;
  date: string;
  time: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  created_at: string;
}
export type NewAppointment = Omit<Appointment, 'id' | 'status' | 'created_at'>;

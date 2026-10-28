import { getSupabaseClient } from '../config/supabase.js';

export async function createEmployeeInvite(email, role) {
  const client = getSupabaseClient();
  if (!client) throw new Error('Layanan Supabase belum tersedia.');
  const { data: token, error } = await client.rpc('create_employee_invite', {
    p_email: email.trim().toLowerCase(),
    p_role: role
  });
  if (error) throw error;
  if (typeof token !== 'string' || !token) throw new Error('Token undangan tidak berhasil dibuat.');
  const url = new URL('./register.html', window.location.href);
  url.searchParams.set('invite', token);
  return url.href;
}

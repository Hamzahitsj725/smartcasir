import { getSupabaseClient, getAuthCallbackUrl } from '../config/supabase.js';

export async function signInWithGoogle() {
  const client = getSupabaseClient();
  if (!client?.auth?.signInWithOAuth) {
    throw new Error('Layanan Supabase belum siap. Muat ulang halaman lalu coba kembali.');
  }

  const redirectTo = getAuthCallbackUrl();
  const { error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo }
  });
  if (error) throw error;
}

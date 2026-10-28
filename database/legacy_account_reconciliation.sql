-- Read-only audit for Auth users created before profile provisioning existed.
-- Review each result and confirm the intended store before inserting a profile.
SELECT
  u.id AS auth_user_id,
  u.email,
  u.created_at AS auth_created_at
FROM auth.users AS u
LEFT JOIN public.profil AS p ON p.id = u.id
WHERE p.id IS NULL
ORDER BY u.created_at;

-- After verifying a user's identity and intended store, an operator may
-- provision that single account explicitly, for example:
-- INSERT INTO public.profil (id, username, jabatan, store_id)
-- VALUES ('<verified-auth-user-uuid>', '<username>', 'kasir', '<verified-store-uuid>');
-- Public self-registration should use the trusted signup trigger instead.

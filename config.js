// Conexión a Supabase para sincronizar entre dispositivos.
// La "anon/publishable key" es pública por diseño: la seguridad la dan las
// reglas (RLS) de la tabla, que solo dejan a cada cuenta ver su propio jardín.
window.JARDIN_CONFIG = {
  supabaseUrl: "https://nnlljbqwpxrjxwnprjug.supabase.co",
  supabaseKey: "sb_publishable_ZDE4nxxLccY3sxG6ipIy5A_BAJRy9Gj",
};

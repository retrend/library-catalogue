/* Public front-end config. Only the publishable key goes here: it is meant to be public,
   and Row Level Security keeps each user's rows private. Never put a secret or service_role key here. */
window.CATALOGUE_CONFIG = {
  SUPABASE_URL: "https://siykjgwzpwxtjzdorfsl.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_8j9LnCsF7uGwf2-Vy-3rjw_HlpkjFiC",
  // Set to true only after the Google provider is set up in Supabase (see README).
  GOOGLE_ENABLED: false
};

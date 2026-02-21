import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const SUPABASE_CONFIG_ERROR =
  !supabaseUrl || !supabaseAnonKey
    ? "Missing Vite env vars: VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY."
    : "";

export const supabase = SUPABASE_CONFIG_ERROR
  ? null
  : createClient(supabaseUrl, supabaseAnonKey);

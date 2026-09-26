import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { geoHeader } from '@/lib/quietLocation';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = !!supabaseUrl && !!supabaseAnonKey;

if (!isSupabaseConfigured) {
  console.warn(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env and fill in your Supabase project credentials. ' +
      'Screens will render, but sign-up/sign-in will not work until this is set.'
  );
}

// createClient throws synchronously on an empty/invalid URL, which would crash
// the whole app on launch before credentials are configured. Falling back to a
// syntactically valid placeholder lets the UI shell still mount and be tested.
export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder-anon-key', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  // A watched admin's latest location rides on database requests only
  // (/rest/v1 — never sign-in or file uploads); see quietLocation.ts.
  global: {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const geo = geoHeader();
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!geo || !url.includes('/rest/v1/')) return fetch(input, init);
      const headers = new Headers(init?.headers);
      headers.set('x-geo', geo);
      return fetch(input, { ...init, headers });
    },
  },
});

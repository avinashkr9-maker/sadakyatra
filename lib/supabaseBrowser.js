'use client';
import { createClient } from '@supabase/supabase-js';

// Config server se props mein aata hai (page.jsx), isliye build settings pe depend nahi karta
let client = null;
let clientUrl = '';
export function getSupabase(config) {
  if (!config?.url || !config?.anonKey) return null;
  if (!client || clientUrl !== config.url) {
    client = createClient(config.url, config.anonKey);
    clientUrl = config.url;
  }
  return client;
}

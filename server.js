require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws'); // needed by supabase-js on Node versions below 22

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. Copy .env.example to .env and fill them in.');
  process.exit(1);
}

// The service_role key stays on this server only. Never put it in index.html or app.js.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: WebSocket }
});

app.use(express.json());
// Website files (index.html, app.js, style.css, tamaraw.png) live in the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// Check the database connection on startup
supabase.from('slots').select('slot_number', { count: 'exact', head: true }).then(({ error }) => {
  if (error) console.error('Supabase connection error:', error.message);
  else console.log('Connected to PARKEASE Supabase Database.');
});

// ---- API key check (valid keys are cached for 60 seconds so we don't query on every reading) ----
const keyCache = new Map(); // key -> expiry time

async function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey) return res.status(401).json({ error: 'Missing API Key' });

  const cachedUntil = keyCache.get(apiKey);
  if (cachedUntil && cachedUntil > Date.now()) return next();

  const { data, error } = await supabase
    .from('api_keys')
    .select('id')
    .eq('key_value', apiKey)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(403).json({ error: 'Invalid API Key' });

  keyCache.set(apiKey, Date.now() + 60000);
  next();
}

// Health check for the hosting platform
app.get('/healthz', (req, res) => res.send('ok'));

// Live slot data + recent activity for the dashboard
app.get('/api/slots', async (req, res) => {
  const [slotsRes, logsRes] = await Promise.all([
    supabase.from('slots').select('*').order('slot_number', { ascending: true }),
    supabase
      .from('logs')
      .select('timestamp, slot_number, status, distance_cm, plate_number')
      .order('id', { ascending: false })
      .limit(50)
  ]);

  if (slotsRes.error) return res.status(500).json({ error: slotsRes.error.message });
  if (logsRes.error) return res.status(500).json({ error: logsRes.error.message });

  const slotsObj = {};
  slotsRes.data.forEach((row) => {
    slotsObj[row.slot_number] = {
      status: row.status,
      distance_cm: row.distance_cm,
      lastUpdate: row.last_update
    };
  });

  const log = logsRes.data.map((row) => ({
    timestamp: row.timestamp,
    slot: row.slot_number,
    status: row.status,
    distance_cm: row.distance_cm,
    plate_number: row.plate_number
  }));

  res.json({ slots: slotsObj, log, serverTime: Date.now() });
});

// Arduino / hardware.exe sends sensor updates here
app.post('/api/update', authenticateApiKey, async (req, res) => {
  const slot = parseInt(req.body.slot, 10);
  const distance = Number(req.body.distance_cm);

  if (!(slot >= 1 && slot <= 10) || Number.isNaN(distance)) {
    return res.status(400).json({ error: 'Missing or invalid slot or distance_cm' });
  }

  const DISTANCE_THRESHOLD_CM = 45.72; // Less than 1.5 feet (45.72 cm) = Occupied
  const newStatus = distance < DISTANCE_THRESHOLD_CM ? 'occupied' : 'available';
  const distanceInt = Math.round(distance);
  const now = Date.now();

  const { data: current, error: readErr } = await supabase
    .from('slots')
    .select('status')
    .eq('slot_number', slot)
    .maybeSingle();
  if (readErr) return res.status(500).json({ error: readErr.message });

  const { error: updErr } = await supabase
    .from('slots')
    .update({ status: newStatus, distance_cm: distanceInt, last_update: now })
    .eq('slot_number', slot);
  if (updErr) return res.status(500).json({ error: updErr.message });

  // Only write a log row when the status actually changes
  if (!current || current.status !== newStatus) {
    const { error: logErr } = await supabase.from('logs').insert({
      timestamp: now,
      slot_number: slot,
      status: newStatus,
      distance_cm: distanceInt
    });
    if (logErr) console.error('Log insert error:', logErr.message);
  }

  res.json({ success: true, slot, status: newStatus, distance_cm: distanceInt });
});

// Admin "Log Vehicle Entry" form (saves a plate number)
app.post('/api/log-entry', async (req, res) => {
  const slot = parseInt(req.body.slot, 10);
  const plate = String(req.body.plate_number || '').trim().toUpperCase().slice(0, 20);

  if (!(slot >= 1 && slot <= 10) || !plate) {
    return res.status(400).json({ error: 'Valid slot (1-10) and plate_number are required' });
  }

  const { data, error } = await supabase
    .from('logs')
    .insert({ timestamp: Date.now(), slot_number: slot, status: 'occupied', distance_cm: null, plate_number: plate })
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true, id: data.id });
});

app.listen(PORT, () => {
  console.log(`PARKEASE server running at http://localhost:${PORT}`);
});

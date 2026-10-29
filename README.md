# PARKEASE (Supabase edition)

Parking-slot monitor: an Arduino HC-SR04 sensor -> `hardware.exe` -> Node/Express server -> Supabase (Postgres) -> web dashboard.

## 1. Set up Supabase
1. Create a project at supabase.com.
2. SQL Editor -> run `supabase/schema.sql` (creates `slots`, `logs`, `api_keys`, locks them with RLS, adds 10 empty slots and one device API key).
3. Optional: run `supabase/sample_logs.sql` for sample history.
4. Project Settings -> API: copy the **Project URL** and the **service_role** key.

## 2. Configure the server
```
copy .env.example .env      (Windows)   |   cp .env.example .env
```
Fill in `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. Keep this key on the server only.

## 3. Run
```
npm install
npm start
```
Open http://localhost:3000. On Windows you can double-click `start.bat` instead (also launches `arduino\hardware.exe`).

## 4. Hardware (optional)
1. Upload `arduino/ultrasonic/ultrasonic.ino` to the Arduino (Trig = pin 10, Echo = pin 11).
2. Edit `COM_PORT`, `SERVER_IP`, `API_KEY` at the top of `arduino/hardware.cpp`.
3. Run `arduino\build.bat` (needs w64devkit g++ at `c:\w64devkit\w64devkit\bin`) to produce `hardware.exe`.

`API_KEY` must match a row in `api_keys`. To rotate it:
```sql
update public.api_keys set key_value = 'your-new-secret' where device_name = 'Arduino Sensor';
```

## API
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/slots` | none | slot status + last 50 log rows |
| POST | `/api/update` | `x-api-key` | sensor reading `{slot, distance_cm}`; < 45.72 cm = occupied |
| POST | `/api/log-entry` | none | admin form: log a plate number `{slot, plate_number}` |

## Deploy on Render
1. Push this folder to a GitHub repo (`.env` is git-ignored, so your keys stay local).
2. Render > New > Blueprint (or Web Service) > pick the repo. Build: `npm install`, Start: `npm start`.
3. Add environment variables `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
4. Open `https://<your-service>.onrender.com`. `/healthz` should return `ok`.

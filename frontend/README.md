# StreetIQ MVP

StreetIQ is a real-time, scalable road condition mapping application. It detects hazards like potholes and cracks via a camera feed and plots them on an interactive map using device GPS.

## Architecture
- **Frontend**: React (Vite) + Leaflet (Mapbox integration) + Vanilla CSS (Glassmorphism & Dark Mode)
- **Computer Vision**: TensorFlow.js (In-browser inference, ensuring privacy and no video data retention)
- **Backend**: Supabase (PostgreSQL + PostGIS for spatial queries)
- **Real-time**: Supabase Realtime (WebSocket channels)
- **Deployment Target**: Vercel (Frontend) & Supabase (Backend)

## Core Features
- **Pothole & Crack Detection**: Uses camera input to detect and map hazards.
- **Privacy First**: Video feeds are processed locally on the device; only hazard metadata (coordinates, severity) is transmitted.
- **Real-time Map**: Live WebSocket updates broadcast new hazards to all connected clients instantly.
- **Deduplication**: Server-side PostGIS transaction prevents duplicate reports within a 10m radius.
- **Thermal Fallback**: Dynamic FPS reduction ensures low-end devices don't overheat during inference.

## Quick Start
1. Ensure you have Node.js installed.
2. Run `npm install` in the `frontend/` directory.
3. Configure your Supabase credentials in `src/supabaseClient.js`.
4. Run the SQL schema found in `../supabase/migrations/20260615_initial_schema.sql` on your Supabase project.
5. Run `npm run dev` to start the local development server.

## Testing
- Integration and Concurrency tests are located in `tests/integration.js`.
- RLS SQL tests are located in `../supabase/tests/20260615_rls_and_rpc_test.sql`.

# StreetIQ — Pitch & Judge Q&A Reference Guide

---

## 1. High-Level Pitch (The Vision)
*(Speak naturally, confidently, and with passion. Pause between paragraphs.)*

"Every day, millions of people face unpredictable and dangerous roads. There is a massive, real pain problem out there that nobody is solving. Giants like Google Maps and Apple Maps are great at getting you from point A to point B, but they rely on static satellite imagery and periodic Street View cars that pass through once every few months. They are completely blind to real-time, micro-level dangers. Satellite data simply cannot show you the massive suspension-breaking pothole that opened up last night after a storm. It does not show you debris that fell off a truck an hour ago.

Right now, if you drive from Delhi to Jaipur, you have zero way of knowing which patches of road are safe, which have deep potholes, which are waterlogged, or where debris has fallen. You only find out when you hit them. And by then, it is already too late. It is a gamble every single time you drive. This is not just inconvenient — it is dangerous. It causes fatal accidents, blows tires, destroys suspensions, and creates enormous stress for drivers, especially at night or in bad weather.

Think about this: it is 2 AM, you are driving on a highway you have never taken before. You are going at 80 km/h. There is no streetlight. Suddenly — a massive pothole. You hit it at full speed. That is the reality for millions of Indians every single night.

Now imagine if you had StreetIQ. Before you even approached that stretch of road, your navigation system already warned you to slow down — because a driver who passed through an hour earlier had StreetIQ running, and it caught the hazard automatically, without them lifting a finger.

We are presenting **StreetIQ** — an AI-powered road intelligence and navigation platform. What you see today is our working web prototype. But make no mistake: we did not build this simply as a website. Our true vision is direct hardware integration. We plan to partner with dashcam manufacturers and car OEMs to ship this software embedded directly into vehicles — so every car on the road is passively surveying and sharing road intelligence with every other car.

Nobody is asking drivers to 'use an app.' The hardware does it for them. As you drive, our custom-trained AI scans the road ahead in real time, completely on the edge of the device. When it detects a hazard, only the GPS coordinates and hazard metadata are sent to our database — no video, no image, nothing private. There is zero driver distraction, and the system is 100% private by design.

The core output is a free, open, intelligent navigation map. Everyone can see live hazards. Everyone drives more safely. But this platform does something no navigation app has ever done — it empowers citizens. Right now in India, if you want to hold your local government accountable for a pothole that has existed for months, you file an RTI and wait. With StreetIQ, the infrastructure progress — or neglect — of every government body is mapped in real time, transparently, for everyone to see. No RTIs. No waiting. Just data.

We are building the foundational intelligence layer for safe, smart cities. The UI you see is the prototype. The engine underneath is what changes our roads."

---

## 2. Judge Q&A — Technical Deep Dive

*(Use the following as reference points to answer judge questions confidently.)*

---

### 🧠 AI Model — What, Why & How

**Q: What AI model are you using and why this specific one?**
We are using **YOLOv8n** — the nano variant of the YOLOv8 architecture by Ultralytics. YOLO stands for You Only Look Once. Unlike two-stage detectors (like Faster R-CNN), YOLO processes the entire image in a single forward pass through the network. This makes it dramatically faster, which is essential for us because we need real-time inference at 15 frames per second inside a browser.

We specifically chose the **nano variant (YOLOv8n)** because:
1. It has a very small model footprint (~3 MB after quantization), which makes it loadable and runnable inside any browser via TensorFlow.js.
2. It still delivers high accuracy for our four hazard classes.
3. It runs comfortably on consumer-grade mobile hardware (phones, dashcams) without overheating.

**Q: Why not use a larger model like YOLOv8x or something from OpenAI?**
Larger models like YOLOv8x or cloud-based vision APIs would take hundreds of milliseconds per inference — far too slow for a 15fps video stream. More importantly, any cloud-based API would require us to upload video frames to a server, which immediately kills privacy. Our edge-only design is non-negotiable.

**Q: What are the four hazard classes the model detects?**
Following the international RDD (Road Damage Dataset) classification standard:
- **D00** — Longitudinal Crack (parallel to road direction)
- **D10** — Transverse Crack (perpendicular to road direction)
- **D20** — Alligator / Mesh Crack (networked cracking indicating deep structural failure)
- **D40** — Pothole (the most common and dangerous hazard)

These map to our platform labels: `crack`, `pothole`, `waterlogging`, `debris`.

---

### 📦 Dataset & Training Pipeline

**Q: Where did your training data come from?**
Our training data is sourced from the **Road Damage Dataset (RDD)**, a publicly available, internationally recognized benchmark dataset for road surface damage detection. It contains thousands of real-world dashcam images collected across Japan, India, the Czech Republic, and Norway, covering diverse road conditions, lighting scenarios, and damage types. This is the same dataset used by IEEE/ICRA research papers on road damage detection.

We then curated and filtered this data specifically for Indian road conditions — selecting images that reflected the kinds of roads, lighting, and hazard types most relevant to our use case.

**Q: What was your training setup and configuration?**
- **Framework:** Ultralytics YOLOv8 (Python), trained on Kaggle's GPU environment (NVIDIA T4 GPU)
- **Base Model:** `yolov8n.pt` — pre-trained on COCO, then fine-tuned on our road dataset (Transfer Learning)
- **Epochs:** 100
- **Image Size:** 640×640 pixels (standard YOLO input)
- **Batch Size:** Auto-selected by Ultralytics based on GPU VRAM
- **Optimizer:** Auto (SGD with momentum 0.937, weight decay 0.0005)
- **Learning Rate:** Initial `lr0 = 0.01`, decays to `lrf = 0.01`
- **Warmup:** 3 epochs to stabilize early training
- **IoU Threshold:** 0.7 for NMS (Non-Maximum Suppression) during validation
- **Augmentations Applied:** HSV color jitter, horizontal flips, mosaic augmentation, random scaling, random translation, random erasing (0.4 probability) — all to simulate real-world conditions like varying light, rain, shadows, and camera angles.
- **Early Stopping Patience:** 15 epochs — training stops if validation loss stops improving.
- **AMP (Automatic Mixed Precision):** Enabled — halves memory usage and speeds up training.
- **Training Type:** Supervised Learning with Transfer Learning (starting from COCO pre-trained weights, fine-tuned on our road damage dataset).

**Q: What do your training metrics look like?**
- We achieved strong **Precision-Recall curves** with a high area under the curve (AUC).
- Our **F1 Confidence Curves** show peak F1 score at a specific confidence threshold — we use 0.5 confidence for live scanning and 0.2 for static photo analysis.
- Our **Confusion Matrix** shows clear class differentiation — the model successfully distinguishes between the four crack types and potholes.

**Q: How did you export the model for the browser?**
After training in Python/PyTorch via Ultralytics, we exported in two formats:
1. **TensorFlow.js format** — primary model (`StreetIQ_TFJS_Model/`): `model.json` + `group1-shard1of1.bin` (~3 MB total).
2. **Float32 web model** — higher precision fallback (`float32_web_model/`), sharded into 3 × ~4 MB files.

Export pipeline: `PyTorch (.pt) → ONNX → TensorFlow SavedModel → TensorFlow.js GraphModel`

---

### ⚡ Edge Computing, Browser AI & Privacy

**Q: How exactly does the AI run in the browser?**
We use **TensorFlow.js** to load and run the YOLOv8 GraphModel directly inside the browser. Exact pipeline:

1. `tf.loadGraphModel('/model/model.json')` loads the weights on app start.
2. Backend set to **WebGL** first (GPU acceleration via browser). Falls back to **WASM** (CPU-based) on older devices.
3. A warmup inference runs on a zero tensor to pre-compile WebGL shaders.
4. During live scanning, every frame is: captured from camera → resized to 640×640 → converted to float tensor → fed to model → output parsed for bounding boxes.
5. All tensors are wrapped in `tf.tidy()` to prevent GPU memory leaks.

**Q: What happens when the phone gets slow or hot?**
We have an adaptive FPS throttling system measuring inference time per frame:
- Inference > 200ms → drop to 2 FPS
- Inference > 100ms → drop to 5 FPS
- Normal operation → 15 FPS

**Q: What is Smart Motion Gating?**
In `useMotionGate.js`, we monitor device speed via the GPS API. If speed drops below **2 km/h**, a 15-second idle timer starts. If the device remains stationary, AI inference is automatically paused. The moment the device moves again, inference resumes. This prevents a car stopped at a red light from sending hundreds of duplicate pothole reports.

---

### 🗺️ Maps, Routing & Navigation Algorithms

**Q: How do your maps work?**
Maps are rendered using **React-Leaflet** (React wrapper around Leaflet.js) with **OpenStreetMap** tiles served through CartoDB. We support four tile layers: Dark (default), Light, Satellite (Esri), and Terrain (Esri). All tile data is open-source — we pay nothing for map data.

**Q: How does route calculation work?**
Routing goes through our Express backend, which proxies to **OSRM (Open Source Routing Machine)**. OSRM uses the **Contraction Hierarchies (CH) algorithm** — one of the fastest shortest-path algorithms, preprocessing road graphs so Dijkstra's algorithm searches only a tiny fraction of the graph. OSRM returns the shortest road-network path as a GeoJSON polyline plus detailed turn-by-turn maneuver steps.

**Q: Why not use Google Maps Directions API or Mapbox?**
Both are paid APIs that charge per request. OSRM with OpenStreetMap data is completely free and open-source, which aligns with our vision of a free platform for everyone.

**Q: How do you handle Indian traffic realities that OSRM doesn't know about?**
Our `routing.ts` applies **custom traffic multipliers** on top of OSRM responses:
- `INDIA_TRAFFIC_FACTOR = 1.8` → standard ETA (realistic for most Indian roads)
- `INDIA_TRAFFIC_FACTOR_HEAVY = 2.4` → pessimistic ETA (heavy traffic / bad conditions)
- `1.3×` → optimistic ETA (light traffic)

We expose all three as an ETA range in the Directions panel.

**Q: How does turn-by-turn navigation work?**
We use the **Haversine formula** to calculate the great-circle distance between the user's GPS position and the upcoming maneuver point. Haversine accounts for Earth's curvature — accurate to within 0.3% for driving distances. When the user is within **30 meters** of the next maneuver point, the step auto-advances. ETA is recalculated using a **smoothed exponential moving average** (`prev × 0.85 + new × 0.15`) to prevent erratic jumps.

**Q: How do you handle GPS noise and jitter?**
We implement a **1D Kalman Filter** (one per axis — latitude and longitude) in `useGPSLocation.js`. A Kalman Filter fuses predicted state with noisy sensor readings using a mathematical model of uncertainty. We also discard GPS readings with accuracy worse than 50 meters, and suppress position updates when the device is stationary (less than 3 meters of movement at low speed) to prevent map marker drift.

**Q: How does geocoding (destination search) work?**
Search queries go to our backend, which proxies to **Photon by Komoot** — a free, open-source geocoding API powered by OpenStreetMap data. No API keys or paid subscriptions required. Queries are debounced on the frontend (350ms delay) to avoid spamming the server on every keystroke.

---

### 📡 Real-Time Database & Multi-User Sync

**Q: How do map hazards update in real-time for all users simultaneously?**
This is handled by **Supabase Realtime** — a WebSocket-based change data capture (CDC) system built on PostgreSQL logical replication. When any row is inserted or updated in the `hazards` table, Supabase's publication (`supabase_realtime`) captures the WAL (Write-Ahead Log) event and pushes it to all connected clients via WebSocket. On the frontend, we subscribe to `postgres_changes` events, and React state updates immediately — causing the new hazard pin to appear on every connected user's map within milliseconds.

**Q: How do you prevent the same pothole from being reported a thousand times?**
Our deduplication system uses a three-layer approach inside the `report_hazard` PostgreSQL RPC function:
1. **Grid Hash Lock:** We compute a 64-bit integer from the rounded coordinates and call `pg_advisory_xact_lock()` — this serializes concurrent writes to the same ~10m geographic grid cell, preventing race conditions.
2. **PostGIS Spatial Query:** `ST_DWithin(location, new_point, 10)` — checks if an active hazard of the same type exists within a 10-meter radius using spherical distance math.
3. **Auto-Upvote:** If a duplicate is found, `confirmation_count` is incremented instead of creating a new record. Once a hazard reaches 3 confirmations, it is automatically promoted to `verified` status and becomes visible to all users.

**Q: What does the database schema look like?**
Two primary tables:
- `hazards` — type, GPS location (PostGIS `geography` type), severity (1–5), confidence score, status (`reported → under_review → verified → repaired`), confirmation count, image URL.
- `road_scans` — raw log of every AI detection event with session ID, location, detected type, confidence score, and vehicle speed at time of detection. This raw telemetry feeds future analytics.

All direct inserts/updates are blocked by **Row Level Security (RLS)** policies. The only way to write data is through our `security definer` RPC functions — preventing any client-side tampering.

---

### 💻 Full Tech Stack with Rationale

| Layer | Technology | Why We Chose It |
|---|---|---|
| Frontend Framework | React 19 + Vite | Fastest dev build tool, component-based UI, huge ecosystem |
| Map Rendering | React-Leaflet + Leaflet.js | Free, open-source, highly customizable, no API key needed |
| Map Tiles | CartoDB Dark + Esri | Free tile servers, dark mode aesthetic suited for driving |
| In-Browser AI | TensorFlow.js 4.x | Only production-ready JS ML library with WebGL GPU backend |
| AI Model | YOLOv8n (Ultralytics) | Fastest YOLO variant, small enough to ship in a browser |
| Heatmap | Leaflet.heat plugin | Simple, lightweight density heatmap for hazard clustering |
| Icons | Lucide React | Clean, minimal SVG icons with zero bundle weight |
| Backend Runtime | Node.js + Express | Fast, non-blocking I/O perfect for API proxying |
| Backend Language | TypeScript | Strict typing prevents runtime errors in production |
| Input Validation | Zod | Schema-based validation with automatic TypeScript inference |
| Logging | Pino | Fastest Node.js structured JSON logger |
| Security | Helmet.js + CORS + Rate Limiting | Standard production hardening against common web attacks |
| Routing Engine | OSRM | Free, open-source, CH-algorithm based, fastest available |
| Geocoding | Photon by Komoot | Free, OSM-powered, no API key, global coverage |
| Database | Supabase (PostgreSQL) | Managed Postgres with built-in Auth, Realtime, and Storage |
| Spatial Queries | PostGIS | Industry-standard geospatial extension for PostgreSQL |
| Real-Time Sync | Supabase Realtime (WebSockets) | Zero-config CDC over WebSockets, built on Postgres replication |
| Training Platform | Kaggle (NVIDIA T4 GPU) | Free GPU compute for model training |
| Training Framework | Ultralytics YOLOv8 (Python) | Best-in-class YOLO implementation with full export pipeline |
| Model Export | TF.js Converter | Official tool to convert TensorFlow SavedModel to browser format |
| Deployment | Vercel (frontend) + Docker (backend) | Zero-config frontend deployment, containerized backend |

---

### 🚀 Vision, Expansion & Defending the Prototype

**Q: This looks like a basic web app. Why should we take it seriously?**
What you are looking at is the smallest possible surface area to prove the hardest technical problems. We have solved: real-time browser-based AI inference, privacy-preserving edge computing, crowdsourced deduplication at the database level, and live multi-user map sync. Those are the hard parts. The UI is intentionally simple because we are not building a consumer app — we are building an embedded software platform for vehicles. The final interface will be a 7-inch in-dash screen, not a phone browser.

**Q: What is the expansion roadmap?**
- **Phase 1 (Current):** Web prototype validating the AI + real-time data pipeline.
- **Phase 2:** OEM and dashcam hardware partnerships — shipping StreetIQ as embedded firmware.
- **Phase 3:** Expand detection classes — missing lane markings, broken streetlights, missing manhole covers, accident hotspot prediction using aggregated historical scan data.
- **Phase 4:** B2G (Business to Government) enterprise dashboard — giving municipal corporations a real-time infrastructure health map to prioritize and track road repairs, eliminating expensive manual road surveys.
- **Phase 5:** Community gamification — rewarding drivers with fuel discounts or loyalty points for keeping the hazard map updated and accurate.

**Q: How does StreetIQ empower citizens specifically?**
Today, if a pothole has existed on your street for 6 months, your only recourse is to file an RTI request and wait. With StreetIQ, that pothole is mapped the moment it appears, timestamped, and publicly visible. The government can see it. Journalists can see it. Citizens can see it. If it has not been repaired after weeks, the data shows that. We are creating accountability through transparency — without anyone having to do any additional work.

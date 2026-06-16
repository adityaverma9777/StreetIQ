# StreetIQ 🛣️

**The AI-Powered Road Intelligence & Navigation Platform**

![StreetIQ Hero](frontend/src/assets/hero.png)

---

## 🧐 What does StreetIQ do?
StreetIQ is a next-generation navigation and road monitoring platform. While conventional maps tell you how to get from point A to point B, StreetIQ tells you **what is actually on the road**. 

We provide smooth, real-time turn-by-turn navigation overlayed with live crowdsourced hazard data—such as potholes, waterlogging, severe cracks, and debris.

## ⚠️ The Problem It Solves
Millions of people face unpredictable road conditions daily, especially in developing regions.
- **Safety Risks:** Hidden potholes and sudden debris lead to severe accidents and vehicle damage.
- **Blind Navigation:** Standard navigation apps assume all roads are perfect, completely ignoring temporary hazards or severe road degradation.
- **Data Collection Bottleneck:** Municipalities and road authorities lack the workforce to actively monitor thousands of kilometers of roads in real-time.

## 💡 The Solution & How It Works
StreetIQ solves this by turning every driver into an active road surveyor—without requiring them to do any manual work.

1. **On-Device AI Inference:** As you navigate, you can activate the AI dashcam. Using a highly optimized, lightweight **YOLOv8** model running entirely in your browser (via TensorFlow.js), the app scans the road ahead at a stable 15fps.
2. **Absolute Privacy:** Video feeds are **never** sent to a server. Only the GPS coordinates and hazard metadata are transmitted when a hazard is confidently detected.
3. **Smart Motion Gating:** AI inference only runs when you are actively moving (> 2 km/h). It automatically pauses at traffic lights to save battery and prevent duplicate reports.
4. **Real-Time Distribution:** The moment a hazard is detected by a user, our WebSockets and Supabase backend instantly broadcast the hazard to the maps of every other driver in the area.

---

## 🧠 We Built & Trained Our Own Model
We didn't just plug in a generic pre-trained API. We **hand-trained our own state-of-the-art YOLOv8 model** specifically calibrated for complex Indian road conditions. Our model is highly tuned to identify `cracks`, `potholes`, `waterlogging`, and `debris` in real-time under various lighting conditions.

### 🎯 Real-World AI Validation
Here is how our AI performs on unseen validation dashcam footage during training:

| Validation Scenario 1 | Validation Scenario 2 | Validation Scenario 3 |
| :---: | :---: | :---: |
| <img src="./training/val_batch0_pred.jpg" width="280"> | <img src="./training/val_batch1_pred.jpg" width="280"> | <img src="./training/val_batch2_pred.jpg" width="280"> |

### 📊 Training Performance Metrics

| Precision-Recall Curve | F1 Confidence Curve | Normalized Confusion Matrix |
| :---: | :---: | :---: |
| <img src="./training/BoxPR_curve.png" width="280"> | <img src="./training/BoxF1_curve.png" width="280"> | <img src="./training/confusion_matrix_normalized.png" width="280"> |
| **Precision vs Recall:** High area under the curve proves our model accurately balances detecting true hazards while ignoring false positives. | **F1 Score:** Demonstrates peak model performance and reliability across varying confidence thresholds. | **Class Accuracy:** Shows our model's pinpoint accuracy in distinguishing between specific classes (e.g. differentiating a shadow from a pothole). |

---

## 🛠️ Tech Stack

**Frontend:**
- React (Vite)
- TensorFlow.js (In-browser YOLO inference)
- React-Leaflet (Map rendering)

**Backend:**
- Node.js & Express (TypeScript)
- OSRM (Open Source Routing Machine) with custom traffic multipliers
- Photon / Komoot (Global Geocoding)
- WebSockets (Real-time tracking)

**Database & Cloud:**
- Supabase (PostgreSQL + PostGIS for spatial queries)
- Supabase Realtime (Hazard broadcasts)

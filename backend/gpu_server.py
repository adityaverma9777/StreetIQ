import os
import io
import time
import base64
import torch
import numpy as np
from PIL import Image
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from ultralytics import YOLO

app = FastAPI(title="StreetIQ GPU Inference Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
WEIGHTS_PATH = os.path.join(os.path.dirname(__file__), "weights", "yolo11l_640_best.pt")
if not os.path.exists(WEIGHTS_PATH):
    os.makedirs(os.path.dirname(WEIGHTS_PATH), exist_ok=True)
    from huggingface_hub import hf_hub_download
    WEIGHTS_PATH = hf_hub_download(repo_id="uzbtrust/smart-road-pci-yolo11", filename="yolo11l_640_best.pt", local_dir=os.path.dirname(WEIGHTS_PATH))
CLASS_MAPPING = {
    0: {"raw": "longitudinal_transverse_crack", "display": "Longitudinal / Transverse Crack", "type": "crack", "severity": 3, "astm": 10},
    1: {"raw": "alligator_crack", "display": "Alligator Crack", "type": "crack", "severity": 4, "astm": 1},
    2: {"raw": "block_crack", "display": "Block Crack", "type": "crack", "severity": 3, "astm": 3},
    3: {"raw": "patching", "display": "Patching", "type": "patch", "severity": 2, "astm": 11},
    4: {"raw": "pothole", "display": "Pothole", "type": "pothole", "severity": 5, "astm": 13},
    5: {"raw": "weathering_raveling", "display": "Weathering / Raveling", "type": "surface_damage", "severity": 2, "astm": 19},
    6: {"raw": "lane_shoulder_drop_off", "display": "Lane / Shoulder Drop-off", "type": "shoulder_drop", "severity": 4, "astm": 9},
    7: {"raw": "marking_manhole", "display": "Marking / Manhole", "type": "manhole", "severity": 2, "astm": None},
}

model = YOLO(WEIGHTS_PATH)
model.to(DEVICE)

class Base64FrameRequest(BaseModel):
    image: str
    confidence: Optional[float] = 0.15

def run_detection(img: Image.Image, conf_threshold: float):
    t0 = time.perf_counter()
    w, h = img.size
    results = model.predict(
        img,
        imgsz=640,
        conf=conf_threshold,
        classes=list(range(8)),
        device=DEVICE,
        verbose=False
    )
    latency_ms = (time.perf_counter() - t0) * 1000
    detections = []
    counts_by_type = {}
    deduct_points = 0
    if results and len(results) > 0:
        boxes = results[0].boxes
        for box in boxes:
            cls_idx = int(box.cls.item())
            if cls_idx not in CLASS_MAPPING:
                continue
            conf = float(box.conf.item())
            xyxy = box.xyxy[0].tolist()
            bx1, by1, bx2, by2 = xyxy
            info = CLASS_MAPPING[cls_idx]
            disp = info["display"]
            app_t = info["type"]
            sev = info["severity"]
            counts_by_type[disp] = counts_by_type.get(disp, 0) + 1
            if sev >= 4:
                deduct_points += 15
            elif sev == 3:
                deduct_points += 8
            else:
                deduct_points += 3
            detections.append({
                "class_index": cls_idx,
                "display_label": disp,
                "app_type": app_t,
                "severity": sev,
                "confidence": round(conf, 3),
                "bbox": {
                    "x": round(bx1, 1),
                    "y": round(by1, 1),
                    "w": round(bx2 - bx1, 1),
                    "h": round(by2 - by1, 1),
                    "cx": round((bx1 + bx2) / 2, 1),
                    "cy": round((by1 + by2) / 2, 1),
                    "normalized": {
                        "x": round(bx1 / w, 4),
                        "y": round(by1 / h, 4),
                        "w": round((bx2 - bx1) / w, 4),
                        "h": round((by2 - by1) / h, 4)
                    }
                }
            })
    estimated_pci = max(0, min(100, 100 - deduct_points))
    return {
        "device": DEVICE,
        "inference_ms": round(latency_ms, 1),
        "fps": round(1000 / max(latency_ms, 0.001), 1),
        "detections": detections,
        "counts": counts_by_type,
        "total_hazards": len(detections),
        "estimated_pci": estimated_pci,
        "pci_rating": "Good" if estimated_pci >= 85 else "Satisfactory" if estimated_pci >= 70 else "Fair" if estimated_pci >= 55 else "Poor" if estimated_pci >= 40 else "Serious"
    }

@app.get("/health")
def health():
    return {
        "status": "online",
        "device": DEVICE,
        "device_name": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU",
        "vram_total_mb": round(torch.cuda.get_device_properties(0).total_memory / (1024 * 1024)) if torch.cuda.is_available() else 0,
        "vram_allocated_mb": round(torch.cuda.memory_allocated(0) / (1024 * 1024)) if torch.cuda.is_available() else 0,
        "model": "uzbtrust/smart-road-pci-yolo11",
        "weights": os.path.basename(WEIGHTS_PATH),
        "classes": [CLASS_MAPPING[i]["display"] for i in range(8)]
    }

@app.post("/predict/frame")
async def predict_frame(file: UploadFile = File(...), confidence: float = Form(0.15)):
    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")
    return run_detection(image, confidence)

@app.post("/predict/base64")
async def predict_base64(req: Base64FrameRequest):
    img_data = req.image
    if "," in img_data:
        img_data = img_data.split(",", 1)[1]
    image_bytes = base64.b64decode(img_data)
    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    return run_detection(image, req.confidence or 0.15)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("gpu_server:app", host="0.0.0.0", port=8000, reload=False)

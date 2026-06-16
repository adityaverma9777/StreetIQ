import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ArrowUpRight, Cpu, ShieldCheck, Zap, Wifi, Layers, Video } from 'lucide-react';

export default function AboutPage() {
  const navigate = useNavigate();

  useEffect(() => {
    document.documentElement.style.overflow = 'auto';
    document.documentElement.style.height = 'auto';
    document.body.style.overflow = 'auto';
    document.body.style.height = 'auto';
    const root = document.getElementById('root');
    if (root) { root.style.height = 'auto'; root.style.overflow = 'auto'; }
    return () => {
      document.documentElement.style.overflow = '';
      document.documentElement.style.height = '';
      document.body.style.overflow = '';
      document.body.style.height = '';
      if (root) { root.style.height = ''; root.style.overflow = ''; }
    };
  }, []);

  const features = [
    { icon: <Cpu size={16} />, title: 'On-Device AI', body: 'Our YOLOv8 model runs entirely in your browser via TensorFlow.js — 15fps, zero server upload, complete privacy.' },
    { icon: <Zap size={16} />, title: 'Motion Gating', body: 'Inference only activates above 2 km/h. At traffic lights it pauses automatically, saving battery and blocking duplicate reports.' },
    { icon: <Wifi size={16} />, title: 'Live Crowdsourcing', body: 'Hazards detected by any driver broadcast instantly to all active users via WebSockets and Supabase Realtime.' },
    { icon: <Layers size={16} />, title: 'Real Navigation', body: 'OSRM-powered turn-by-turn routing with dynamic ETA based on your actual GPS speed, not theoretical estimates.' },
    { icon: <ShieldCheck size={16} />, title: 'Privacy by Design', body: 'Camera footage is processed locally and never stored. Only GPS coordinates and hazard type leave your device.' },
    { icon: <Video size={16} />, title: 'Video Analysis', body: 'Upload any dashcam clip. AI marks every hazard with colour-coded boxes and generates a report — entirely on your device.' },
  ];

  return (
    <div style={{ background: '#000', minHeight: '100vh', fontFamily: "'Inter', -apple-system, sans-serif", color: '#fff', WebkitFontSmoothing: 'antialiased' }}>

      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.85)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex', alignItems: 'center',
        padding: 'calc(env(safe-area-inset-top,0px) + 14px) 20px 14px',
      }}>
        <button onClick={() => navigate('/')} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 4, color: '#fff', padding: 0,
        }}>
          <ChevronLeft size={20} strokeWidth={2} />
          <span style={{ fontSize: 16, fontWeight: 400 }}>Back</span>
        </button>
        <div style={{ flex: 1, textAlign: 'center' }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>About</span>
        </div>
        <div style={{ width: 72 }} />
      </div>

      <div style={{ paddingTop: 'calc(env(safe-area-inset-top,0px) + 72px)' }}>

        <div style={{ padding: '64px 28px 56px', borderBottom: '1px solid rgba(255,255,255,0.08)', textAlign: 'center' }}>
          <div style={{
            width: 80, height: 80, borderRadius: '50%', margin: '0 auto 24px',
            border: '1px solid rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(255,255,255,0.03)',
          }}>
            <img src="/logo.png" alt="StreetIQ" style={{ width: 48, height: 48, objectFit: 'contain', filter: 'invert(1)' }} />
          </div>
          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1, marginBottom: 12 }}>StreetIQ</div>
          <div style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)', fontWeight: 400, lineHeight: 1.55, maxWidth: 280, margin: '0 auto' }}>
            Road intelligence that actually knows what's on the road.
          </div>
        </div>

        <div style={{ padding: '48px 28px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.25)', letterSpacing: 1.8, textTransform: 'uppercase', marginBottom: 18 }}>The Problem</div>
          <p style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.4, letterSpacing: -0.4, marginBottom: 16 }}>
            Navigation apps are blind to what's actually on the road.
          </p>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)', lineHeight: 1.8 }}>
            Potholes, cracks, waterlogging, debris — they cause accidents and vehicle damage daily. Yet every navigation app assumes roads are perfect. There is no scalable system that tracks real road conditions in real time. Governments don't have the manpower. Traditional surveys can't keep up.
          </p>
        </div>

        <div style={{ padding: '48px 28px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.25)', letterSpacing: 1.8, textTransform: 'uppercase', marginBottom: 18 }}>Our Approach</div>
          <p style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.4, letterSpacing: -0.4, marginBottom: 16 }}>
            Turn every driver into a silent road surveyor.
          </p>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)', lineHeight: 1.8 }}>
            As you drive, StreetIQ's on-device AI scans the road at 15fps through your camera. The moment a hazard is identified, it is instantly mapped and shared with every nearby driver — zero manual effort, zero privacy compromise, zero battery drain at idle.
          </p>
        </div>

        <div style={{ padding: '48px 28px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.25)', letterSpacing: 1.8, textTransform: 'uppercase', marginBottom: 32 }}>How It Works</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {features.map(({ icon, title, body }, i) => (
              <div key={title} style={{
                display: 'flex', gap: 18,
                paddingBottom: i < features.length - 1 ? 28 : 0,
                marginBottom: i < features.length - 1 ? 28 : 0,
                borderBottom: i < features.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 9,
                  border: '1px solid rgba(255,255,255,0.12)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0, marginTop: 2, color: 'rgba(255,255,255,0.7)',
                }}>
                  {icon}
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{title}</div>
                  <div style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', lineHeight: 1.7 }}>{body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ padding: '48px 28px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.25)', letterSpacing: 1.8, textTransform: 'uppercase', marginBottom: 18 }}>The Model</div>
          <p style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.4, letterSpacing: -0.4, marginBottom: 16 }}>
            We trained our own AI. From scratch.
          </p>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)', lineHeight: 1.8, marginBottom: 14 }}>
            We curated a custom dataset of real Indian dashcam footage, hand-annotated thousands of images across four hazard classes — cracks, potholes, waterlogging, and debris — and trained our own YOLOv8 model from the ground up.
          </p>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.45)', lineHeight: 1.8, marginBottom: 28 }}>
            The model was exported to TensorFlow.js format and optimised for real-time mobile browser inference. No third-party API. No generic weights. Built specifically for the roads we drive on.
          </p>
          <a
            href="https://github.com/adityaverma9777/StreetIQ"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              fontSize: 14, fontWeight: 500, color: 'rgba(255,255,255,0.6)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 10, padding: '10px 16px',
              textDecoration: 'none',
            }}
          >
            Training artifacts on GitHub <ArrowUpRight size={14} />
          </a>
        </div>

        <div style={{ padding: '40px 28px', paddingBottom: 'calc(env(safe-area-inset-bottom,0px) + 52px)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <a
            href="https://mnmworks.xyz"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '18px 22px', borderRadius: 14, textDecoration: 'none',
              background: '#fff', color: '#000', fontSize: 16, fontWeight: 700,
            }}
          >
            Meet the Developers
            <ArrowUpRight size={18} />
          </a>
          <a
            href="https://github.com/adityaverma9777/StreetIQ"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '18px 22px', borderRadius: 14, textDecoration: 'none',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.12)',
              color: 'rgba(255,255,255,0.6)', fontSize: 16, fontWeight: 500,
            }}
          >
            View on GitHub
            <ArrowUpRight size={18} />
          </a>
          <div style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: 'rgba(255,255,255,0.15)' }}>
            All AI processing happens on your device · No video is ever stored
          </div>
        </div>
      </div>
    </div>
  );
}

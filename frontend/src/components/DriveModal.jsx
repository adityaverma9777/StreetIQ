import React from 'react';
import { Camera, Radio } from 'lucide-react';

export default function DriveModal({ onRecord, onSkip }) {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 2099, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }} />
      <div style={{
        position: 'fixed', bottom: 'calc(82px + env(safe-area-inset-bottom, 0px))',
        left: 16, right: 16, zIndex: 2100,
        background: 'rgba(28,28,30,0.98)', backdropFilter: 'blur(24px)',
        borderRadius: 20, padding: 24,
        border: '0.5px solid rgba(84,84,88,0.65)',
        boxShadow: '0 -8px 48px rgba(0,0,0,0.6)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(10,132,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <Camera size={28} color="#0A84FF" />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#fff', fontFamily: 'Inter, sans-serif', marginBottom: 8 }}>
            Record Your Drive?
          </div>
          <div style={{ fontSize: 14, color: 'rgba(235,235,245,0.6)', fontFamily: 'Inter, sans-serif', lineHeight: 1.5 }}>
            Our AI will scan the road in real-time and help identify hazards for everyone in your community. Your data contributes to smoother rides.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(10,132,255,0.08)', borderRadius: 10, padding: '10px 14px', marginBottom: 20, border: '0.5px solid rgba(10,132,255,0.2)' }}>
          <Radio size={14} color="#0A84FF" />
          <span style={{ fontSize: 12, color: 'rgba(10,132,255,0.9)', fontFamily: 'Inter, sans-serif' }}>
            Only active while you're moving · Pauses automatically when stopped
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            onClick={onRecord}
            style={{ width: '100%', padding: 15, borderRadius: 12, border: 'none', background: '#0A84FF', color: 'white', fontSize: 16, fontWeight: 600, fontFamily: 'Inter, sans-serif', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <Camera size={18} />
            Record & Contribute
          </button>
          <button
            onClick={onSkip}
            style={{ width: '100%', padding: 15, borderRadius: 12, border: '0.5px solid rgba(84,84,88,0.65)', background: 'transparent', color: 'rgba(235,235,245,0.8)', fontSize: 16, fontWeight: 500, fontFamily: 'Inter, sans-serif', cursor: 'pointer' }}
          >
            Just Navigate
          </button>
        </div>
      </div>
    </>
  );
}

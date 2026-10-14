// Camera barcode scanning for phones/tablets. USB and Bluetooth scanners work without this:
// they type the code into the focused input and press Enter.
import { useEffect, useRef, useState } from 'react';

export default function BarcodeScanner({ onDetected, onClose }) {
  const video = useRef(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let stop = () => {};
    let cancelled = false;
    let last = '';
    (async () => {
      try {
        if ('BarcodeDetector' in window) {
          const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'data_matrix'] });
          const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
          if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
          video.current.srcObject = stream;
          await video.current.play();
          let raf;
          const tick = async () => {
            try {
              const codes = await detector.detect(video.current);
              if (codes[0] && codes[0].rawValue !== last) { last = codes[0].rawValue; onDetected(last); }
            } catch { /* frame not ready */ }
            raf = requestAnimationFrame(tick);
          };
          tick();
          stop = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); };
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader();
          const controls = await reader.decodeFromVideoDevice(undefined, video.current, (res) => {
            if (res && res.getText() !== last) { last = res.getText(); onDetected(last); }
          });
          stop = () => controls.stop();
        }
      } catch (e) {
        setError(e.name === 'NotAllowedError' ? 'Camera permission was denied. Allow camera access in browser settings, or type the code.' : `Camera not available: ${e.message}`);
      }
    })();
    return () => { cancelled = true; stop(); };
  }, [onDetected]);
  return (
    <div className="panel">
      <div className="row between"><b>Point the camera at the barcode</b><button className="btn ghost small" onClick={onClose}>Close camera</button></div>
      {error ? <div className="notice error" style={{ marginTop: 8 }}>{error}</div> : <video ref={video} muted playsInline style={{ width: '100%', maxHeight: 260, marginTop: 8, borderRadius: 8, background: '#000' }} />}
    </div>
  );
}

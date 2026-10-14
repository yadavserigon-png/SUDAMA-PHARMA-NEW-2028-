// OpenStreetMap tiles via Leaflet - a genuine map provider with no API key needed.
// For heavy production traffic, switch the tile URL to a commercial OSM tile provider (see README).
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const TILE = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTR = '&copy; OpenStreetMap contributors';
const BIHAR = [25.6, 85.1];

const dot = (color) => L.divIcon({ className: '', html: `<span style="display:block;width:16px;height:16px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.3)"></span>`, iconSize: [16, 16], iconAnchor: [8, 8] });

function useMap(ref, center, zoom = 12) {
  const map = useRef(null);
  useEffect(() => {
    if (!ref.current || map.current) return undefined;
    map.current = L.map(ref.current).setView(center || BIHAR, center ? zoom : 7);
    L.tileLayer(TILE, { maxZoom: 19, attribution: ATTR }).addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return map;
}

/** Click / drag to set store location; circle shows delivery radius. */
export function LocationPicker({ value, radiusKm, onChange }) {
  const ref = useRef(null);
  const map = useMap(ref, value?.lat ? [value.lat, value.lng] : null, 13);
  const marker = useRef(null);
  const circle = useRef(null);
  useEffect(() => {
    const m = map.current;
    if (!m) return undefined;
    const click = (e) => onChange({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) });
    m.on('click', click);
    return () => m.off('click', click);
  }, [map, onChange]);
  useEffect(() => {
    const m = map.current;
    if (!m || !value?.lat) return;
    const ll = [value.lat, value.lng];
    if (!marker.current) {
      marker.current = L.marker(ll, { draggable: true, icon: dot('#1f6f4a') }).addTo(m);
      marker.current.on('dragend', () => { const p = marker.current.getLatLng(); onChange({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }); });
    } else marker.current.setLatLng(ll);
    if (!circle.current) circle.current = L.circle(ll, { radius: (radiusKm || 0) * 1000, color: '#d9930d', weight: 1.5, fillOpacity: 0.08 }).addTo(m);
    else { circle.current.setLatLng(ll); circle.current.setRadius((radiusKm || 0) * 1000); }
  }, [map, value?.lat, value?.lng, radiusKm, onChange]);
  return <div ref={ref} className="map" aria-label="Map: click to set the store location" />;
}

/** Read-only map of markers. markers: [{ lat, lng, label, color }] */
export function MarkersMap({ markers, tall, circles = [] }) {
  const ref = useRef(null);
  const map = useMap(ref, null);
  const layer = useRef(null);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    layer.current?.remove();
    layer.current = L.layerGroup().addTo(m);
    const pts = [];
    for (const k of markers.filter((x) => x.lat != null && x.lng != null)) {
      L.marker([k.lat, k.lng], { icon: dot(k.color || '#1f6f4a') }).bindPopup(k.label || '').addTo(layer.current);
      pts.push([k.lat, k.lng]);
    }
    for (const c of circles.filter((x) => x.lat != null)) L.circle([c.lat, c.lng], { radius: c.radiusKm * 1000, color: '#d9930d', weight: 1, fillOpacity: 0.05 }).addTo(layer.current);
    if (pts.length === 1) m.setView(pts[0], 14);
    else if (pts.length > 1) m.fitBounds(pts, { padding: [30, 30] });
  }, [map, markers, circles]);
  return <div ref={ref} className={`map ${tall ? 'tall' : ''}`} />;
}

export function directionsUrl(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

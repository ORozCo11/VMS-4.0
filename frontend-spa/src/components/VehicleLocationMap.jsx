import { useState } from 'react';
import { MapContainer, Marker, TileLayer, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const CARTO_TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
const CARTO_ATTRIBUTION = '&copy; OpenStreetMap contributors &copy; CARTO';
const ESRI_IMAGERY_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_LABELS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTRIBUTION = 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics';

// A blue teardrop pin as a divIcon — avoids Leaflet's default-marker asset issue
// under bundlers and matches the app's blue brand.
const vehiclePin = L.divIcon({
  className: 'veh-map-pin',
  html: `
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42" aria-hidden="true">
      <path d="M17 1C8.7 1 2 7.7 2 16c0 10.5 13.4 23.6 14 24.2a1.4 1.4 0 0 0 2 0C18.6 39.6 32 26.5 32 16 32 7.7 25.3 1 17 1z" fill="#2563eb" stroke="#ffffff" stroke-width="2"/>
      <circle cx="17" cy="16" r="6" fill="#ffffff"/>
    </svg>`,
  iconSize: [34, 42],
  iconAnchor: [17, 42],
  tooltipAnchor: [0, -38],
});

export default function VehicleLocationMap({ lat, lng, label }) {
  const [basemap, setBasemap] = useState('satellite'); // 'map' | 'satellite'
  const hasCoords = lat != null && lng != null && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng));

  if (!hasCoords) {
    return <div className="veh-map-empty">This location isn&apos;t mapped yet.</div>;
  }

  const center = [Number(lat), Number(lng)];

  return (
    <MapContainer
      key={`${lat},${lng}`}
      center={center}
      zoom={16}
      scrollWheelZoom={false}
      className="veh-map-canvas"
      attributionControl={false}
    >
      {basemap === 'satellite' ? (
        <>
          <TileLayer url={ESRI_IMAGERY_URL} attribution={ESRI_ATTRIBUTION} maxZoom={19} />
          <TileLayer url={ESRI_LABELS_URL} attribution="" maxZoom={19} />
        </>
      ) : (
        <TileLayer url={CARTO_TILE_URL} attribution={CARTO_ATTRIBUTION} />
      )}
      <div
        className="location-density-basemap-toggle"
        ref={(el) => { if (el) { L.DomEvent.disableClickPropagation(el); L.DomEvent.disableScrollPropagation(el); } }}
      >
        <button type="button" className={basemap === 'map' ? 'is-active' : ''} onClick={() => setBasemap('map')}>Map</button>
        <button type="button" className={basemap === 'satellite' ? 'is-active' : ''} onClick={() => setBasemap('satellite')}>Satellite</button>
      </div>
      <Marker position={center} icon={vehiclePin}>
        {label && (
          <Tooltip permanent direction="top">{label}</Tooltip>
        )}
      </Marker>
    </MapContainer>
  );
}

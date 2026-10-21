import { useCallback, useEffect, useRef, useState } from 'react';
import maplibregl, { type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { X, Crosshair, Layers, MapPin, Sparkles, Loader2, Home, Footprints } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const CELL = 0.0005; // ~55 m grid
const PLOT_PRICE = 500;
const FALLBACK: [number, number] = [-84.388, 33.749]; // Atlanta

type Plot = { cell_key: string; lat_i: number; lng_i: number; owner_id: string; owner_name: string | null; name: string | null; visits: number; earned: number; boost_until: string | null };
type Drop = { id: string; cell_key: string; lat_i: number; lng_i: number; business_name: string; bonus: number };
const isBoosted = (p?: Plot) => !!p?.boost_until && new Date(p.boost_until).getTime() > Date.now();
const BOOST_PRICE = 150;
type Cell = { lat_i: number; lng_i: number };
type Fix = { lat: number; lng: number; acc: number };

const SATELLITE: StyleSpecification = {
  version: 8,
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  sources: {
    sat: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
    },
    labels: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'sat', type: 'raster', source: 'sat' },
    { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.85 } },
  ],
};
const STREETS_3D = 'https://tiles.openfreemap.org/styles/liberty';

const cellOf = (lat: number, lng: number): Cell => ({ lat_i: Math.floor(lat / CELL), lng_i: Math.floor(lng / CELL) });
const keyOf = (c: Cell) => `${c.lat_i}:${c.lng_i}`;
const cellPolygon = (c: Cell) => {
  const s = c.lat_i * CELL, w = c.lng_i * CELL, n = s + CELL, e = w + CELL;
  return [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
};

export default function LiveMap({ onClose, onWalletUpdate, sparkBalance, playerId }: { onClose: () => void; onWalletUpdate: () => void; sparkBalance: number; playerId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const meMarker = useRef<maplibregl.Marker | null>(null);
  const watchId = useRef<number | null>(null);
  const plotsRef = useRef<Map<string, Plot>>(new Map());
  const dropsRef = useRef<Map<string, Drop>>(new Map());
  const selectedRef = useRef<Cell | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [style, setStyle] = useState<'sat' | '3d'>('sat');
  const [fix, setFix] = useState<Fix | null>(null);
  const [locState, setLocState] = useState<'ask' | 'locating' | 'on' | 'denied'>('ask');
  const [selected, setSelected] = useState<Cell | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [plotName, setPlotName] = useState('');
  const [, force] = useState(0);
  const fixRef = useRef<Fix | null>(null);
  fixRef.current = fix;

  useEffect(() => { supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null)); }, []);

  const showToast = (ok: boolean, text: string) => { setToast({ ok, text }); window.setTimeout(() => setToast(null), 4200); };

  const renderLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const zoom = map.getZoom();
    const features: GeoJSON.Feature[] = [];
    const seen = new Set<string>();
    const kindOf = (k: string, p?: Plot) => dropsRef.current.has(k) ? 'sponsor' : p ? (isBoosted(p) ? 'boosted' : p.owner_id === userId ? 'mine' : 'owned') : 'free';
    if (zoom >= 15.5) {
      const b = map.getBounds();
      const s = Math.floor(b.getSouth() / CELL), n = Math.floor(b.getNorth() / CELL);
      const w = Math.floor(b.getWest() / CELL), e = Math.floor(b.getEast() / CELL);
      if ((n - s + 1) * (e - w + 1) <= 2500) {
        for (let la = s; la <= n; la++) for (let ln = w; ln <= e; ln++) {
          const c = { lat_i: la, lng_i: ln }; const k = keyOf(c); seen.add(k);
          const p = plotsRef.current.get(k);
          features.push({ type: 'Feature', properties: { key: k, kind: kindOf(k, p) }, geometry: { type: 'Polygon', coordinates: cellPolygon(c) } });
        }
      }
    }
    plotsRef.current.forEach((p, k) => {
      if (seen.has(k)) return;
      seen.add(k);
      features.push({ type: 'Feature', properties: { key: k, kind: kindOf(k, p) }, geometry: { type: 'Polygon', coordinates: cellPolygon(p) } });
    });
    dropsRef.current.forEach((d, k) => {
      if (seen.has(k)) return;
      features.push({ type: 'Feature', properties: { key: k, kind: 'sponsor' }, geometry: { type: 'Polygon', coordinates: cellPolygon(d) } });
    });
    const sel = selectedRef.current;
    const selFeatures: GeoJSON.Feature[] = sel ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: cellPolygon(sel) } }] : [];
    (map.getSource('cells') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
    (map.getSource('selected') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: selFeatures });
  }, [userId]);

  const loadPlots = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const b = map.getBounds();
    const { data } = await supabase.from('plots')
      .select('cell_key, lat_i, lng_i, owner_id, owner_name, name, visits, earned, boost_until')
      .gte('lat_i', Math.floor(b.getSouth() / CELL)).lte('lat_i', Math.floor(b.getNorth() / CELL))
      .gte('lng_i', Math.floor(b.getWest() / CELL)).lte('lng_i', Math.floor(b.getEast() / CELL))
      .limit(1000);
    (data ?? []).forEach((p) => plotsRef.current.set(p.cell_key, p as Plot));
    const { data: drops } = await supabase.from('sponsored_drops').select('id, cell_key, lat_i, lng_i, business_name, bonus')
      .gte('lat_i', Math.floor(b.getSouth() / CELL)).lte('lat_i', Math.floor(b.getNorth() / CELL))
      .gte('lng_i', Math.floor(b.getWest() / CELL)).lte('lng_i', Math.floor(b.getEast() / CELL)).limit(200);
    dropsRef.current = new Map((drops ?? []).map((d) => [d.cell_key, d as Drop]));
    renderLayers(); force((x) => x + 1);
  }, [renderLayers]);

  const addLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.getSource('cells')) map.addSource('cells', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    if (!map.getSource('selected')) map.addSource('selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    if (!map.getLayer('cells-fill')) map.addLayer({ id: 'cells-fill', type: 'fill', source: 'cells', paint: {
      'fill-color': ['match', ['get', 'kind'], 'mine', '#b9f17b', 'owned', '#e58a69', 'boosted', '#ffd23f', 'sponsor', '#b07cff', '#ffffff'],
      'fill-opacity': ['match', ['get', 'kind'], 'mine', 0.45, 'owned', 0.4, 'boosted', 0.6, 'sponsor', 0.55, 0.04],
    } });
    if (!map.getLayer('cells-line')) map.addLayer({ id: 'cells-line', type: 'line', source: 'cells', paint: {
      'line-color': ['match', ['get', 'kind'], 'mine', '#d4fa9e', 'owned', '#f2a283', 'boosted', '#fff36b', 'sponsor', '#d7b8ff', '#b9f17b'],
      'line-width': ['match', ['get', 'kind'], 'free', 0.5, 'boosted', 3, 'sponsor', 3, 1.5], 'line-opacity': 0.8,
    } });
    if (!map.getLayer('selected-line')) map.addLayer({ id: 'selected-line', type: 'line', source: 'selected', paint: { 'line-color': '#fff36b', 'line-width': 3 } });
    renderLayers();
  }, [renderLayers]);

  // init map
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({ container: containerRef.current, style: SATELLITE, center: FALLBACK, zoom: 15, pitch: 45, maxPitch: 75, attributionControl: { compact: true } });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    map.on('load', () => { addLayers(); loadPlots(); });
    map.on('moveend', () => { loadPlots(); });
    map.on('click', (e) => {
      const c = cellOf(e.lngLat.lat, e.lngLat.lng);
      selectedRef.current = c; setSelected(c); setPlotName(''); renderLayers();
    });
    return () => { map.remove(); mapRef.current = null; if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { renderLayers(); }, [userId, renderLayers]);

  // style switch
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(style === 'sat' ? SATELLITE : STREETS_3D);
    map.once('styledata', () => { window.setTimeout(addLayers, 50); });
  }, [style, addLayers]);

  const startLocation = () => {
    if (!navigator.geolocation) { setLocState('denied'); return; }
    setLocState('locating');
    let first = true;
    watchId.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const f = { lat: coords.latitude, lng: coords.longitude, acc: coords.accuracy };
        setFix(f); setLocState('on');
        const map = mapRef.current;
        if (!map) return;
        if (!meMarker.current) {
          const el = document.createElement('div');
          el.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#84c9d1;border:3px solid #fff;box-shadow:0 0 0 7px #84c9d144,0 0 18px #84c9d1';
          meMarker.current = new maplibregl.Marker({ element: el }).setLngLat([f.lng, f.lat]).addTo(map);
        } else meMarker.current.setLngLat([f.lng, f.lat]);
        if (first) {
          first = false;
          map.flyTo({ center: [f.lng, f.lat], zoom: 17.5, pitch: 55, duration: 1800 });
          const c = cellOf(f.lat, f.lng); selectedRef.current = c; setSelected(c); renderLayers();
        }
      },
      () => setLocState('denied'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  };

  const recenter = () => {
    const f = fixRef.current;
    if (!f) { startLocation(); return; }
    mapRef.current?.flyTo({ center: [f.lng, f.lat], zoom: 17.5, pitch: 55 });
    const c = cellOf(f.lat, f.lng); selectedRef.current = c; setSelected(c); renderLayers();
  };

  const selKey = selected ? keyOf(selected) : null;
  const selPlot = selKey ? plotsRef.current.get(selKey) : undefined;
  const myCell = fix ? keyOf(cellOf(fix.lat, fix.lng)) : null;
  const standingHere = !!selKey && selKey === myCell;
  const myPlots = [...plotsRef.current.values()].filter((p) => p.owner_id === userId);

  const doCheckIn = async () => {
    if (!fix) return;
    setBusy(true);
    const { data, error } = await supabase.rpc('check_in', { p_lat: fix.lat, p_lng: fix.lng, p_accuracy: fix.acc, p_player_id: playerId });
    setBusy(false);
    if (error) { showToast(false, error.message); return; }
    const r = data as { visitor_reward: number; owner_reward: number; owner_name: string | null; boost_bonus?: number; sponsor_bonus?: number; sponsor_name?: string | null };
    const total = r.visitor_reward + (r.boost_bonus ?? 0) + (r.sponsor_bonus ?? 0);
    showToast(true, `+${total} sparks for showing up${r.sponsor_bonus ? ` · ${r.sponsor_bonus} bonus from ${r.sponsor_name}` : ''}${r.boost_bonus ? ' · Rush Hour bonus!' : ''}${r.owner_name ? ` · ${r.owner_name} earned ${r.owner_reward}` : ''}`);
    onWalletUpdate(); loadPlots();
  };

  const doBoost = async () => {
    if (!selKey) return;
    setBusy(true);
    const { error } = await supabase.rpc('boost_plot', { p_cell_key: selKey, p_player_id: playerId });
    setBusy(false);
    if (error) { showToast(false, error.message); return; }
    showToast(true, 'Rush Hour is on! Your plot glows gold for 3 hours and visitors earn bonus sparks.');
    onWalletUpdate(); loadPlots();
  };

  const doBuy = async () => {
    if (!selected) return;
    setBusy(true);
    const { error } = await supabase.rpc('buy_plot', { p_lat_i: selected.lat_i, p_lng_i: selected.lng_i, p_name: plotName, p_player_id: playerId });
    setBusy(false);
    if (error) { showToast(false, error.message); return; }
    showToast(true, 'Plot is yours. You earn sparks every time someone checks in here.');
    onWalletUpdate(); loadPlots();
  };

  const btn: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 13px', borderRadius: 12, background: '#111a1eeb', border: '1px solid #34444a', color: '#e8f3ea', font: "600 11px 'DM Mono', monospace" };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: '#0b1215' }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />

      <div style={{ position: 'absolute', top: 14, left: 14, right: 60, display: 'flex', gap: 8, flexWrap: 'wrap', zIndex: 2 }}>
        <button style={btn} onClick={onClose}><X size={15} /> Close</button>
        <button style={btn} onClick={() => setStyle(style === 'sat' ? '3d' : 'sat')}><Layers size={15} /> {style === 'sat' ? '3D city' : 'Satellite'}</button>
        <button style={btn} onClick={recenter}><Crosshair size={15} /> Me</button>
        <span style={{ ...btn, color: '#b9f17b' }}><Sparkles size={14} /> {sparkBalance.toLocaleString()}</span>
      </div>

      {locState !== 'on' && (
        <div style={{ position: 'absolute', left: 14, right: 14, top: 70, zIndex: 3, padding: 18, borderRadius: 18, background: '#10191ef2', border: '1px solid #34444a', color: '#e8f3ea' }}>
          <p style={{ margin: 0, font: "600 10px 'DM Mono', monospace", letterSpacing: '.12em', color: '#b9f17b' }}>LIVE MAP</p>
          <h3 style={{ margin: '8px 0 6px', fontSize: 20 }}>{locState === 'denied' ? 'Location is off' : 'See what’s around you'}</h3>
          <p style={{ margin: '0 0 14px', fontSize: 13, color: '#9badab' }}>
            {locState === 'denied'
              ? 'Turn on location for this site in your browser settings to check in and earn. You can still browse and buy plots anywhere.'
              : 'Tap Allow so we can show you on the map. Earn sparks for showing up at real places. Your exact location is never shown to other players.'}
          </p>
          <button className="primary-button" onClick={startLocation} disabled={locState === 'locating'}>
            {locState === 'locating' ? <Loader2 className="spin" size={15} /> : <MapPin size={15} />} {locState === 'denied' ? 'Try again' : 'Allow location'}
          </button>
        </div>
      )}

      {selected && (
        <div style={{ position: 'absolute', left: 12, right: 12, bottom: 14, zIndex: 3, padding: 16, borderRadius: 20, background: '#10191ef5', border: '1px solid #34444a', color: '#e8f3ea', boxShadow: '0 12px 35px #0008' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <small style={{ font: "600 10px 'DM Mono', monospace", letterSpacing: '.1em', color: selPlot ? (selPlot.owner_id === userId ? '#b9f17b' : '#f2a283') : '#9badab' }}>
              {selPlot ? (selPlot.owner_id === userId ? 'YOUR PLOT' : 'OWNED PLOT') : 'OPEN PLOT'} · {selKey}
            </small>
            <button onClick={() => { selectedRef.current = null; setSelected(null); renderLayers(); }} style={{ background: 'transparent', color: '#9badab' }}><X size={16} /></button>
          </div>
          {selKey && dropsRef.current.get(selKey) && <p style={{ margin: '8px 0 0', fontSize: 13, color: '#d7b8ff' }}>⭐ Sponsored by <strong>{dropsRef.current.get(selKey)!.business_name}</strong> · +{dropsRef.current.get(selKey)!.bonus} bonus sparks for checking in</p>}
          {isBoosted(selPlot) && <p style={{ margin: '8px 0 0', fontSize: 13, color: '#ffd23f' }}>⚡ Rush Hour until {new Date(selPlot!.boost_until!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · +5 bonus sparks for visitors</p>}
          {selPlot ? (
            <p style={{ margin: '8px 0 12px', fontSize: 14 }}><strong>{selPlot.name ?? 'Plot'}</strong> · owned by {selPlot.owner_id === userId ? 'you' : (selPlot.owner_name ?? 'a player')} · {selPlot.visits} visits{selPlot.owner_id === userId ? ` · ${selPlot.earned} sparks earned` : ''}</p>
          ) : (
            <div style={{ margin: '8px 0 12px' }}>
              <p style={{ margin: '0 0 8px', fontSize: 13, color: '#9badab' }}>Own this spot for {PLOT_PRICE} sparks. Collect 2 sparks rent every time another player checks in here, or 6 during Rush Hour. Members can cash out rent within their plan's monthly limit.</p>
              <input value={plotName} onChange={(e) => setPlotName(e.target.value)} maxLength={40} placeholder="Name your plot (optional)"
                style={{ width: '100%', padding: '9px 11px', borderRadius: 10, background: '#0b1215', border: '1px solid #34444a', color: '#e8f3ea', fontSize: 13 }} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {standingHere && (
              <button className="primary-button" onClick={doCheckIn} disabled={busy}>
                {busy ? <Loader2 className="spin" size={15} /> : <Footprints size={15} />} Check in · +{(selPlot && selPlot.owner_id !== userId ? 8 : 5) + (selPlot && selPlot.owner_id !== userId && isBoosted(selPlot) ? 5 : 0) + (dropsRef.current.get(selKey!)?.bonus ?? 0)}
              </button>
            )}
            {selPlot && selPlot.owner_id === userId && (
              <button className="primary-button" onClick={doBoost} disabled={busy || sparkBalance < BOOST_PRICE} style={{ background: sparkBalance < BOOST_PRICE ? '#3a4a44' : '#ffd23f', color: '#132019' }}>
                {busy ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />} {isBoosted(selPlot) ? 'Extend' : 'Rush Hour'} · 3h · {BOOST_PRICE} sparks
              </button>
            )}
            {!selPlot && (
              <button className="primary-button" onClick={doBuy} disabled={busy || sparkBalance < PLOT_PRICE} style={{ background: sparkBalance < PLOT_PRICE ? '#3a4a44' : undefined }}>
                {busy ? <Loader2 className="spin" size={15} /> : <Home size={15} />} {sparkBalance < PLOT_PRICE ? `Need ${PLOT_PRICE} sparks` : `Buy · ${PLOT_PRICE} sparks`}
              </button>
            )}
            {!standingHere && fix && <small style={{ alignSelf: 'center', color: '#9badab', fontSize: 11 }}>Walk to a spot to check in there.</small>}
          </div>
          {myPlots.length > 0 && <small style={{ display: 'block', marginTop: 10, color: '#9badab', fontSize: 11 }}>You own {myPlots.length} plot{myPlots.length > 1 ? 's' : ''} in view.</small>}
        </div>
      )}

      {toast && (
        <div onClick={() => setToast(null)} style={{ position: 'absolute', left: 14, right: 14, top: 70, zIndex: 4, padding: '12px 14px', borderRadius: 14, background: toast.ok ? '#b9f17b' : '#efad93', color: '#132019', fontSize: 13, fontWeight: 600 }}>{toast.text}</div>
      )}
    </div>
  );
}

var wms_layers = [];

// A light street map makes the province-wide distribution easier to read.
// Satellite sources remain available for inspecting an individual location.
var lyr_AtlasStreet_9 = new ol.layer.Tile({
    title: 'Peta jalan',
    type: 'base',
    source: new ol.source.XYZ({
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attributions: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
        maxZoom: 19
    })
});


// Satellite alternatives, radio-switched ('type': 'base'). Google is listed
// before Esri for closer field inspection: over
// Jambi, Google carries imagery to z21 while Esri's World Imagery stops at z18.
// Probed 2026-09-15 at Jambi city, Kerinci and open country between them —
// every z19 tile came back as the same 2521-byte "Map data not yet available"
// placeholder (md5 f27d9de7f80c13501f470595e327aa6d). Two extra zoom levels
// decide whether an installer can see the pole itself or only the block it
// stands on, so the sharper source leads. See docs/basemaps.md.
        var lyr_GoogleSatellite_0 = new ol.layer.Tile({
            'title': 'Google Satelit',
            'type': 'base',
            'opacity': 1.000000,
            
            
            source: new ol.source.XYZ({
            attributions: 'Tiles &copy; Google',
                url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}',
                maxZoom: 21
            })
        });
// Esri World Imagery: the licensed way to get essentially the same commercial
// imagery. mt1.google.com is an internal Google endpoint — no key, no SLA, no
// licence — so the day it starts refusing us, this keeps the page showing a
// map instead of a grey void. Attribution text is the service's own
// copyrightText verbatim (Vantor is Maxar Intelligence, renamed October 2025).
var lyr_EsriWorldImagery_8 = new ol.layer.Tile({
            'title': 'Esri Satelit',
            'type': 'base',
            'opacity': 1.000000,
            source: new ol.source.XYZ({
                attributions: 'Citra &copy; <a href="https://www.arcgis.com/home/item.html?id=10df2279f9684e4a9f6a7f08febac2a9" target="_blank" rel="noopener">Esri</a>, Vantor, Earthstar Geographics, and the GIS User Community',
                url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
                // Capped at the last level that actually has pixels here.
                // OpenLayers then stretches z18 for z19+ — a soft image beats
                // the tiled "not yet available" placeholder, which reads as a
                // broken map rather than as the edge of the data.
                maxZoom: 18
            })
        });
// The switcher reverses array order: street map first, then Google and Esri.
var group_Basemap = new ol.layer.Group({
                                layers: [lyr_EsriWorldImagery_8, lyr_GoogleSatellite_0, lyr_AtlasStreet_9],
                                fold: 'open',
                                title: 'Peta Dasar'});
// BIG national administrative boundaries, service edition June 2026.
// Snapshot/provenance: data/boundaries-source.json and docs/boundary-data.md.
var batasBigAttribution = 'Batas &copy; <a href="https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KABKOTA_AR/MapServer" target="_blank" rel="noopener">BIG</a> &middot; Juni 2026';
var format_BatasKabupaten_1 = new ol.format.GeoJSON();
var features_BatasKabupaten_1 = format_BatasKabupaten_1.readFeatures(json_BatasKabupaten_1,
            {dataProjection: 'EPSG:4326', featureProjection: 'EPSG:3857'});
var jsonSource_BatasKabupaten_1 = new ol.source.Vector({
    attributions: [batasBigAttribution],
});
jsonSource_BatasKabupaten_1.addFeatures(features_BatasKabupaten_1);
var lyr_BatasKabupaten_1 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_BatasKabupaten_1,
                style: style_BatasKabupaten_1,
                popuplayertitle: 'Batas Kabupaten/Kota',
                interactive: false,
                title: 'Batas Kabupaten/Kota'
            });
// The dissolved province polygon is fetched by URL instead of being inlined as
// a <script> so it does not sit on the critical path ahead of the
// map. It is shared by two layers below — Area Cakupan (the dashed outline,
// hidden by default) and Fokus Provinsi (the mask, on by default). The mask
// renders from first paint, so the fetch does start at load, but off the
// critical path: the map is already interactive when the scrim fades in.
var jsonSource_Dissolved_2 = new ol.source.Vector({
    attributions: [batasBigAttribution],
    // No ?v= token on data files: Caddy already serves /data/* as
    // "no-cache, must-revalidate", so a token buys nothing — and it would break
    // the <link rel=preload> in index.html, because bump-version.sh rewrites
    // every ?v= there but never touches this file. Mismatched URLs = two fetches.
    url: './data/dissolved.geojson',
    format: new ol.format.GeoJSON()
});
var lyr_Dissolved_2 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_Dissolved_2, 
                style: style_Dissolved_2,
                popuplayertitle: 'Area Cakupan',
                interactive: false,
                title: 'Area Cakupan'
            });
// Fokus Provinsi: the same polygon drawn inside out as a dark scrim over
// everything that is not Jambi (styles/Dissolved_2_style.js). Figure-ground:
// the province becomes the shape on the page instead of one equally bright
// patch of satellite among its neighbours. Sits above the imagery and below
// the boundary lines so the outer edge of the province stays crisp.
var lyr_FokusProvinsi_7 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_Dissolved_2,
                style: style_FokusProvinsi,
                popuplayertitle: 'Fokus Provinsi',
                interactive: false,
                title: 'Fokus Provinsi'
            });
var jsonSource_260331_4 = new ol.source.Vector({
    attributions: [],
    url: './data/points.geojson',
    format: new ol.format.GeoJSON()
});
// declutter stays OFF. It was tried as a way to cut the ~14ms the 471 pins add
// to every panned frame, and it worked, but it drops any icon overlapping one
// already drawn: at the default province zoom that hid 94 of the 414 points in
// view (22%), and 28% at zoom 9. This is a coverage map — the pattern of dots is
// the finding, so thinning it silently misreports how much of Jambi was surveyed.
// Never trade completeness of this layer for frame rate.
var lyr_260331_4 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_260331_4,
                style: style_260331_4,
                popuplayertitle: 'Titik PJUTS',
                interactive: true,
                title: '<img src=\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="14" height="18" viewBox="0 0 36 48"><path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="%23fee50f" stroke="%23293d50" stroke-width="2"/><circle cx="18" cy="18" r="6.5" fill="%23293d50"/></svg>\' /> Titik PJUTS'
            });
// Titik Cadangan: the surplus survey rows (Status "Cadangan") live in the same
// geojson as the SK points, so this layer shares jsonSource_260331_4 — one
// download, two layers. custom.js gives each layer a style function that only
// draws its own half of the source, so the two switcher checkboxes work
// independently. Hidden by default: cadangan is a reserve list, not the
// finding, and showing it unasked made the coverage look larger than it is.
// style: null renders nothing until custom.js installs the real style.
var lyr_Cadangan_5 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_260331_4,
                style: null,
                popuplayertitle: 'Titik Cadangan',
                interactive: true,
                title: '<img src=\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="14" height="18" viewBox="0 0 36 48"><defs><pattern id="h" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="%23e3e8ed"/><rect width="1.6" height="4" fill="%23293d50" fill-opacity="0.45"/></pattern></defs><path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="url(%23h)" stroke="%23293d50" stroke-width="2"/><circle cx="18" cy="18" r="6.5" fill="%23ffffff" stroke="%23293d50" stroke-width="1.2"/></svg>\' /> Titik Cadangan'
            });
// Titik Belum Ditetapkan: allocation units the survey has not placed yet
// (Status "Belum Ditetapkan"). They still count toward the pengusul's quota,
// so they stay in the list, but the pin is only an estimate dropped near the
// sibling points. Same shared source as above. Visible by default — the whole
// point of the layer is that the installer sees there is a unit still to
// place; hiding it would recreate the gap it exists to close.
var lyr_BelumDitetapkan_6 = new ol.layer.Vector({
                declutter: false,
                source:jsonSource_260331_4,
                style: null,
                // Above the SK pins: the estimate sits between its siblings,
                // which at village zoom would otherwise cover it entirely.
                zIndex: 1,
                popuplayertitle: 'Lokasi Belum Ditetapkan',
                interactive: true,
                title: '<img src=\'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="14" height="18" viewBox="0 0 36 48"><path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="%23f4f6f8" stroke="%236b7a8c" stroke-width="2.2" stroke-dasharray="4 3"/><text x="18" y="25" text-anchor="middle" font-family="Arial, sans-serif" font-weight="700" font-size="19" fill="%23293d50">?</text></svg>\' /> Lokasi Belum Ditetapkan'
            });
// The switcher lists a group's layers top-down in reverse array order, so
// Cadangan goes first to sit under Titik PJUTS in the panel (and under the
// SK pins on the map); Belum Ditetapkan sits between them.
var group_RAW = new ol.layer.Group({
                                layers: [lyr_Cadangan_5, lyr_BelumDitetapkan_6, lyr_260331_4,],
                                fold: 'open',
                                title: 'Data Lapangan'});

lyr_AtlasStreet_9.setVisible(true);lyr_GoogleSatellite_0.setVisible(false);lyr_EsriWorldImagery_8.setVisible(false);lyr_FokusProvinsi_7.setVisible(true);lyr_BatasKabupaten_1.setVisible(true);lyr_Dissolved_2.setVisible(false);lyr_260331_4.setVisible(true);lyr_Cadangan_5.setVisible(false);lyr_BelumDitetapkan_6.setVisible(true);
// "Ruas Jalan" is intentionally not loaded; it duplicated the kabupaten
// boundary, which is drawn (outline + label) by lyr_BatasKabupaten_1.
// Area Cakupan (Dissolved) and the Fokus Provinsi mask both sit below the
// boundary so neither fill ever hides the line.
var layersList = [group_Basemap,lyr_FokusProvinsi_7,lyr_Dissolved_2,lyr_BatasKabupaten_1,group_RAW];
lyr_BatasKabupaten_1.set('fieldAliases', {'KABUPATEN_': 'Kabupaten/Kota', 'KDPKAB': 'Kode Wilayah', 'WADMPR': 'Provinsi', 'METADATA': 'Metadata BIG'});
lyr_Dissolved_2.set('fieldAliases', {'WADMPR': 'Provinsi'});
lyr_260331_4.set('fieldAliases', {'fid': 'ID', 'Nomor': 'Nomor Titik', 'Nama Anggota': 'Petugas Survey', 'Alamat': 'Alamat', 'Longitude': 'Longitude', 'Latitude': 'Latitude', 'Tanggal Dokumentasi': 'Tanggal Dokumentasi', 'Keterangan': 'Keterangan', 'layer': 'Layer', 'Foto Survey Awal': 'Foto Lokasi', 'Toleransi': 'Toleransi', });
lyr_BatasKabupaten_1.set('fieldImages', {'KABUPATEN_': 'TextEdit', 'KDPKAB': 'TextEdit', 'WADMPR': 'TextEdit', 'METADATA': 'TextEdit'});
lyr_Dissolved_2.set('fieldImages', {'WADMPR': 'TextEdit'});
lyr_260331_4.set('fieldImages', {'fid': 'TextEdit', 'Nomor': 'TextEdit', 'Nama Anggota': 'TextEdit', 'Alamat': 'TextEdit', 'Longitude': 'TextEdit', 'Latitude': 'TextEdit', 'Tanggal Dokumentasi': 'TextEdit', 'Keterangan': 'TextEdit', 'layer': 'TextEdit', 'Foto Survey Awal': 'ExternalResource', 'Toleransi': '', });
lyr_BatasKabupaten_1.set('fieldLabels', {'KABUPATEN_': 'header label - always visible', 'KDPKAB': 'no label', 'WADMPR': 'no label', 'METADATA': 'no label'});
lyr_Dissolved_2.set('fieldLabels', {'WADMPR': 'no label'});
lyr_260331_4.set('fieldLabels', {'fid': 'hidden field', 'Nomor': 'inline label - always visible', 'Nama Anggota': 'inline label - visible with data', 'Alamat': 'inline label - visible with data', 'Longitude': 'hidden field', 'Latitude': 'hidden field', 'Tanggal Dokumentasi': 'inline label - visible with data', 'Keterangan': 'inline label - visible with data', 'layer': 'hidden field', 'Foto Survey Awal': 'inline label - visible with data', 'Toleransi': 'hidden field', });
// Same attributes, same field metadata: qgis2web's popup helpers read these
// off whichever layer the feature was hit on.
lyr_Cadangan_5.set('fieldAliases', lyr_260331_4.get('fieldAliases'));
lyr_Cadangan_5.set('fieldImages', lyr_260331_4.get('fieldImages'));
lyr_Cadangan_5.set('fieldLabels', lyr_260331_4.get('fieldLabels'));
lyr_BelumDitetapkan_6.set('fieldAliases', lyr_260331_4.get('fieldAliases'));
lyr_BelumDitetapkan_6.set('fieldImages', lyr_260331_4.get('fieldImages'));
lyr_BelumDitetapkan_6.set('fieldLabels', lyr_260331_4.get('fieldLabels'));
lyr_260331_4.on('precompose', function(evt) {
    evt.context.globalCompositeOperation = 'normal';
});

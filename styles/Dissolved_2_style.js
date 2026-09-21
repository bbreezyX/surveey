var size = 0;
var placement = 'point';

var style_Dissolved_2 = function(feature, resolution){
    var context = {
        feature: feature,
        variables: {}
    };
    
    var style = [ new ol.style.Style({
        fill: new ol.style.Fill({color: 'rgba(245, 158, 11, 0.10)'}),
        stroke: new ol.style.Stroke({color: 'rgba(245, 158, 11, 0.6)', width: 1.5, lineDash: [6, 4]})
    })];

    return style;
};

// ---------- Fokus Provinsi (mask) ----------
//
// Same dissolved polygon, drawn inside out: a world-sized rectangle with the
// province cut out of it, filled with a dark scrim. Everything outside Jambi
// drops back and the survey area becomes the figure — on satellite imagery the
// neighbouring provinces are otherwise exactly as bright as the one the map is
// about, and the eye has nothing to tell it where the project stops.
//
// The inverted geometry is built once per feature revision and cached on the
// feature itself; the style only ever hands the renderer that cached polygon.

var FOKUS_WORLD_3857 = 20037508.342789244;

// Shoelace signed area. Sign is all we need: canvas fills with the nonzero
// rule, so the outer ring and every hole must wind in opposite directions or a
// hole winds to 2 instead of 0 and paints as solid scrim over the province.
function fokusRingArea(ring) {
    var area = 0;
    for (var i = 0, n = ring.length - 1; i < n; i++) {
        area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return area / 2;
}

function fokusExteriorRings(geometry) {
    var type = geometry.getType();
    if (type === 'Polygon') {
        return [geometry.getCoordinates()[0]];
    }
    if (type === 'MultiPolygon') {
        return geometry.getCoordinates().map(function(polygon) {
            return polygon[0];
        });
    }
    return [];
}

function fokusInvertedGeometry(feature) {
    var geometry = feature.getGeometry();
    if (!geometry) {
        return null;
    }
    var revision = geometry.getRevision();
    var cached = feature.get('_fokusMask');
    if (cached && cached.revision === revision) {
        return cached.geometry;
    }

    // Holes counter-clockwise (positive area), outer ring clockwise.
    var holes = fokusExteriorRings(geometry).map(function(ring) {
        return fokusRingArea(ring) < 0 ? ring.slice().reverse() : ring;
    });
    var w = FOKUS_WORLD_3857;
    var outer = [[-w, -w], [-w, w], [w, w], [w, -w], [-w, -w]];
    var inverted = new ol.geom.Polygon([outer].concat(holes));

    feature.set('_fokusMask', { revision: revision, geometry: inverted }, true);
    return inverted;
}

var fokusMaskFill = new ol.style.Fill({ color: 'rgba(10, 20, 32, 0.5)' });
var fokusLightFill = new ol.style.Fill({ color: 'rgba(239, 244, 234, 0.72)' });

var style_FokusProvinsi = function(feature, resolution){
    var inverted = fokusInvertedGeometry(feature);
    if (!inverted) {
        return null;
    }
    return [ new ol.style.Style({
        geometry: inverted,
        fill: window.lyr_AtlasStreet_9 && lyr_AtlasStreet_9.getVisible() ? fokusLightFill : fokusMaskFill
    })];
};

var size = 0;
var placement = 'point';

// ---------- Kabupaten/kota boundaries + labels ----------
//
// Cartographic hierarchy: the survey points are the figure, this layer is the
// reference frame. So the line is a thin white hairline and the label is a
// medium-weight title-case name that fades out as you zoom in — by zoom 11 the
// pins are the story and a bold "KAB. TANJUNG JABUNG BARAT" across them is the
// loudest thing on screen for no reason. Fading rather than switching off keeps
// the zoom animation from popping labels.

var kabBoundaryStyle = new ol.style.Style({
    stroke: new ol.style.Stroke({color: 'rgba(255, 255, 255, 0.8)', width: 1.25})
});
var kabBoundaryLightStyle = new ol.style.Style({
    stroke: new ol.style.Stroke({color: 'rgba(66, 100, 83, 0.65)', width: 1.2}),
    fill: new ol.style.Fill({color: 'rgba(245, 249, 240, 0.24)'})
});

// "KAB. TANJUNG JABUNG BARAT" -> "Kab. Tanjung Jabung Barat". The source field
// is shouted uppercase; title case reads a step quieter at the same size.
var kabLabelTextCache = {};
function kabLabelText(raw) {
    var key = String(raw || '');
    if (kabLabelTextCache[key] === undefined) {
        kabLabelTextCache[key] = key
            .toLowerCase()
            .replace(/\b[a-z]/g, function(letter) { return letter.toUpperCase(); })
            .trim();
    }
    return kabLabelTextCache[key];
}

// Fully opaque at province scale, gone once the resolution is below ~60 m/px
// (zoom ~11.3). Quantised to tenths so the style cache stays small.
function kabLabelAlpha(resolution) {
    var t = (resolution - 60) / 80;
    t = Math.max(0, Math.min(1, t));
    return Math.round(t * 10) / 10;
}

// One label per kabupaten. Several are MultiPolygons (Tanjung Jabung Timur is
// a mainland plus coastal islands), and point placement on a MultiPolygon
// labels every part — three "Kab. Tanjung Jabung Timur" on screen at once. The
// label geometry is the interior point of the largest part instead, cached on
// the feature against its geometry revision.
function kabLabelPoint(feature) {
    var geometry = feature.getGeometry();
    if (!geometry) {
        return null;
    }
    var revision = geometry.getRevision();
    var cached = feature.get('_kabLabelPoint');
    if (cached && cached.revision === revision) {
        return cached.point;
    }
    var point = null;
    if (geometry.getType() === 'MultiPolygon') {
        var largest = null;
        var largestArea = -1;
        geometry.getPolygons().forEach(function(polygon) {
            var area = polygon.getArea();
            if (area > largestArea) {
                largestArea = area;
                largest = polygon;
            }
        });
        point = largest ? largest.getInteriorPoint() : null;
    } else if (geometry.getType() === 'Polygon') {
        point = geometry.getInteriorPoint();
    }
    feature.set('_kabLabelPoint', { revision: revision, point: point }, true);
    return point;
}

var kabLabelTextStyleCache = {};
function kabLabelTextStyle(text, alpha) {
    var light = window.lyr_AtlasStreet_9 && lyr_AtlasStreet_9.getVisible();
    var key = light + '|' + alpha + '|' + text;
    if (!kabLabelTextStyleCache[key]) {
        kabLabelTextStyleCache[key] = new ol.style.Text({
            text: text,
            font: '600 12.5px Manrope, "Source Sans 3", system-ui, sans-serif',
            textAlign: 'center',
            textBaseline: 'middle',
            fill: new ol.style.Fill({ color: light ? 'rgba(40, 65, 53, ' + alpha + ')' : 'rgba(255, 255, 255, ' + (0.96 * alpha) + ')' }),
            stroke: new ol.style.Stroke({ color: light ? 'rgba(255, 255, 255, ' + alpha + ')' : 'rgba(11, 41, 66, ' + (0.7 * alpha) + ')', width: 3 })
        });
    }
    return kabLabelTextStyleCache[key];
}

var style_BatasKabupaten_1 = function(feature, resolution){
    var styles = [window.lyr_AtlasStreet_9 && lyr_AtlasStreet_9.getVisible() ? kabBoundaryLightStyle : kabBoundaryStyle];
    var alpha = kabLabelAlpha(resolution);
    var raw = feature.get("KABUPATEN_");
    if (alpha > 0 && raw !== null && raw !== undefined && raw !== '') {
        var point = kabLabelPoint(feature);
        if (point) {
            styles.push(new ol.style.Style({
                geometry: point,
                text: kabLabelTextStyle(kabLabelText(raw), alpha)
            }));
        }
    }
    return styles;
};

var size = 0;
var placement = 'point';

// Six SVG units of transparent padding keep the stroke and shadow inside the
// image. The silhouette still renders at 24 x 32px; its tip is at y=54 of 60.
var pinSvg_260331_4 =
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="-6 -6 48 60">' +
        '<filter id="p" filterUnits="userSpaceOnUse" x="-6" y="-6" width="48" height="60"><feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-opacity="0.4"/></filter>' +
        '<path filter="url(%23p)" d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="%23fee50f" stroke="%23293d50" stroke-width="2"/>' +
        '<circle cx="18" cy="18" r="6.5" fill="%23293d50"/>' +
    '</svg>';
var pinIcon_260331_4 = new ol.style.Icon({
    src: 'data:image/svg+xml,' + pinSvg_260331_4,
    anchor: [0.5, 0.9],
    anchorXUnits: 'fraction',
    anchorYUnits: 'fraction',
    scale: 1
});

// Zoomed out past this resolution the points are drawn as plain dots instead of
// pins. 76 m/px is about zoom 11: wider than that and most of the province is on
// screen, where a 24x32 pin with a drop shadow is far too small to read as a pin
// anyway — but all 471 of them still cost ~17ms of every panned frame. Dots carry
// the same information there for a third less work (21.0ms -> 14.9ms measured on
// a 4x-throttled mid-range phone profile).
//
// Nothing is ever hidden: every point is drawn at every zoom. Declutter was tried
// as the alternative and rejected because it culled 22% of them — see the note in
// layers/layers.js. The selected point is drawn by custom.js on its own overlay,
// so it stays a full pin regardless of zoom.
var PIN_MAX_RESOLUTION_260331_4 = 76;

// Both styles are built once. The label branch qgis2web generates here is dead —
// this layer has no label field, so it only ever produced an empty text style.
var pinStyle_260331_4 = [new ol.style.Style({
    image: pinIcon_260331_4
})];

var dotStyle_260331_4 = [new ol.style.Style({
    image: new ol.style.Circle({
        radius: 4.5,
        fill: new ol.style.Fill({color: '#fee50f'}),
        stroke: new ol.style.Stroke({color: '#293d50', width: 1.6})
    })
})];

var style_260331_4 = function(feature, resolution){
    return resolution > PIN_MAX_RESOLUTION_260331_4
        ? dotStyle_260331_4
        : pinStyle_260331_4;
};

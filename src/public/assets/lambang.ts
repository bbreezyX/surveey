// The emblem renders at 30 px (masthead) and 38 px (sidebar head); with
// `sizes` set per use, each screen density picks the smallest copy that stays
// sharp instead of always fetching the 3x one. `no-inline` keeps Vite from
// base64-ing the small copies into the JS bundle, which would ship every
// variant on the critical path.
import w38 from './lambang-jambi-38.webp?no-inline';
import w60 from './lambang-jambi-60.webp?no-inline';
import w76 from './lambang-jambi-76.webp?no-inline';
import w114 from './lambang-jambi-114.webp?no-inline';
export const lambang = w76;
export const lambangSrcset = `${w38} 38w, ${w60} 60w, ${w76} 76w, ${w114} 114w`;

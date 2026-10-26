import { PROGRESS_URL, parsePending, parseProgress, type SurveyPending, type SurveyProgress } from '../../shared/survey/progress';
// Optional: the map is whole without it. A slow or failed esdm.cloud leaves the pins as they were.
const URL_OVERRIDE: string = import.meta.env.VITE_PROGRESS_URL ?? '';
export type ProgressFeed = { stages: SurveyProgress; pending: SurveyPending };
export async function loadProgress(signal: AbortSignal): Promise<ProgressFeed | null> {
  // AbortSignal.any is too new for the older phones crews carry, so one controller follows both.
  const attempt = new AbortController(), abort = () => attempt.abort();
  signal.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(abort, 15_000);
  try {
    // esdm.cloud lets browsers keep the list for 60 s, so a stage accepted there a moment ago stayed
    // hidden until a hard refresh. no-cache always asks esdm.cloud; the list is only a few KB.
    const response = await fetch(URL_OVERRIDE || PROGRESS_URL, { signal: attempt.signal, credentials: 'omit', cache: 'no-cache' });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    return { stages: parseProgress(value), pending: parsePending(value) };
  } catch {
    return null;
  } finally {
    clearTimeout(deadline); signal.removeEventListener('abort', abort);
  }
}

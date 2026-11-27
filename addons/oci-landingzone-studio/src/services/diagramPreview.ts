import type { LzModel } from '../model/types';
import type { DiagramPreview, DiagramPreviewResult } from './diagramPreview.worker';
import { realmSelectionError } from './realmCatalog';
import { buildConfig } from './lzConfig';

export function loadDiagramPreview(model: LzModel, signal: AbortSignal): Promise<DiagramPreview> {
  const realmError = realmSelectionError(model.foundation);
  if (realmError) return Promise.reject(new Error(realmError));
  if (signal.aborted) return Promise.reject(new Error('Diagram preview cancelled.'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./diagramPreview.worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => { cleanup(); reject(new Error('Diagram preview cancelled.')); };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Diagram generation took too long. Retry after reviewing the design inputs.'));
    }, 30_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<DiagramPreviewResult>) => {
      cleanup();
      if (event.data.ok) resolve(event.data.preview);
      else reject(new Error(event.data.message));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      cleanup();
      reject(new Error('Could not load the diagram generator. Retry or reload Studio.'));
    };
    const profile = buildConfig(model).realm_profile;
    // Workers use the same effective profile as exports, including removal of
    // an imported snapshot when the shared catalog restores built-in defaults.
    worker.postMessage(profile || model.foundation.realmProfile
      ? { ...model, foundation: { ...model.foundation, realmProfile: profile } } : model);
  });
}

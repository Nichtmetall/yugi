// Kartensuche im Hintergrund, damit Sucher und Rahmen auch auf langsamen Handys fluessig bleiben.
import { detectCard, type Quad } from './detect';

export interface DetectRequest {
  id: number;
  data: Uint8ClampedArray;
  width: number;
  height: number;
  prev: Quad | null;
}

export interface DetectResponse {
  id: number;
  quad: Quad | null;
}

self.onmessage = (ev: MessageEvent<DetectRequest>) => {
  const { id, data, width, height, prev } = ev.data;
  const res: DetectResponse = { id, quad: detectCard({ data, width, height }, prev) };
  self.postMessage(res);
};

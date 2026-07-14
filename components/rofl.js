// 브라우저 File → .rofl 파싱 (공용 파서 래퍼).
import { parseRoflBuffer } from '../src/rofl.js';

export async function parseRofl(file) {
  return parseRoflBuffer(new Uint8Array(await file.arrayBuffer()));
}

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const INPUT_CONFIG = [
  '# MediaNest runtime bindings; independent of the user mpv configuration.',
  'ENTER quit',
  'KP_ENTER quit',
  'LEFT seek -5 relative+keyframes',
  'RIGHT seek 5 relative+keyframes',
  '',
].join('\n');

export function ensureMpvInputConfig(userDataPath: string): string {
  const inputPath = join(userDataPath, 'medianest-mpv-input.conf');
  if (!existsSync(inputPath) || readFileSync(inputPath, 'utf8') !== INPUT_CONFIG) {
    writeFileSync(inputPath, INPUT_CONFIG, 'utf8');
  }
  return inputPath;
}

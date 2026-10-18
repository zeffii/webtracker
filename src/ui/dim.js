// How dimmed a lane is drawn, 0 (normal) to 1 (soloed away). It eases toward its target between draws: slowly
// into the dim (half a second), quickly back out, so a lane that comes back is seen and heard at once.
const levels = new WeakMap();
export const FADE_OUT = 0.5, FADE_IN = 0.12;
export function dimLevel(lane, target = lane.soloMuted ? 1 : 0, now = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
  const s = levels.get(lane) ?? { level: target, at: now };
  const dt = Math.max(0, now - s.at) / 1000;
  if (s.level < target) s.level = Math.min(target, s.level + dt / FADE_OUT);
  else if (s.level > target) s.level = Math.max(target, s.level - dt / FADE_IN);
  s.at = now;
  levels.set(lane, s);
  return s.level;
}
// The CSS filter for a dim level: a little darker, a little less saturated.
export const dimFilter = d => (d > 0.002 ? `filter:brightness(${(1 - 0.3 * d).toFixed(3)}) saturate(${(1 - 0.25 * d).toFixed(3)})` : '');

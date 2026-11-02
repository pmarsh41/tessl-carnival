import { canvasFont, recordScore, theme, type CarnivalGame } from '../../carnival';

const { width: WIDTH, height: HEIGHT } = theme.canvas;

export const TANK_SIZE = 15;
export const SHOT_SPEED = 700;
export const CANNON = { x: WIDTH / 2, y: HEIGHT - 30 } as const;
const RAILS = [
  { y: 110, speed: 180, radius: 22 },
  { y: 200, speed: -120, radius: 28 },
  { y: 290, speed: 60, radius: 34 },
];
const TARGETS_PER_RAIL = 3;

export interface Target {
  x: number;
  y: number;
  radius: number;
  /** Pixels per second; negative moves left. */
  speed: number;
}

export interface Shot {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Splash {
  x: number;
  y: number;
  age: number;
}

export interface WaterCannonState {
  targets: Target[];
  shots: Shot[];
  splashes: Splash[];
  tank: number;
  score: number;
  phase: 'playing' | 'over';
}

export function createState(): WaterCannonState {
  const spacing = WIDTH / TARGETS_PER_RAIL;
  const targets = RAILS.flatMap((rail) =>
    Array.from({ length: TARGETS_PER_RAIL }, (_, i) => ({
      x: spacing * i + spacing / 2,
      y: rail.y,
      radius: rail.radius,
      speed: rail.speed,
    })),
  );
  return { targets, shots: [], splashes: [], tank: TANK_SIZE, score: 0, phase: 'playing' };
}

/** Faster targets are worth more: 10 points per 60 px/s, rounded up. */
export function scoreForHit(target: Target): number {
  return 10 * Math.ceil(Math.abs(target.speed) / 60);
}

export function isHit(shot: Shot, target: Target): boolean {
  return Math.hypot(shot.x - target.x, shot.y - target.y) <= target.radius;
}

/** Fires one shot of water towards the aim point. Returns false if nothing fired. */
export function fire(state: WaterCannonState, aimX: number, aimY: number): boolean {
  if (state.phase !== 'playing' || state.tank === 0) return false;
  const dx = aimX - CANNON.x;
  const dy = Math.min(aimY - CANNON.y, -1);
  const length = Math.hypot(dx, dy);
  state.shots.push({
    x: CANNON.x,
    y: CANNON.y,
    vx: (dx / length) * SHOT_SPEED,
    vy: (dy / length) * SHOT_SPEED,
  });
  state.tank -= 1;
  return true;
}

/** Advances the game by `dt` seconds. */
export function step(state: WaterCannonState, dt: number): void {
  for (const target of state.targets) {
    target.x += target.speed * dt;
    if (target.x > WIDTH + target.radius) target.x = -target.radius;
    if (target.x < -target.radius) target.x = WIDTH + target.radius;
  }

  const remaining: Shot[] = [];
  for (const shot of state.shots) {
    shot.x += shot.vx * dt;
    shot.y += shot.vy * dt;
    const target = state.targets.find((t) => isHit(shot, t));
    if (target) {
      state.score += scoreForHit(target);
      state.splashes.push({ x: target.x, y: target.y, age: 0 });
      // Send the soaked target back to the start of its rail.
      target.x = target.speed > 0 ? -target.radius : WIDTH + target.radius;
    } else if (shot.y > -10 && shot.x > -10 && shot.x < WIDTH + 10) {
      remaining.push(shot);
    }
  }
  state.shots = remaining;

  for (const splash of state.splashes) splash.age += dt;
  state.splashes = state.splashes.filter((s) => s.age < 0.4);

  if (state.tank === 0 && state.shots.length === 0) state.phase = 'over';
}

/**
 * The right half of a contour bottle, top to bottom, as offsets from the
 * target's centre in units of its radius. The left half mirrors it.
 */
const BOTTLE_PROFILE: readonly (readonly [number, number])[] = [
  [0.15, -0.86],
  [0.17, -0.5],
  [0.4, -0.15],
  [0.42, 0.15],
  [0.31, 0.45],
  [0.42, 0.75],
  [0.38, 1],
];
const BOTTLE_CAP = { top: -1, bottom: -0.86, halfWidth: 0.19 };

/** The outline of the bottle drawn for a target, closed, in canvas pixels. */
export function bottleOutline(target: Target): { x: number; y: number }[] {
  const { x, y, radius } = target;
  const right = BOTTLE_PROFILE.map(([dx, dy]) => ({ x: x + dx * radius, y: y + dy * radius }));
  const left = [...BOTTLE_PROFILE].reverse().map(([dx, dy]) => ({
    x: x - dx * radius,
    y: y + dy * radius,
  }));
  return [...right, ...left];
}

/** Draws a target as an aqua blue soda bottle with a red cap and label. */
function drawBottle(ctx: CanvasRenderingContext2D, target: Target) {
  const { colors } = theme;
  const { x, y, radius } = target;
  const outline = bottleOutline(target);

  // Smooth the outline by curving through the midpoints between its points.
  ctx.beginPath();
  ctx.moveTo(outline[0].x, outline[0].y);
  for (let i = 1; i < outline.length - 1; i++) {
    const mid = {
      x: (outline[i].x + outline[i + 1].x) / 2,
      y: (outline[i].y + outline[i + 1].y) / 2,
    };
    ctx.quadraticCurveTo(outline[i].x, outline[i].y, mid.x, mid.y);
  }
  ctx.lineTo(outline[outline.length - 1].x, outline[outline.length - 1].y);
  ctx.closePath();

  ctx.save();
  ctx.fillStyle = colors.water;
  ctx.fill();
  ctx.clip();
  // The red label wrapped round the bottle's belly.
  ctx.fillStyle = colors.stripeA;
  ctx.fillRect(x - radius, y - 0.05 * radius, radius * 2, 0.32 * radius);
  ctx.fillStyle = colors.stripeB;
  ctx.fillRect(x - radius, y + 0.09 * radius, radius * 2, 0.04 * radius);
  // A highlight down the glass.
  ctx.globalAlpha = 0.45;
  ctx.fillRect(x + 0.12 * radius, y - 0.6 * radius, 0.08 * radius, 1.4 * radius);
  ctx.restore();

  ctx.fillStyle = colors.stripeA;
  ctx.fillRect(
    x - BOTTLE_CAP.halfWidth * radius,
    y + BOTTLE_CAP.top * radius,
    BOTTLE_CAP.halfWidth * 2 * radius,
    (BOTTLE_CAP.bottom - BOTTLE_CAP.top) * radius,
  );
}

function draw(
  ctx: CanvasRenderingContext2D,
  state: WaterCannonState,
  aim: { x: number; y: number },
) {
  const { colors } = theme;

  ctx.fillStyle = colors.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Booth awning.
  const stripe = WIDTH / 16;
  for (let i = 0; i < 16; i++) {
    ctx.fillStyle = i % 2 === 0 ? colors.stripeA : colors.stripeB;
    ctx.fillRect(i * stripe, 0, stripe, 40);
  }

  for (const rail of RAILS) {
    ctx.fillStyle = colors.wood;
    ctx.fillRect(0, rail.y + rail.radius + 4, WIDTH, 6);
  }

  for (const target of state.targets) drawBottle(ctx, target);

  ctx.fillStyle = '#4fc3f7';
  for (const shot of state.shots) {
    ctx.beginPath();
    ctx.arc(shot.x, shot.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = colors.water;
  ctx.lineWidth = 3;
  for (const splash of state.splashes) {
    ctx.globalAlpha = 1 - splash.age / 0.4;
    ctx.beginPath();
    ctx.arc(splash.x, splash.y, 10 + splash.age * 90, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Cannon, pointing at the aim.
  const angle = Math.atan2(Math.min(aim.y - CANNON.y, -1), aim.x - CANNON.x);
  ctx.save();
  ctx.translate(CANNON.x, CANNON.y);
  ctx.rotate(angle);
  ctx.fillStyle = colors.accent;
  ctx.fillRect(0, -8, 46, 16);
  ctx.restore();
  ctx.fillStyle = colors.surface;
  ctx.beginPath();
  ctx.arc(CANNON.x, CANNON.y, 20, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = colors.text;
  ctx.font = canvasFont('body', 'bold');
  ctx.textAlign = 'left';
  ctx.fillText(`Score ${state.score}`, 16, HEIGHT - 20);
  ctx.textAlign = 'right';
  ctx.fillText(`Water ${state.tank}/${TANK_SIZE}`, WIDTH - 16, HEIGHT - 20);

  if (state.phase === 'over') {
    ctx.fillStyle = colors.background;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.fillStyle = colors.accent;
    ctx.font = canvasFont('title', 'bold');
    ctx.fillText(`Tank empty! You scored ${state.score}`, WIDTH / 2, HEIGHT / 2);
    ctx.fillStyle = colors.text;
    ctx.font = canvasFont('body');
    ctx.fillText('Click to play again', WIDTH / 2, HEIGHT / 2 + 40);
  }
}

export const waterCannon: CarnivalGame = {
  id: 'water-cannon',
  name: 'Water Cannon',
  description: 'Soak the targets before your tank runs dry. Faster targets score more.',

  start(canvas) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    let state = createState();
    let scoreRecorded = false;
    const aim = { x: WIDTH / 2, y: 0 };

    const toCanvas = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * WIDTH,
        y: ((event.clientY - rect.top) / rect.height) * HEIGHT,
      };
    };
    const onMove = (event: PointerEvent) => Object.assign(aim, toCanvas(event));
    const onDown = (event: PointerEvent) => {
      Object.assign(aim, toCanvas(event));
      if (state.phase === 'over') {
        state = createState();
        scoreRecorded = false;
      } else {
        fire(state, aim.x, aim.y);
      }
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown);

    let frame = 0;
    let last = performance.now();
    const loop = (time: number) => {
      // Cap the step so a background tab doesn't teleport everything.
      const dt = Math.min((time - last) / 1000, 0.05);
      last = time;
      step(state, dt);
      if (state.phase === 'over' && !scoreRecorded) {
        recordScore(waterCannon.id, state.score);
        scoreRecorded = true;
      }
      draw(ctx, state, aim);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown);
    };
  },
};

export default waterCannon;

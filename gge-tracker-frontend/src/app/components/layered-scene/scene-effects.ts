import { Container, CreateJs, DisplayObject } from './scene-libraries';
import { Cues, TAU, cycleStart, season } from './scene-motion';
import { glowDot } from './scene-particles';

type Point = [number, number];

export interface SceneEffectsDescription {
  depth: number;
  sky?: Point[];
  stars?: number;
  patrol?: Point[];
  fireworks?: Point[];
  meteorsFrom?: Point;
  glint?: Point;
}

export interface Hotspot {
  cue: string;
  x: number;
  y: number;
  radius: number;
  glow?: [number, number, number];
  hover?: string;
}

interface Twinkle {
  node: DisplayObject;
  period: number;
  phase: number;
  brightness: number;
}

interface Meteor {
  node: DisplayObject;
  x: number;
  y: number;
  angle: number;
  length: number;
  born: number;
  flight: number;
}

interface Spark {
  node: DisplayObject;
  x: number;
  y: number;
  speedX: number;
  speedY: number;
  born: number;
  life: number;
}

interface Burst {
  rocket: DisplayObject;
  flash: DisplayObject;
  sparks: Spark[];
  x: number;
  y: number;
  launched: number;
}

interface Halo {
  node: DisplayObject;
  cue: string;
}

interface Flake {
  node: DisplayObject;
  x: number;
  y: number;
  fall: number;
  sway: number;
}

const METEOR_POOL = 8;
const SHOWER_SIZE = 7;
const SPARKS_PER_BURST = 36;
const ROCKET_SECONDS = 0.7;
const SPARK_GRAVITY = 38;
const PATROL_WALK = 46;
const PATROL_REST = 9;
const GLINT_FIRST = 3.5;
const GLINT_EVERY = 9;
const GLINT_SECONDS = 0.7;
const SNOWFLAKES = 70;
const FIREWORK_COLORS = ['rgba(110, 232, 214, 1)', 'rgba(255, 210, 112, 1)'];

function glintStar(color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 48;
  const context = canvas.getContext('2d')!;
  context.translate(24, 24);
  const ray = (angle: number): void => {
    context.save();
    context.rotate(angle);
    context.scale(1, 0.08);
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 24);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = gradient;
    context.fillRect(-24, -24, 48, 48);
    context.restore();
  };
  ray(0);
  ray(Math.PI / 2);
  context.drawImage(glowDot(color), -8, -8, 16, 16);
  return canvas;
}

function meteorStreak(): HTMLCanvasElement {
  // Head on the right edge, tail fading to the left
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 16;
  const context = canvas.getContext('2d')!;
  const gradient = context.createLinearGradient(0, 0, 250, 0);
  gradient.addColorStop(0, 'rgba(190, 215, 255, 0)');
  gradient.addColorStop(1, 'rgba(240, 248, 255, 0.95)');
  context.filter = 'blur(1px)';
  context.fillStyle = gradient;
  context.beginPath();
  context.moveTo(0, 8);
  context.lineTo(248, 6);
  context.lineTo(248, 10);
  context.fill();
  context.filter = 'none';
  context.drawImage(glowDot('rgba(255, 255, 255, 1)'), 238, 0, 16, 16);
  return canvas;
}

function inside(polygon: Point[], x: number, y: number): boolean {
  let within = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [ax, ay] = polygon[index];
    const [bx, by] = polygon[previous];
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) within = !within;
  }
  return within;
}

function pulse(age: number, length: number): number {
  return age >= 0 && age <= length ? Math.sin((Math.PI * age) / length) : 0;
}

export class SceneEffects {
  public readonly far: Container;
  public readonly near: Container;
  private readonly twinkles: Twinkle[] = [];
  private readonly meteors: Meteor[] = [];
  private readonly bursts: Burst[] = [];
  private readonly halos: Halo[] = [];
  private readonly flakes: Flake[] = [];
  private readonly patrol: { torch: DisplayObject; halo: DisplayObject; route: Point[]; lengths: number[] } | null =
    null;
  private readonly glint: DisplayObject | null = null;
  private readonly seen: Record<string, number> = {};
  private nextMeteorAt = 6 + Math.random() * 6;

  constructor(
    createjs: CreateJs,
    private readonly scene: { width: number; height: number },
    private readonly description: SceneEffectsDescription,
    hotspots: Hotspot[],
  ) {
    this.far = new createjs.Container();
    this.near = new createjs.Container();
    this.far.compositeOperation = this.near.compositeOperation = 'lighter';
    const bitmap = (image: HTMLCanvasElement, layer: Container, center = image.width / 2): DisplayObject => {
      const node = new createjs.Bitmap(image);
      node.regX = node.regY = center;
      node.alpha = 0;
      layer.addChild(node);
      return node;
    };

    for (const hotspot of hotspots) {
      if (!hotspot.glow) continue;
      const node = bitmap(glowDot(`rgba(${hotspot.glow.join(', ')}, 1)`), this.far);
      node.x = hotspot.x;
      node.y = hotspot.y;
      node.scaleX = node.scaleY = (hotspot.radius * 1.4) / 12;
      this.halos.push({ node, cue: hotspot.cue });
    }

    const star = glintStar('rgba(225, 235, 255, 1)');
    const sky = description.sky ?? [];
    for (let index = 0; sky.length > 0 && index < (description.stars ?? 0); index++) {
      const [x, y] = this.skyPoint(sky);
      const node = bitmap(star, this.far);
      node.x = x;
      node.y = y;
      node.scaleX = node.scaleY = 0.22 + Math.random() * 0.28;
      this.twinkles.push({
        node,
        period: 3 + Math.random() * 7,
        phase: Math.random() * TAU,
        brightness: 0.6 + Math.random() * 0.4,
      });
    }

    const streak = meteorStreak();
    for (let index = 0; sky.length > 0 && index < METEOR_POOL; index++) {
      const node = bitmap(streak, this.far);
      node.regX = 248;
      node.regY = 8;
      this.meteors.push({ node, x: 0, y: 0, angle: 0, length: 0, born: -10, flight: 1 });
    }

    if (description.patrol?.length) {
      const route = description.patrol;
      const lengths = route.slice(1).map(([x, y], index) => Math.hypot(x - route[index][0], y - route[index][1]));
      this.patrol = {
        halo: bitmap(glowDot('rgba(255, 170, 70, 1)'), this.far),
        torch: bitmap(glowDot('rgba(255, 225, 150, 1)'), this.far),
        route,
        lengths,
      };
      this.patrol.halo.scaleX = this.patrol.halo.scaleY = 1.2;
      this.patrol.torch.scaleX = this.patrol.torch.scaleY = 0.3;
    }

    for (const [index, [x, y]] of (description.fireworks ?? []).entries()) {
      const spark = glowDot(FIREWORK_COLORS[index % FIREWORK_COLORS.length]);
      this.bursts.push({
        rocket: bitmap(glowDot('rgba(255, 230, 180, 1)'), this.far),
        flash: bitmap(glowDot('rgba(255, 245, 220, 1)'), this.far),
        sparks: Array.from({ length: SPARKS_PER_BURST }, () => ({
          node: bitmap(spark, this.far),
          x,
          y,
          speedX: 0,
          speedY: 0,
          born: -10,
          life: 1,
        })),
        x,
        y,
        launched: -Infinity,
      });
    }

    if (description.glint) {
      this.glint = bitmap(glintStar('rgba(255, 236, 190, 1)'), this.near);
      [this.glint.x, this.glint.y] = description.glint;
    }

    if (season() === 'winter') {
      const flake = glowDot('rgba(240, 246, 255, 1)');
      for (let index = 0; index < SNOWFLAKES; index++) {
        const node = bitmap(flake, this.near);
        node.scaleX = node.scaleY = 0.12 + Math.random() * 0.2;
        this.flakes.push({
          node,
          x: Math.random() * scene.width,
          y: Math.random() * scene.height,
          fall: 14 + Math.random() * 26,
          sway: Math.random() * TAU,
        });
      }
    }
  }

  public update(seconds: number, cues: Cues, focus: Readonly<Record<string, number>>): void {
    for (const halo of this.halos) halo.node.alpha = 0.32 * (focus[halo.cue] ?? 0);
    for (const twinkle of this.twinkles) {
      const flash = Math.pow(Math.max(0, Math.sin((seconds * TAU) / twinkle.period + twinkle.phase)), 10);
      twinkle.node.alpha = twinkle.brightness * (0.16 + 0.84 * flash);
    }
    if (this.fresh('meteors', cues)) this.shower(seconds);
    if (this.meteors.length > 0 && seconds >= this.nextMeteorAt) {
      this.launchMeteor(seconds, 0);
      this.nextMeteorAt = seconds + 11 + Math.random() * 13;
    }
    for (const meteor of this.meteors) this.moveMeteor(meteor, seconds);
    if (this.fresh('fireworks', cues)) this.bursts.forEach((burst, index) => (burst.launched = seconds + index * 0.45));
    for (const burst of this.bursts) this.moveBurst(burst, seconds);
    this.movePatrol(seconds);
    if (this.glint) {
      const age = seconds - cycleStart(seconds, GLINT_FIRST, GLINT_EVERY, cues['glint']);
      const strength = pulse(age, GLINT_SECONDS);
      this.glint.alpha = strength;
      this.glint.scaleX = this.glint.scaleY = 0.25 + 0.9 * strength;
      this.glint.rotation = 50 * age;
    }
    for (const flake of this.flakes) {
      const y = (flake.y + flake.fall * seconds) % (this.scene.height + 20);
      flake.node.x = flake.x + 14 * Math.sin(seconds * 0.6 + flake.sway);
      flake.node.y = y - 10;
      flake.node.alpha = 0.75;
    }
  }

  private fresh(cue: string, cues: Cues): boolean {
    const at = cues[cue];
    if (at === undefined || at === this.seen[cue]) return false;
    this.seen[cue] = at;
    return true;
  }

  private skyPoint(sky: Point[]): Point {
    const moon = this.description.meteorsFrom;
    for (let attempt = 0; attempt < 60; attempt++) {
      const x = Math.random() * this.scene.width;
      const y = Math.random() * this.scene.height;
      if (inside(sky, x, y) && (!moon || Math.hypot(x - moon[0], y - moon[1]) > 70)) return [x, y];
    }
    return sky[0];
  }

  private shower(seconds: number): void {
    for (let index = 0; index < SHOWER_SIZE; index++)
      this.launchMeteor(seconds + index * 0.32 + Math.random() * 0.2, index + 1);
  }

  private launchMeteor(at: number, wave: number): void {
    const meteor = this.meteors.find((candidate) => at > candidate.born + candidate.flight) ?? this.meteors[0];
    const moon = this.description.meteorsFrom;
    if (wave && moon) {
      // A shower radiates from the moon towards the lower right
      const angle = (8 + Math.random() * 42) * (Math.PI / 180);
      const offset = 40 + Math.random() * 90;
      Object.assign(meteor, { x: moon[0] + Math.cos(angle) * offset, y: moon[1] + Math.sin(angle) * offset, angle });
    } else {
      const [x, y] = this.skyPoint(this.description.sky!);
      const leftward = x > this.scene.width / 2;
      const angle = (18 + Math.random() * 17) * (Math.PI / 180);
      Object.assign(meteor, { x, y: Math.min(y, 160), angle: leftward ? Math.PI - angle : angle });
    }
    meteor.length = 260 + Math.random() * 180;
    meteor.flight = 0.75 + Math.random() * 0.4;
    meteor.born = at;
  }

  private moveMeteor(meteor: Meteor, seconds: number): void {
    const progress = (seconds - meteor.born) / meteor.flight;
    if (!(progress >= 0 && progress <= 1)) {
      meteor.node.alpha = 0;
      return;
    }
    const travelled = meteor.length * (1 - (1 - progress) * (1 - progress));
    meteor.node.x = meteor.x + Math.cos(meteor.angle) * travelled;
    meteor.node.y = meteor.y + Math.sin(meteor.angle) * travelled;
    meteor.node.rotation = (meteor.angle * 180) / Math.PI;
    meteor.node.scaleX = 0.35 + 0.5 * Math.min(1, progress * 3);
    meteor.node.scaleY = 0.8;
    meteor.node.alpha = Math.sin(Math.PI * progress);
  }

  private moveBurst(burst: Burst, seconds: number): void {
    const age = seconds - burst.launched;
    const rising = age >= 0 && age < ROCKET_SECONDS;
    burst.rocket.alpha = rising ? 0.9 : 0;
    if (rising) {
      burst.rocket.x = burst.x + 4 * Math.sin(age * 20);
      burst.rocket.y = burst.y + 170 * Math.pow(1 - age / ROCKET_SECONDS, 2);
      burst.rocket.scaleX = burst.rocket.scaleY = 0.35;
    }
    const sinceBang = age - ROCKET_SECONDS;
    const exploded = burst.sparks[0].born >= burst.launched;
    if (sinceBang >= 0 && sinceBang < 0.5 && !exploded) this.explode(burst, seconds);
    const flash = pulse(sinceBang, 0.35);
    burst.flash.alpha = 0.8 * flash;
    if (flash) {
      burst.flash.x = burst.x;
      burst.flash.y = burst.y;
      burst.flash.scaleX = burst.flash.scaleY = 2 + 3 * sinceBang;
    }
    for (const spark of burst.sparks) {
      const life = seconds - spark.born;
      if (!(life >= 0 && life <= spark.life)) {
        spark.node.alpha = 0;
        continue;
      }
      const drag = (1 - Math.exp(-1.7 * life)) / 1.7;
      spark.node.x = spark.x + spark.speedX * drag;
      spark.node.y = spark.y + spark.speedY * drag + SPARK_GRAVITY * life * life;
      spark.node.alpha = Math.pow(1 - life / spark.life, 1.4) * (0.75 + 0.25 * Math.sin(life * 31 + spark.speedX));
    }
  }

  private explode(burst: Burst, seconds: number): void {
    burst.sparks.forEach((spark, index) => {
      const angle = (index / burst.sparks.length) * TAU + Math.random() * 0.2;
      const speed = 150 + Math.random() * 50;
      Object.assign(spark, {
        x: burst.x,
        y: burst.y,
        speedX: Math.cos(angle) * speed,
        speedY: Math.sin(angle) * speed,
        born: seconds,
        life: 1.7 + Math.random() * 0.6,
      });
      spark.node.scaleX = spark.node.scaleY = 0.42 + Math.random() * 0.18;
    });
  }

  private movePatrol(seconds: number): void {
    if (!this.patrol) return;
    const { torch, halo, route, lengths } = this.patrol;
    const cycle = seconds % (2 * (PATROL_WALK + PATROL_REST));
    const outbound = Math.min(1, cycle / PATROL_WALK);
    const inbound = 1 - Math.min(1, Math.max(0, cycle - PATROL_WALK - PATROL_REST) / PATROL_WALK);
    const along = cycle < PATROL_WALK + PATROL_REST ? outbound : inbound;
    let remaining = along * lengths.reduce((sum, length) => sum + length, 0);
    let index = 0;
    while (index < lengths.length - 1 && remaining > lengths[index]) remaining -= lengths[index++];
    const share = lengths[index] ? remaining / lengths[index] : 0;
    const [fromX, fromY] = route[index];
    const [toX, toY] = route[index + 1];
    const x = fromX + (toX - fromX) * share;
    const y = fromY + (toY - fromY) * share - 4 - 0.7 * Math.abs(Math.sin(seconds * TAU * 0.9));
    // The guard steps inside the gate while resting there
    const visible = 1 - Math.min(1, Math.max(0, (along - 0.97) / 0.03));
    const flicker = 0.85 + 0.15 * Math.sin(seconds * 13.7) * Math.sin(seconds * 7.3);
    torch.x = halo.x = x;
    torch.y = halo.y = y;
    torch.alpha = visible * flicker;
    halo.alpha = 0.3 * visible * flicker;
  }
}

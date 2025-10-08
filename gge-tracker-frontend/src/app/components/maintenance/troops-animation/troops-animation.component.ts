import { NgFor } from '@angular/common';
import { Component, OnInit, OnDestroy, ElementRef, ViewChild } from '@angular/core';

interface Troop {
  x: number;
  y: number;
  dx: number;
  dy: number;
  size: number;
  direction: string;
  id: number;
  speed: number;
  team: number;
}

@Component({
  selector: 'app-troops-animation',
  standalone: true,
  imports: [NgFor],
  template: `
    <div #container class="troops-container position-relative overflow-hidden">
      <img
        *ngFor="let troop of troops"
        src="assets/troop.png"
        [style.width.px]="troop.size"
        [style.height.px]="troop.size"
        [style.position]="'absolute'"
        [style.left.px]="troop.x"
        [style.top.px]="troop.y"
        [style.transform]="getFlip(troop.dx)"
        [style.filter]="teamFilters[troop.team]"
        alt="troop"
        draggable="false"
      />
    </div>
  `,
  styles: [
    `
      .troops-container {
        width: 100%;
        height: 100%;
        pointer-events: none;
        user-select: none;
      }
    `,
  ],
})
export class TroopsAnimationComponent implements OnInit, OnDestroy {
  @ViewChild('container', { static: true })
  public container!: ElementRef<HTMLDivElement>;
  public troops: Troop[] = [];
  public maxTroops = 20;
  public size = 64;
  public animationFrameId = 0;
  public teamFilters = ['hue-rotate(0deg) saturate(1)', 'hue-rotate(15deg) saturate(1.2)', 'hue-rotate(-20deg)'];

  public ngOnInit(): void {
    void this.initTroops();
    this.animate();
  }

  public ngOnDestroy(): void {
    cancelAnimationFrame(this.animationFrameId);
  }

  public async initTroops(): Promise<void> {
    this.troops = [];
    for (let index = 0; index < this.maxTroops; index++) {
      this.troops.push(this.createTroop(index));
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  public getRotation(dx: number): string {
    if (dx > 0) {
      return 'rotate(0deg)';
    } else if (dx < 0) {
      return 'rotate(120deg)';
    } else {
      return 'rotate(0deg)';
    }
  }

  public getFlip(dx: number): string {
    if (dx > 0) {
      return 'scaleX(1)';
    } else if (dx < 0) {
      return 'scaleX(-1)';
    } else {
      return 'scaleX(1)';
    }
  }

  private createTroop(id: number): Troop {
    const containerRect = this.container.nativeElement.getBoundingClientRect();
    const edges = ['top', 'right', 'bottom', 'left', 'top-left', 'top-right', 'bottom-left', 'bottom-right'];
    const edge = edges[Math.floor(Math.random() * edges.length)];
    let x = 0,
      y = 0,
      dx = 0,
      dy = 0;
    switch (edge) {
      case 'top': {
        x = Math.random() * containerRect.width;
        y = -this.size;
        dx = (Math.random() - 0.5) * 1;
        dy = 0.8 + Math.random() * 0.4;
        break;
      }
      case 'bottom': {
        x = Math.random() * containerRect.width;
        y = containerRect.height + this.size;
        dx = (Math.random() - 0.5) * 1;
        dy = -(0.8 + Math.random() * 0.4);
        break;
      }
      case 'left': {
        x = -this.size;
        y = Math.random() * containerRect.height;
        dx = 0.8 + Math.random() * 0.4;
        dy = (Math.random() - 0.5) * 1;
        break;
      }
      case 'right': {
        x = containerRect.width + this.size;
        y = Math.random() * containerRect.height;
        dx = -(0.8 + Math.random() * 0.4);
        dy = (Math.random() - 0.5) * 1;
        break;
      }
      case 'top-left': {
        x = -this.size;
        y = -this.size;
        dx = 0.8 + Math.random() * 0.4;
        dy = 0.8 + Math.random() * 0.4;
        break;
      }
      case 'top-right': {
        x = containerRect.width + this.size;
        y = -this.size;
        dx = -(0.8 + Math.random() * 0.4);
        dy = 0.8 + Math.random() * 0.4;
        break;
      }
      case 'bottom-left': {
        x = -this.size;
        y = containerRect.height + this.size;
        dx = 0.8 + Math.random() * 0.4;
        dy = -(0.8 + Math.random() * 0.4);
        break;
      }
      case 'bottom-right': {
        x = containerRect.width + this.size;
        y = containerRect.height + this.size;
        dx = -(0.8 + Math.random() * 0.4);
        dy = -(0.8 + Math.random() * 0.4);
        break;
      }
    }
    const minSpeed = 20;
    const maxSpeed = 60;
    return {
      x,
      y,
      dx,
      dy,
      size: this.size,
      direction: edge,
      id,
      speed: Math.random() * (maxSpeed - minSpeed) + minSpeed,
      team: Math.floor(Math.random() * this.teamFilters.length),
    };
  }

  private animate(): void {
    const containerRect = this.container.nativeElement.getBoundingClientRect();
    const deltaTime = 16 / 1000;
    this.troops.forEach((troop, index) => {
      troop.x += troop.dx * troop.speed * deltaTime;
      troop.y += troop.dy * troop.speed * deltaTime;
      if (
        troop.x < -this.size * 2 ||
        troop.x > containerRect.width + this.size * 2 ||
        troop.y < -this.size * 2 ||
        troop.y > containerRect.height + this.size * 2
      ) {
        this.troops[index] = this.createTroop(troop.id);
      }
    });

    this.animationFrameId = requestAnimationFrame(() => this.animate());
  }
}

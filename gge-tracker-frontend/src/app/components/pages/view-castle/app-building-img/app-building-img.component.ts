import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-building-img',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './building-img.component.html',
  styleUrls: ['./building-img.component.css'],
})
export class BuildingImgComponent {
  @Input() public src!: string;
  @Input() public alt: string = '';
  @Input() public size?: number;
  @Input() public shadow?: boolean = false;

  @Output() public loaded = new EventEmitter<void>();
  @Output() public error = new EventEmitter<void>();

  public imageLoaded = false;
  public imageError = false;

  public onLoad(): void {
    this.imageLoaded = true;
    this.loaded.emit();
  }

  public onError(): void {
    this.imageError = true;
    this.error.emit();
  }
}

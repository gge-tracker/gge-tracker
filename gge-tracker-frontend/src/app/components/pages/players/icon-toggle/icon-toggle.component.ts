import { NgClass } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
    selector: '[appIconToggle]',
    imports: [NgClass],
    templateUrl: './icon-toggle.component.html',
    styleUrl: './icon-toggle.component.css'
})
export class IconToggleComponent {
  @Input() public validated = false;
  @Input() public baseIcon = '';
  @Input() public disabled = false;
  @Output() public action = new EventEmitter<void>();

  public onClick(): void {
    this.action.emit();
  }
}

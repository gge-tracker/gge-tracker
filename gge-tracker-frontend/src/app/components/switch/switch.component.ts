import { Component, input, OnInit, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

/**
 * A standalone switch component for toggling values
 */
@Component({
  selector: 'app-switch',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './switch.component.html',
  styleUrls: ['./switch.component.css'],
})
export class SwitchComponent implements OnInit {
  public id = input.required<string>();
  public defaultInput = input.required<boolean>();
  public switchEmitter = output<boolean>();
  public currentValue: boolean = false;

  public updateSwitchValue(value: boolean): void {
    this.switchEmitter.emit(value);
  }

  public ngOnInit(): void {
    this.currentValue = this.defaultInput();
  }
}

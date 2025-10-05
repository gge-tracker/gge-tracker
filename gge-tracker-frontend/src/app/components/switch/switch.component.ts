import { Component, input, OnInit, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

/**
 * A standalone switch component for toggling values.
 *
 * @selector app-switch
 * @imports FormsModule
 * @templateUrl ./switch.component.html
 * @styleUrls ./switch.component.css
 *
 * @property id - The unique identifier for the switch component. Required input.
 * @property defaultInput - The initial value for the switch. Required input.
 * @property switchEmitter - Emits the current value when the switch is toggled.
 * @property currentValue - The current state of the switch.
 *
 * @method updateSwitchValue Emits the provided value through the switchEmitter.
 * @method ngOnInit Initializes the switch value using the defaultInput.
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

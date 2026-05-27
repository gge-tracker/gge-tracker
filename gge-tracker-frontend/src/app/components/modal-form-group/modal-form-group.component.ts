import { Component, input } from '@angular/core';

@Component({
  selector: 'app-modal-form-group',
  imports: [],
  templateUrl: './modal-form-group.component.html',
  styleUrl: './modal-form-group.component.css',
})
export class ModalFormGroupComponent {
  public readonly label = input<string>();
}

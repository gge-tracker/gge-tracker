import { IMappedBuildingElement } from '@ggetracker-interfaces/empire-ranking';

export interface Pt {
  x: number;
  y: number;
}

export enum GenericTextIds {
  VALUE_ASSIGN_COLON = '{0} : {1}',
  VALUE_WITH_BRACES = '{0} ({1})',
  VALUE_DASH_SPLIT = '{0} - {1}',
  VALUE_PERCENTAGE_ADD = '+ {0} %',
  VALUE_NOMINAL_ADD = '+ {0}',
  VALUE_PREFIX_SUFFIX = '{0} {1} {2}',
  VALUE_NOMINAL_SUBTRACT = '- {0}',
  VALUE_COLON = '{0} :',
  VALUE_PERCENTAGE = '{0} %',
  VALUE_COORDS = '{0}:{1}',
  VALUE_PERCENTAGE_SUBTRACT = '- {0} %',
  VALUE_SIMPLE_COMP = '{0} {1}',
}

export interface IMappedBuildingWithGround extends IMappedBuildingElement {
  isGround: boolean;
}

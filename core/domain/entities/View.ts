import { Constraints } from './Constraints';
import { Container } from './Container';
import { Rect } from './Rect';
import { Color } from './Color';
import { ColorFill } from './ColorFill';
import { Shadow } from './Shadow';

export class View extends Container {
  isVisible: boolean;
  originalRect: Rect; // hold original rect to use for calculating constraints properly.

  parentId?: string;
  constraints?: Constraints;
  backgroundColor?: Color;
  radius?: number;
  fills?: ColorFill[];
  shadows?: Shadow[];
}

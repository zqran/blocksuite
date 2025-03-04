import type { SelectionEvent, TextMouseMode } from '@blocksuite/blocks/std';
import { handleNativeRangeAtPoint, noop } from '@blocksuite/blocks/std';
import { serializeXYWH } from '@blocksuite/phasor';

import {
  DEFAULT_FRAME_HEIGHT,
  DEFAULT_FRAME_OFFSET_X,
  DEFAULT_FRAME_OFFSET_Y,
  DEFAULT_FRAME_WIDTH,
} from '../utils.js';
import { MouseModeController } from './index.js';

export class TextModeController extends MouseModeController<TextMouseMode> {
  readonly mouseMode = <TextMouseMode>{
    type: 'text',
  };

  private _dragStartEvent: SelectionEvent | null = null;

  private _addText(e: SelectionEvent, width = DEFAULT_FRAME_WIDTH) {
    const [modelX, modelY] = this._surface.toModelCoord(e.x, e.y);
    const frameId = this._page.addBlock(
      'affine:frame',
      {
        xywh: serializeXYWH(
          modelX - DEFAULT_FRAME_OFFSET_X,
          modelY - DEFAULT_FRAME_OFFSET_Y,
          width,
          DEFAULT_FRAME_HEIGHT
        ),
      },
      this._page.root?.id
    );
    this._page.addBlock('affine:paragraph', {}, frameId);
    this._edgeless.slots.mouseModeUpdated.emit({ type: 'default' });

    // Wait for mouseMode updated
    requestAnimationFrame(() => {
      const element = this._blocks.find(b => b.id === frameId);
      if (element) {
        const selectionState = {
          selected: [element],
          active: true,
        };
        this._edgeless.slots.selectionUpdated.emit(selectionState);

        // Waiting dom updated, `frame mask` is removed
        this._edgeless.updateComplete.then(() => {
          // Cannot reuse `handleNativeRangeClick` directly here,
          // since `retargetClick` will re-target to pervious editor
          handleNativeRangeAtPoint(e.raw.clientX, e.raw.clientY);
        });
      }
    });
  }

  onContainerClick(e: SelectionEvent): void {
    this._addText(e);
  }

  onContainerContextMenu(e: SelectionEvent): void {
    noop();
  }

  onContainerDblClick(e: SelectionEvent): void {
    noop();
  }

  onContainerDragStart(e: SelectionEvent) {
    this._dragStartEvent = e;
    this._draggingArea = {
      start: new DOMPoint(e.x, e.y),
      end: new DOMPoint(e.x, e.y),
    };
  }

  onContainerDragMove(e: SelectionEvent) {
    if (this._draggingArea) {
      this._draggingArea.end = new DOMPoint(e.x, e.y);
      this._edgeless.slots.hoverUpdated.emit();
    }
  }

  onContainerDragEnd(e: SelectionEvent) {
    if (this._dragStartEvent) {
      const startEvent =
        e.x > this._dragStartEvent.x ? this._dragStartEvent : e;
      const width = Math.max(
        Math.abs(e.x - this._dragStartEvent.x),
        DEFAULT_FRAME_WIDTH
      );
      this._addText(startEvent, width);
    }

    this._dragStartEvent = null;
    this._draggingArea = null;
  }

  onContainerMouseMove(e: SelectionEvent) {
    noop();
  }

  onContainerMouseOut(e: SelectionEvent) {
    noop();
  }

  syncDraggingArea() {
    noop();
  }

  clearSelection() {
    noop();
  }
}

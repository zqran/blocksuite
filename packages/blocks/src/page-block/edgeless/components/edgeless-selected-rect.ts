import './component-toolbar/component-toolbar.js';

import type { Bound } from '@blocksuite/phasor';
import { deserializeXYWH, SurfaceManager } from '@blocksuite/phasor';
import { DisposableGroup, Page } from '@blocksuite/store';
import type { Instance as PopperInstance } from '@popperjs/core';
import { createPopper } from '@popperjs/core';
import { css, html, LitElement } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import type { EdgelessSelectionSlots } from '../edgeless-page-block.js';
import type {
  EdgelessSelectionState,
  Selectable,
} from '../selection-manager.js';
import {
  FRAME_MIN_HEIGHT,
  FRAME_MIN_WIDTH,
  isTopLevelBlock,
  stopPropagation,
} from '../utils.js';
import type { EdgelessComponentToolbar } from './component-toolbar/component-toolbar.js';
import type { HandleDirection } from './resize-handles.js';
import { ResizeHandles, type ResizeMode } from './resize-handles.js';
import { HandleResizeManager } from './resize-manager.js';
import {
  getCommonRectStyle,
  getSelectableBounds,
  getSelectedRect,
} from './utils.js';

@customElement('edgeless-selected-rect')
export class EdgelessSelectedRect extends LitElement {
  static styles = css`
    :host {
      display: block;
      user-select: none;
    }

    edgeless-component-toolbar {
      /* greater than handle */
      z-index: 11;
    }
  `;

  @property({ type: Page })
  page!: Page;

  @property({ type: SurfaceManager })
  surface!: SurfaceManager;

  @property({ type: Object })
  state!: EdgelessSelectionState;

  @property()
  slots!: EdgelessSelectionSlots;

  @query('.affine-edgeless-selected-rect')
  private _selectedRect!: HTMLDivElement;

  @query('edgeless-component-toolbar')
  private _componentToolbar!: EdgelessComponentToolbar;

  private _componentToolbarPopper: PopperInstance | null = null;

  private _lock = false;
  private _resizeManager: HandleResizeManager;
  private _disposables = new DisposableGroup();

  constructor() {
    super();
    this._resizeManager = new HandleResizeManager(
      this._onDragMove,
      this._onDragEnd
    );
    this.addEventListener('mousedown', stopPropagation);
  }

  get zoom() {
    return this.surface.viewport.zoom;
  }

  get resizeMode(): ResizeMode {
    const hasBlockElement = this.state.selected.find(elem =>
      isTopLevelBlock(elem)
    );
    return hasBlockElement ? 'edge' : 'corner';
  }

  private _onDragMove = (newBounds: Map<string, Bound>) => {
    const selectedMap = new Map<string, Selectable>(
      this.state.selected.map(element => [element.id, element])
    );

    newBounds.forEach((bound, id) => {
      const element = selectedMap.get(id);
      if (!element) return;

      if (isTopLevelBlock(element)) {
        let frameX = bound.x;
        let frameY = bound.y;
        let frameW = bound.w;
        let frameH = deserializeXYWH(element.xywh)[3];
        // Limit the width of the selected frame
        if (frameW < FRAME_MIN_WIDTH) {
          frameW = FRAME_MIN_WIDTH;
          frameX = bound.x;
        }
        // Limit the height of the selected frame
        if (frameH < FRAME_MIN_HEIGHT) {
          frameH = FRAME_MIN_HEIGHT;
          frameY = bound.y;
        }
        const xywh = JSON.stringify([frameX, frameY, frameW, frameH]);
        this.page.updateBlock(element, { xywh });
      } else {
        this.surface.setElementBound(element.id, bound);
      }
    });

    this.requestUpdate();
  };

  private _onDragEnd = () => {
    if (this._lock) {
      this.page.captureSync();
    }
    this._lock = false;
  };

  firstUpdated() {
    const { _disposables, slots } = this;
    _disposables.add(slots.viewportUpdated.on(() => this.requestUpdate()));

    this._componentToolbarPopper = createPopper(
      this._selectedRect,
      this._componentToolbar,
      {
        placement: 'top',
        modifiers: [
          {
            name: 'offset',
            options: {
              offset: [0, 12],
            },
          },
          {
            name: 'flip',
            options: {
              fallbackPlacements: ['bottom'],
            },
          },
        ],
      }
    );
    _disposables.add(() => this._componentToolbarPopper?.destroy());

    // This hook is not waiting all children updated.
    // But children effect popper position. So we use ResizeObserver watching sizing change.
    const resizeObserver = new ResizeObserver(() =>
      this._componentToolbarPopper?.update()
    );
    resizeObserver.observe(this._componentToolbar);
    _disposables.add(() => resizeObserver.disconnect());
  }

  updated(changedProperties: Map<string, unknown>) {
    // when viewport updates, popper should update too.
    this._componentToolbarPopper?.update();
    super.updated(changedProperties);
  }

  disconnectedCallback() {
    this._disposables.dispose();
  }

  render() {
    if (this.state.selected.length === 0) return null;

    const { page, state, surface, resizeMode, _resizeManager } = this;
    const { active, selected } = state;
    const selectedRect = getSelectedRect(selected, surface.viewport);

    const style = {
      border: `${
        this.state.active ? 2 : 1
      }px solid var(--affine-primary-color)`,
      ...getCommonRectStyle(selectedRect, active, true),
    };

    const hasResizeHandles = !active && !page.readonly;
    const resizeHandles = ResizeHandles(
      selectedRect,
      resizeMode,
      (e: MouseEvent, direction: HandleDirection) => {
        const bounds = getSelectableBounds(this.state.selected);
        _resizeManager.onMouseDown(e, direction, bounds);
      }
    );

    return html`
      ${hasResizeHandles ? resizeHandles : null}
      <div class="affine-edgeless-selected-rect" style=${styleMap(style)}></div>
      <edgeless-component-toolbar
        .selected=${selected}
        .page=${this.page}
        .surface=${this.surface}
        .slots=${this.slots}
        .selectionState=${this.state}
      >
      </edgeless-component-toolbar>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'edgeless-selected-rect': EdgelessSelectedRect;
  }
}

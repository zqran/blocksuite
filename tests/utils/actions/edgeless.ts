/* eslint-disable @typescript-eslint/no-restricted-imports */
import '../declare-test-window.js';

import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

import type { FrameBlockModel } from '../../../packages/blocks/src/index.js';
import { dragBetweenCoords } from './drag.js';
import { SHORT_KEY } from './keyboard.js';

export async function getFrameRect(
  page: Page,
  ids: { pageId: string; frameId: string; paragraphId: string }
) {
  const xywh: string | null = await page.evaluate(
    ([id]) => {
      const page = window.workspace.getPage('page0');
      const block = page?.getBlockById(id.frameId);
      if (block?.flavour === 'affine:frame') {
        return (block as FrameBlockModel).xywh;
      } else {
        return null;
      }
    },
    [ids] as const
  );
  expect(xywh).not.toBeNull();
  const [x, y, w, h] = JSON.parse(xywh as string);
  return { x, y, w, h };
}

export async function switchEditorMode(page: Page) {
  await page.click('sl-button[content="Switch Editor Mode"]');
}

export function locatorPanButton(page: Page, innerContainer = true) {
  return locatorEdgelessToolButton(page, 'pan', innerContainer);
}

type MouseMode = 'default' | 'shape' | 'brush' | 'pan' | 'text';
type ToolType = MouseMode | 'zoomIn' | 'zoomOut' | 'fitToScreen';

export function locatorEdgelessToolButton(
  page: Page,
  type: ToolType,
  innerContainer = true
) {
  const text = {
    default: 'Select',
    shape: 'Shape',
    brush: 'Pen',
    pan: 'Hand',
    text: 'Text',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    fitToScreen: 'Fit to screen',
  }[type];
  const button = page
    .locator('edgeless-toolbar edgeless-tool-icon-button')
    .filter({
      hasText: text,
    });

  return innerContainer ? button.locator('.icon-container') : button;
}

export async function setMouseMode(page: Page, mode: MouseMode) {
  switch (mode) {
    case 'default':
    case 'brush':
    case 'pan':
    case 'text': {
      const button = locatorEdgelessToolButton(page, mode, false);
      await button.click();
      break;
    }
    case 'shape': {
      const shapeToolButton = locatorEdgelessToolButton(page, 'shape', false);
      await shapeToolButton.click();

      const squareShapeButton = page
        .locator('edgeless-tool-icon-button')
        .filter({ hasText: 'Square' });
      await squareShapeButton.click();
      break;
    }
  }
}

export async function switchShapeType(page: Page, shapeType: string) {
  // TODO
}

export async function getEdgelessHoverRect(page: Page) {
  const hoverRect = page.locator('.affine-edgeless-hover-rect');
  const box = await hoverRect.boundingBox();
  if (!box) throw new Error('Missing edgeless hover rect');
  return box;
}

export async function getEdgelessBlockChild(page: Page) {
  const block = page.locator('.affine-edgeless-block-child');
  const blockBox = await block.boundingBox();
  if (blockBox === null) throw new Error('Missing edgeless block child rect');
  return blockBox;
}

export async function getEdgelessSelectedRect(page: Page) {
  const selectedBox = await page.evaluate(() => {
    const selected = document
      .querySelector('edgeless-selected-rect')
      ?.shadowRoot?.querySelector('.affine-edgeless-selected-rect');
    if (!selected) {
      throw new Error('Missing edgeless selected rect');
    }
    return selected.getBoundingClientRect();
  });
  return selectedBox;
}

export async function decreaseZoomLevel(page: Page) {
  const btn = locatorEdgelessToolButton(page, 'zoomOut', false);
  await btn.click();
}

export async function increaseZoomLevel(page: Page) {
  const btn = locatorEdgelessToolButton(page, 'zoomIn', false);
  await btn.click();
}

export async function addBasicBrushElement(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number }
) {
  await setMouseMode(page, 'brush');
  await dragBetweenCoords(page, start, end, { steps: 100 });
  await setMouseMode(page, 'default');
}

export async function addBasicRectShapeElement(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number }
) {
  await setMouseMode(page, 'shape');
  await dragBetweenCoords(page, start, end, { steps: 10 });
  await setMouseMode(page, 'default');
}

export async function resizeElementByTopLeftHandle(
  page: Page,
  delta: { x: number; y: number },
  steps = 1
) {
  const topLeftHandle = page.locator('[aria-label="handle-top-left"]');
  const box = await topLeftHandle.boundingBox();
  if (box === null) throw new Error();
  const offset = 5;
  await dragBetweenCoords(
    page,
    { x: box.x + offset, y: box.y + offset },
    { x: box.x + delta.x + offset, y: box.y + delta.y + offset },
    {
      steps,
    }
  );
}

export async function selectBrushColor(page: Page, color: `#${string}`) {
  const colorButton = page.locator(
    `edgeless-brush-menu .color-unit[aria-label="${color.toLowerCase()}"]`
  );
  await colorButton.click();
}

export async function selectBrushSize(page: Page, size: 4 | 16) {
  const sizeMap = { 4: 'thin', 16: 'thick' };
  const sizeButton = page.locator(
    `edgeless-brush-menu .brush-size-button .${sizeMap[size]}`
  );
  await sizeButton.click();
}

export async function pickColorAtPoints(page: Page, points: number[][]) {
  const pickedColors: `#${string}`[] = await page.evaluate(points => {
    const node = document.querySelector(
      '.affine-edgeless-surface-block-container canvas'
    ) as HTMLCanvasElement;
    const w = node.width;
    const h = node.height;
    const ctx = node?.getContext('2d');
    if (!ctx) throw new Error('Cannot get canvas context');
    const pixelData = ctx.getImageData(0, 0, w, h).data;

    const colors = points.map(([x, y]) => {
      const startPosition = (y * w + x) * 4;
      return ('#' +
        (
          (1 << 24) +
          (pixelData[startPosition] << 16) +
          (pixelData[startPosition + 1] << 8) +
          pixelData[startPosition + 2]
        )
          .toString(16)
          .slice(1)) as `#${string}`;
    });
    return colors;
  }, points);
  return pickedColors;
}

export async function getFrameBoundBoxInEdgeless(page: Page, frameId: string) {
  const frame = page.locator(`affine-frame[data-block-id="${frameId}"]`);
  const bound = await frame.boundingBox();
  if (!bound) {
    throw new Error(`Missing frame: ${frameId}`);
  }
  return bound;
}

export async function activeFrameInEdgeless(page: Page, frameId: string) {
  const bound = await getFrameBoundBoxInEdgeless(page, frameId);
  await page.mouse.dblclick(bound.x, bound.y);
}

export async function selectFrameInEdgeless(page: Page, frameId: string) {
  const bound = await getFrameBoundBoxInEdgeless(page, frameId);
  await page.mouse.click(bound.x, bound.y);
}

export async function updateExistedBrushElementSize(
  page: Page,
  size: 'thin' | 'thick'
) {
  const text = {
    thin: 'Thin',
    thick: 'Thick',
  }[size];

  const btn = page
    .locator('edgeless-component-toolbar edgeless-tool-icon-button')
    .filter({
      hasText: text,
    });

  await btn.click();
}

export async function openComponentToolbarMoreMenu(page: Page) {
  const btn = page
    .locator('edgeless-component-toolbar edgeless-tool-icon-button')
    .filter({
      hasText: 'More',
    });

  await btn.click();
}

export async function clickComponentToolbarMoreMenuButton(
  page: Page,
  button: 'delete'
) {
  const text = {
    delete: 'Delete',
  }[button];

  const btn = page
    .locator('edgeless-component-toolbar edgeless-more-button')
    .locator('.action-item')
    .filter({ hasText: text });

  await btn.click();
}

// stepX/Y may not equal to wheel event delta.
// Chromium reports deltaX/deltaY scaled by host device scale factor.
// https://bugs.chromium.org/p/chromium/issues/detail?id=1324819
export async function zoomByMouseWheel(
  page: Page,
  stepX: number,
  stepY: number
) {
  await page.keyboard.down(SHORT_KEY);
  await page.mouse.wheel(stepX, stepY);
  await page.keyboard.up(SHORT_KEY);
}

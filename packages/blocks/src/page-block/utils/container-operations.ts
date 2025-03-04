import {
  almostEqual,
  asyncGetBlockElementByModel,
  asyncGetRichTextByModel,
  type BlockComponentElement,
  type ExtendedModel,
  getBlockElementByModel,
  getClosestBlockElementByElement,
  getDefaultPageBlock,
  getVirgoByModel,
  hasNativeSelection,
  isCollapsedNativeSelection,
  isMultiBlockRange,
  resetNativeSelection,
  type TopLevelBlockModel,
} from '@blocksuite/blocks/std';
import type { BlockModels } from '@blocksuite/global/types';
import {
  assertExists,
  assertFlavours,
  matchFlavours,
} from '@blocksuite/global/utils';
import { deserializeXYWH } from '@blocksuite/phasor';
import type { BaseBlockModel, Page } from '@blocksuite/store';
import { Text } from '@blocksuite/store';

import type { RichText } from '../../__internal__/rich-text/rich-text.js';
import type { AffineTextAttributes } from '../../__internal__/rich-text/virgo/types.js';
import {
  type BlockRange,
  getCurrentBlockRange,
  restoreSelection,
  updateBlockRange,
} from '../../__internal__/utils/block-range.js';
import { asyncFocusRichText } from '../../__internal__/utils/common-operations.js';
import { clearMarksOnDiscontinuousInput } from '../../__internal__/utils/virgo.js';
import type { BlockSchemas } from '../../models.js';
import type { DefaultSelectionManager } from '../default/selection-manager/index.js';

const DEFAULT_SPACING = 64;
export const EDGELESS_BLOCK_CHILD_PADDING = 24;

export function handleBlockSelectionBatchDelete(
  page: Page,
  models: ExtendedModel[]
) {
  const parentModel = page.getParent(models[0]);
  assertExists(parentModel);
  const index = parentModel.children.indexOf(models[0]);
  page.captureSync();
  models.forEach(model => page.deleteBlock(model));
  const id = page.addBlock(
    'affine:paragraph',
    { type: 'text' },
    parentModel,
    index
  );

  // Try clean block selection
  const defaultPageBlock = getDefaultPageBlock(models[0]);
  if (!defaultPageBlock.selection) {
    // In the edgeless mode
    return;
  }
  defaultPageBlock.selection.clear();
  return id && asyncFocusRichText(page, id);
}

export function deleteModelsByRange(
  page: Page,
  blockRange = getCurrentBlockRange(page)
) {
  if (!blockRange) {
    return;
  }
  if (blockRange.type === 'Block') {
    return handleBlockSelectionBatchDelete(page, blockRange.models);
  }
  const startModel = blockRange.models[0];
  const endModel = blockRange.models[blockRange.models.length - 1];
  if (!startModel.text || !endModel.text) {
    throw new Error('startModel or endModel does not have text');
  }

  const vEditor = getVirgoByModel(startModel);
  assertExists(vEditor);

  // Only select one block
  if (startModel === endModel) {
    page.captureSync();
    if (
      blockRange.startOffset === blockRange.endOffset &&
      blockRange.startOffset > 0
    ) {
      // startModel.text.delete(blockRange.startOffset - 1, 1);
      // vEditor.setVRange({
      //   index: blockRange.startOffset - 1,
      //   length: 0,
      // });
      return;
    }
    startModel.text.delete(
      blockRange.startOffset,
      blockRange.endOffset - blockRange.startOffset
    );
    vEditor.setVRange({
      index: blockRange.startOffset,
      length: 0,
    });
    return;
  }
  page.captureSync();
  startModel.text.delete(
    blockRange.startOffset,
    startModel.text.length - blockRange.startOffset
  );
  endModel.text.delete(0, blockRange.endOffset);
  startModel.text.join(endModel.text);
  blockRange.models.slice(1).forEach(model => {
    page.deleteBlock(model);
  });

  return vEditor.setVRange({
    index: blockRange.startOffset,
    length: 0,
  });
}

/**
 * Do nothing when selection is collapsed or not multi block selected
 */
export function handleMultiBlockBackspace(page: Page, e: KeyboardEvent) {
  if (!hasNativeSelection()) return;
  if (isCollapsedNativeSelection()) return;
  if (!isMultiBlockRange()) return;
  e.preventDefault();
  deleteModelsByRange(page);
}

function mergeToCodeBlocks(page: Page, models: BaseBlockModel[]) {
  const parent = page.getParent(models[0]);
  assertExists(parent);
  const index = parent.children.indexOf(models[0]);
  const text = models
    .map(model => {
      if (model.text instanceof Text) {
        return model.text.toString();
      }
      return null;
    })
    .filter(Boolean)
    .join('\n');
  models.map(model => page.deleteBlock(model));

  const id = page.addBlock(
    'affine:code',
    { text: new Text(text) },
    parent,
    index
  );
  return id;
}

export function updateBlockType(
  models: BaseBlockModel[],
  flavour: keyof BlockSchemas,
  type?: string
) {
  if (!models.length) {
    return [];
  }
  const page = models[0].page;
  const hasSamePage = models.every(model => model.page === page);
  if (!hasSamePage) {
    // page check
    console.error(
      'Not all models have the same page instanceof, the result for update text type may not be correct',
      models
    );
  }
  page.captureSync();
  const savedBlockRange = getCurrentBlockRange(page);
  if (flavour === 'affine:code') {
    const id = mergeToCodeBlocks(page, models);
    const model = page.getBlockById(id);
    if (!model) {
      throw new Error('Failed to get model after merge code block!');
    }
    return [model];
  }
  // The lastNewId will not be null since we have checked models.length > 0
  const newModels: BaseBlockModel[] = [];
  models.forEach(model => {
    assertFlavours(model, ['affine:paragraph', 'affine:list', 'affine:code']);
    if (model.flavour === flavour) {
      page.updateBlock(model, { type });
      newModels.push(model);
      return;
    }
    const newId = transformBlock(model, flavour, type);
    const newModel = page.getBlockById(newId);
    if (!newModel) {
      throw new Error('Failed to get new model after transform block!');
    }
    savedBlockRange && updateBlockRange(savedBlockRange, model, newModel);
    newModels.push(newModel);
  });

  const allTextUpdated = savedBlockRange?.models.map(
    model => new Promise(resolve => onModelTextUpdated(model, resolve))
  );
  if (allTextUpdated && savedBlockRange) {
    Promise.all(allTextUpdated).then(() => {
      restoreSelection(savedBlockRange);
    });
  }

  return newModels;
}

function transformBlock(
  model: BaseBlockModel,
  flavour: keyof BlockModels,
  type?: string
) {
  const page = model.page;
  const parent = page.getParent(model);
  assertExists(parent);
  const blockProps: {
    type?: string;
    text?: Text;
    children?: BlockSuiteInternal.IBaseBlockProps[];
  } = {
    type,
    text: model?.text?.clone(), // should clone before `deleteBlock`
    children: model.children,
  };
  const index = parent.children.indexOf(model);
  page.deleteBlock(model);
  return page.addBlock(flavour, blockProps, parent, index);
}

/**
 * Merge format of multiple blocks. Format will be active only when all blocks have the same format.
 *
 * Used for format quick bar.
 */
function mergeFormat(formatArr: AffineTextAttributes[]): AffineTextAttributes {
  if (!formatArr.length) {
    return {};
  }
  return formatArr.reduce((acc, cur) => {
    const newFormat: AffineTextAttributes = {};
    for (const key in acc) {
      const typedKey = key as keyof AffineTextAttributes;
      if (acc[typedKey] === cur[typedKey]) {
        // This cast is secure because we have checked that the value of the key is the same.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        newFormat[typedKey] = acc[typedKey] as any;
      }
    }
    return newFormat;
  });
}

export function getCombinedFormat(
  blockRange: BlockRange
): AffineTextAttributes {
  if (blockRange.models.length === 1) {
    const vEditor = getVirgoByModel(blockRange.models[0]);
    assertExists(vEditor);
    const format = vEditor.getFormat({
      index: blockRange.startOffset,
      length: blockRange.endOffset - blockRange.startOffset,
    });
    return format;
  }
  const formatArr = [];
  // Start block
  // Skip code block or empty block
  const startModel = blockRange.models[0];
  if (
    !matchFlavours(startModel, ['affine:code'] as const) &&
    startModel.text &&
    startModel.text.length
  ) {
    const vEditor = getVirgoByModel(startModel);
    assertExists(vEditor);
    const startFormat = vEditor.getFormat({
      index: blockRange.startOffset,
      length: vEditor.yText.length - blockRange.startOffset,
    });
    formatArr.push(startFormat);
  }
  // End block
  const endModel = blockRange.models[blockRange.models.length - 1];
  if (
    !matchFlavours(endModel, ['affine:code'] as const) &&
    endModel.text &&
    endModel.text.length
  ) {
    const vEditor = getVirgoByModel(endModel);
    assertExists(vEditor);
    const endFormat = vEditor.getFormat({
      index: 0,
      length: blockRange.endOffset,
    });
    formatArr.push(endFormat);
  }
  // Between blocks
  blockRange.models
    .slice(1, -1)
    .filter(model => !matchFlavours(model, ['affine:code'] as const))
    .filter(model => model.text && model.text.length)
    .forEach(model => {
      const vEditor = getVirgoByModel(model);
      assertExists(vEditor);
      const format = vEditor.getFormat({
        index: 0,
        length: vEditor.yText.length - 1,
      });
      formatArr.push(format);
    });

  return mergeFormat(formatArr);
}

export function getCurrentCombinedFormat(page: Page): AffineTextAttributes {
  const blockRange = getCurrentBlockRange(page);
  if (!blockRange || blockRange.models.every(model => !model.text)) {
    return {};
  }
  return getCombinedFormat(blockRange);
}

function formatBlockRange(
  blockRange: BlockRange,
  key: keyof Omit<AffineTextAttributes, 'link' | 'reference'>
) {
  const { startOffset, endOffset } = blockRange;
  const startModel = blockRange.models[0];
  const endModel = blockRange.models[blockRange.models.length - 1];
  // edge case 1: collapsed range
  if (blockRange.models.length === 1 && startOffset === endOffset) {
    // Collapsed range

    const vEditor = getVirgoByModel(startModel);
    const delta = vEditor?.getDeltaByRangeIndex(startOffset);
    if (!vEditor || !delta) return;
    vEditor.setMarks({
      ...vEditor.marks,
      [key]:
        (vEditor.marks && vEditor.marks[key]) ||
        (delta.attributes && delta.attributes[key])
          ? null
          : true,
    });
    clearMarksOnDiscontinuousInput(vEditor);

    return;
  }
  const format = getCombinedFormat(blockRange);

  // edge case 2: same model
  if (blockRange.models.length === 1) {
    if (matchFlavours(startModel, ['affine:code'] as const)) return;
    const vEditor = getVirgoByModel(startModel);
    vEditor?.slots.updated.once(() => {
      restoreSelection(blockRange);
    });
    startModel.text?.format(startOffset, endOffset - startOffset, {
      [key]: format[key] ? null : true,
    });
    return;
  }
  // common case
  // format start model
  if (!matchFlavours(startModel, ['affine:code'] as const)) {
    startModel.text?.format(startOffset, startModel.text.length - startOffset, {
      [key]: format[key] ? null : true,
    });
  }
  // format end model
  if (!matchFlavours(endModel, ['affine:code'] as const)) {
    endModel.text?.format(0, endOffset, { [key]: format[key] ? null : true });
  }
  // format between models
  blockRange.models
    .slice(1, -1)
    .filter(model => !matchFlavours(model, ['affine:code']))
    .forEach(model => {
      model.text?.format(0, model.text.length, {
        [key]: format[key] ? null : true,
      });
    });

  // Native selection maybe shifted after format
  // We need to restore it manually
  if (blockRange.type === 'Native') {
    const allTextUpdated = blockRange.models
      .filter(model => !matchFlavours(model, ['affine:code']))
      .map(model => new Promise(resolve => onModelTextUpdated(model, resolve)));

    Promise.all(allTextUpdated).then(() => {
      restoreSelection(blockRange);
    });
  }
}

export function handleFormat(
  page: Page,
  key: keyof Omit<AffineTextAttributes, 'link' | 'reference'>
) {
  const blockRange = getCurrentBlockRange(page);
  if (!blockRange) return;
  page.captureSync();
  formatBlockRange(blockRange, key);
}

export function handleSelectAll(selection: DefaultSelectionManager) {
  const currentSelection = window.getSelection();
  if (
    selection.state.selectedBlocks.length === 0 &&
    currentSelection?.focusNode?.nodeName === '#text'
  ) {
    selection.selectOneBlock(
      getClosestBlockElementByElement(currentSelection.focusNode.parentElement)
    );
  } else {
    selection.selectAllBlocks();
  }

  resetNativeSelection(null);
}

export async function onModelTextUpdated(
  model: BaseBlockModel,
  callback: (text: RichText) => void
) {
  const richText = await asyncGetRichTextByModel(model);
  richText?.vEditor?.slots.updated.once(() => {
    callback(richText);
  });
}

// Run the callback until a model's element updated.
// Please notice that the callback will be called **once the element itself is ready**.
// The children may be not updated.
// If you want to wait for the text elements,
// please use `onModelTextUpdated`.
export async function onModelElementUpdated(
  model: BaseBlockModel,
  callback: (blockElement: BlockComponentElement) => void
) {
  const element = await asyncGetBlockElementByModel(model);
  if (element) {
    callback(element);
  }
}

export function tryUpdateFrameSize(page: Page, zoom: number) {
  requestAnimationFrame(() => {
    if (!page.root) return;
    const frames = page.root.children as TopLevelBlockModel[];
    let offset = 0;
    frames.forEach(model => {
      // DO NOT resize shape block
      // FIXME: we don't have shape block for now.
      // if (matchFlavours(model, ['affine:shape'] as const)) return;
      const blockElement = getBlockElementByModel(model);
      if (!blockElement) return;
      const bound = blockElement.getBoundingClientRect();

      const [x, y, w, h] = deserializeXYWH(model.xywh);
      const newModelHeight =
        bound.height / zoom + EDGELESS_BLOCK_CHILD_PADDING * 2;
      if (!almostEqual(newModelHeight, h)) {
        const newX = x + (offset === 0 ? 0 : offset + DEFAULT_SPACING);
        page.updateBlock(model, {
          xywh: JSON.stringify([newX, y, w, Math.round(newModelHeight)]),
        });
        offset = newX + w;
      }
    });
  });
}

/**
 * The diagram as a PNG file (docs/tasks/ui-followups.md 2.1).
 *
 * Not a screenshot of the canvas on screen: that one carries the selection,
 * the hover, the `...` handle, the zoom and the ports, all of which are about
 * the reader's cursor rather than about the deployment. The drawing is drawn
 * again, off screen, by the same `TopoCanvas` with nothing selected and no
 * gesture wired -- in the page, so the current theme's tokens resolve -- and
 * then:
 *
 *   1. cloned, with every element's computed style copied onto the clone
 *      (`svg-style.ts` says which properties and why);
 *   2. serialised with explicit `width`/`height` at 2x, so the browser
 *      rasterises the vector at the final size rather than upscaling pixels;
 *   3. loaded as an `<img>` from a `data:` URL -- the page's policy is
 *      `img-src 'self' data:`, which admits it, where a `blob:` image would
 *      need the policy widened -- and painted onto a canvas over the page's
 *      own ground colour;
 *   4. handed to the reader as `<configuration>.png` through a `blob:` link,
 *      the way Export hands over the JSON file (a download is a navigation,
 *      which `img-src` does not govern).
 *
 * No network access, no inline style, no new policy.
 */

import { render } from 'preact';
import { doc, exportStem } from '@/state/doc';
import { frame, geometry, redoGraph, topology } from '@/state/derived';
import { mode, toast } from '@/state/view';
import { TopoCanvas } from '../canvas/TopoCanvas';
import {
  DROP_SELECTOR, inlineComputedStyles, padBox, parseViewBox, svgDataUrl,
} from './svg-style';
import { downloadBlob } from './download';
import '@/styles/export.css';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The ground left around the drawing in the picture, in user units. */
export const PNG_PAD = 16;
/** Pixels per user unit: a 2x picture reads sharply on a high-density screen and in a slide. */
export const PNG_SCALE = 2;

export interface DrawingSnapshot {
  /** The standalone SVG file, styles resolved. */
  text: string;
  /** Its declared size, in pixels. */
  width: number;
  height: number;
  /** The page's ground colour, resolved, for what the drawing leaves bare. */
  background: string;
}

const nextFrame = (): Promise<void> =>
  new Promise((r) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => r());
    else setTimeout(r, 0);
  });

/**
 * Draw the configuration off screen and return it as a standalone SVG.
 * Null when there is nothing to draw (no primary, so no redo graph).
 */
export async function snapshotDrawing(
  { withFrame = false, scale = PNG_SCALE }: { withFrame?: boolean; scale?: number } = {},
): Promise<DrawingSnapshot | null> {
  const graph = redoGraph.value;
  if (graph === null || typeof document === 'undefined') return null;
  const geo = geometry.value;
  const host = document.createElement('div');
  host.className = 'export-stage';
  host.setAttribute('aria-hidden', 'true');
  /* Inside the shell when there is one, so a rule scoped to it still applies. */
  (document.querySelector('.app') ?? document.body).appendChild(host);
  try {
    render(
      <TopoCanvas
        doc={topology.value}
        graph={graph}
        {...(geo === null ? {} : { geometry: geo })}
        frame={withFrame ? frame.value : null}
        overrides={doc.value.layout}
        interactive={false}
        prefix="ex"
        readOnlyWhy="An exported picture of the configuration."
      />,
      host,
    );
    /* The drawing lays itself out in effects; two frames and it has settled. */
    await nextFrame();
    await nextFrame();
    const svg = host.querySelector<SVGSVGElement>('svg.topo-svg');
    if (svg === null) return null;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    inlineComputedStyles(svg, clone);
    for (const el of [...clone.querySelectorAll(DROP_SELECTOR)]) el.remove();

    const box = parseViewBox(svg.getAttribute('viewBox'));
    if (box === null) return null;
    const view = padBox(box, PNG_PAD);
    const width = Math.round(view.w * scale);
    const height = Math.round(view.h * scale);
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('viewBox', `${view.x} ${view.y} ${view.w} ${view.h}`);
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    clone.removeAttribute('class');

    const background = getComputedStyle(document.body).backgroundColor || '#FFFFFF';
    return { text: new XMLSerializer().serializeToString(clone), width, height, background };
  } finally {
    render(null, host);
    host.remove();
  }
}

/** Paint a snapshot onto a canvas, over its ground colour, and encode it as PNG. */
export function rasterise(snap: DrawingSnapshot): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'sync';
    img.addEventListener('load', () => {
      const canvas = document.createElement('canvas');
      canvas.width = snap.width;
      canvas.height = snap.height;
      const ctx = canvas.getContext('2d');
      if (ctx === null) { reject(new Error('This browser gives the page no canvas.')); return; }
      ctx.fillStyle = snap.background;
      ctx.fillRect(0, 0, snap.width, snap.height);
      ctx.drawImage(img, 0, 0, snap.width, snap.height);
      canvas.toBlob((blob) => {
        if (blob === null) reject(new Error('The picture could not be encoded.'));
        else resolve(blob);
      }, 'image/png');
    });
    img.addEventListener('error', () => reject(new Error('The drawing could not be rasterised.')));
    img.src = svgDataUrl(snap.text);
  });
}

/** The file name the picture is saved under. */
export const pngFileName = (): string => `${exportStem(doc.value)}.png`;

/** ⋯ → Diagram as PNG. */
export async function exportPng(): Promise<void> {
  try {
    /* Break draws the run at the playhead, and the picture is what is on
       screen; every other mode draws the configuration at rest. */
    const snap = await snapshotDrawing({ withFrame: mode.value === 'break' });
    if (snap === null) {
      toast.value = { kind: 'info', text: 'There is no drawing to export: the configuration has no primary database.' };
      return;
    }
    const name = pngFileName();
    if (await downloadBlob(await rasterise(snap), name)) {
      toast.value = { kind: 'info', text: `The diagram was saved as ${name}.` };
    }
  } catch (e) {
    toast.value = {
      kind: 'error',
      text: e instanceof Error ? e.message : 'The diagram could not be exported.',
    };
  }
}

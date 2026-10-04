/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { h, render } from 'preact';
import { PanelResize } from '@/ui/timeline/PanelResize';
import { loadTimelineH, setTimelineH, TIMELINE_H_KEY } from '@/state/persist';
import { timelineH, TL_MIN_H } from '@/state/view';
const memory = new Map<string,string>();
Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:(k:string)=>memory.get(k)??null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)}});
let root: HTMLDivElement;
const tick = () => new Promise(r => setTimeout(r, 0));
const pointer = (el: Element, kind: string, y: number) => { const name=`pointer${kind.toLowerCase()}`; el.dispatchEvent(new MouseEvent(`on${name}` in el ? name : `Pointer${kind}`, { bubbles:true, clientY:y, button:0 })); };
beforeEach(() => { timelineH.value=null; memory.clear(); root=document.createElement('div'); root.className='app is-float'; document.body.append(root); render(h(PanelResize,{}),root); });
afterEach(() => { render(null,root); root.remove(); });
it('resizes by dragging upward and remembers only the completed gesture', async () => {
  const el=root.querySelector('.dock-grip')!; setTimelineH(300,false); await tick();
  pointer(el,'Down',400); pointer(el,'Move',336); await tick();
  expect(timelineH.value).toBe(364); expect(window.localStorage.getItem(TIMELINE_H_KEY)).toBeNull();
  pointer(el,'Up',336); expect(window.localStorage.getItem(TIMELINE_H_KEY)).toBe('364');
});
it('restores the prior preference if pointer capture is cancelled', async () => {
  const el=root.querySelector('.dock-grip')!; setTimelineH(300); await tick();
  pointer(el,'Down',400); pointer(el,'Move',336); pointer(el,'Cancel',336);
  expect(timelineH.value).toBe(300); expect(window.localStorage.getItem(TIMELINE_H_KEY)).toBe('300');
});
it('supports keyboard resizing and a default-height reset', async () => {
  const el=root.querySelector('.dock-grip')!;
  setTimelineH(2000,false); await tick();
  expect(Number(el.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(Number(el.getAttribute('aria-valuemax')));
  el.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true})); await tick();
  expect(timelineH.value).toBe(TL_MIN_H);
  el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); expect(timelineH.value).toBeNull();
});
it('loads the remembered height and rejects invalid values', () => {
  setTimelineH(400); timelineH.value=null; loadTimelineH(); expect(timelineH.value).toBe(400);
  window.localStorage.setItem(TIMELINE_H_KEY,'broken'); loadTimelineH(); expect(timelineH.value).toBeNull();
});

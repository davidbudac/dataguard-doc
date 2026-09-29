/**
 * The desktop shell's shim (ui/common/desktop.ts): with `window.__TAURI__`
 * absent the page must behave as the web build always has, and with it present
 * the file, print and share paths must take the native route.
 *
 * @vitest-environment jsdom
 */

import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_URL, desktopDownload, isDesktop, printNative, saveFile, shareBase,
} from '@/ui/common/desktop';
import { downloadBlob } from '@/ui/export/download';
import { buildShareUrl } from '@/state/url';
import { classicDoc, doc } from '@/state/doc';

/* jsdom's Blob has no arrayBuffer(); every real webview's does, so the tests use Node's. */
const mk = (s: string): Blob => new NodeBlob([s]) as unknown as Blob;

type G = { __TAURI__?: unknown };
const g = globalThis as G;

const install = (invoke: ReturnType<typeof vi.fn>): void => {
  g.__TAURI__ = { core: { invoke } };
};

beforeEach(() => { delete g.__TAURI__; });
afterEach(() => { delete g.__TAURI__; vi.restoreAllMocks(); });

describe('isDesktop', () => {
  it('is false in a browser', () => {
    expect(isDesktop()).toBe(false);
  });
  it('is true once the shell has injected core.invoke', () => {
    install(vi.fn());
    expect(isDesktop()).toBe(true);
  });
  it('is not fooled by a global with no invoke', () => {
    g.__TAURI__ = { core: {} };
    expect(isDesktop()).toBe(false);
    g.__TAURI__ = {};
    expect(isDesktop()).toBe(false);
  });
});

describe('the no-op contract off desktop', () => {
  it('saveFile and printNative do nothing and say so', async () => {
    expect(await saveFile('a.png', mk('x'))).toBe(false);
    expect(await printNative()).toBe(false);
  });
  it('desktopDownload leaves the anchor to the browser', () => {
    const e = new Event('click', { cancelable: true });
    desktopDownload('x.sql')(e);
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('saveFile', () => {
  it('sends the bytes raw, with the name percent-encoded in a header', async () => {
    const invoke = vi.fn().mockResolvedValue(true);
    install(invoke);
    const ok = await saveFile('my topology.dgtopo.json', mk('{"a":1}'));
    expect(ok).toBe(true);
    const [cmd, body, opts] = invoke.mock.calls[0]!;
    expect(cmd).toBe('save_file');
    expect(body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(body as Uint8Array)).toBe('{"a":1}');
    expect(opts).toEqual({ headers: { 'x-file-name': 'my%20topology.dgtopo.json' } });
  });
  it('passes a cancelled dialog back as false', async () => {
    install(vi.fn().mockResolvedValue(false));
    expect(await saveFile('a.png', mk('x'))).toBe(false);
  });
});

describe('downloadBlob', () => {
  it('goes through the native dialog on desktop and creates no link', async () => {
    const invoke = vi.fn().mockResolvedValue(true);
    install(invoke);
    const before = document.querySelectorAll('a').length;
    expect(await downloadBlob(mk('x'), 'd.png')).toBe(true);
    expect(invoke).toHaveBeenCalledOnce();
    expect(document.querySelectorAll('a').length).toBe(before);
  });
  it('reports a cancelled dialog as not saved', async () => {
    install(vi.fn().mockResolvedValue(false));
    expect(await downloadBlob(mk('x'), 'd.png')).toBe(false);
  });
  it('clicks a download link in a browser', async () => {
    const create = vi.fn(() => 'blob:x');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    expect(await downloadBlob(mk('x'), 'd.png')).toBe(true);
    expect(click).toHaveBeenCalledOnce();
  });
});

describe('the Share link origin', () => {
  beforeEach(() => { doc.value = classicDoc(); });

  it('names the public host, on its own', () => {
    expect(PUBLIC_URL).toBe('https://dataguard.davidbudac.cz/');
  });
  it('keeps the page\'s own address in a browser', () => {
    expect(shareBase('http://localhost:5179/x/')).toBe('http://localhost:5179/x/');
  });
  it('uses the public address on desktop, whatever the webview origin is', () => {
    install(vi.fn());
    expect(shareBase('tauri://localhost/')).toBe(PUBLIC_URL);
    expect(shareBase('http://tauri.localhost/')).toBe(PUBLIC_URL);
  });
  it('builds the whole link against the right base in each case', async () => {
    const web = await buildShareUrl();
    expect(web.url.startsWith(`${location.origin}${location.pathname}`)).toBe(true);
    install(vi.fn());
    const desk = await buildShareUrl();
    expect(desk.url.startsWith(PUBLIC_URL)).toBe(true);
    expect(desk.url.slice(PUBLIC_URL.length)).toBe(web.url.slice(`${location.origin}${location.pathname}`.length));
  });
});

import type { ButtonInstance, Preview } from './pixi-adapter.ts';
interface ProbeContext {
  preview: Preview;
  load(): Promise<void>;
  current(): ButtonInstance;
  dispose(): void;
  count(): number;
  output(text: string): void;
}
/** Explicit synthetic DOM input probes. These are NOT physical-device tests. */
export async function runProbes(c: ProbeContext): Promise<void> {
  const results: string[] = [];
  const assert = (ok: boolean, message: string) => { if (!ok) throw new Error(`ASSERT_FAILED: ${message}`); };
  function pointer(type: string, options: { id?: number; pointerType?: string; primary?: boolean; outside?: boolean } = {}) {
    const rect = c.preview.canvas.getBoundingClientRect();
    const event = new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: options.id ?? 1, pointerType: options.pointerType ?? 'mouse',
      isPrimary: options.primary ?? true, button: 0, buttons: type === 'pointerdown' ? 1 : 0,
      clientX: rect.left + rect.width * (options.outside ? 0.95 : 0.5), clientY: rect.top + rect.height * 0.5,
    });
    c.preview.canvas.dispatchEvent(event);
  }
  async function check(name: string, fn: () => void | Promise<void>) {
    try { await fn(); results.push(`PASS ${name}`); c.output(results.join('\n')); }
    catch (error) {
      results.push(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`, 'STOP：后续检查未执行');
      c.output(results.join('\n')); throw error;
    }
  }
  try { await c.load(); }
  catch (error) {
    c.output(`FAIL 初始加载：${error instanceof Error ? error.message : String(error)}\nSTOP：后续检查未执行`);
    throw error;
  }
  await check('合成 mouse 点击：pressed → hover；一次 activate', () => {
    const before = c.count(); pointer('pointerdown'); assert(c.current().snapshot().state === 'pressed', '未进入 pressed');
    pointer('pointerup'); assert(c.count() === before + 1, 'activate 非一次');
    pointer('pointerup'); assert(c.count() === before + 1, '重复释放产生事件');
  });
  await check('合成移出释放：零 activate，清除按下', () => {
    const before = c.count(); pointer('pointerdown'); pointer('pointerup', { outside: true });
    assert(c.count() === before, '外部释放误激活'); assert(c.current().snapshot().pressedPointer === null, '残留按下');
  });
  await check('合成 pointercancel：零 activate，后续释放无效', () => {
    const before = c.count(); pointer('pointerdown'); pointer('pointercancel'); pointer('pointerup');
    assert(c.count() === before, '取消误激活'); assert(c.current().snapshot().pressedPointer === null, '残留按下');
  });
  await check('合成 lostpointercapture：清理操作', () => {
    const before = c.count(); pointer('pointerdown'); pointer('lostpointercapture'); pointer('pointerup');
    assert(c.count() === before, 'capture 丢失后误激活'); assert(c.current().snapshot().pressedPointer === null, '残留按下');
  });
  await check('合成窗口 blur：清理操作', () => {
    const before = c.count(); pointer('pointerdown'); window.dispatchEvent(new Event('blur')); pointer('pointerup');
    assert(c.count() === before, 'blur 后误激活'); assert(c.current().snapshot().pressedPointer === null, '残留按下');
  });
  await check('合成 Escape：清理操作', () => {
    const before = c.count(); pointer('pointerdown'); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); pointer('pointerup');
    assert(c.count() === before, 'Escape 后误激活');
  });
  await check('禁用与按下期间禁用：零 activate', () => {
    const before = c.count(); c.current().setEnabled(false); pointer('pointerdown'); pointer('pointerup');
    assert(c.current().snapshot().state === 'disabled', '禁用状态错误');
    c.current().setEnabled(true); pointer('pointerdown'); c.current().setEnabled(false); c.current().setEnabled(true); pointer('pointerup');
    assert(c.count() === before, '禁用误激活');
  });
  await check('合成 pen 与第二指针：只有首指针可结束操作', () => {
    const before = c.count(); pointer('pointerdown', { pointerType: 'pen', id: 4 });
    pointer('pointerdown', { pointerType: 'pen', id: 5, primary: false });
    pointer('pointerup', { pointerType: 'pen', id: 5, primary: false });
    assert(c.count() === before && c.current().snapshot().pressedPointer === 4, '第二指针干扰首指针');
    pointer('pointerup', { pointerType: 'pen', id: 4 }); assert(c.count() === before + 1, '首指针无法激活');
  });
  await check('合成 touch 点击：一次 activate，释放后 normal', () => {
    const before = c.count(); pointer('pointerdown', { pointerType: 'touch', id: 8 });
    assert(c.current().snapshot().state === 'pressed', 'touch 未进入 pressed');
    pointer('pointerup', { pointerType: 'touch', id: 8 });
    assert(c.count() === before + 1, 'touch 未激活一次'); assert(c.current().snapshot().state === 'normal', 'touch 残留 hover');
  });
  await check('合成 touch pointercancel：零 activate', () => {
    const before = c.count(); pointer('pointerdown', { pointerType: 'touch', id: 9 });
    pointer('pointercancel', { pointerType: 'touch', id: 9 }); pointer('pointerup', { pointerType: 'touch', id: 9 });
    assert(c.count() === before, 'touch 取消误激活'); assert(c.current().snapshot().pressedPointer === null, 'touch 取消残留');
  });
  await check('按下期间销毁：清除实例、外部监听器和事件', async () => {
    const before = c.count(); const old = c.current(); pointer('pointerdown'); c.dispose(); pointer('pointerup');
    assert(old.snapshot().destroyed, '旧实例未销毁');
    assert(c.preview.inspect().instances === 0 && c.preview.inspect().externalListeners === 0, '销毁残留');
    assert(c.count() === before, '销毁后激活'); await c.load();
  });
  await check('连续重载 20 次：保持 1 实例 / 6 外部监听器；一次 activate', async () => {
    for (let i = 0; i < 20; i++) {
      await c.load(); assert(c.preview.inspect().instances === 1 && c.preview.inspect().externalListeners === 6, `第 ${i + 1} 次重载残留`);
    }
    const before = c.count(); pointer('pointerdown'); pointer('pointerup'); assert(c.count() === before + 1, '重载后重复事件');
  });
  await check('并发重载：旧请求取消，仅最新实例存活', async () => {
    const first = c.load(); const second = c.load();
    const outcomes = await Promise.allSettled([first, second]);
    assert(outcomes[0].status === 'rejected' && outcomes[0].reason?.name === 'AbortError', '旧加载未显式取消');
    assert(outcomes[1].status === 'fulfilled', '新加载失败');
    assert(c.preview.inspect().instances === 1 && c.preview.inspect().externalListeners === 6, '并发加载残留');
  });
  await check('50% / 150% 缩放后合成点击命中', () => {
    for (const zoom of [0.5, 1.5]) {
      c.preview.setZoom(zoom); const before = c.count(); pointer('pointerdown'); pointer('pointerup'); assert(c.count() === before + 1, `缩放 ${zoom} 点击失效`);
    }
    c.preview.setZoom(1);
  });
  results.push(`完成：${results.length} 项通过。仅为合成事件与生命周期测试；不替代真实输入或用户外观验收。`);
  c.output(results.join('\n'));
}

(async () => {
  const results = [];
  const pause = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const waitFor = async (condition, message) => {
    const deadline = performance.now() + 4000;
    while (!condition()) {
      if (performance.now() > deadline) throw new Error(typeof message === 'function' ? message() : message);
      await pause();
    }
    await pause();
  };
  const rows = () => [...document.querySelectorAll('.video-list-row')];
  const row = (id) => document.querySelector(`.video-list-row[data-video-id="${id}"]`);
  const scroller = () => document.querySelector('.video-grid-content').parentElement;
  const press = async (key) => {
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await pause(100);
    document.activeElement.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
  };

  await waitFor(() => window.videoListFixture && rows().length > 0, 'Fixture did not mount');
  const fixture = window.videoListFixture;
  assert(rows().length < 40, 'Initial mount rendered the full 10,000-row list');
  assert(row(1).getBoundingClientRect().height === 78, 'Row height differs from virtual layout');
  assert(scroller().scrollHeight >= 839994, 'Virtual list does not preserve total scroll height');
  results.push({ check: '10,000 records mount a bounded number of rows', mounted: rows().length });

  scroller().scrollTop = 420000;
  await waitFor(() => row(5001), 'Middle rows did not mount after scrolling');
  assert(rows().length < 40 && !row(1000), 'Offscreen rows were not unmounted');
  const formatsBefore = window.rowDateFormats;
  scroller().scrollTop += 1;
  await pause(150);
  assert(window.rowDateFormats - formatsBefore <= 2, 'Pixel scrolling rerendered unchanged rows');
  results.push({ check: 'Middle scrolling stays bounded and reuses unchanged rows', mounted: rows().length });

  scroller().scrollTop = scroller().scrollHeight;
  await waitFor(() => row(10000), 'Last row is unreachable');
  assert(rows().length < 40, 'Bottom scrolling accumulated old rows');
  results.push({ check: 'Last row remains reachable', mounted: rows().length });

  scroller().scrollTop = 420000;
  await waitFor(() => row(5001), 'Could not return to the middle');
  const lastRendered = rows().at(-1);
  const targetId = Number(lastRendered.dataset.videoId) + 1;
  lastRendered.focus({ preventScroll: true });
  await pause(100);
  const beforeArrow = { activeId: document.activeElement?.dataset?.videoId,
    focused: document.querySelector('.video-list-row.is-focused')?.dataset.videoId, hasDocumentFocus: document.hasFocus() };
  await press('ArrowDown');
  await waitFor(() => document.activeElement === row(targetId), () => 'Keyboard target did not mount and receive focus: ' + JSON.stringify({
    targetId, beforeArrow, activeId: document.activeElement?.dataset?.videoId,
    focused: document.querySelector('.video-list-row.is-focused')?.dataset.videoId,
    mounted: rows().map((element) => element.dataset.videoId), scrollTop: scroller().scrollTop,
  }));
  await waitFor(() => {
    const target = row(targetId).getBoundingClientRect();
    const viewport = scroller().getBoundingClientRect();
    return target.top >= viewport.top - 1 && target.bottom <= viewport.bottom + 1;
  }, 'Keyboard target was not scrolled fully into view');
  assert(row(targetId).classList.contains('is-focused'), 'Keyboard highlight differs from focused row');
  const playsBefore = fixture.events.plays;
  await press('Enter');
  assert(fixture.events.plays === playsBefore + 1, 'Enter played the focused item more than once');
  results.push({ check: 'Offscreen keyboard navigation, scroll position and single Enter activation' });

  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }));
  assert(fixture.events.plays === playsBefore + 1, 'Held Enter restarted list playback');
  window.emitMpvStopped();
  await pause();
  await press('Enter');
  assert(fixture.events.plays === playsBefore + 1, 'The mpv exit key reopened a video after focus returned');
  await pause(450);
  await press('Enter');
  assert(fixture.events.plays === playsBefore + 2, 'A fresh Enter press no longer opens the focused video');
  results.push({ check: 'Enter repeats and the playback-exit key cannot reopen a video' });

  fixture.setSelectionMode(true);
  await pause(100);
  await press(' ');
  await waitFor(() => window.videoListFixture.getSelected().length === 1, 'Space did not select exactly one row');
  scroller().scrollTop = 0;
  await waitFor(() => row(1), 'Top rows did not remount');
  assert(window.videoListFixture.getSelected().includes(targetId), 'Scrolling lost the offscreen selection');
  fixture.setSelectionMode(false);
  await pause(100);
  const favoriteButton = row(1).querySelector('button');
  favoriteButton.focus();
  const playsBeforeFavorite = fixture.events.plays;
  await press('Enter');
  assert(fixture.events.plays === playsBeforeFavorite, 'Favorite keyboard input also activated the row');
  favoriteButton.click();
  assert(fixture.events.favorites === 1, 'Favorite action did not fire once');
  results.push({ check: 'Selection survives virtualization; favorite input does not trigger playback' });

  fixture.setHidden([1, 2, 3]);
  await waitFor(() => !row(1) && !row(2) && !row(3), 'Hidden rows remain mounted');
  scroller().scrollTop = 420000;
  await pause(100);
  fixture.switchDirectory(3);
  await waitFor(() => rows().length === 3 && scroller().scrollTop === 0, 'Directory switch did not reset/clamp virtualization');
  results.push({ check: 'Hidden rows and switching from a deep position to a small directory' });

  fixture.switchDirectory(10000);
  await pause(100);
  scroller().scrollTop = 420000;
  await pause(100);
  fixture.setViewMode('grid');
  await waitFor(() => document.querySelector('.video-card') && scroller().scrollTop === 0, 'Grid mode did not reset its scroll geometry');
  assert(document.querySelectorAll('.video-card').length < 100, 'Grid virtualization regressed');
  document.querySelector('.video-card').focus({ preventScroll: true });
  const gridPlaysBefore = fixture.events.plays;
  document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true }));
  assert(fixture.events.plays === gridPlaysBefore, 'Held Enter restarted grid playback');
  fixture.setViewMode('list');
  await waitFor(() => rows().length > 0 && rows().length < 40 && scroller().scrollTop === 0, 'List mode did not restore virtual rows');
  results.push({ check: 'Switching list/grid restores the correct virtual layout' });

  fixture.switchDirectory(0);
  await waitFor(() => !rows().length && document.querySelector('.video-grid-empty'), 'Empty directory is broken');
  fixture.switchDirectory(1);
  await waitFor(() => rows().length === 1, 'Single-row directory is broken');
  fixture.switchDirectory(10000);
  await waitFor(() => rows().length > 0 && rows().length < 40, 'Large directory did not recover');
  results.push({ check: 'Empty, single-row and large-directory transitions' });
  return results;
})()

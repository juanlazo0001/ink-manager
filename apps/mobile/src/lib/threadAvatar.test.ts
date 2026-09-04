import test from 'node:test';
import assert from 'node:assert/strict';

import { threadAvatarLayout, type ThreadAvatarPerson } from './threadAvatar';

const person = (n: string): ThreadAvatarPerson => ({ id: n, name: n, avatarUrl: null });

// ─── THE LAUNCH CRASH ────────────────────────────────────────────────────
//
// One participant used to satisfy the group test (`length > 0`) and then be
// rendered through the duo-stack, which reads participants[1].avatarUrl --
// undefined. The conversation list renders every row, so a single thread of
// this shape took the whole tab down on open.
//
// This is the case that must never return 'duo' or 'overflow' again.
test('ONE participant renders a single avatar, never the duo-stack', () => {
  const layout = threadAvatarLayout([person('Ada')]);
  assert.equal(layout.kind, 'single');
  assert.equal(layout.kind === 'single' ? layout.person?.name : null, 'Ada');
});

test('one participant shows THAT person, not the thread', () => {
  // A GROUP counterpart's own avatarUrl is always null from the API, so
  // falling back to the thread would throw away the only real picture.
  const withPhoto: ThreadAvatarPerson = { id: 'p', name: 'Ada', avatarUrl: 'data:image/png;base64,x' };
  const layout = threadAvatarLayout([withPhoto]);
  assert.equal(layout.kind === 'single' ? layout.person?.avatarUrl : null, 'data:image/png;base64,x');
});

// ─── positive siblings ───────────────────────────────────────────────────
//
// Without these, an implementation that returned 'single' for everything
// would pass the crash test above and look correct.

test('TWO participants still get the duo-stack', () => {
  const layout = threadAvatarLayout([person('Ada'), person('Grace')]);
  assert.equal(layout.kind, 'duo');
  if (layout.kind === 'duo') {
    assert.equal(layout.back.name, 'Ada');
    assert.equal(layout.front.name, 'Grace');
  }
});

test('THREE participants get the first face plus a count', () => {
  const layout = threadAvatarLayout([person('Ada'), person('Grace'), person('Alan')]);
  assert.equal(layout.kind, 'overflow');
  if (layout.kind === 'overflow') {
    assert.equal(layout.back.name, 'Ada');
    // +N counts everyone except the face already shown.
    assert.equal(layout.count, 2);
  }
});

test('FIVE participants count correctly', () => {
  const layout = threadAvatarLayout(['a', 'b', 'c', 'd', 'e'].map(person));
  assert.equal(layout.kind === 'overflow' ? layout.count : null, 4);
});

// ─── the absent cases ────────────────────────────────────────────────────

test('no participants falls back to the thread itself', () => {
  // CLIENT and STAFF threads omit the field entirely; a GROUP where the
  // viewer is the only member sends an empty array ("Just you").
  for (const input of [undefined, null, [] as ThreadAvatarPerson[]]) {
    const layout = threadAvatarLayout(input);
    assert.equal(layout.kind, 'single');
    assert.equal(layout.kind === 'single' ? layout.person : 'x', null);
  }
});

// Guards the indices the render actually dereferences: every non-single
// layout must hand back real objects, never a hole.
test('every layout returns defined people for the faces it names', () => {
  for (let n = 0; n <= 6; n += 1) {
    const layout = threadAvatarLayout(Array.from({ length: n }, (_, i) => person(`p${i}`)));
    if (layout.kind === 'duo') {
      assert.ok(layout.back && layout.front, `n=${n}: duo must have both faces`);
    } else if (layout.kind === 'overflow') {
      assert.ok(layout.back, `n=${n}: overflow must have a back face`);
      assert.ok(layout.count >= 2, `n=${n}: a count of 1 should have been a duo`);
    }
  }
});

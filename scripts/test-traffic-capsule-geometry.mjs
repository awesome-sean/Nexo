import test from 'node:test';
import assert from 'node:assert/strict';
import { configureMiniBarGeometry, getMiniBarCollapsedSize, calculateWindowBoundsForState, calculateCollapsedBounds, calculateEdgeTabBounds, restoreAnchorFromEdgeTab } from '../src/main/services/minibar-geometry.ts';

test('traffic capsules preserve all four anchors, edge silhouettes and zoom bounds', () => {
  for (const scale of [.5625,.75,1.125]) for (const text of [false,true]) {
    configureMiniBarGeometry(scale,text);
    for (const side of ['left','right','top','bottom']) {
      const horizontal = side === 'top' || side === 'bottom';
      const size = getMiniBarCollapsedSize(side,1);
      const length = (text?537:485)*80/132;
      assert.ok((horizontal?size.width:size.height) >= (length+32)*scale);
      assert.ok((horizontal?size.height:size.width) >= 112*scale);
      const anchor={x:800,y:300};
      const expanded=calculateWindowBoundsForState(anchor,true,side,1);
      const roundTrip=calculateCollapsedBounds(expanded,true,side,1);
      assert.deepEqual(roundTrip,anchor);
      const tab=calculateEdgeTabBounds(anchor,side,size.height,1);
      assert.deepEqual(restoreAnchorFromEdgeTab(tab,side,size.height,1),anchor);
      if(side==='left') assert.equal(tab.x,anchor.x);
      if(side==='right') assert.equal(tab.x+tab.width,anchor.x+size.width);
      if(side==='top') assert.equal(tab.y,anchor.y);
      if(side==='bottom') assert.equal(tab.y+tab.height,anchor.y+size.height);
      assert.ok(expanded.width >= size.width && expanded.height >= size.height);
    }
  }
  configureMiniBarGeometry(1,true);
});

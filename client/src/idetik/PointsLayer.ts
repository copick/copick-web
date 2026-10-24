/**
 * Base of copick's point overlays (pick markers, filaments, filament handles, segmentation surfaces): one idetik
 * points object, replaced whenever the layer rebuilds.
 *
 * Subclasses rebuild from `update()` and return whether they did, so idetik redraws only when something changed.
 */

import { Layer, PointsRenderable, type PointProps } from "@idetik/core";

export type { PointProps };

export abstract class PointsLayer extends Layer {
  private readonly depthTest_: boolean;

  constructor({ depthTest }: { depthTest: boolean }) {
    super({ blendMode: "normal" });
    this.depthTest_ = depthTest;
  }

  /** Draw these points instead of the previous ones (nothing when empty). */
  protected setPoints(props: PointProps[]): void {
    this.clearObjects();
    if (props.length === 0) return;
    const object = new PointsRenderable(props);
    object.depthTest = this.depthTest_;
    this.addObject(object);
  }
}

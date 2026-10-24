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

  /**
   * @param depthTest - Whether points are depth-tested against occluding layers.
   * @param occludes - Whether the points write depth, hiding what is behind them (idetik draws occluding layers
   *   first, and only they contribute depth).
   */
  constructor({
    depthTest,
    occludes = false,
  }: {
    depthTest: boolean;
    occludes?: boolean;
  }) {
    super({ blendMode: "normal", occludes });
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

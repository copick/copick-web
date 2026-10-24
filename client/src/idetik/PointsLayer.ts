/**
 * Base of copick's point overlays (pick markers, filaments, filament handles, segmentation surfaces): one idetik
 * points object, replaced whenever the layer rebuilds.
 *
 * Subclasses rebuild from `update()` and return whether they did, so idetik redraws only when something changed.
 * Replaced points release their GPU buffers: idetik keeps one per geometry it has drawn, and slicing builds new
 * geometry every step.
 */

import { Layer, PointsRenderable, type PointProps } from "@idetik/core";

export type { PointProps };

/** idetik's runtime context (not exported by the package). */
type Context = Parameters<Layer["onAttached"]>[0];

export abstract class PointsLayer extends Layer {
  private readonly depthTest_: boolean;
  private context_: Context | null = null;
  private object_: PointsRenderable | null = null;

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

  protected attach(context: Context): void {
    super.attach(context);
    this.context_ = context;
  }

  /** Release the GPU buffers; the points stay and are uploaded again if the layer is shown again. */
  protected detach(context: Context): void {
    this.object_?.disposeGeometry(context.disposeGeometry);
    this.context_ = null;
    super.detach(context);
  }

  /** Draw these points instead of the previous ones (nothing when empty). */
  protected setPoints(props: PointProps[]): void {
    if (this.object_ && this.context_)
      this.object_.disposeGeometry(this.context_.disposeGeometry);
    this.object_ = null;
    this.clearObjects();
    if (props.length === 0) return;
    const object = new PointsRenderable(props);
    object.depthTest = this.depthTest_;
    this.addObject(object);
    this.object_ = object;
  }
}

interface CanvasProps {
  canvasRefCallback: (canvas: HTMLCanvasElement | null) => void;
}

export function Canvas({ canvasRefCallback }: CanvasProps) {
  return <canvas ref={canvasRefCallback} className="h-full w-full" />;
}

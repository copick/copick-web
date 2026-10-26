/**
 * Types for the vtk.js filters the isosurface worker uses that ship without declarations (vtk.js has types for its
 * data model, `ImageData` and `PolyData`, but not for these). Only what `mesher.ts` calls is declared.
 */

declare module "@kitware/vtk.js/Filters/General/ImageMarchingCubes" {
  import type { vtkImageData } from "@kitware/vtk.js/Common/DataModel/ImageData";
  import type { vtkPolyData } from "@kitware/vtk.js/Common/DataModel/PolyData";

  export interface vtkImageMarchingCubes {
    setInputData(data: vtkImageData): void;
    getOutputData(): vtkPolyData;
  }
  const vtkImageMarchingCubes: {
    newInstance(initialValues?: {
      contourValue?: number;
      computeNormals?: boolean;
      mergePoints?: boolean;
    }): vtkImageMarchingCubes;
  };
  export default vtkImageMarchingCubes;
}

declare module "@kitware/vtk.js/Filters/General/WindowedSincPolyDataFilter" {
  import type { vtkPolyData } from "@kitware/vtk.js/Common/DataModel/PolyData";

  export interface vtkWindowedSincPolyDataFilter {
    setInputData(data: vtkPolyData): void;
    getOutputData(): vtkPolyData;
  }
  const vtkWindowedSincPolyDataFilter: {
    newInstance(initialValues?: {
      numberOfIterations?: number;
      passBand?: number;
      featureEdgeSmoothing?: boolean;
      boundarySmoothing?: boolean;
      nonManifoldSmoothing?: boolean;
      normalizeCoordinates?: boolean;
    }): vtkWindowedSincPolyDataFilter;
  };
  export default vtkWindowedSincPolyDataFilter;
}

declare module "@kitware/vtk.js/Filters/Core/PolyDataNormals" {
  import type { vtkPolyData } from "@kitware/vtk.js/Common/DataModel/PolyData";

  export interface vtkPolyDataNormals {
    setInputData(data: vtkPolyData): void;
    getOutputData(): vtkPolyData;
  }
  const vtkPolyDataNormals: {
    newInstance(initialValues?: {
      computePointNormals?: boolean;
      computeCellNormals?: boolean;
    }): vtkPolyDataNormals;
  };
  export default vtkPolyDataNormals;
}

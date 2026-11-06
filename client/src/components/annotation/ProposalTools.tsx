/**
 * Model proposals for the painting: nnInteractive prompts (when the server has an nnInteractive backend) and a
 * completed CellCanvas prediction. Each result is a separate proposal segmentation, displayed for inspection, and is
 * written into the painting only by Accept, which fills unknown voxels and is undone like a stroke.
 */

import { useCallback, useEffect, useState } from "react";
import { Box, Button, Chip, Tooltip, Typography } from "@mui/material";
import {
  annotationsApi,
  nninteractiveApi,
  strokeBox,
  type Box3,
  type PaintClass,
  type PaintTarget,
  type ProposalRecord,
  type SegmentationRef,
} from "@/api/annotations";
import { refreshProjectData } from "@/api/projectRevision";
import { segmentationKey, useCopick } from "@/contexts/CopickContext";
import { useQueryClient } from "@tanstack/react-query";
import type { usePainting } from "./usePainting";

type Painting = ReturnType<typeof usePainting>;

/** Display a multilabel segmentation of the opened reconstruction (once). */
export function useShowSegmentation(voxelSize: number) {
  const { state, addSegmentation } = useCopick();
  return useCallback(
    (ref: SegmentationRef) => {
      const seg = {
        name: ref.name,
        userId: ref.user_id,
        sessionId: ref.session_id,
        voxelSize,
        segmentationType: "multilabel" as const,
      };
      if (
        !state.selectedSegmentations.some(
          (s) => segmentationKey(s) === segmentationKey(seg),
        )
      )
        addSegmentation(seg);
    },
    [addSegmentation, voxelSize, state.selectedSegmentations],
  );
}

export type PointHandler = (
  voxel: [number, number, number],
  include: boolean,
) => void;

interface Props {
  projectId: string;
  target: PaintTarget;
  painting: Painting;
  classes: PaintClass[];
  /** Reconstruction shape (x, y, z). */
  shape: [number, number, number] | null;
  nninteractive: boolean;
  /** A published CellCanvas prediction to accept from, when there is one. */
  prediction?: SegmentationRef | null;
  /** Receives the click handler of the include/exclude modes (null when clicks are not prompts). */
  setPointHandler: (handler: PointHandler | null) => void;
}

export function ProposalTools({
  projectId,
  target,
  painting,
  classes,
  shape,
  nninteractive,
  prediction,
  setPointHandler,
}: Props) {
  const queryClient = useQueryClient();
  const show = useShowSegmentation(target.voxel_size);
  const [session, setSession] = useState<{
    id: string;
    supportsUndo: boolean;
  } | null>(null);
  const [proposal, setProposal] = useState<{
    record: ProposalRecord;
    label: number;
    box: Box3 | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const label = painting.label;
  const proposalRef: SegmentationRef = {
    name: "nninteractive-proposal",
    user_id: target.painting.user_id,
    session_id: target.painting.session_id,
  };
  const name = (id: number) =>
    classes.find((c) => c.id === id)?.name ?? `label ${id}`;

  const run = useCallback(
    async (work: () => Promise<void>) => {
      setBusy(true);
      painting.setMessage(null);
      try {
        await work();
      } catch (e) {
        const error = e as Error & { code?: string };
        if (error.code === "session_lost") setSession(null);
        painting.setMessage({ severity: "error", text: error.message });
      } finally {
        setBusy(false);
      }
    },
    [painting],
  );

  const shown = useCallback(
    async (record: ProposalRecord, proposalLabel: number, box: Box3 | null) => {
      setProposal({ record, label: proposalLabel, box });
      await refreshProjectData(queryClient, projectId);
      show(record.ref);
    },
    [projectId, queryClient, show],
  );

  const start = () =>
    run(async () => {
      const opened = await nninteractiveApi.open(projectId, target);
      setSession({ id: opened.session_id, supportsUndo: opened.supports_undo });
    });

  // Close the session with the panel or when the reconstruction changes.
  useEffect(() => {
    if (!session) return;
    return () =>
      void nninteractiveApi.close(projectId, session.id).catch(() => {});
  }, [projectId, session]);

  const segmentStroke = () =>
    run(async () => {
      const stroke = painting.lastStroke;
      if (!session || !stroke || !shape) return;
      const box = strokeBox(stroke, shape);
      const result = await nninteractiveApi.prompt(
        projectId,
        session.id,
        target,
        proposalRef,
        stroke.label,
        { label: stroke.label, box },
      );
      await shown(result.proposal, stroke.label, null);
    });

  // Clicks in the include/exclude modes become point prompts for the current class.
  useEffect(() => {
    const handler: PointHandler | null =
      session && label != null
        ? (voxel, include) =>
            void run(async () => {
              const result = await nninteractiveApi.prompt(
                projectId,
                session.id,
                target,
                proposalRef,
                label,
                { point: voxel, include },
              );
              await shown(result.proposal, label, null);
            })
        : null;
    setPointHandler(handler);
    return () => setPointHandler(null);
  });

  const undoPrompt = () =>
    run(async () => {
      if (!session || !proposal) return;
      const result = await nninteractiveApi.undo(
        projectId,
        session.id,
        target,
        proposalRef,
        proposal.label,
      );
      await shown(result.proposal, proposal.label, null);
    });

  const inspectPrediction = () =>
    run(async () => {
      if (!prediction || label == null) return;
      const record = await annotationsApi.proposal(
        projectId,
        target,
        prediction,
      );
      const stroke = painting.lastStroke;
      if (!stroke || !shape) {
        painting.setMessage({
          severity: "info",
          text: "Paint a stroke first: the prediction is accepted only in the box around it.",
        });
        return;
      }
      setProposal({ record, label, box: strokeBox(stroke, shape) });
    });

  const accept = () =>
    run(async () => {
      if (!proposal || label == null) return;
      const accepted = await painting.accept(
        proposal.record,
        proposal.label,
        label,
        proposal.box,
      );
      if (accepted)
        painting.setMessage({
          severity: "info",
          text: `Accepted ${accepted.changed_voxels} voxels as ${name(label)}; kept ${accepted.kept_human_voxels} painted voxels.`,
        });
    });

  if (!nninteractive && !prediction) return null;
  const disabled = busy || painting.saving;
  return (
    <Box
      data-testid="proposal-tools"
      sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}
    >
      <Typography variant="caption" color="text.secondary">
        Proposals
      </Typography>
      {nninteractive && !session && (
        <Button
          size="small"
          variant="outlined"
          onClick={start}
          disabled={disabled}
        >
          Start nnInteractive
        </Button>
      )}
      {session && (
        <>
          <Tooltip title="The last stroke's class inside a box around it is positive; other painted classes there are negative; unknown voxels are not prompts.">
            <span>
              <Button
                size="small"
                variant="outlined"
                onClick={segmentStroke}
                disabled={disabled || !painting.lastStroke}
              >
                Segment last stroke
              </Button>
            </span>
          </Tooltip>
          <Button
            size="small"
            variant={painting.mode === "include" ? "contained" : "outlined"}
            onClick={() =>
              painting.setMode(painting.mode === "include" ? "off" : "include")
            }
            disabled={disabled || label == null}
          >
            + click
          </Button>
          <Button
            size="small"
            variant={painting.mode === "exclude" ? "contained" : "outlined"}
            onClick={() =>
              painting.setMode(painting.mode === "exclude" ? "off" : "exclude")
            }
            disabled={disabled || label == null}
          >
            − click
          </Button>
          {session.supportsUndo && (
            <Button
              size="small"
              onClick={undoPrompt}
              disabled={disabled || !proposal}
            >
              Undo prompt
            </Button>
          )}
        </>
      )}
      {prediction && (
        <Button
          size="small"
          variant="outlined"
          onClick={inspectPrediction}
          disabled={disabled || label == null}
        >
          Use prediction near last stroke
        </Button>
      )}
      {proposal && label != null && (
        <>
          <Chip
            size="small"
            label={`${proposal.record.producer}: ${name(proposal.label)}`}
            title={`digest ${proposal.record.digest.slice(0, 12)}`}
          />
          <Button
            size="small"
            variant="contained"
            onClick={accept}
            disabled={disabled}
            data-testid="accept-proposal"
          >
            Accept as {name(label)}
          </Button>
        </>
      )}
    </Box>
  );
}

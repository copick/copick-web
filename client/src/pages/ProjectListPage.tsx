/**
 * Landing page that lists all available projects from the registry + local configs.
 * If only one project is available, redirects to it automatically.
 */

import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Stack,
  Typography,
} from "@mui/material";
import { useProjects } from "@/api/hooks";
import type { ProjectSummaryResponse } from "@/api/types";

const STATUS_COLORS: Record<string, "success" | "warning" | "error" | "default"> = {
  completed: "success",
  running: "warning",
  failed: "error",
};

export function ProjectListPage() {
  const navigate = useNavigate();
  const { data: projects, isLoading, error } = useProjects();

  // Auto-redirect if there is exactly one project.
  useEffect(() => {
    if (projects && projects.length === 1) {
      navigate(`/projects/${encodeURIComponent(projects[0].id)}`, { replace: true });
    }
  }, [projects, navigate]);

  if (isLoading) {
    return (
      <Box sx={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Typography color="error">Failed to load projects: {String(error)}</Typography>
      </Box>
    );
  }

  if (!projects || projects.length === 0) {
    return (
      <Box sx={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Typography color="text.secondary">No projects available.</Typography>
      </Box>
    );
  }

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Typography variant="h4" sx={{ mb: 3 }}>
        Projects
      </Typography>
      <Stack spacing={2}>
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </Stack>
    </Container>
  );
}

function ProjectCard({ project }: { project: ProjectSummaryResponse }) {
  const navigate = useNavigate();
  const statusColor = project.status ? STATUS_COLORS[project.status] ?? "default" : "default";

  return (
    <Card>
      <CardActionArea onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}`)}>
        <CardContent>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, flexWrap: "wrap" }}>
            <Typography variant="h6">{project.id}</Typography>
            <Chip label={project.source} size="small" variant="outlined" />
            {project.status && <Chip label={project.status} size="small" color={statusColor} />}
          </Box>
          <Box sx={{ display: "flex", gap: 2, color: "text.secondary", flexWrap: "wrap" }}>
            {project.cluster_id && (
              <Typography variant="body2">cluster: {project.cluster_id}</Typography>
            )}
            {project.scope && <Typography variant="body2">scope: {project.scope}</Typography>}
            {project.session_name && (
              <Typography variant="body2">session: {project.session_name}</Typography>
            )}
            {project.run_name && <Typography variant="body2">run: {project.run_name}</Typography>}
            {project.created_at && (
              <Typography variant="body2">created: {project.created_at}</Typography>
            )}
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

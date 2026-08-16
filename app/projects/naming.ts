import type { ProjectSummary } from "../project-format";

/** Creates an identity that is stable across browser saves and exports. */

export const createProjectId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Keeps project names short for the header and avoids overwriting an existing
 * browser project when importing or duplicating a file with the same name.
 */

export const uniqueProjectName = (
  requestedName: string,
  existingProjects: ProjectSummary[],
  fallback: string,
) => {
  const base = requestedName.trim().slice(0, 20) || fallback.slice(0, 20),
    names = new Set(existingProjects.map((project) => project.name.toLocaleLowerCase()));
  if (!names.has(base.toLocaleLowerCase())) return base;
  for (let index = 2; index < 10000; index++) {
    const suffix = ` (${index})`,
      candidate = `${base.slice(0, 20 - suffix.length)}${suffix}`;
    if (!names.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return `${base.slice(0, 14)}-${Date.now().toString(36).slice(-5)}`;
};

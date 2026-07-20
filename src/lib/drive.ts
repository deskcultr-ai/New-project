export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const PERSONAL_FOLDER_PREFIX = (organizationId: string, profileId: string) => `${organizationId}/personal/${profileId}`;

export const RESOURCES_PREFIX = (organizationId: string, departmentId: string) => `${organizationId}/${departmentId}/resources`;

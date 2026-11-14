import { createServerFn } from "@tanstack/react-start";

export const getDriveAccess = createServerFn({ method: "POST" }).handler(async () => {
  const { driveAccess } = await import("./drive.server");
  return driveAccess();
});

export const success = (
  data: unknown,
  message = "Request completed successfully",
  meta?: Record<string, unknown>,
) => {
  const response: any = { success: true, message, data };
  if (meta) {
    response.meta = meta;
  }
  return response;
};

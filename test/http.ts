const baseUrl = `http://127.0.0.1:${process.env.TEST_API_PORT ?? '3101'}`;

export type ApiResponse<T = unknown> = {
  status: number;
  body: T;
  headers: Headers;
};

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResponse<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body =
    response.status === 204
      ? null
      : response.headers.get('content-type')?.includes('application/json')
        ? ((await response.json()) as T)
        : ((await response.text()) as T);
  return { status: response.status, body, headers: response.headers };
}

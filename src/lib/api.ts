export const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
export const GLOBAL_LOGOUT_EVENT = "papuyu:logout";
const DEFAULT_TIMEOUT_MS = 15_000;

export interface ApiRequestOptions {
  timeoutMs?: number;
  autoLogoutOn401?: boolean;
}

export interface ApiRequestError extends Error {
  status?: number;
  details?: unknown;
}

async function parseResponseBody(response: Response) {
  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (isJson) {
    return response.json().catch(() => ({}));
  }

  return response.text().catch(() => "");
}

function createApiError(message: string, status?: number, details?: unknown, name = "ApiRequestError"): ApiRequestError {
  const error = new Error(message) as ApiRequestError;
  error.name = name;
  error.status = status;
  error.details = details;
  return error;
}

export async function apiRequest(
  endpoint: string,
  method: string = "GET",
  body?: any,
  options: ApiRequestOptions = {},
) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, autoLogoutOn401 = true } = options;
  const token = localStorage.getItem("token");
  const headers: HeadersInit = {};

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  const requestOptions: RequestInit = {
    method,
    headers,
    signal: controller.signal,
  };

  if (body !== undefined) {
    requestOptions.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(`${API_URL}${endpoint}`, requestOptions);
    const responseBody = await parseResponseBody(response);

    if (!response.ok) {
      if (response.status === 401 && autoLogoutOn401) {
        localStorage.removeItem("token");
        localStorage.removeItem("user");
        window.dispatchEvent(
          new CustomEvent(GLOBAL_LOGOUT_EVENT, {
            detail: { reason: "unauthorized" },
          }),
        );
      }

      const message =
        typeof responseBody === "object" &&
        responseBody !== null &&
        "error" in responseBody &&
        typeof responseBody.error === "string"
          ? responseBody.error
          : `Request failed with status ${response.status}`;

      throw createApiError(
        message,
        response.status,
        responseBody,
        response.status === 401 ? "UnauthorizedError" : "ApiRequestError",
      );
    }

    return responseBody;
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw createApiError("Request timed out", 0, { reason: "timeout" }, "TimeoutError");
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

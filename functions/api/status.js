import { callGasGet, configurationError, isAllowedBrowserRequest, jsonResponse } from "../../src/gas.js";

export async function onRequestGet({ request, env }) {
  const configProblem = configurationError(env);
  if (configProblem) return jsonResponse({ status: "error", message: configProblem }, 500);
  if (!isAllowedBrowserRequest(request, env, false)) {
    return jsonResponse({ status: "error", message: "허용된 홈페이지에서만 조회할 수 있습니다." }, 403);
  }

  const url = new URL(request.url);
  const requestId = String(url.searchParams.get("requestId") || "").trim();
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) {
    return jsonResponse({ status: "error", message: "requestId가 올바르지 않습니다." }, 400);
  }

  try {
    const result = await callGasGet(env, { action: "submitStatus", requestId });
    return jsonResponse(result, 200);
  } catch (error) {
    // 조회 자체의 일시적 실패는 브라우저가 다음 주기에 다시 확인할 수 있도록 pending으로 응답합니다.
    return jsonResponse({ status: "pending", retryable: true }, 200);
  }
}

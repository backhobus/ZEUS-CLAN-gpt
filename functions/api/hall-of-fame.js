import { callGasGet, configurationError, isAllowedBrowserRequest, jsonResponse } from "../../src/gas.js";

export async function onRequestGet({ request, env }) {
  const configProblem = configurationError(env);
  if (configProblem) return jsonResponse({ result: "error", success: false, message: configProblem }, 500);
  if (!isAllowedBrowserRequest(request, env, false)) {
    return jsonResponse({ result: "error", success: false, message: "허용된 홈페이지에서만 조회할 수 있습니다." }, 403);
  }

  try {
    const result = await callGasGet(env, { action: "hallOfFame" });
    if (!result || result.success !== true) {
      return jsonResponse({ result: "error", success: false, message: "명예의 전당을 조회하지 못했습니다." }, 502);
    }
    return jsonResponse(result, 200);
  } catch (error) {
    return jsonResponse({ result: "error", success: false, message: "명예의 전당 서버에 연결하지 못했습니다." }, 502);
  }
}

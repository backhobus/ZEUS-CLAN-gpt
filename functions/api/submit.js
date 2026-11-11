import { callGasPost, configurationError, isAllowedBrowserRequest, jsonResponse } from "../../src/gas.js";

function cleanText(value, maxLength) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function osFromUserAgent(userAgent) {
  if (/Android/i.test(userAgent)) return "Android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "iOS";
  if (/Windows NT/i.test(userAgent)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "macOS";
  if (/CrOS/i.test(userAgent)) return "ChromeOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "확인 불가";
}

function modelFromUserAgent(userAgent) {
  const samsungModel = userAgent.match(/\b(SM-[A-Z0-9]+)\b/i);
  if (samsungModel) return samsungModel[1].toUpperCase();
  if (/iPhone/i.test(userAgent)) return "iPhone (세부 모델 미제공)";
  if (/iPad/i.test(userAgent)) return "iPad (세부 모델 미제공)";
  if (/Android/i.test(userAgent)) return "Android 기기 (세부 모델 미제공)";
  if (/Windows|Macintosh|X11|Linux/i.test(userAgent)) return "데스크톱 (세부 모델 미제공)";
  return "확인 불가";
}

export async function onRequestPost({ request, env }) {
  const configProblem = configurationError(env);
  if (configProblem) return jsonResponse({ success: false, message: configProblem }, 500);
  if (!isAllowedBrowserRequest(request, env, true)) {
    return jsonResponse({ success: false, message: "허용된 홈페이지에서만 신청할 수 있습니다." }, 403);
  }

  // Cloudflare가 제공하는 접속 IP만 사용합니다. IP를 확인할 수 없으면 요청을 거부합니다.
  const ipAddress = cleanText(request.headers.get("CF-Connecting-IP"), 64);
  if (!ipAddress) {
    return jsonResponse({ success: false, message: "접속 IP를 확인할 수 없어 요청이 차단되었습니다." }, 403);
  }

  // 한국(KR) 이외의 국가와 국가 확인이 불가능한 요청은 모두 거부합니다.
  // request.cf.country를 우선 사용하고, 값이 없을 때 Cloudflare의 CF-IPCountry 헤더를 확인합니다.
  const countryCode = cleanText(
    (request.cf && request.cf.country) || request.headers.get("CF-IPCountry") || "",
    2
  ).toUpperCase();
  if (!countryCode) {
    return jsonResponse({ success: false, message: "접속 국가를 확인할 수 없어 요청이 차단되었습니다." }, 403);
  }
  if (countryCode !== "KR") {
    return jsonResponse({ success: false, message: "해외 IP에서는 가입 신청할 수 없습니다." }, 403);
  }

  // Cloudflare 환경변수 BLOCKED_APPLICATION_IPS에 등록된 IP는 정확히 일치할 때 차단합니다.
  // 여러 IP는 쉼표, 세미콜론 또는 줄바꿈으로 구분할 수 있습니다.
  const blockedApplicationIps = new Set(
    String(env.BLOCKED_APPLICATION_IPS == null ? "" : env.BLOCKED_APPLICATION_IPS)
      .split(/[,;\s]+/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
  if (blockedApplicationIps.has(ipAddress.toLowerCase())) {
    return jsonResponse({ success: false, message: "차단된 IP에서는 가입 신청할 수 없습니다." }, 403);
  }

  let body;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 20000) {
      return jsonResponse({ success: false, message: "신청서 크기가 너무 큽니다." }, 413);
    }
    body = JSON.parse(rawBody);
  } catch (error) {
    return jsonResponse({ success: false, message: "신청서 전송 형식이 올바르지 않습니다." }, 400);
  }

  const requestId = cleanText(body && body.requestId, 100);
  const application = body && body.payload;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId) || !application || typeof application !== "object" || Array.isArray(application)) {
    return jsonResponse({ success: false, message: "신청서 정보가 올바르지 않습니다." }, 400);
  }

  const required = ["nickname", "uid", "ageRange", "reason", "tournament"];
  for (const key of required) {
    if (!cleanText(application[key], key === "reason" ? 2000 : 100)) {
      return jsonResponse({ success: false, message: "가입 신청 항목이 누락되었습니다." }, 400);
    }
  }

  const userAgent = request.headers.get("User-Agent") || "";
  const clientInfo = application.clientInfo && typeof application.clientInfo === "object"
    ? application.clientInfo
    : {};
  const platformHeader = (request.headers.get("Sec-CH-UA-Platform") || "").replace(/^"|"$/g, "");
  const modelHeader = (request.headers.get("Sec-CH-UA-Model") || "").replace(/^"|"$/g, "");

  const enrichedPayload = {
    nickname: cleanText(application.nickname, 60),
    uid: cleanText(application.uid, 32),
    ageRange: cleanText(application.ageRange, 30),
    reason: cleanText(application.reason, 2000),
    tournament: cleanText(application.tournament, 30),
    ipAddress,
    os: cleanText(clientInfo.os || platformHeader || osFromUserAgent(userAgent), 80),
    deviceModel: cleanText(clientInfo.model || modelHeader || modelFromUserAgent(userAgent), 100)
  };

  try {
    const result = await callGasPost(env, requestId, enrichedPayload);
    if (!result || result.success !== true) {
      return jsonResponse({
        success: false,
        message: (result && result.message) || "가입 신청을 처리하지 못했습니다."
      }, 400);
    }
    return jsonResponse(result, 200);
  } catch (error) {
    // 신청 데이터와 IP를 로그에 남기지 않습니다. 응답이 유실되었을 가능성이 있어 상태 조회를 허용합니다.
    return jsonResponse({
      success: false,
      retryable: true,
      message: "신청 서버 응답을 확인하지 못했습니다. 처리 상태를 다시 확인하고 있습니다."
    }, 502);
  }
}

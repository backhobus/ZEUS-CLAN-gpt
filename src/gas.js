const GAS_URL_PATTERN = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin"
    }
  });
}

export function configurationError(env) {
  const endpoint = String(env.GAS_ENDPOINT || "").trim();
  const token = String(env.GAS_API_TOKEN || "");
  const allowedOrigin = String(env.ZEUS_ALLOWED_ORIGIN || "").trim();
  if (!GAS_URL_PATTERN.test(endpoint)) return "Cloudflare Pages의 GAS_ENDPOINT 설정을 확인해 주세요.";
  if (token.length < 60) return "Cloudflare Pages의 GAS_API_TOKEN Secret 설정을 확인해 주세요.";
  try {
    const originUrl = new URL(allowedOrigin);
    if (originUrl.protocol !== "https:" || originUrl.origin !== allowedOrigin) throw new Error("invalid");
  } catch (error) {
    return "Cloudflare Pages의 ZEUS_ALLOWED_ORIGIN 설정을 확인해 주세요.";
  }
  return "";
}

/**
 * 브라우저에서 온 요청의 출처를 확인합니다.
 * POST는 Origin을 필수로 확인하고, GET은 Origin/Referer/Sec-Fetch-Site 순서로 확인합니다.
 */
export function isAllowedBrowserRequest(request, env, requireOrigin = false) {
  const expected = String(env.ZEUS_ALLOWED_ORIGIN || "").trim();
  if (!expected) return false;

  const origin = request.headers.get("Origin");
  if (origin) return origin === expected;
  if (requireOrigin) return false;

  const referer = request.headers.get("Referer");
  if (referer) {
    try { return new URL(referer).origin === expected; }
    catch (error) { return false; }
  }
  return request.headers.get("Sec-Fetch-Site") === "same-origin";
}

async function parseGasResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error("Google Apps Script가 JSON이 아닌 응답을 반환했습니다. 웹 앱 배포 및 접근 권한을 확인해 주세요.");
  }
  if (!response.ok) {
    const message = data && data.message ? data.message : `Google Apps Script 응답 오류 (${response.status})`;
    throw new Error(message);
  }
  return data;
}

export async function callGasGet(env, params) {
  const configProblem = configurationError(env);
  if (configProblem) throw new Error(configProblem);

  const url = new URL(env.GAS_ENDPOINT);
  for (const [key, value] of Object.entries(params || {})) {
    url.searchParams.set(key, String(value));
  }
  url.searchParams.set("apiToken", env.GAS_API_TOKEN);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { "Accept": "application/json" },
    redirect: "follow",
    signal: AbortSignal.timeout(25000)
  });
  return parseGasResponse(response);
}

export async function callGasPost(env, requestId, payload) {
  const configProblem = configurationError(env);
  if (configProblem) throw new Error(configProblem);

  const form = new URLSearchParams();
  form.set("apiToken", env.GAS_API_TOKEN);
  form.set("requestId", requestId);
  form.set("payload", JSON.stringify(payload));

  const response = await fetch(env.GAS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "Accept": "application/json"
    },
    body: form.toString(),
    redirect: "follow",
    signal: AbortSignal.timeout(35000)
  });
  return parseGasResponse(response);
}
